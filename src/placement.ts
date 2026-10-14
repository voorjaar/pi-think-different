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
import { markerHeading } from "./paradigms.ts";
import type { Language, Placement } from "./config.ts";

export interface Relocated {
	/** What the answer should look like after the structure is removed. */
	text: string;
	/** The removed structure, or undefined when nothing was relocatable. */
	structure: string | undefined;
}

export interface ExtractOptions {
	/**
	 * Drop the `<answer>` wrapper and keep its content. With `placement: "thinking"` the visible
	 * answer is meant to read as a plain conclusion, not as a tagged block.
	 */
	unwrapAnswer?: boolean;
}

const ANSWER_MARKER = "<answer>";
const ANSWER_CLOSE = "</answer>";

/** Strip every `<answer> ... </answer>` wrapper, keeping the conclusion inside it. */
export function unwrapAnswerBlocks(text: string): string {
	let out = text;
	let cursor = 0;
	while (true) {
		const start = out.indexOf(ANSWER_MARKER, cursor);
		if (start < 0) break;
		const end = out.indexOf(ANSWER_CLOSE, start + ANSWER_MARKER.length);
		if (end < 0) break;
		const inner = out.slice(start + ANSWER_MARKER.length, end).trim();
		out = `${out.slice(0, start)}${inner}${out.slice(end + ANSWER_CLOSE.length)}`;
		cursor = start + inner.length;
	}
	return out.replace(/\n{3,}/g, "\n\n").trim();
}

/** One recognisable structural section: a tag pair, or a bare-token (emoji) heading. */
interface SectionSpec {
	open: string;
	close?: string;
	/** The marker whose heading this section renders as. */
	canonical: string;
}

/**
 * Every token that can start a section: the declared markers plus the aliases a model writes instead.
 * `<answer>` is handled by unwrapAnswerBlocks, so it is never a section of its own.
 */
function sectionSpecs(paradigm: Paradigm): SectionSpec[] {
	const tokens: { token: string; canonical: string }[] = [
		...paradigm.markers.map((marker) => ({ token: marker, canonical: marker })),
		...Object.entries(paradigm.markerAliases ?? {}).map(([alias, canonical]) => ({ token: alias, canonical })),
	];

	const specs: SectionSpec[] = [];
	for (const { token, canonical } of tokens) {
		const tag = /^<([A-Za-z0-9_:.\-]+)>$/.exec(token);
		if (tag) {
			if (token === ANSWER_MARKER) continue;
			specs.push({ open: `<${tag[1]}>`, close: `</${tag[1]}>`, canonical });
			continue;
		}
		if (token.length > 0) specs.push({ open: token, canonical });
	}
	return specs;
}

/**
 * Every token the paradigm's scaffolding is written with, declared markers and aliases alike.
 * Debris cleanup needs the aliases too, or a stray `</hat:black>` survives in the answer.
 */
export function markerTokens(paradigm: Paradigm): string[] {
	return [...paradigm.markers, ...Object.keys(paradigm.markerAliases ?? {})];
}

/**
 * Which section a heading actually is.
 *
 * A model that writes "🔵 Black (risk)" has picked the wrong colour but named the right hat. The name is
 * the reliable signal, so the heading follows the word and carries the colour the registry declares.
 * Only paradigms that declare `markerHeadingWords` are relabelled this way.
 */
function canonicalForSection(paradigm: Paradigm, spec: SectionSpec, body: string): string {
	const words = paradigm.markerHeadingWords;
	if (!words) return spec.canonical;

	const firstLine = body.split("\n")[0] ?? "";
	for (const [word, canonical] of Object.entries(words)) {
		const pattern = /^[A-Za-z]/.test(word) ? new RegExp(`\\b${escapeRegExp(word)}\\b`, "i") : new RegExp(escapeRegExp(word));
		if (pattern.test(firstLine)) return canonical;
	}
	return spec.canonical;
}

/** Every token that ends a section, used when a tag was opened but never closed. */
function sectionStops(specs: SectionSpec[]): string[] {
	const stops = new Set<string>();
	for (const spec of specs) {
		stops.add(spec.open);
		if (spec.close) stops.add(spec.close);
	}
	stops.add(ANSWER_MARKER);
	return [...stops];
}

/**
 * Locate one section starting at or after `from`.
 *
 * A closed `<tag> ... </tag>` pair is the normal case. An unclosed tag - which is what a six-section
 * paradigm like hats actually produces - ends at the next section token, or at the next blank line for a
 * bare-token section: a hat is one block, not the rest of the answer.
 */
function findSectionSpan(text: string, spec: SectionSpec, stops: string[], from: number): { start: number; end: number } | undefined {
	const tokenAt = text.indexOf(spec.open, from);
	if (tokenAt < 0) return undefined;

	const lineStart = text.lastIndexOf("\n", tokenAt) + 1;
	// A model that writes `### <hat:black> Black (risk)` has already spent the heading. Absorb the bare
	// `### ` in front of the tag so replacing the span cannot leave `### ### 黑帽…` behind.
	const headingOnlyPrefix = /^[ \t]*#{1,6}[ \t]*$/.test(text.slice(lineStart, tokenAt));
	const start = headingOnlyPrefix ? lineStart : tokenAt;

	if (spec.close) {
		const closeAt = text.indexOf(spec.close, tokenAt + spec.open.length);
		if (closeAt >= 0) return { start, end: closeAt + spec.close.length };
	}

	let end = text.length;
	for (const stop of stops) {
		if (stop === spec.open) continue;
		const at = text.indexOf(stop, tokenAt + spec.open.length);
		if (at >= 0 && at < end) end = at;
	}

	// A bare token - an emoji heading - opens a block, not the rest of the document. Without a blank-line
	// boundary the last section swallows everything written after it, which is how a whole recipe ended up in
	// the thinking block with one orphaned bullet left behind in the answer.
	if (!spec.close) {
		const after = tokenAt + spec.open.length;
		const blank = text.slice(after).search(/\n[ \t]*\n/);
		if (blank >= 0 && after + blank < end) end = after + blank;
	}

	// Back off to the end of the previous line, but only when a stop token really did land mid-line
	// ("⚪ Facts: the ⚫ black hat ..."). Backing off from the end of the text is what used to drop the
	// answer's final line out of its own section.
	if (end < text.length && text[end - 1] !== "\n") {
		const lastBreak = text.lastIndexOf("\n", end - 1);
		if (lastBreak > tokenAt) end = lastBreak;
	}

	// ...unless the section was cut by a token on its own line ("🟡/🔵 Blue: control"). Cutting there would
	// leave a word fragment behind and give the same hat a second heading, so the whole line is the section.
	// Only when this section starts the line: a tag inside a heading line must keep the body below it.
	const lineEnd = text.indexOf("\n", tokenAt + spec.open.length);
	const lineBoundary = lineEnd >= 0 ? lineEnd : text.length;
	if (tokenAt === lineStart && end <= lineBoundary) end = lineBoundary;

	return { start, end };
}

/**
 * Drop every span that starts inside one already accepted, in start order.
 *
 * Comparing with the previous sorted span is not enough: an outer span can hold two inner ones, and the
 * second inner span starts after the first inner span ends, so it survives. Cutting accepted spans from the
 * back then slices the already-shortened string with stale offsets, which swallows the text after the outer
 * span and leaves a word fragment in the answer.
 */
function dropNestedSpans<T extends { start: number; end: number }>(spans: T[]): T[] {
	const ordered: T[] = [];
	let coveredTo = -1;
	for (const span of spans.slice().sort((a, b) => a.start - b.start)) {
		if (span.start < coveredTo) continue;
		ordered.push(span);
		coveredTo = Math.max(coveredTo, span.end);
	}
	return ordered;
}

/**
 * Cut the paradigm's structure out of visible answer text.
 *
 * Nothing is removed when the removal would leave an empty answer: a model that wrote only
 * structure and no conclusion keeps its answer as it is, which is the safer failure mode.
 */
export function extractStructure(text: string, paradigm: Paradigm, options: ExtractOptions = {}): Relocated {
	const spans: { start: number; end: number; open: string }[] = [];
	const specs = sectionSpecs(paradigm);
	const stops = sectionStops(specs);

	for (const spec of specs) {
		let cursor = 0;
		while (cursor < text.length) {
			const span = findSectionSpan(text, spec, stops, cursor);
			if (!span || span.end <= span.start) break;
			spans.push({ ...span, open: spec.open });
			cursor = span.end;
		}
	}

	if (spans.length === 0) return { text, structure: undefined };

	// Drop spans nested inside an earlier span, then cut from the back so offsets stay valid.
	const ordered = dropNestedSpans(spans);

	const structureParts: string[] = [];
	let remaining = text;
	for (const span of ordered.slice().reverse()) {
		structureParts.unshift(remaining.slice(span.start, span.end).trim());
		remaining = remaining.slice(0, span.start) + remaining.slice(span.end);
	}

	const cleaned = remaining.replace(/\n{3,}/g, "\n\n").trim();
	const structure = structureParts.filter((part) => part.length > 0).join("\n\n");

	if (!structure) return { text: options.unwrapAnswer ? unwrapAnswerBlocks(text) : text, structure: undefined };
	if (cleaned.length === 0) return { text, structure: undefined };

	const answer = options.unwrapAnswer ? unwrapAnswerBlocks(cleaned) : cleaned;
	if (answer.length === 0) return { text, structure: undefined };

	return { text: answer, structure };
}

const LABEL_STOP_WORDS = new Set(["the", "a", "an", "of", "is", "are", "and", "or", "to", "for", "in", "on", "this", "that", "it", "we", "you", "with", "的", "了", "和", "与", "是"]);

/** The meaningful words of a line, lightly stemmed, so "Tree of Thoughts" matches the heading "Thought tree". */
function labelWords(value: string): string[] {
	return value
		.split(/\s+/)
		.map((word) => word.replace(/[^\p{L}\p{N}_]/gu, ""))
		.filter((word) => word.length > 2 && !LABEL_STOP_WORDS.has(word.toLowerCase()))
		.map((word) => {
			const lower = word.toLowerCase();
			return lower.length > 4 ? lower.replace(/(ings|ing|es|s|ed)$/, "") : lower;
		});
}

/**
 * Whether a section's first line says nothing beyond the heading the harness is about to print.
 *
 * This is the only safe test for "the model already wrote the label": length is not. A 46-character sentence
 * of body text used to be deleted as a label while a 51-character one survived, because the old test was
 * "under 48 chars and no sentence punctuation" - and ASCII `.` was not even in that punctuation set.
 */
function isRedundantLabel(line: string, heading: string): boolean {
	const flatten = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}_]+/gu, " ").replace(/\s+/g, " ").trim();
	const headingText = flatten(heading);
	const lineText = flatten(line);
	if (lineText.length === 0) return true;
	if (headingText.length === 0) return false;
	if (lineText === headingText) return true;

	// A Chinese label is a character run rather than whitespace-separated words, so the same containment
	// test is done by character.
	const cjk = /[\u3400-\u4DBF\u4E00-\u9FFF]/u;
	if (cjk.test(lineText) && cjk.test(headingText)) {
		const headingChars = new Set(headingText.replace(/\s+/g, ""));
		const lineChars = [...new Set(lineText.replace(/\s+/g, ""))];
		return lineChars.length > 0 && lineChars.every((char) => headingChars.has(char));
	}

	const headingWords = new Set(labelWords(headingText));
	const words = labelWords(lineText);
	if (words.length === 0) return true;
	return words.every((word) => headingWords.has(word));
}

/**
 * Rewrite a marker-structured answer so the user reads labels instead of scaffolding.
 *
 * The model still writes markers verbatim (that is what proves the paradigm ran), but with
 * `placement: "answer"` the visible answer must not contain them: each section becomes a bold label in
 * the session language - `<angle:adversary>` turns into `**对手视角**`, `<angle:adversary>` in an English
 * session into `**Adversary angle**` - and the `<answer>` wrapper disappears. Bold rather than `###`:
 * a level-three heading made every section of an answer look like a top-level heading of the document.
 */
export function naturalizeMarkers(text: string, paradigm: Paradigm, language: Language): string {
	let out = unwrapAnswerBlocks(text);

	// Some markers are already the readable form. `hats` writes "⚫ Black: risk - …", and a generated
	// `### ⚫ 黑帽：风险与批判` above it is noise, so the section is left exactly as the model wrote it.
	// Bracketed tag syntax is still removed: the user asked for emoji, not tags.
	if (paradigm.verbatimMarkers) {
		let verbatim = out;
		for (const tag of Object.keys(paradigm.markerAliases ?? {})) {
			verbatim = verbatim.replaceAll(`</${tag.slice(1)}>`, "").replaceAll(tag, "");
		}
		verbatim = verbatim.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n");
		return stripMarkerDebris(verbatim, markerTokens(paradigm));
	}

	const spans: { start: number; end: number; open: string; canonical: string }[] = [];
	const specs = sectionSpecs(paradigm);
	const stops = sectionStops(specs);

	for (const spec of specs) {
		let cursor = 0;
		while (cursor < out.length) {
			const span = findSectionSpan(out, spec, stops, cursor);
			if (!span || span.end <= span.start) break;
			spans.push({ ...span, open: spec.open, canonical: canonicalForSection(paradigm, spec, out.slice(span.start, span.end)) });
			cursor = span.end;
		}
	}

	if (spans.length === 0) return stripMarkerDebris(out, paradigm.markers);

	const ordered = dropNestedSpans(spans);

	for (const span of ordered.slice().reverse()) {
		const body = out.slice(span.start, span.end);
		const heading = markerHeading(span.canonical, language);

		// Strip the section's own tokens: a tag pair, or a bare emoji possibly preceded by `### `. Leading
		// tokens are stripped repeatedly because a model writes two of them side by side ("🟡/🔵 Blue:").
		const isTag = span.open.startsWith("<");
		const tokenAlternation = specs.map((spec) => escapeRegExp(spec.open)).join("|");
		const leadingTokens = new RegExp(`^(?:[ \t]*(?:#{1,6}[ \t]*)?(?:${tokenAlternation})[ \t/|·、,]*)+`, "u");
		const closePattern = isTag ? new RegExp(`\\s*${escapeRegExp(span.open.replace(/^</, "</"))}$`) : undefined;
		const stripped = (closePattern ? body.replace(closePattern, "") : body).replace(leadingTokens, "").trim();

		// The first line of a section is either the section's own label - "### ⚫ Black Hat", "白帽：事实与数据" -
		// which the rendered heading already says, or the section's actual text, which must survive.
		const firstBreak = stripped.indexOf("\n");
		const firstLine = firstBreak >= 0 ? stripped.slice(0, firstBreak) : stripped;
		const restOfLine = firstLine.replace(/^[ \t]*#{0,6}[ \t]*/u, "").replace(/^[ \t:：\-–—/|·、,]+/u, "").trim();
		// A kept line can still open with the model's own label ("Black: risk - ..."); the rendered heading
		// already names the section, so the label prefix goes too.
		const labelPrefix = new RegExp("^[ \\t]*[\\p{L}\\p{N}_]+[ \\t]*[:：][ \\t]*", "u");
		const afterColon = restOfLine.replace(labelPrefix, "");
		const dashAt = afterColon.search(/\s[-–—]\s/u);
		const withoutLabel = (dashAt > 0 && dashAt <= 32 ? afterColon.slice(dashAt + 1) : afterColon).replace(/^[ \t]*[-–—][ \t]*/u, "").trim();
		const keptLine = withoutLabel.trim().length > 0 ? withoutLabel.trim() : restOfLine;
		// A label line with nothing under it is the whole section, so it stays - dropping it would empty it.
		const labelOnly = restOfLine.length === 0 || (firstBreak >= 0 && isRedundantLabel(keptLine, heading));
		let inner = labelOnly ? stripped.slice(firstBreak + 1).trim() : `${keptLine}${firstBreak >= 0 ? stripped.slice(firstBreak) : ""}`.trim();

		// A section that opened with its own Markdown heading line would otherwise render as `### ### …`.
		inner = inner.replace(/^#{1,6}[ \t].*\n?/, "").trim();

		let prefix = out.slice(0, span.start);
		if (prefix.trim().length > 0 && !/\n\n$/.test(prefix)) prefix = prefix.replace(/\n?$/, "\n\n");
		out = `${prefix}**${heading}**\n\n${inner}${out.slice(span.end)}`;
	}

	out = stripMarkerDebris(out, paradigm.markers);
	return out.replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Remove leftover marker debris from a visible answer.
 *
 * With `placement: "thinking"` the answer is supposed to carry only the conclusion, but a model that
 * wrote its structure into the answer leaves scraps behind once the spans are relocated: a bare
 * `angle:pragmatist` line, a stray `</angle:adversary>`, an orphan `<synthesis>`. Those are not
 * content - they are the scaffolding's punctuation, and the harness removes them rather than show the
 * user a paragraph interrupted by tags. Natural language is what stays.
 *
 * Bare marker words are dropped only when they occupy a line by themselves, so a legitimate word like
 * "synthesis" inside a sentence survives.
 */
export function stripMarkerDebris(text: string, markers: string[]): string {
	const names = markers.map((marker) => marker.replace(/^<|>$/g, "")).filter((name) => name.length > 0);
	if (names.length === 0) return text;

	const alternation = names.map(escapeRegExp).join("|");
	const markerLine = new RegExp(`^</?(${alternation})>$`);
	const bareLine = new RegExp(`^(${alternation})$`);
	const inlineTag = new RegExp(`</?(${alternation})>`, "g");

	const kept = text
		.split("\n")
		.map((line) => {
			const trimmed = line.trim();
			if (trimmed.length === 0) return line;
			if (markerLine.test(trimmed) || bareLine.test(trimmed)) return undefined;
			const stripped = line.replace(inlineTag, "").replace(/[ \t]{2,}/g, " ").trimEnd();
			return stripped.trim().length === 0 ? undefined : stripped;
		})
		.filter((line): line is string => line !== undefined);

	const collapsed: string[] = [];
	for (const line of kept) {
		if (line.trim().length === 0 && (collapsed.at(-1) ?? "").trim().length === 0) continue;
		collapsed.push(line);
	}
	while (collapsed.length > 0 && collapsed[0].trim().length === 0) collapsed.shift();
	while (collapsed.length > 0 && (collapsed.at(-1) ?? "").trim().length === 0) collapsed.pop();

	return collapsed.join("\n");
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Put relocated structure into the message's block list so the transcript reads
 * thinking -> answer, never answer -> thinking.
 *
 * Rules:
 *   - the model's own block order is preserved;
 *   - the extracted structure is folded into the thinking block that already precedes the answer,
 *     so there is one Thinking section and it sits above the answer;
 *   - if no thinking precedes the answer, a thinking block is inserted directly before it;
 *   - every text block is folded into the single cleaned answer (they were joined before cutting).
 */
export interface PlacementBlock {
	type: string;
	text?: string;
	thinking?: string;
	/** Tool calls and other block kinds carry their own fields; they are passed through untouched. */
	[key: string]: unknown;
}

export function placeStructureBeforeAnswer<T extends PlacementBlock>(content: T[], structure: string, answerText: string): T[] {
	const firstTextAt = content.findIndex((block) => block.type === "text");
	let lastThinkingBefore = -1;
	for (let index = firstTextAt - 1; index >= 0; index -= 1) {
		if (content[index].type === "thinking") {
			lastThinkingBefore = index;
			break;
		}
	}

	const out: T[] = [];
	let answerPlaced = false;

	for (let index = 0; index < content.length; index += 1) {
		const block = content[index];
		if (block.type !== "text") {
			out.push(block);
			continue;
		}
		if (answerPlaced) continue;

		if (lastThinkingBefore === index - 1 && out.length > 0 && out[out.length - 1].type === "thinking") {
			const previous = out[out.length - 1];
			out[out.length - 1] = { ...previous, thinking: `${previous.thinking ?? ""}\n\n${structure}` };
		} else {
			out.push({ type: "thinking", thinking: structure } as T);
		}
		out.push({ ...block, type: "text", text: answerText });
		answerPlaced = true;
	}

	if (!answerPlaced) {
		out.push({ type: "thinking", thinking: structure } as T, { type: "text", text: answerText } as T);
	}
	return out;
}

/** The prompt-level half of the option. */
export function placementClause(placement: Placement, paradigm: Paradigm): string {
	if (placement === "thinking") {
		return (
			"Placement: write this paradigm's sections with their markers verbatim " +
			`(${paradigm.markers.join(", ")}) in the text you produce for this reply - the harness moves that structure out of the visible answer and into the thinking block, so the user reads only the conclusion. ` +
			"Running the paradigm in private reasoning only is not enough: a reasoning block that never spells the markers cannot be verified and cannot be moved. " +
			"Naming the paradigm, or writing one marker with nothing under it, is not running it. " +
			"The conclusion you leave in the answer must contain none of those marker tokens - not as tags, not as closing tags, not as the bare words alone on a line, not as headings. " +
			"If the conclusion needs sections, name them in natural language in the language the user wrote in (for example \"对手视角\", \"务实视角\", \"结论\"), never with a marker token. " +
			"Do not restate the branches, scores, or critiques in the conclusion, and do not wrap the conclusion in <answer> tags - the answer is already the answer."
		);
	}
	return (
		"Emit the structure in your visible answer, not only in private thinking. Keep each block short: this is scaffolding for the reasoning, not extra prose.\n" +
		"Tag discipline (this is verified mechanically): write each tag exactly as spelled, on its own line - for example a line containing `<thought_tree>` and a later line containing `</thought_tree>`. " +
		"Write the tags even though the user will not see them: the harness renders every tag as a bold natural-language label in the answer, so no marker token is ever shown. " +
		"Do not replace a tag with a heading, bold label, emoji, or table, and do not bury the entire structure inside one code fence. If the tags are missing, the paradigm counts as not run."
	);
}
