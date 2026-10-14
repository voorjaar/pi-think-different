/**
 * Multi-pass thinking workflow engine for pi-think-different.
 *
 * The engine drives a paradigm's steps as separate model calls and keeps the
 * control logic in code: it parses the scores the model reports, prunes weak
 * branches itself, and tells the next step exactly which candidates it may build
 * on. The model never has to hold the whole tree in its own imagination.
 *
 * `ModelCall` is injected, so the engine is unit-testable with a fake model.
 */

import { fillLimits } from "./render.ts";
import type { Intensity, Paradigm, ParadigmStep } from "./paradigms.ts";

export interface ModelCallResult {
	text: string;
	/** Provider usage for this call, when the caller can report it. */
	usage?: { input: number; output: number; totalTokens: number };
}

export type ModelCall = (system: string, user: string, step: ParadigmStep) => Promise<ModelCallResult>;

export interface WorkflowStepOutput {
	id: string;
	label: string;
	text: string;
	/** Gate note appended by the harness, when this step was score-gated. */
	gate?: string;
}

export interface WorkflowResult {
	paradigmId: string;
	intensity: Intensity;
	steps: WorkflowStepOutput[];
	final: string;
	usage: { input: number; output: number; totalTokens: number };
}

export interface Scored {
	label: string;
	score: number;
}

const MIN_SCORE = 6;
const DEFAULT_STEP_CHARS = 4000;
const MAX_CONTEXT_CHARS = 12000;
const MAX_BRANCH_BUDGET = 5;

/**
 * Intensity changes the width of a run, not just its wording:
 * light explores fewer candidates, deep explores one or two more.
 */
export function branchBudget(paradigm: Paradigm, intensity: Intensity): number {
	if (intensity === "light") return Math.max(1, Math.min(2, paradigm.limits.branches));
	if (intensity === "deep") return Math.min(MAX_BRANCH_BUDGET, paradigm.limits.branches + 1);
	return paradigm.limits.branches;
}

/** Per-step output cap, tightened for light runs and loosened for deep runs. */
export function stepCharBudget(step: ParadigmStep, intensity: Intensity): number {
	const base = step.maxChars ?? DEFAULT_STEP_CHARS;
	if (intensity === "light") return Math.round(base * 0.6);
	if (intensity === "deep") return Math.round(base * 1.25);
	return base;
}

/**
 * Extract `label -> score` pairs from model output.
 * Recognises `Score: 8/10`, `评分：8/10`, `[8/10]`, `8 / 10` on any line, and pairs the
 * score with the bracketed label on the same line, or the last label seen above it.
 */
export function extractScores(text: string): Scored[] {
	const out: Scored[] = [];
	let lastLabel = "";

	for (const line of text.split(/\r?\n/)) {
		const labelMatch = line.match(/\[([^\]|\n]{1,48})\]/);
		if (labelMatch) lastLabel = labelMatch[1].trim();

		const scoreMatch = line.match(/(?<![\d/.,-])(\d{1,2})\s*\/\s*10(?![\d])/);
		if (!scoreMatch) continue;
		const score = Number(scoreMatch[1]);
		if (!Number.isFinite(score) || score < 0 || score > 10) continue;

		const label = labelMatch ? labelMatch[1].trim() : lastLabel || `item-${out.length + 1}`;
		if (out.some((entry) => entry.label === label)) continue;
		out.push({ label, score });
	}

	return out;
}

export interface GateDecision {
	scores: Scored[];
	kept: Scored[];
	pruned: Scored[];
	note: string;
}

/**
 * External control: decide which candidates survive on score, in code.
 * When nothing is parseable the gate keeps everything and says so, so a
 * non-cooperative model cannot silently delete the whole candidate set.
 */
export function gateScores(text: string, minScore = MIN_SCORE): GateDecision {
	const scores = extractScores(text);
	if (scores.length === 0) {
		return {
			scores,
			kept: [],
			pruned: [],
			note: "Harness gate: no parseable scores found; keeping all candidates and asking for explicit scores next step.",
		};
	}
	const kept = scores.filter((entry) => entry.score >= minScore);
	const pruned = scores.filter((entry) => entry.score < minScore);
	const survivors = kept.length > 0 ? kept : [scores.slice().sort((a, b) => b.score - a.score)[0]];
	const keptList = survivors.map((entry) => `${entry.label} (${entry.score}/10)`).join(", ");
	const prunedList = pruned.length > 0 ? pruned.map((entry) => `${entry.label} (${entry.score}/10)`).join(", ") : "none";
	return {
		scores,
		kept: survivors,
		pruned,
		note: `Harness gate (external control): pruned ${prunedList}. Build only on: ${keptList}. Do not revive a pruned candidate unless you state the evidence that changes its score.`,
	};
}

function capText(text: string, maxChars: number): string {
	const trimmed = text.trim();
	if (trimmed.length <= maxChars) return trimmed;
	return `${trimmed.slice(0, maxChars)}\n... [truncated ${trimmed.length - maxChars} chars]`;
}

function fillStepTemplate(step: ParadigmStep, values: Record<string, string>): string {
	return step.user.replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, key: string) => values[key] ?? "");
}

/** Assemble the prior-step context block, capped and labelled. */
function buildPriorContext(steps: WorkflowStepOutput[], mode: "last" | "all"): string {
	const picked = mode === "last" ? steps.slice(-1) : steps;
	const joined = picked.map((step) => `### ${step.label}\n${step.text}${step.gate ? `\n${step.gate}` : ""}`).join("\n\n");
	return capText(joined, MAX_CONTEXT_CHARS);
}

export interface RunOptions {
	/** Only run these step ids (order preserved). Used for partial reruns and tests. */
	only?: string[];
	minScore?: number;
}

/**
 * Run a paradigm's multi-pass workflow.
 * Steps run strictly in sequence; each step receives the labelled output of its
 * predecessors plus any harness gate note.
 */
export async function runWorkflow(
	paradigm: Paradigm,
	task: string,
	intensity: Intensity,
	call: ModelCall,
	options: RunOptions = {},
): Promise<WorkflowResult> {
	const usage = { input: 0, output: 0, totalTokens: 0 };
	const steps: WorkflowStepOutput[] = [];
	const branches = branchBudget(paradigm, intensity);
	const depth = intensity === "light" ? 1 : paradigm.limits.depth;
	const selected = options.only && options.only.length > 0 ? paradigm.steps.filter((step) => options.only!.includes(step.id)) : paradigm.steps;

	for (const step of selected) {
		const priorLast = buildPriorContext(steps, "last");
		const priorAll = buildPriorContext(steps, "all");
		const lastGate = steps.length > 0 ? steps[steps.length - 1].gate ?? "" : "";
		const budget = `[Harness budget] Explore at most ${branches} candidates and ${depth} level(s) deep. This limit is set by the harness, not by you.`;
		const user = `${fillStepTemplate(step, {
			task,
			last: priorLast,
			all: priorAll,
			gate: lastGate,
			limits: budget,
			branches: String(branches),
			depth: String(depth),
		})}

${budget}`;

		const result = await call(fillLimits(step.system, paradigm), user, step);
		const maxChars = stepCharBudget(step, intensity);
		const output: WorkflowStepOutput = { id: step.id, label: step.label, text: capText(result.text, maxChars) };

		if (step.scoreGate) {
			const gate = gateScores(result.text, options.minScore ?? MIN_SCORE);
			output.gate = gate.note;
			output.text = `${output.text}\n\n[Harness scores] ${gate.scores.map((entry) => `${entry.label}=${entry.score}`).join(" | ")}`;
		}

		if (result.usage) {
			usage.input += result.usage.input;
			usage.output += result.usage.output;
			usage.totalTokens += result.usage.totalTokens;
		}
		steps.push(output);
	}

	const last = steps.length > 0 ? steps[steps.length - 1] : undefined;
	const final = last ? last.text : "";
	return { paradigmId: paradigm.id, intensity, steps, final, usage };
}

/** Render a workflow result for the model or the terminal. */
export function renderWorkflowResult(result: WorkflowResult, task: string): string {
	const head = `Thinking workflow: ${result.paradigmId} (${result.intensity}) over ${result.steps.length} separate model calls.\nTask: ${task}`;
	const body = result.steps.map((step) => `### Step ${result.steps.indexOf(step) + 1}: ${step.label}\n${step.text}${step.gate ? `\n${step.gate}` : ""}`).join("\n\n");
	return `${head}\n\n${body}`;
}
