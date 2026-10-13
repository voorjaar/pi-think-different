/**
 * Prompt rendering and slash-command argument parsing for pi-think-different.
 * Pure functions: no Pi imports.
 */

import { isIntensity, listParadigms, resolveParadigm, type Intensity, type Paradigm } from "./paradigms.ts";

/** Section tag name used in the structured system prompt. */
export const SECTION_TAG = "thinking_paradigm";

const SKIP_CLAUSE =
	"Escape hatch: if the request is trivial - a lookup, a rename, a one-line edit, a direct shell command, small talk - skip this structure entirely and answer normally. " +
	"Apply the structure to the substantive part only, and never repeat it across turns of the same trivial exchange.";

const VISIBLE_CLAUSE =
	"Emit the structure in your visible answer, not only in private thinking. Keep each block short: this is scaffolding for the reasoning, not extra prose.\n" +
	"Tag discipline (this is verified mechanically): write each tag exactly as spelled, on its own line - for example a line containing `<thought_tree>` and a later line containing `</thought_tree>`. " +
	"Do not replace a tag with a heading, bold label, emoji, or table, and do not bury the entire structure inside one code fence. If the tags are missing, the paradigm counts as not run.";

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
export function renderSection(paradigm: Paradigm, intensity: Intensity, origin?: string, task?: string): string {
	const header = `${paradigm.emoji} Active thinking paradigm: ${paradigm.title} (${paradigm.id})${origin ? ` [${origin}]` : ""}.`;
	const parts = [
		header,
		`Required markers, verbatim: ${paradigm.markers.join(", ")}. A substantive answer that omits any of them did not run this paradigm.`,
		"Apply this thinking paradigm to substantive work in this session.",
	];
	if (task) parts.push(`Concrete task for this turn: ${task}`);
	parts.push(renderBody(paradigm, intensity), VISIBLE_CLAUSE, SKIP_CLAUSE);
	return parts.join("\n\n");
}

/** The `think` tool payload: the paradigm contract applied to one concrete task. */
export function renderScaffoldForTask(paradigm: Paradigm, intensity: Intensity, task: string): string {
	return [
		`Thinking paradigm: ${paradigm.emoji} ${paradigm.title} (${paradigm.id}) - intensity ${intensity}.`,
		`Required markers, verbatim: ${paradigm.markers.join(", ")}.`,
		`Task: ${task}`,
		renderBody(paradigm, intensity),
		"Work on the task now, following the structure above exactly. Do not restate these instructions.",
	].join("\n\n");
}

/** Human-readable catalogue for `/think list` and the `think` tool. */
export function renderList(): string {
	const lines = listParadigms().map((paradigm) => {
		const aliases = paradigm.aliases.filter((alias) => alias !== paradigm.id).join(", ");
		return [
			`${paradigm.emoji} ${paradigm.id} (${paradigm.titleZh}) - ${paradigm.summary}`,
			`   best for: ${paradigm.bestFor}`,
			`   cost: ${paradigm.cost}   aliases: ${aliases || "-"}`,
		].join("\n");
	});
	return lines.join("\n");
}

export interface ThinkArgs {
	action: "help" | "list" | "status" | "off" | "auto" | "once" | "set" | "intensity";
	paradigm?: Paradigm;
	paradigmName?: string;
	intensity?: Intensity;
	/** Free text after the paradigm token: the concrete problem to think about. */
	task?: string;
	/** True when a paradigm token was present but unknown. */
	unknown?: string;
}

/**
 * Parse `/think` arguments.
 * Accepted shapes:
 *   (empty) | help | list | status | off | auto [intensity] | once <paradigm> [intensity]
 *   <paradigm> [intensity] | <intensity> [of current]
 */
export function parseThinkArgs(raw: string): ThinkArgs {
	const tokens = raw.trim().split(/\s+/).filter(Boolean);
	if (tokens.length === 0) return { action: "status" };

	let action: ThinkArgs["action"] = "set";
	let intensity: Intensity | undefined;
	const rest: string[] = [];

	for (const token of tokens) {
		const lower = token.toLowerCase();
		if (action === "set" && (lower === "help" || lower === "list" || lower === "status" || lower === "off" || lower === "auto" || lower === "once")) {
			action = lower as ThinkArgs["action"];
			continue;
		}
		if (!intensity && (lower === "light" || lower === "standard" || lower === "deep")) {
			intensity = lower as Intensity;
			continue;
		}
		rest.push(token);
	}

	// First remaining token is the paradigm candidate; anything after it is free text.
	const candidate = rest.length > 0 ? rest[0] : undefined;
	const resolved = candidate ? resolveParadigm(candidate) : undefined;

	if (candidate && !resolved && (action === "set" || action === "once")) {
		return { action, unknown: candidate, intensity };
	}
	if (action === "set" && !resolved) {
		if (intensity) return { action: "intensity", intensity };
		return { action: "status" };
	}

	return { action, paradigmName: resolved?.id, paradigm: resolved, intensity, task: rest.slice(1).join(" ").trim() || undefined };
}
