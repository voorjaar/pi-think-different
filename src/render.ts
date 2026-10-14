/**
 * Prompt rendering and slash-command argument parsing for pi-think-different.
 * Pure functions: no Pi imports.
 */

import { isIntensity, listParadigms, resolveParadigm, type Intensity, type Paradigm } from "./paradigms.ts";
import { matchCues, taskAfterCue } from "./nlmatch.ts";
import { isPlacement, type Language, type Placement } from "./config.ts";
import { placementClause } from "./placement.ts";

export { renderList } from "./ui.ts";

/** Section tag name used in the structured system prompt. */
export const SECTION_TAG = "thinking_paradigm";

const MANDATE_CLAUSE =
	"Application rule, no exceptions: while this paradigm is active, every reply you give in this session is produced through this structure - including a short, trivial, factual, or one-line one. " +
	"A direct answer with no structure is not an acceptable reply: the paradigm is a standing instruction you accepted, not a filter you apply when a request looks substantial enough. " +
	"Only the paradigm named in this section applies now; a paradigm named in an earlier turn is expired, and the structure in your earlier replies is finished output, not a pattern to keep copying. " +
	"Keep a trivial reply short inside the structure, never outside it, and never comment about the structure itself - just run it.";

/**
 * The per-turn reminder, injected as a message alongside the user prompt.
 *
 * The paradigm contract travels as a *diff* of system-prompt sections, so a switch is one changed
 * section in a long context that still holds every earlier reply written under the old paradigm. In
 * real sessions the model kept running the previous paradigm - `<thought_tree>` under `cot` and
 * `debate` - because its own history was the strongest signal. Naming the paradigm inside the turn is
 * what makes the switch land.
 */
export function renderTurnReminder(paradigm: Paradigm, placement: Placement, switchedFrom?: string): string {
	const where = placement === "thinking" ? "inside your thinking block" : "in your answer";
	const head = switchedFrom
		? `Thinking paradigm for this turn: ${paradigm.id} (${paradigm.title}). It replaced ${switchedFrom}: that paradigm is finished, and the structure in your earlier replies is its output, not a pattern to continue.`
		: `Thinking paradigm for this turn: ${paradigm.id} (${paradigm.title}).`;
	return `${head} Run it now, with its markers verbatim (${paradigm.markers.join(", ")}) ${where}. Do not reuse another paradigm's markers or section names.`;
}

export function intensityFor(value: string | undefined, fallback: Intensity = "standard"): Intensity {
	return isIntensity(value) ? value : fallback;
}

/** Fill the {{branches}} / {{depth}} placeholders in a paradigm body. */
export function fillLimits(text: string, paradigm: Paradigm): string {
	return text
		.replace(/\{\{\s*branches\s*\}\}/g, String(paradigm.limits.branches))
		.replace(/\{\{\s*depth\s*\}\}/g, String(paradigm.limits.depth));
}

/** The instruction block for one paradigm at one intensity. */
export function renderBody(paradigm: Paradigm, intensity: Intensity): string {
	const body = intensity === "light" ? paradigm.compact : fillLimits(paradigm.body, paradigm);
	const deep = intensity === "deep" && paradigm.deep ? `\n\nExtra depth: ${paradigm.deep}` : "";
	return `${body}${deep}`;
}

/** The full prompt section injected into the system prompt. */
export function renderSection(paradigm: Paradigm, intensity: Intensity, placement: Placement, origin?: string, task?: string): string {
	const header = `${paradigm.emoji} Active thinking paradigm: ${paradigm.title} (${paradigm.id})${origin ? ` [${origin}]` : ""}.`;
	const parts = [
		header,
		`Required markers, verbatim: ${paradigm.markers.join(", ")}. A substantive answer that omits any of them did not run this paradigm.`,
		"Marker discipline: write every marker exactly as spelled, each one starting its own section. Do not substitute a heading, a bold label, or a different emoji, and do not merge two sections into one.",
		"Apply this thinking paradigm to every reply in this session, not to the substantive part only.",
	];
	if (task) parts.push(`Concrete task for this turn: ${task}`);
	parts.push(renderBody(paradigm, intensity), placementClause(placement, paradigm), MANDATE_CLAUSE);
	return parts.join("\n\n");
}

/** The `think` tool payload: the paradigm contract applied to one concrete task. */
export function renderScaffoldForTask(paradigm: Paradigm, intensity: Intensity, task: string): string {
	return [
		`Thinking paradigm: ${paradigm.emoji} ${paradigm.title} (${paradigm.id}) - intensity ${intensity}.`,
		`Required markers, verbatim: ${paradigm.markers.join(", ")}.`,
		"Write every marker exactly as spelled, each one starting its own section; never merge two sections into one.",
		`Task: ${task}`,
		renderBody(paradigm, intensity),
		"Work on the task now, following the structure above exactly. Do not restate these instructions.",
	].join("\n\n");
}

/** Human-readable catalogue lives in ui.ts because it is localized. */

export interface ThinkArgs {
	action: "help" | "list" | "status" | "off" | "auto" | "random" | "once" | "set" | "intensity" | "language" | "placement" | "config";
	paradigm?: Paradigm;
	paradigmName?: string;
	intensity?: Intensity;
	language?: Language;
	placement?: Placement;
	/** Free text after the paradigm token: the concrete problem to think about. */
	task?: string;
	/** True when a paradigm token was present but unknown. */
	unknown?: string;
	/** Set when prose matched more than one paradigm; the caller should ask, not guess. */
	ambiguous?: { id: string; cue: string }[];
	/** Set when the paradigm came from prose rather than an explicit token. */
	viaCue?: string;
}

/**
 * Parse `/think` arguments.
 * Accepted shapes:
 *   (empty) | help | list | status | off | auto [intensity] | once <paradigm> [intensity]
 *   <paradigm> [intensity] | <intensity> [of current] | config
 *   lang <en|zh> | placement <answer|thinking>
 */
export function parseThinkArgs(raw: string): ThinkArgs {
	const tokens = raw.trim().split(/\s+/).filter(Boolean);
	if (tokens.length === 0) return { action: "status" };

	let action: ThinkArgs["action"] = "set";
	let intensity: Intensity | undefined;
	let language: Language | undefined;
	let placement: Placement | undefined;
	const rest: string[] = [];

	for (const token of tokens) {
		const lower = token.toLowerCase();
		if (action === "set" && (lower === "help" || lower === "list" || lower === "status" || lower === "off" || lower === "auto" || lower === "random" || lower === "随机" || lower === "once" || lower === "config")) {
			action = lower === "随机" ? "random" : (lower as ThinkArgs["action"]);
			continue;
		}
		if (action === "set" && (lower === "lang" || lower === "language" || lower === "语言")) {
			action = "language";
			continue;
		}
		if (action === "set" && (lower === "placement" || lower === "结构")) {
			action = "placement";
			continue;
		}
		if (action === "language" && !language) {
			const ZH_TOKENS = ["zh", "zh-cn", "cn", "chinese", "中文"];
			if (lower === "en") language = "en";
			else if (ZH_TOKENS.includes(lower)) language = "zh";
			else continue;
			continue;
		}
		if (action === "placement" && !placement && isPlacement(lower)) {
			placement = lower as Placement;
			continue;
		}
		if (!intensity && (lower === "light" || lower === "standard" || lower === "deep")) {
			intensity = lower as Intensity;
			continue;
		}
		rest.push(token);
	}

	if (action === "language") return { action, language };
	if (action === "placement") return { action, placement };
	if (action === "config") return { action };

	// First remaining token is the paradigm candidate; anything after it is free text.
	const candidate = rest.length > 0 ? rest[0] : undefined;
	const resolved = candidate ? resolveParadigm(candidate) : undefined;

	if (!resolved && (action === "set" || action === "once") && rest.length > 0) {
		// No explicit token: read the phrase as prose and look for a paradigm cue in it.
		const prose = rest.join(" ");
		const outcome = matchCues(prose, listParadigms());

		if (outcome.ambiguous) {
			return { action, ambiguous: outcome.matches.map((match) => ({ id: match.paradigm.id, cue: match.cue })), intensity };
		}
		const match = outcome.matches[0];
		if (match) {
			return {
				action,
				paradigmName: match.paradigm.id,
				paradigm: match.paradigm,
				intensity,
				task: taskAfterCue(prose, match),
				viaCue: match.cue,
			};
		}
	}

	if (candidate && !resolved && (action === "set" || action === "once")) {
		return { action, unknown: candidate, intensity };
	}
	if (action === "set" && !resolved) {
		if (intensity) return { action: "intensity", intensity };
		return { action: "status" };
	}

	return { action, paradigmName: resolved?.id, paradigm: resolved, intensity, task: rest.slice(1).join(" ").trim() || undefined };
}
