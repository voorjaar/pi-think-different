/**
 * Localized user-facing strings for pi-think-different.
 *
 * The language option selects ONE language for menus, help, status, and notifications.
 * Nothing here is bilingual output: a Chinese menu contains no English sentences, and an
 * English menu contains no Chinese.
 *
 * The paradigm contracts themselves (what gets injected into the system prompt) stay in
 * English regardless of this setting - they are model-facing instructions that the live
 * checks verify, not UI text.
 *
 * Pure functions: no Pi imports.
 */

import { listParadigms, type Intensity, type Paradigm } from "./paradigms.ts";
import type { Language, Placement } from "./config.ts";

/** Pick the string for the session language. */
export function t(lang: Language, en: string, zh: string): string {
	return lang === "zh" ? zh : en;
}

export interface StateDescription {
	lang: Language;
	mode: "off" | "sticky" | "once" | "auto" | "random";
	paradigm?: Paradigm;
	paradigmId?: string;
	intensity: Intensity;
	placement: Placement;
}

export const INTENSITY_LABEL: Record<Intensity, [string, string]> = {
	light: ["light", "精简"],
	standard: ["standard", "标准"],
	deep: ["deep", "深入"],
};

export const PLACEMENT_LABEL: Record<Placement, [string, string]> = {
	answer: ["answer", "答案"],
	thinking: ["thinking", "思考块"],
};

export function paradigmName(paradigm: Paradigm | undefined, lang: Language, fallback?: string): string {
	if (!paradigm) return fallback ?? "unknown";
	return lang === "zh" ? `${paradigm.emoji} ${paradigm.id}（${paradigm.titleZh}）` : `${paradigm.emoji} ${paradigm.id} (${paradigm.title})`;
}

/**
 * One line in the status widget: short, one language.
 *
 * The leading icon is the active paradigm's own emoji, not a generic brain: the bar is the only place
 * the user can see which shape the session is running in, so an icon that never changes contradicts the
 * name next to it.
 */
export function statusLabel(state: StateDescription): string {
	const icon = state.paradigm?.emoji?.trim() || "🧠";
	const id = state.paradigm?.id ?? state.paradigmId;
	const localizedSlot = state.lang === "zh" ? 1 : 0;

	let base: string;
	if (state.mode === "auto") base = id ? `${icon} ${t(state.lang, "auto", "自动")} → ${id}` : `${icon} ${t(state.lang, "auto", "自动")}`;
	else if (state.mode === "random") base = id ? `${icon} ${t(state.lang, "random", "随机")} → ${id}` : `${icon} ${t(state.lang, "random", "随机")}`;
	else base = `${icon} ${id ?? "?"}`;

	const intensity = state.intensity === "standard" ? "" : ` · ${INTENSITY_LABEL[state.intensity][localizedSlot]}`;
	return `${base}${intensity}`;
}

/** What `/think` (no arguments) and every state change print. */
export function describeState(state: StateDescription): string {
	const intensity = INTENSITY_LABEL[state.intensity][state.lang === "zh" ? 1 : 0];
	const placement = PLACEMENT_LABEL[state.placement][state.lang === "zh" ? 1 : 0];
	if (state.mode === "off") {
		return t(state.lang, "thinking paradigm: off (default Pi reasoning)", "思考范式：关闭（使用 Pi 默认推理）");
	}
	if (state.mode === "auto") {
		return t(
			state.lang,
			`thinking paradigm: auto (a paradigm is chosen for every prompt, never none), intensity ${intensity}, structure in ${placement}`,
			`思考范式：自动（每个提示词必选一个，不会是不选），强度 ${intensity}，结构位置 ${placement}`,
		);
	}
	if (state.mode === "random") {
		return t(
			state.lang,
			`thinking paradigm: random (a different paradigm every turn, never the same one twice in a row), intensity ${intensity}, structure in ${placement}`,
			`思考范式：随机（每回合换一个，不会连续两回合同一个），强度 ${intensity}，结构位置 ${placement}`,
		);
	}
	const name = paradigmName(state.paradigm, state.lang, state.paradigmId);
	const once = state.mode === "once" ? t(state.lang, " (next turn only)", "（仅下一个回合）") : "";
	return t(
		state.lang,
		`thinking paradigm: ${name}, intensity ${intensity}, structure in ${placement}${once}`,
		`思考范式：${name}，强度 ${intensity}，结构位置 ${placement}${once}`,
	);
}

/** `/think list` catalogue, in one language. */
export function renderList(lang: Language): string {
	const lines = listParadigms().map((paradigm) => {
		const cjk = /[\u3400-\u4DBF\u4E00-\u9FFF]/;
		// Chinese aliases would leak a second language into the English list.
		const aliases = paradigm.aliases.filter((alias) => alias !== paradigm.id && (lang === "zh" || !cjk.test(alias))).join(", ");
		const name = lang === "zh" ? `${paradigm.emoji} ${paradigm.id}（${paradigm.titleZh}）` : `${paradigm.emoji} ${paradigm.id} (${paradigm.title})`;
		const summary = lang === "zh" ? paradigm.summaryZh : paradigm.summary;
		const bestFor = lang === "zh" ? paradigm.bestForZh : paradigm.bestFor;
		const cost = lang === "zh" ? paradigm.costZh : paradigm.cost;
		const bestLabel = t(lang, "best for", "适用");
		const costLabel = t(lang, "cost", "开销");
		const aliasLabel = t(lang, "aliases", "别名");
		return [`${name} - ${summary}`, `   ${bestLabel}: ${bestFor}`, `   ${costLabel}: ${cost}   ${aliasLabel}: ${aliases || "-"}`].join("\n");
	});
	return lines.join("\n");
}

/** `/think help`. */
export function helpLines(lang: Language): string[] {
	return [
		t(lang, "/think                       status (picker in interactive mode)", "/think                       查看状态（交互模式打开选择器）"),
		t(lang, "/think list                  catalogue", "/think list                  范式清单"),
		t(lang, "/think <paradigm> [intensity] [task]  sticky for this session", "/think <范式> [强度] [任务]      本会话固定使用该范式"),
		t(lang, "/think once <paradigm>       next turn only", "/think once <范式>           仅下一个回合使用"),
		t(lang, "/think auto [intensity]      choose a paradigm per prompt", "/think auto [强度]           每个提示词自动选范式"),
		t(lang, "/think random [intensity]    a different paradigm every turn", "/think random [强度]         每回合随机换一个范式"),
		t(lang, "/think light|standard|deep   change intensity", "/think light|standard|deep   调整强度"),
		t(lang, "/think placement answer|thinking  where the structure is shown", "/think placement answer|thinking  结构显示在哪里"),
		t(lang, "/think lang en|zh            menu language", "/think lang en|zh            菜单语言"),
		t(lang, "/think off                   default Pi reasoning", "/think off                   关闭，回到 Pi 默认推理"),
		"",
		t(
			lang,
			"Tool: think({task, paradigm, mode:'run'}) runs a paradigm as separate model calls.",
			"工具：think({task, paradigm, mode:'run'}) 会把一个范式拆成多次独立的模型调用。",
		),
	];
}

export interface ThinkCompletion {
	value: string;
	label: string;
	description: string;
}

interface SubCompletion {
	value: string;
	descriptionEn: string;
	descriptionZh: string;
}

const SUBCOMMANDS: Record<string, SubCompletion[]> = {
	lang: [
		{ value: "lang en", descriptionEn: "English interface", descriptionZh: "英文界面" },
		{ value: "lang zh", descriptionEn: "Chinese interface", descriptionZh: "中文界面" },
	],
	placement: [
		{ value: "placement answer", descriptionEn: "structure in the visible answer", descriptionZh: "结构放在可见回答里" },
		{ value: "placement thinking", descriptionEn: "structure in the thinking block", descriptionZh: "结构放在思考块里" },
	],
};

/**
 * Argument completions for `/think <arg>`.
 *
 * Pi replaces the whole typed argument span with `value`, so a value must be the complete argument text
 * ("auto", "lang zh") and never carry the command name - "/think auto" would render as
 * "/think /think auto".
 */
export function completionItems(lang: Language, argumentPrefix: string): ThinkCompletion[] {
	const prefix = argumentPrefix.trimStart().toLowerCase();

	for (const [word, options] of Object.entries(SUBCOMMANDS)) {
		if (!prefix.startsWith(word)) continue;
		return options
			.filter((option) => option.value.startsWith(prefix))
			.map((option) => ({
				value: option.value,
				label: option.value,
				description: lang === "zh" ? option.descriptionZh : option.descriptionEn,
			}));
	}

	const commands: Array<[string, string, string]> = [
		["auto", "pick a paradigm for every turn", "每轮自动选一个范式"],
		["random", "pick a random paradigm each turn", "每轮随机换一个范式"],
		["list", "show every paradigm", "列出全部范式"],
		["status", "show the current setting", "查看当前设置"],
		["off", "turn the paradigm off", "关闭范式"],
		["once", "use a paradigm for the next turn only", "只用于下一轮"],
		["light", "intensity: minimum structure", "强度：轻量"],
		["standard", "intensity: normal structure", "强度：标准"],
		["deep", "intensity: fullest structure", "强度：深度"],
		["lang", "set the interface language", "设置界面语言"],
		["placement", "set where the structure appears", "设置结构出现的位置"],
		["help", "show help", "查看帮助"],
	];

	const items: ThinkCompletion[] = commands.map(([word, en, zh]) => ({
		value: word,
		label: word,
		description: lang === "zh" ? zh : en,
	}));

	for (const paradigm of listParadigms()) {
		items.push({
			value: paradigm.id,
			label: paradigm.id,
			description: lang === "zh" ? paradigm.titleZh : paradigm.title,
		});
	}

	return items.filter((item) => item.value.startsWith(prefix)).slice(0, 24);
}

export function unknownParadigmMessage(lang: Language, name: string): string {
	const known = listParadigms().map((paradigm) => paradigm.id).join(", ");
	return t(lang, `Unknown thinking paradigm '${name}'. Available: ${known}`, `未知的思考范式「${name}」。可选：${known}`);
}

export function cueResolvedMessage(lang: Language, paradigm: Paradigm, cue: string): string {
	return t(lang, `matched paradigm from your wording: '${cue}' → ${paradigm.id}`, `从你的措辞识别出范式：「${cue}」→ ${paradigm.id}`);
}

export function ambiguousCueMessage(lang: Language, candidates: { id: string; cue: string }[]): string {
	const listed = candidates.map((candidate) => `${candidate.cue}→${candidate.id}`).join(", ");
	return t(
		lang,
		`Your wording matches more than one paradigm (${listed}). Name one explicitly: /think <paradigm> <task>`,
		`你的措辞同时命中多个范式（${listed}）。请明确指定一个：/think <范式> <任务>`,
	);
}
export function autoSelectionMessage(lang: Language, paradigm: Paradigm, reasons: string[], confident = true): string {
	const head = confident
		? t(lang, `auto thinking paradigm → ${paradigm.id}`, `自动选择思考范式 → ${paradigm.id}`)
		: t(lang, `auto thinking paradigm → ${paradigm.id} (best match, low score)`, `自动选择思考范式 → ${paradigm.id}（最高分兜底，分数偏低）`);
	return head + (reasons.length > 0 ? ` (${reasons.slice(0, 3).join("; ")})` : "");
}

export function randomSelectionMessage(lang: Language, paradigm: Paradigm): string {
	return t(lang, `random thinking paradigm → ${paradigm.id}`, `随机思考范式 → ${paradigm.id}`);
}

/** Auto mode is armed but scored this prompt below the bar - say so instead of staying silent. */
export function autoSelectionSkippedMessage(lang: Language, score: number, reasons: string[]): string {
	return (
		t(lang, `auto thinking paradigm: none (score ${score}, below the threshold)`, `自动思考范式：未选中（分数 ${score}，低于阈值）`) +
		(reasons.length > 0 ? ` (${reasons.slice(0, 3).join("; ")})` : "") +
		t(lang, " - use /think <paradigm> to force one", " - 可用 /think <范式> 强制指定")
	);
}

export function configProblemMessage(lang: Language, file: string, problem: string): string {
	return t(lang, `config ${file}: ${problem}`, `配置文件 ${file}：${problem}`);
}

/** Tool description shown to the model; kept in English because the model reads it. */
export const TOOL_DESCRIPTION =
	"Apply a thinking paradigm. mode 'scaffold' returns the paradigm contract for the task; mode 'run' executes the paradigm as separate model calls with harness-controlled pruning. Omit task to list paradigms.";
