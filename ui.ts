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
	mode: "off" | "sticky" | "once" | "auto";
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

/** One line in the status widget: short, one language. */
export function statusLabel(state: StateDescription): string {
	const base = state.mode === "auto" ? t(state.lang, "🧠 auto", "🧠 自动") : `🧠 ${state.paradigm?.id ?? state.paradigmId ?? "?"}`;
	const localizedSlot = state.lang === "zh" ? 1 : 0;
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
			`thinking paradigm: auto (chosen per prompt), intensity ${intensity}, structure in ${placement}`,
			`思考范式：自动（每个提示词选一个），强度 ${intensity}，结构位置 ${placement}`,
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
		t(lang, "/think light|standard|deep   change intensity", "/think light|standard|deep   调整强度"),
		t(lang, "/think placement answer|thinking  where the structure is shown", "/think placement answer|thinking  结构显示在哪里"),
		t(lang, "/think lang en|zh            menu language", "/think lang en|zh            菜单语言"),
		t(lang, "/think config                config files and current values", "/think config                配置文件与当前取值"),
		t(lang, "/think off                   default Pi reasoning", "/think off                   关闭，回到 Pi 默认推理"),
		"",
		t(
			lang,
			"Tool: think({task, paradigm, mode:'run'}) runs a paradigm as separate model calls.",
			"工具：think({task, paradigm, mode:'run'}) 会把一个范式拆成多次独立的模型调用。",
		),
	];
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
export function autoSelectionMessage(lang: Language, paradigm: Paradigm, reasons: string[]): string {
	return t(lang, `auto thinking paradigm → ${paradigm.id}`, `自动选择思考范式 → ${paradigm.id}`) + (reasons.length > 0 ? ` (${reasons.slice(0, 3).join("; ")})` : "");
}

export function configPathsMessage(lang: Language, userPath: string, projectPath: string): string {
	return [
		t(lang, "config files (later wins):", "配置文件（后者覆盖前者）："),
		`  ${t(lang, "user", "用户级")}    ${userPath}`,
		`  ${t(lang, "project", "项目级")}  ${projectPath}`,
	].join("\n");
}

export function configProblemMessage(lang: Language, file: string, problem: string): string {
	return t(lang, `config ${file}: ${problem}`, `配置文件 ${file}：${problem}`);
}

/** Tool description shown to the model; kept in English because the model reads it. */
export const TOOL_DESCRIPTION =
	"Apply a thinking paradigm. mode 'scaffold' returns the paradigm contract for the task; mode 'run' executes the paradigm as separate model calls with harness-controlled pruning. Omit task to list paradigms.";
