/**
 * Natural-language paradigm matching for `/think <free text>`.
 *
 * `/think 六顶思考帽 俄乌战争的结果` is explicit: paradigm token, then task.
 * `/think 以六顶思考帽的方式思考俄乌战争的结果` is prose: the paradigm name is buried in
 * the sentence and so is the problem. This module finds the paradigm cue in the text and
 * hands back what is left as the task.
 *
 * Matching is deliberately cue-based, not semantic: a fixed vocabulary per paradigm
 * (id, aliases, titles, `cues`) and longest-match-wins. When two different paradigms match,
 * the caller is told it is ambiguous instead of guessing - silently picking a paradigm is
 * worse than asking.
 *
 * Pure functions: no Pi imports.
 */

import type { Paradigm } from "./paradigms.ts";

export interface CueMatch {
	paradigm: Paradigm;
	/** The phrase that produced the match, as written in the registry. */
	cue: string;
	start: number;
	end: number;
}

export interface CueOutcome {
	/** Distinct paradigms whose cue was found, best match first. */
	matches: CueMatch[];
	/** True when more than one paradigm matched and the caller should ask instead of picking. */
	ambiguous: boolean;
}

const ASCII_WORD = /^[a-z0-9 ._-]+$/;

/** Every phrase that means "this paradigm", lowercased for ASCII. */
export function cueVocabulary(paradigm: Paradigm): string[] {
	const terms = [
		paradigm.id,
		paradigm.title,
		paradigm.titleZh,
		...paradigm.aliases,
		...(paradigm.cues ?? []),
	];
	return terms.map((term) => term.trim()).filter((term) => term.length >= 2);
}

function isAsciiWordBoundary(text: string, start: number, end: number): boolean {
	const before = start > 0 ? text[start - 1] : "";
	const after = end < text.length ? text[end] : "";
	const alnum = (char: string) => /[a-z0-9]/i.test(char);
	return !alnum(before) && !alnum(after);
}

function findOccurrences(haystack: string, needle: string): { start: number; end: number }[] {
	const found: { start: number; end: number }[] = [];
	let from = 0;
	while (from <= haystack.length) {
		const at = haystack.indexOf(needle, from);
		if (at < 0) break;
		const end = at + needle.length;
		if (ASCII_WORD.test(needle) && !isAsciiWordBoundary(haystack, at, end)) {
			from = at + 1;
			continue;
		}
		found.push({ start: at, end });
		from = end;
	}
	return found;
}

/**
 * Find paradigm cues in free text.
 *
 * Overlapping hits are collapsed to the longest phrase at the same span, so
 * "六顶思考帽" wins over the shorter "思考帽" instead of matching twice.
 */
export function matchCues(text: string, paradigms: Paradigm[]): CueOutcome {
	const haystack = text.toLowerCase();
	const raw: CueMatch[] = [];

	for (const paradigm of paradigms) {
		for (const cue of cueVocabulary(paradigm)) {
			const needle = ASCII_WORD.test(cue) ? cue.toLowerCase() : cue;
			for (const span of findOccurrences(haystack, needle)) {
				raw.push({ paradigm, cue, ...span });
			}
		}
	}

	// Longest phrase first, then drop any match nested inside an accepted one.
	const ranked = raw
		.sort((a, b) => b.cue.length - a.cue.length || a.start - b.start)
		.filter((match, _index, all) => !all.some((other) => other !== match && other.cue.length > match.cue.length && other.start <= match.start && other.end >= match.end));

	const distinct: CueMatch[] = [];
	for (const match of ranked) {
		if (distinct.some((entry) => entry.paradigm.id === match.paradigm.id)) continue;
		distinct.push(match);
	}

	return { matches: distinct, ambiguous: distinct.length > 1 };
}

/** Connective scaffolding that surrounds a cue: "以…的方式", "用…分析一下", "帮我…". */
const FILLER = [
	"以",
	"用",
	"采用",
	"运用",
	"使用",
	"借助",
	"靠",
	"基于",
	"请",
	"帮我",
	"麻烦",
	"试着",
	"尝试",
	"的方式",
	"的方法",
	"的方式去",
	"的方式来",
	"方式",
	"方法",
	"来",
	"去",
	"并",
	"和",
	"跟",
	"与",
	"关于",
	"对于",
	"针对",
	"一下",
	"想想",
	"想一想",
	"看看",
	"思考",
	"分析",
	"评估",
	"探讨",
	"讨论",
	"论证",
	"研究",
	"想",
	"看",
	"的",
];

function trimFront(text: string): string {
	let out = text.trim().replace(/^[，。、：:;!！?？()（）\s]+/, "");
	let changed = true;
	while (changed) {
		changed = false;
		for (const filler of FILLER) {
			if (out.toLowerCase().startsWith(filler.toLowerCase())) {
				out = out.slice(filler.length).replace(/^[，。、：:;!！?？()（）\s]+/, "");
				changed = true;
			}
		}
	}
	return out;
}

/**
 * The task is whatever the sentence says once the paradigm cue and its scaffolding are gone.
 * Returns undefined when the sentence said nothing beyond the paradigm itself.
 */
export function taskAfterCue(text: string, match: CueMatch): string | undefined {
	const withoutCue = text.slice(0, match.start) + " " + text.slice(match.end);
	const cleaned = trimFront(withoutCue).replace(/\s{2,}/g, " ").trim();
	return cleaned.length > 0 ? cleaned : undefined;
}
