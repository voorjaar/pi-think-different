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

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { AssistantMessage, TextContent } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import { selectParadigm } from "./autoSelect.ts";
import { listParadigms, resolveParadigm, type Intensity, type Paradigm, type ParadigmStep } from "./paradigms.ts";
import { intensityFor, parseThinkArgs, renderList, renderSection, renderScaffoldForTask, SECTION_TAG } from "./render.ts";
import { renderWorkflowResult, runWorkflow, type ModelCallResult } from "./workflow.ts";

const ENTRY_TYPE = "think-different";
const STATUS_KEY = "think";
/**
 * Skill paths from `resources_discover` are resolved against the session cwd, so a relative
 * "skills/..." would only resolve when Pi happens to run inside this extension's folder.
 * Anchor the bundled skill to this file's own directory instead.
 */
const SKILL_PATH = join(dirname(fileURLToPath(import.meta.url)), "skills", "think-different", "SKILL.md");

type ThinkMode = "off" | "sticky" | "once" | "auto";

interface ThinkState {
	mode: ThinkMode;
	paradigmId?: string;
	intensity: Intensity;
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
	let state: ThinkState = { mode: "off", intensity: "standard" };
	/** Free text supplied with `/think <paradigm> <task>`; injected on the next turn only. */
	let pendingTask: string | undefined;

	function describe(): string {
		if (state.mode === "off") return "thinking paradigm: off (default Pi reasoning)";
		if (state.mode === "auto") return `thinking paradigm: auto (heuristic per prompt), intensity ${state.intensity}`;
		const paradigm = resolveParadigm(state.paradigmId);
		const label = paradigm ? `${paradigm.emoji} ${paradigm.id} (${paradigm.titleZh})` : state.paradigmId ?? "unknown";
		return `thinking paradigm: ${label}, intensity ${state.intensity}${state.mode === "once" ? " (next turn only)" : ""}`;
	}

	function updateStatus(ctx: ExtensionContext): void {
		if (!ctx.hasUI) return;
		if (state.mode === "off") {
			ctx.ui.setStatus(STATUS_KEY, undefined);
			return;
		}
		const paradigm = resolveParadigm(state.paradigmId);
		const short = state.mode === "auto" ? "🧠 auto" : `${paradigm?.emoji ?? "🧠"} ${paradigm?.id ?? state.paradigmId ?? "?"}`;
		ctx.ui.setStatus(STATUS_KEY, state.intensity === "standard" ? short : `${short} · ${state.intensity}`);
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

	// ---------------------------------------------------------------- lifecycle

	pi.on("session_start", async (_event, ctx) => {
		const flag = pi.getFlag("think");
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
			state = { mode: restored.mode, paradigmId: restored.paradigmId, intensity: intensityFor(restored.intensity) };
		}

		if (typeof flag === "string" && flag.trim().length > 0) {
			const auto = flag.trim().toLowerCase() === "auto";
			const paradigm = auto ? undefined : resolveParadigm(flag);
			if (auto) state = { mode: "auto", intensity: state.intensity };
			else if (paradigm) state = { mode: "sticky", paradigmId: paradigm.id, intensity: state.intensity };
			else ctx.ui.notify(`Unknown --think value '${flag}'. Try: ${listParadigms().map((p) => p.id).join(", ")} | auto`, "warning");
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
				ctx.ui.notify(`auto thinking paradigm → ${paradigm.emoji} ${paradigm.id} (${selection.reasons.slice(0, 3).join("; ")})`, "info");
			}
		}

		if (!paradigm) {
			pendingTask = undefined;
			return;
		}

		const task = pendingTask;
		pendingTask = undefined;
		event.systemPromptOptions.sections[SECTION_TAG] = renderSection(paradigm, state.intensity, origin, task);

		if (state.mode === "once") {
			state = { mode: "off", intensity: state.intensity };
			updateStatus(ctx);
			persist();
		}
	});

	// --------------------------------------------------------------- command

	pi.registerCommand("think", {
		description: "Switch the thinking paradigm: cot | tot | got | critique | hypothesis | hats | debate | first-principles | angles | auto | once | off | list",
		getArgumentCompletions: (argumentPrefix) => {
			const words = ["list", "status", "off", "auto", "once", "help", "light", "standard", "deep", ...listParadigms().map((p) => p.id)];
			const prefix = argumentPrefix.trim().toLowerCase();
			return words
				.filter((word) => word.startsWith(prefix) || prefix.length === 0)
				.slice(0, 12)
				.map((word) => ({ value: `/think ${word}`, label: word }));
		},
		handler: async (args, ctx) => {
			const parsed = parseThinkArgs(args);

			if (parsed.unknown) {
				ctx.ui.notify(`Unknown thinking paradigm '${parsed.unknown}'. Available: ${listParadigms().map((p) => p.id).join(", ")}`, "warning");
				ctx.ui.notify(renderList(), "info");
				return;
			}

			switch (parsed.action) {
				case "help":
					ctx.ui.notify(
						[
							"/think                       status (picker in interactive mode)",
							"/think list                  catalogue",
							"/think <paradigm> [intensity] [task]  sticky for this session",
							"/think once <paradigm> [task]  next turn only",
							"/think auto [intensity]      choose a paradigm per prompt",
							"/think light|standard|deep   change intensity only",
							"/think off                   disable",
							"",
							"Tool: think({task, paradigm, mode:'run'}) runs the paradigm as separate model calls.",
						].join("\n"),
						"info",
					);
					return;
				case "list":
					ctx.ui.notify(renderList(), "info");
					return;
				case "off":
					applyState({ mode: "off", intensity: state.intensity }, ctx);
					ctx.ui.notify(describe(), "info");
					return;
				case "intensity":
					applyState({ ...state, intensity: parsed.intensity ?? state.intensity }, ctx);
					ctx.ui.notify(describe(), "info");
					return;
				case "auto":
					applyState({ mode: "auto", intensity: parsed.intensity ?? state.intensity }, ctx);
					ctx.ui.notify(describe(), "info");
					return;
				case "once":
					if (!parsed.paradigm) {
						ctx.ui.notify("Usage: /think once <paradigm>", "warning");
						return;
					}
					pendingTask = parsed.task;
					applyState({ mode: "once", paradigmId: parsed.paradigm.id, intensity: parsed.intensity ?? state.intensity }, ctx);
					ctx.ui.notify(describe(), "info");
					return;
				case "set":
					if (!parsed.paradigm) {
						await showStatus(ctx);
						return;
					}
					pendingTask = parsed.task;
					applyState({ mode: "sticky", paradigmId: parsed.paradigm.id, intensity: parsed.intensity ?? state.intensity }, ctx);
					ctx.ui.notify(pendingTask ? `${describe()} - task set for the next turn` : describe(), "info");
					return;
				case "status":
				default:
					await showStatus(ctx);
					return;
			}
		},
	});

	async function showStatus(ctx: ExtensionCommandContext): Promise<void> {
		if (ctx.hasUI && ctx.mode === "tui") {
			const options = [...listParadigms().map((p) => `${p.emoji} ${p.id} · ${p.titleZh}`), "🎯 auto (pick per prompt)", "⏹ off"];
			const choice = await ctx.ui.select("Thinking paradigm", options);
			if (!choice) {
				ctx.ui.notify(describe(), "info");
				return;
			}
			if (choice.startsWith("⏹")) {
				applyState({ mode: "off", intensity: state.intensity }, ctx);
				ctx.ui.notify(describe(), "info");
				return;
			}
			if (choice.startsWith("🎯")) {
				applyState({ mode: "auto", intensity: state.intensity }, ctx);
				ctx.ui.notify(describe(), "info");
				return;
			}
			const id = choice.split(" ")[1];
			const paradigm = resolveParadigm(id);
			if (!paradigm) {
				ctx.ui.notify(describe(), "info");
				return;
			}
			applyState({ mode: "sticky", paradigmId: paradigm.id, intensity: state.intensity }, ctx);
			ctx.ui.notify(describe(), "info");
			return;
		}
		ctx.ui.notify(`${describe()}\n${renderList()}`, "info");
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
				return { content: [{ type: "text", text: renderList() }], details: { action: "list" } };
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
				return { content: [{ type: "text", text: renderList() }], details: { action: "list" } };
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
