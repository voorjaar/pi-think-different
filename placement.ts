/**
 * Structure placement for pi-think-different.
 *
 * When `placement: "thinking"`, the paradigm's fine-grained structure (branches, scores,
 * criticisms, hats, angles...) belongs in the thinking block, and the visible answer carries
 * only the conclusion.
 *
 * Two independent mechanisms, so the option works on models that ignore the contract:
 *   1. `placementClause()` - the prompt-level request.
 *   2. `extractStructure()` - the harness-level fallback that cuts structure out of the
 *      visible answer and hands it back as thinking content.
 *
 * Pure functions: no Pi imports.
 */

import type { Paradigm } from "./paradigms.ts";
import type { Placement } from "./config.ts";

export interface Relocated {
	/** What the answer should look like after the structure is removed. */
	text: string;
	/** The removed structure, or undefined when nothing was relocatable. */
	structure: string | undefined;
}

const ANSWER_MARKER = "<answer>";

/** Markers that are XML-ish tags (not emoji), excluding the answer block itself. */
function tagMarkers(paradigm: Paradigm): { open: string; close: string }[] {
	return paradigm.markers
		.map((marker) => /^<([A-Za-z0-9_:.\-]+)>$/.exec(marker))
		.filter((match): match is RegExpExecArray => match !== null)
		.map((match) => ({ open: `<${match[1]}>`, close: `</${match[1]}>` }))
		.filter((tag) => tag.open !== ANSWER_MARKER);
}

function emojiMarkers(paradigm: Paradigm): string[] {
	return paradigm.markers.filter((marker) => marker.length > 0 && !/^</.test(marker));
}

/** Locate one `<tag> ... </tag>` span starting at or after `from`. */
function findTagSpan(text: string, open: string, close: string, from: number): { start: number; end: number } | undefined {
	const start = text.indexOf(open, from);
	if (start < 0) return undefined;
	const end = text.indexOf(close, start + open.length);
	if (end < 0) return undefined;
	return { start, end: end + close.length };
}

/** Locate one emoji-headed section: from the emoji to just before the next marker or `<answer>`. */
function findEmojiSpan(text: string, emoji: string, stops: string[], from: number): { start: number; end: number } | undefined {
	const start = text.indexOf(emoji, from);
	if (start < 0) return undefined;

	const lineStart = text.lastIndexOf("\n", start) + 1;
	let end = text.length;

	for (const stop of stops) {
		if (stop === emoji) continue;
		const at = text.indexOf(stop, start + emoji.length);
		if (at >= 0 && at < end) end = at;
	}
	const answerAt = text.indexOf(ANSWER_MARKER, start + emoji.length);
	if (answerAt >= 0 && answerAt < end) end = answerAt;

	// Back off to the end of the previous line so the boundary never cuts mid-sentence.
	const lastBreak = text.lastIndexOf("\n", end - 1);
	if (lastBreak > lineStart) end = lastBreak;

	return { start: lineStart, end };
}

/**
 * Cut the paradigm's structure out of visible answer text.
 *
 * Nothing is removed when the removal would leave an empty answer: a model that wrote only
 * structure and no conclusion keeps its answer as it is, which is the safer failure mode.
 */
export function extractStructure(text: string, paradigm: Paradigm): Relocated {
	const spans: { start: number; end: number; open: string }[] = [];

	for (const tag of tagMarkers(paradigm)) {
		let cursor = 0;
		while (cursor < text.length) {
			const span = findTagSpan(text, tag.open, tag.close, cursor);
			if (!span) break;
			spans.push({ ...span, open: tag.open });
			cursor = span.end;
		}
	}

	const emoji = emojiMarkers(paradigm);
	if (emoji.length > 0) {
		for (const marker of emoji) {
			let cursor = 0;
			while (cursor < text.length) {
				const span = findEmojiSpan(text, marker, [...emoji, ANSWER_MARKER], cursor);
				if (!span || span.end <= span.start) break;
				spans.push({ ...span, open: marker });
				cursor = span.end;
			}
		}
	}

	if (spans.length === 0) return { text, structure: undefined };

	// Drop spans nested inside an earlier span, then cut from the back so offsets stay valid.
	const ordered = spans
		.slice()
		.sort((a, b) => a.start - b.start)
		.filter((span, index, all) => index === 0 || span.start >= all[index - 1].end);

	const structureParts: string[] = [];
	let remaining = text;
	for (const span of ordered.slice().reverse()) {
		structureParts.unshift(remaining.slice(span.start, span.end).trim());
		remaining = remaining.slice(0, span.start) + remaining.slice(span.end);
	}

	const cleaned = remaining.replace(/\n{3,}/g, "\n\n").trim();
	const structure = structureParts.filter((part) => part.length > 0).join("\n\n");

	if (!structure) return { text, structure: undefined };
	if (cleaned.length === 0) return { text, structure: undefined };

	return { text: cleaned, structure };
}

/** The prompt-level half of the option. */
export function placementClause(placement: Placement, paradigm: Paradigm): string {
	if (placement === "thinking") {
		return (
			"Placement: run this paradigm's structure inside your reasoning / thinking block, and let the visible answer carry only the conclusion. " +
			`The structure must still use its markers verbatim (${paradigm.markers.join(", ")}) inside your thinking, because that is what proves the paradigm ran. ` +
			"Do not restate the branches, scores, or critiques in the answer text."
		);
	}
	return (
		"Emit the structure in your visible answer, not only in private thinking. Keep each block short: this is scaffolding for the reasoning, not extra prose.\n" +
		"Tag discipline (this is verified mechanically): write each tag exactly as spelled, on its own line - for example a line containing `<thought_tree>` and a later line containing `</thought_tree>`. " +
		"Do not replace a tag with a heading, bold label, emoji, or table, and do not bury the entire structure inside one code fence. If the tags are missing, the paradigm counts as not run."
	);
}
