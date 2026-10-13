/**
 * Heuristic paradigm selection for `/think auto` and for `think` calls without a paradigm.
 * Pure, deterministic, and testable: keyword hits plus complexity signals, no model call.
 */

import { listParadigms, type Paradigm } from "./paradigms.ts";

export interface Selection {
	paradigm: Paradigm | undefined;
	score: number;
	/** score >= threshold means "inject it". */
	confident: boolean;
	reasons: string[];
}

const DEFAULT_THRESHOLD = 3;

/** Signals that a prompt is substantive enough to deserve a paradigm. */
const COMPLEXITY_SIGNALS: Array<[RegExp, number, string]> = [
	[/[?？]/, 1, "question"],
	[/\b(why|how|should|what if|what would)\b/i, 1, "open question"],
	[/\b(bug|fail|failing|broken|crash|error|exception|flaky|intermittent|regression)\b/i, 2, "defect signal"],
	[/```|stack trace|traceback|\berror:|\bat 0x/i, 2, "code or trace present"],
	[/\b(design|architect|refactor|migrat|redesign|select|choose|evaluate|compare)\w*/i, 2, "design signal"],
	[/\b(trade-?off|pros and cons|options|alternativ|approach)\b/i, 2, "trade-off signal"],
	[/\b(should we|is it worth|decide|decision|proposal|adoption)\b/i, 2, "decision signal"],
	[/[\u4e00-\u9fff]/, 1, "CJK prompt"],
];

function lengthSignal(prompt: string): { score: number; reason: string } {
	const words = prompt.trim().split(/\s+/).filter(Boolean).length;
	if (words >= 40) return { score: 2, reason: "long prompt" };
	if (words >= 18) return { score: 1, reason: "medium prompt" };
	if (words <= 5) return { score: -2, reason: "very short prompt" };
	return { score: 0, reason: "" };
}

/** Score every paradigm against the prompt and return the best one. */
export function selectParadigm(prompt: string, threshold = DEFAULT_THRESHOLD): Selection {
	const text = prompt.trim();
	if (!text) return { paradigm: undefined, score: 0, confident: false, reasons: ["empty prompt"] };

	const lower = text.toLowerCase();
	const reasons: string[] = [];
	let base = 0;

	for (const [pattern, weight, reason] of COMPLEXITY_SIGNALS) {
		if (pattern.test(text)) {
			base += weight;
			reasons.push(`${reason} +${weight}`);
		}
	}

	const length = lengthSignal(text);
	base += length.score;
	if (length.reason) reasons.push(`${length.reason} ${length.score >= 0 ? "+" : ""}${length.score}`);

	let best: Paradigm | undefined;
	let bestScore = -Infinity;

	for (const paradigm of listParadigms()) {
		let score = base;
		const hits: string[] = [];
		for (const keyword of paradigm.keywords) {
			if (lower.includes(keyword.toLowerCase())) {
				score += 2;
				hits.push(keyword);
			}
		}
		for (const keyword of paradigm.skipKeywords ?? []) {
			if (lower.includes(keyword.toLowerCase())) {
				score -= 4;
				hits.push(`-${keyword}`);
			}
		}
		// Deterministic tie-break: registry order, so tests are stable.
		if (score > bestScore) {
			bestScore = score;
			best = paradigm;
		}
	}

	const confident = best !== undefined && bestScore >= threshold;
	if (best) {
		const keywordHits = best.keywords.filter((keyword) => lower.includes(keyword.toLowerCase()));
		if (keywordHits.length > 0) reasons.push(`${best.id} keyword hits: ${keywordHits.join(", ")}`);
	}

	return { paradigm: confident ? best : undefined, score: bestScore, confident, reasons };
}
