/**
 * Heuristic paradigm selection for `/think auto` and for `think` calls without a paradigm.
 * Pure, deterministic, and testable: keyword hits plus complexity signals, no model call.
 */

import { listParadigms, type Paradigm } from "./paradigms.ts";
import { matchCues } from "./nlmatch.ts";

export interface Selection {
	/** The paradigm to use, or undefined when the prompt scored below the threshold. */
	paradigm: Paradigm | undefined;
	/**
	 * The top-scoring paradigm regardless of the threshold. Auto mode is never "none": when nothing
	 * is confident it still commits to the best match, and says the score was low.
	 */
	best: Paradigm | undefined;
	/** score >= threshold means "confidently chosen". */
	confident: boolean;
	score: number;
	reasons: string[];
}

const DEFAULT_THRESHOLD = 3;

/** Signals that a prompt is substantive enough to deserve a paradigm. */
const COMPLEXITY_SIGNALS: Array<[RegExp, number, string]> = [
	[/[?？]/, 1, "question"],
	[/\b(why|how|should|what if|what would)\b/i, 1, "open question"],
	[/(为什么|怎么办|怎么|如何|要不要|值不值|该不该)/, 1, "open question (CJK)"],
	[/\b(bug|fail|failing|broken|crash|error|exception|flaky|intermittent|regression)\b/i, 2, "defect signal"],
	[/(报错|失败|崩溃|异常|不稳定|偶发|复现|超时)/, 2, "defect signal (CJK)"],
	[/```|stack trace|traceback|\berror:|\bat 0x/i, 2, "code or trace present"],
	[/\b(design|architect|refactor|migrat|redesign|select|choose|evaluate|compare)\w*/i, 2, "design signal"],
	[/(设计|架构|重构|迁移|选型|评估|对比|规划)/, 2, "design signal (CJK)"],
	[/\b(trade-?off|pros and cons|options|alternativ|approach)\b/i, 2, "trade-off signal"],
	[/(权衡|取舍|利弊|替代|选项|方案)/, 2, "trade-off signal (CJK)"],
	[/\b(should we|is it worth|decide|decision|proposal|adoption)\b/i, 2, "decision signal"],
	[/(决定|决策|方案|采纳|要不要)/, 2, "decision signal (CJK)"],
	[/[\u4e00-\u9fff]/, 1, "CJK prompt"],
];

/**
 * Prompt length signal.
 *
 * Whitespace-split word counting treats an entire Chinese sentence as one word, so every CJK prompt
 * used to score "very short prompt -2" and auto mode never fired for it. CJK is counted by character.
 */
function lengthSignal(prompt: string): { score: number; reason: string } {
	const words = prompt.trim().split(/\s+/).filter(Boolean).length;
	const cjkCharacters = (prompt.match(/[\u3400-\u4DBF\u4E00-\u9FFF]/g) ?? []).length;
	const units = words + cjkCharacters;
	if (units >= 40) return { score: 2, reason: "long prompt" };
	if (units >= 18) return { score: 1, reason: "medium prompt" };
	if (units <= 6) return { score: -2, reason: "very short prompt" };
	return { score: 0, reason: "" };
}

/** Score every paradigm against the prompt and return the best one. */
export function selectParadigm(prompt: string, threshold = DEFAULT_THRESHOLD): Selection {
	const text = prompt.trim();
	if (!text) return { paradigm: undefined, best: undefined, score: 0, confident: false, reasons: ["empty prompt"] };

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

	// Wording that names a paradigm outranks every signal: "用辩论的方式分析…" is the user saying
	// which shape they want, and generic signals ("why", a question mark) otherwise pull it to cot.
	const named = matchCues(text, listParadigms());
	if (named.matches.length === 1) {
		const cue = named.matches[0];
		reasons.push(`named in your wording: "${cue.cue}" → ${cue.paradigm.id}`);
		if (best && best.id !== cue.paradigm.id) reasons.push(`overrides the scored pick ${best.id}`);
		return { paradigm: cue.paradigm, best: cue.paradigm, score: Math.max(bestScore, threshold), confident: true, reasons };
	}
	if (named.matches.length > 1) {
		reasons.push(`wording names several paradigms (${named.matches.map((match) => `${match.cue}→${match.paradigm.id}`).join(", ")}), scored instead`);
	}

	return { paradigm: confident ? best : undefined, best, score: bestScore, confident, reasons };
}

/**
 * Uniform random pick, used by `/think random`.
 *
 * `excludeId` prevents the same paradigm being chosen two turns in a row, which is what makes a
 * random paradigm visible as variety instead of looking stuck.
 */
export function pickRandom(paradigms: Paradigm[], excludeId?: string, random: () => number = Math.random): Paradigm | undefined {
	if (paradigms.length === 0) return undefined;
	const pool = paradigms.length > 1 ? paradigms.filter((paradigm) => paradigm.id !== excludeId) : paradigms;
	if (pool.length === 0) return undefined;
	const index = Math.min(pool.length - 1, Math.max(0, Math.floor(random() * pool.length)));
	return pool[index];
}
