/**
 * pi-think-different
 *
 * Let the user switch the agent's thinking paradigm: CoT, ToT, GoT, self-critique,
 * hypothesis & elimination, six thinking hats, dialectical debate, first principles,
 * multi-angle sweep.
 *
 * Two mechanisms, on purpose:
 *
 * 1. Scaffold injection. `/think <paradigm>` injects the paradigm's contract as a
 *    structured system-prompt section (`<thinking_paradigm>`), so every subsequent
 *    turn of this session reasons through that paradigm. Cheap: one prompt section.
 *
 * 2. Real multi-pass workflow. The `think` tool with `mode: "run"` executes the
 *    paradigm as a sequence of separate model calls, and the harness - not the
 *    model - decides which candidates survive: it parses reported scores, prunes
 *    low scorers, and tells the next step what it may build on. This is the
 *    code-driven path from the reference notes, which is more reliable than asking
 *    one model to imagine a whole tree.
 *
 * Commands:
 *   /think                       status (picker in interactive mode)
 *   /think list                  catalogue
 *   /think <paradigm> [intensity]   sticky for this session
 *   /think once <paradigm>      next turn only
 *   /think auto [intensity]     pick a paradigm per prompt by heuristic
 *   /think off                  disable
 *   /think help
 *
 * CLI flag: `--think <paradigm|auto>` starts a session with that paradigm active.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { AssistantMessage, TextContent, ThinkingContent } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import { selectParadigm } from "./autoSelect.ts";
import { DEFAULT_CONFIG, mergeConfigs, parseConfigText, type Language, type Placement, type ThinkConfig } from "./config.ts";
import { extractStructure } from "./placement.ts";
import { listParadigms, resolveParadigm, type Intensity, type Paradigm, type ParadigmStep } from "./paradigms.ts";
import { intensityFor, parseThinkArgs, renderSection, renderScaffoldForTask, SECTION_TAG } from "./render.ts";
import { autoSelectionMessage, ambiguousCueMessage, configPathsMessage, configProblemMessage, cueResolvedMessage, describeState, helpLines, paradigmName, renderList, statusLabel, t, unknownParadigmMessage } from "./ui.ts";
import { renderWorkflowResult, runWorkflow, type ModelCallResult } from "./workflow.ts";

const ENTRY_TYPE = "think-different";
const STATUS_KEY = "think";
const EXT_DIR = dirname(fileURLToPath(import.meta.url));
/**
 * Skill paths from `resources_discover` are resolved against the session cwd, so a relative
 * "skills/..." would only resolve when Pi happens to run inside this extension's folder.
 * Anchor extension-owned assets to this file's own directory instead.
 */
const SKILL_PATH = join(EXT_DIR, "skills", "think-different", "SKILL.md");
const USER_CONFIG_PATH = join(EXT_DIR, "config.json");

/** Project-level config, layered on top of the user config. */
function projectConfigPath(cwd: string): string {
	return join(cwd, ".pi", "think-different.json");
}

type ThinkMode = "off" | "sticky" | "once" | "auto";

interface ThinkState {
	mode: ThinkMode;
	paradigmId?: string;
	intensity: Intensity;
	placement: Placement;
	language: Language;
}

const THINK_PARAMS = Type.Object({
	task: Type.Optional(Type.String({ description: "The problem to think about. Omit to list paradigms." })),
	paradigm: Type.Optional(
		Type.String({
			description: "Paradigm id or alias: cot, tot, got, critique, hypothesis, hats, debate, first-principles, angles. Omit to use the session paradigm or auto-selection.",
		}),
	),
	mode: Type.Optional(Type.Union([Type.Literal("scaffold"), Type.Literal("run")])),
	intensity: Type.Optional(Type.Union([Type.Literal("light"), Type.Literal("standard"), Type.Literal("deep")])),
});

function assistantText(message: AssistantMessage): string {
	return message.content
		.filter((block): block is TextContent => block.type === "text")
		.map((block) => block.text)
		.join("\n")
		.trim();
}

function usageOf(message: AssistantMessage): ModelCallResult["usage"] {
	const usage = message.usage;
	if (!usage) return undefined;
	return { input: usage.input ?? 0, output: usage.output ?? 0, totalTokens: usage.totalTokens ?? 0 };
}

export default function thinkDifferentExtension(pi: ExtensionAPI): void {
	let state: ThinkState = { mode: "off", intensity: DEFAULT_CONFIG.intensity, placement: DEFAULT_CONFIG.placement, language: DEFAULT_CONFIG.language };
	/** Free text supplied with `/think <paradigm> <task>`; injected on the next turn only. */
	let pendingTask: string | undefined;
	/** Config-file problems found at session start, reported once. */
	let configProblems: { file: string; problem: string }[] = [];
	/** The paradigm whose contract was injected this turn, if any. */
	let injectedParadigm: Paradigm | undefined;

	function describe(): string {
		return describeState({
			lang: state.language,
			mode: state.mode,
			paradigm: resolveParadigm(state.paradigmId),
			paradigmId: state.paradigmId,
			intensity: state.intensity,
			placement: state.placement,
		});
	}

	function updateStatus(ctx: ExtensionContext): void {
		if (!ctx.hasUI) return;
		if (state.mode === "off") {
			ctx.ui.setStatus(STATUS_KEY, undefined);
			return;
		}
		ctx.ui.setStatus(STATUS_KEY, statusLabel({ lang: state.language, mode: state.mode, paradigm: resolveParadigm(state.paradigmId), paradigmId: state.paradigmId, intensity: state.intensity, placement: state.placement }));
	}

	function persist(): void {
		pi.appendEntry(ENTRY_TYPE, { ...state });
	}

	function applyState(next: ThinkState, ctx: ExtensionContext): void {
		state = next;
		updateStatus(ctx);
		persist();
	}

	function activeParadigm(): Paradigm | undefined {
		if (state.mode !== "sticky" && state.mode !== "once") return undefined;
		return resolveParadigm(state.paradigmId);
	}

	/** Read the user config and the project config, and report what is wrong with them. */
	function loadConfigLayers(cwd: string): ThinkConfig {
		configProblems = [];
		const userPath = USER_CONFIG_PATH;
		const projectPath = projectConfigPath(cwd);
		const layers: Partial<ThinkConfig>[] = [];

		for (const file of [userPath, projectPath]) {
			if (!existsSync(file)) continue;
			try {
				const report = parseConfigText(readFileSync(file, "utf8"));
				layers.push(report.config);
				for (const problem of report.problems) configProblems.push({ file, problem });
			} catch (error) {
				configProblems.push({ file, problem: error instanceof Error ? error.message : String(error) });
			}
		}

		return mergeConfigs(layers);
	}

	/** Apply a config `startup` value: a paradigm id/alias, "auto", or "off". */
	function applyStartup(startup: string): void {
		const lower = startup.trim().toLowerCase();
		if (lower === "off") {
			state = { ...state, mode: "off" };
			return;
		}
		if (lower === "auto") {
			state = { ...state, mode: "auto" };
			return;
		}
		const paradigm = resolveParadigm(startup);
		if (paradigm) state = { ...state, mode: "sticky", paradigmId: paradigm.id };
		else configProblems.push({ file: "startup", problem: `unknown paradigm '${startup}'` });
	}

	// ---------------------------------------------------------------- lifecycle

	pi.on("session_start", async (_event, ctx) => {
		const flag = pi.getFlag("think");
		const config = loadConfigLayers(process.cwd());

		state = {
			mode: "off",
			intensity: config.intensity,
			placement: config.placement,
			language: config.language,
		};
		applyStartup(config.startup);

		const branch = ctx.sessionManager.getBranch();
		let restored: ThinkState | undefined;

		for (let index = branch.length - 1; index >= 0; index -= 1) {
			const entry = branch[index] as { type?: string; customType?: string; data?: ThinkState };
			if (entry.type === "custom" && entry.customType === ENTRY_TYPE && entry.data && typeof entry.data.mode === "string") {
				restored = entry.data;
				break;
			}
		}

		if (restored) {
			state = {
				mode: restored.mode,
				paradigmId: restored.paradigmId,
				intensity: intensityFor(restored.intensity, config.intensity),
				placement: restored.placement ?? config.placement,
				language: restored.language ?? config.language,
			};
		}

		if (typeof flag === "string" && flag.trim().length > 0) {
			const auto = flag.trim().toLowerCase() === "auto";
			const paradigm = auto ? undefined : resolveParadigm(flag);
			if (auto) state = { ...state, mode: "auto" };
			else if (paradigm) state = { ...state, mode: "sticky", paradigmId: paradigm.id };
			else ctx.ui.notify(t(state.language, `Unknown --think value '${flag}'. Try: ${listParadigms().map((p) => p.id).join(", ")} | auto`, `未知的 --think 参数「${flag}」。可选：${listParadigms().map((p) => p.id).join(", ")} | auto`), "warning");
		}

		if (ctx.hasUI) {
			for (const problem of configProblems) {
				ctx.ui.notify(configProblemMessage(state.language, problem.file, problem.problem), "warning");
			}
		}

		updateStatus(ctx);
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		if (ctx.hasUI) ctx.ui.setStatus(STATUS_KEY, undefined);
	});

	pi.on("resources_discover", async () => ({
		skillPaths: [SKILL_PATH],
	}));

	// ------------------------------------------------------------ injection

	pi.on("before_agent_start", async (event, ctx) => {
		if (state.mode === "off") return;

		const prompt = event.messageType === "user" ? event.prompt : "";
		let paradigm = activeParadigm();
		let origin = state.mode === "once" ? "one-shot" : "session";

		if (state.mode === "auto") {
			const selection = selectParadigm(prompt);
			paradigm = selection.paradigm;
			origin = `auto: ${selection.score}`;
		if (paradigm && ctx.hasUI) {
				ctx.ui.notify(autoSelectionMessage(state.language, paradigm, selection.reasons), "info");
			}
		}

		if (!paradigm) {
			pendingTask = undefined;
			return;
		}

		const task = pendingTask;
		pendingTask = undefined;
		injectedParadigm = paradigm;
		event.systemPromptOptions.sections[SECTION_TAG] = renderSection(paradigm, state.intensity, state.placement, origin, task);

		if (state.mode === "once") {
			state = { ...state, mode: "off", paradigmId: undefined };
			updateStatus(ctx);
			persist();
		}
	});

	// ------------------------------------------------------- structure placement

	/**
	 * Fallback for `placement: "thinking"`: if the model put the paradigm's structure in the
	 * visible answer anyway, cut it out of the answer and hand it back as a thinking block, so the
	 * answer the user reads carries only the conclusion.
	 */
	pi.on("message_end", async (event) => {
		if (state.placement !== "thinking") return undefined;
		const paradigm = injectedParadigm;
		if (!paradigm) return undefined;

		const message = event.message as AssistantMessage | undefined;
		if (!message || message.role !== "assistant") return undefined;

		const textBlocks = message.content.filter((block): block is TextContent => block.type === "text");
		if (textBlocks.length === 0) return undefined;

		const relocated = extractStructure(textBlocks.map((block) => block.text).join("\n\n"), paradigm);
		if (!relocated.structure) return undefined;

		const thinking: ThinkingContent = { type: "thinking", thinking: relocated.structure };
		const rest = message.content.filter((block) => block.type !== "text");
		return {
			message: {
				...message,
				content: [thinking, { type: "text", text: relocated.text } as TextContent, ...rest],
			},
		};
	});

	// --------------------------------------------------------------- command

	pi.registerCommand("think", {
		description: "Switch the thinking paradigm: cot | tot | got | critique | hypothesis | hats | debate | first-principles | angles | auto | once | off | list",
		getArgumentCompletions: (argumentPrefix) => {
			const words = ["list", "status", "off", "auto", "once", "help", "config", "lang", "placement", "light", "standard", "deep", ...listParadigms().map((p) => p.id)];
			const prefix = argumentPrefix.trim().toLowerCase();
			return words
				.filter((word) => word.startsWith(prefix) || prefix.length === 0)
				.slice(0, 12)
				.map((word) => ({ value: `/think ${word}`, label: word }));
		},
		handler: async (args, ctx) => {
			const parsed = parseThinkArgs(args);

			if (parsed.unknown) {
				ctx.ui.notify(unknownParadigmMessage(state.language, parsed.unknown), "warning");
				ctx.ui.notify(renderList(state.language), "info");
				return;
			}

			if (parsed.ambiguous) {
				ctx.ui.notify(ambiguousCueMessage(state.language, parsed.ambiguous), "warning");
				return;
			}

			switch (parsed.action) {
				case "help":
					ctx.ui.notify(helpLines(state.language).join("\n"), "info");
					return;
				case "list":
					ctx.ui.notify(renderList(state.language), "info");
					return;
				case "config":
					ctx.ui.notify(configPathsMessage(state.language, USER_CONFIG_PATH, projectConfigPath(process.cwd())), "info");
					ctx.ui.notify(describe(), "info");
					if (configProblems.length > 0) {
						for (const problem of configProblems) ctx.ui.notify(configProblemMessage(state.language, problem.file, problem.problem), "warning");
					}
					return;
				case "language":
					if (!parsed.language) {
						ctx.ui.notify(t(state.language, "Usage: /think lang en|zh", "用法：/think lang en|zh"), "warning");
						return;
					}
					applyState({ ...state, language: parsed.language }, ctx);
					ctx.ui.notify(describe(), "info");
					return;
				case "placement":
					if (!parsed.placement) {
						ctx.ui.notify(t(state.language, "Usage: /think placement answer|thinking", "用法：/think placement answer|thinking"), "warning");
						return;
					}
					applyState({ ...state, placement: parsed.placement }, ctx);
					ctx.ui.notify(describe(), "info");
					return;
				case "off":
					applyState({ ...state, mode: "off", paradigmId: undefined }, ctx);
					ctx.ui.notify(describe(), "info");
					return;
				case "intensity":
					applyState({ ...state, intensity: parsed.intensity ?? state.intensity }, ctx);
					ctx.ui.notify(describe(), "info");
					return;
				case "auto":
					applyState({ ...state, mode: "auto", intensity: parsed.intensity ?? state.intensity }, ctx);
					ctx.ui.notify(describe(), "info");
					return;
				case "once":
					if (!parsed.paradigm) {
						ctx.ui.notify(t(state.language, "Usage: /think once <paradigm>", "用法：/think once <范式>"), "warning");
						return;
					}
					pendingTask = parsed.task;
					applyState({ ...state, mode: "once", paradigmId: parsed.paradigm.id, intensity: parsed.intensity ?? state.intensity }, ctx);
					if (parsed.viaCue) ctx.ui.notify(cueResolvedMessage(state.language, parsed.paradigm, parsed.viaCue), "info");
					ctx.ui.notify(describe(), "info");
					return;
				case "set":
					if (!parsed.paradigm) {
						await showStatus(ctx);
						return;
					}
					pendingTask = parsed.task;
					applyState({ ...state, mode: "sticky", paradigmId: parsed.paradigm.id, intensity: parsed.intensity ?? state.intensity }, ctx);
					if (parsed.viaCue) ctx.ui.notify(cueResolvedMessage(state.language, parsed.paradigm, parsed.viaCue), "info");
					ctx.ui.notify(pendingTask ? `${describe()} ${t(state.language, "- task set for the next turn", "· 已设定下一个回合的任务")}` : describe(), "info");
					return;
				case "status":
				default:
					await showStatus(ctx);
					return;
			}
		},
	});

	async function showStatus(ctx: ExtensionCommandContext): Promise<void> {
		const lang = state.language;
		if (ctx.hasUI && ctx.mode === "tui") {
			const options = [
				...listParadigms().map((p) => `${p.emoji} ${p.id} · ${lang === "zh" ? p.titleZh : p.title}`),
				t(lang, "🎯 auto (pick per prompt)", "🎯 auto（每个提示词自动选）"),
				t(lang, "⏹ off", "⏹ 关闭"),
			];
			const choice = await ctx.ui.select(t(lang, "Thinking paradigm", "思考范式"), options);
			if (!choice) {
				ctx.ui.notify(describe(), "info");
				return;
			}
			if (choice.startsWith("⏹")) {
				applyState({ ...state, mode: "off", paradigmId: undefined }, ctx);
				ctx.ui.notify(describe(), "info");
				return;
			}
			if (choice.startsWith("🎯")) {
				applyState({ ...state, mode: "auto" }, ctx);
				ctx.ui.notify(describe(), "info");
				return;
			}
			const pickedId = choice.split(" ")[1];
			const paradigm = resolveParadigm(pickedId);
			if (!paradigm) {
				ctx.ui.notify(describe(), "info");
				return;
			}
			applyState({ ...state, mode: "sticky", paradigmId: paradigm.id }, ctx);
			ctx.ui.notify(describe(), "info");
			return;
		}
		ctx.ui.notify(`${describe()}\n${renderList(lang)}`, "info");
	}

	// ----------------------------------------------------------------- tool

	pi.registerTool({
		name: "think",
		label: "Thinking paradigm",
		description:
			"Apply a named thinking paradigm to a problem: cot, tot, got, critique, hypothesis, hats, debate, first-principles, angles. " +
			"mode 'scaffold' returns the structure for you to follow in this turn. mode 'run' executes the paradigm as separate model calls with external branch scoring and pruning - use it when a considered answer matters more than speed. " +
			"Call with no task to list paradigms.",
		promptSnippet: "Apply a thinking paradigm (CoT / ToT / GoT / self-critique / hypothesis / six hats / debate / first principles / multi-angle) to a problem",
		promptGuidelines: [
			"- Use `think` with mode 'run' for design choices, root-cause hunting, and decisions you are about to act on; use mode 'scaffold' for lighter structured reasoning.",
			"- A paradigm chosen with `/think` is already injected into the system prompt; do not call `think` for the same paradigm again in that turn.",
		],
		parameters: THINK_PARAMS,
		async execute(_toolCallId, params, signal, _onUpdate, ctx: ExtensionToolContext) {
			const mode = params.mode ?? "scaffold";
			const intensity = intensityFor(params.intensity, state.intensity);

			if (!params.task) {
				return { content: [{ type: "text", text: renderList(state.language) }], details: { action: "list" } };
			}

			if (params.paradigm) {
				const requested = resolveParadigm(params.paradigm);
				if (!requested) {
					return {
						content: [{ type: "text", text: `Unknown paradigm '${params.paradigm}'. Available: ${listParadigms().map((p) => p.id).join(", ")}` }],
						details: { action: "error" },
						isError: true,
					};
				}
			}

			const selection = selectParadigm(params.task);
			const paradigm =
				resolveParadigm(params.paradigm) ?? activeParadigm() ?? selection.paradigm ?? listParadigms().find((p) => p.id === "cot");

			if (!paradigm) {
				return { content: [{ type: "text", text: renderList(state.language) }], details: { action: "list" } };
			}

			if (mode === "scaffold") {
				return {
					content: [{ type: "text", text: renderScaffoldForTask(paradigm, intensity, params.task) }],
					details: { action: "scaffold", paradigm: paradigm.id, intensity },
				};
			}

			const model = ctx.model;
			if (!model) {
				return { content: [{ type: "text", text: "think mode 'run' needs a model in this session." }], details: { action: "error" }, isError: true };
			}

			const call = async (system: string, user: string, _step: ParadigmStep): Promise<ModelCallResult> => {
				const stream = ctx.modelRegistry.streamSimple(
					model,
					{ systemPrompt: system, messages: [{ role: "user", content: user, timestamp: Date.now() }] },
					{ signal },
				);
				const message = await stream.result();
				if (message.stopReason === "error") {
					throw new Error(message.errorMessage ?? `model call failed (${message.provider})`);
				}
				return { text: assistantText(message), usage: usageOf(message) };
			};

			const result = await runWorkflow(paradigm, params.task, intensity, call);
			const text = renderWorkflowResult(result, params.task);
			const capped = text.length > 24000 ? `${text.slice(0, 24000)}\n... [workflow output truncated]` : text;

			return {
				content: [{ type: "text", text: capped }],
				details: {
					action: "run",
					paradigm: paradigm.id,
					intensity,
					steps: result.steps.map((step) => ({ id: step.id, label: step.label, gate: step.gate })),
				},
				usage: {
					input: result.usage.input,
					output: result.usage.output,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: result.usage.totalTokens,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
			};
		},
	});

	pi.registerFlag("think", { description: "Start the session with a thinking paradigm (id or 'auto')", type: "string", default: "" });
}
