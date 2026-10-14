/**
 * Test suite for pi-think-different.
 *
 * Run: node --test selftest.ts
 *
 * Covers the paradigm registry, prompt rendering, command parsing, auto-selection,
 * score extraction, external pruning, and the multi-pass workflow engine against a
 * scripted fake model. Every paradigm is exercised, not just the popular ones.
 */

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { selectParadigm } from "./autoSelect.ts";
import { listParadigms, PARADIGMS, resolveParadigm } from "./paradigms.ts";
import { intensityFor, parseThinkArgs, renderBody, renderSection, SECTION_TAG } from "./render.ts";
import { DEFAULT_CONFIG, mergeConfigs, parseConfig, parseConfigText, stripJsonComments } from "./config.ts";
import { extractStructure, placementClause } from "./placement.ts";
import { describeState, helpLines, renderList } from "./ui.ts";
import { branchBudget, extractScores, gateScores, renderWorkflowResult, runWorkflow, stepCharBudget, type ModelCallResult } from "./workflow.ts";
import type { ParadigmStep } from "./paradigms.ts";

const ALLOWED_PLACEHOLDERS = new Set(["task", "last", "all", "gate", "limits", "branches", "depth"]);

// ---------------------------------------------------------------- registry

test("registry: ids and aliases are unique and normalized", () => {
	const seen = new Map<string, string>();
	for (const paradigm of PARADIGMS) {
		for (const key of [paradigm.id, ...paradigm.aliases]) {
			const normalized = key.trim().toLowerCase().replace(/[\s_]+/g, "-");
			assert.ok(normalized.length > 0, `${paradigm.id}: empty alias`);
			assert.equal(seen.get(normalized), undefined, `duplicate alias '${normalized}' (${seen.get(normalized)} vs ${paradigm.id})`);
			seen.set(normalized, paradigm.id);
		}
	}
	assert.ok(PARADIGMS.length >= 8, "expected at least 8 paradigms");
});

test("registry: every paradigm is complete and internally consistent", () => {
	for (const paradigm of PARADIGMS) {
		assert.match(paradigm.id, /^[a-z][a-z0-9-]*$/, `${paradigm.id}: id must be slug-like`);
		assert.ok(paradigm.title.length > 0, `${paradigm.id}: title`);
		assert.ok(paradigm.titleZh.length > 0, `${paradigm.id}: titleZh`);
		assert.ok(paradigm.emoji.length > 0, `${paradigm.id}: emoji`);
		assert.ok(paradigm.summary.length > 10, `${paradigm.id}: summary`);
		assert.ok(paradigm.bestFor.length > 10, `${paradigm.id}: bestFor`);
		assert.ok(paradigm.markers.length >= 2, `${paradigm.id}: needs at least two structural markers`);
		assert.ok(paradigm.body.length > 200, `${paradigm.id}: body too short`);
		assert.ok(paradigm.compact.length > 80, `${paradigm.id}: compact too short`);
		assert.ok(paradigm.compact.length < paradigm.body.length, `${paradigm.id}: compact must be shorter than body`);
		assert.ok(paradigm.limits.branches >= 1 && paradigm.limits.depth >= 1, `${paradigm.id}: limits`);
		assert.ok(paradigm.keywords.length >= 2, `${paradigm.id}: needs auto-select keywords`);
		assert.ok(paradigm.steps.length >= 2, `${paradigm.id}: needs a multi-step workflow`);

		// The scaffold must actually name the markers it is judged on.
		for (const marker of paradigm.markers) {
			assert.ok(paradigm.body.includes(marker), `${paradigm.id}: body missing marker ${marker}`);
			assert.ok(paradigm.compact.includes(marker), `${paradigm.id}: compact missing marker ${marker}`);
		}

		// No unresolved template placeholders other than the allowed ones.
		for (const step of paradigm.steps) {
			assert.ok(step.id.length > 0, `${paradigm.id}: step id`);
			assert.ok(step.label.length > 0, `${paradigm.id}: step label`);
			assert.ok(step.system.length > 30, `${paradigm.id}.${step.id}: system prompt too short`);
			for (const match of step.user.matchAll(/\{\{\s*(\w+)\s*\}\}/g)) {
				assert.ok(ALLOWED_PLACEHOLDERS.has(match[1]), `${paradigm.id}.${step.id}: unknown placeholder {{${match[1]}}}`);
			}
			for (const match of step.system.matchAll(/\{\{\s*(\w+)\s*\}\}/g)) {
				assert.ok(ALLOWED_PLACEHOLDERS.has(match[1]), `${paradigm.id}.${step.id}: system uses {{${match[1]}}}`);
			}
		}

		// Step ids must be unique so `only:` reruns are unambiguous.
		const ids = new Set(paradigm.steps.map((step) => step.id));
		assert.equal(ids.size, paradigm.steps.length, `${paradigm.id}: duplicate step ids`);
	}
});

test("registry: the last step of every workflow asks for the answer block", () => {
	for (const paradigm of PARADIGMS) {
		const last = paradigm.steps[paradigm.steps.length - 1];
		const mentionsAnswer = last.system.includes("answer") || last.system.includes("<answer>");
		assert.ok(mentionsAnswer, `${paradigm.id}: final step must produce the answer (${last.label})`);
	}
});

// ---------------------------------------------------------------- resolution

test("resolve: ids, aliases, case, spacing, and CJK aliases", () => {
	assert.equal(resolveParadigm("tot")?.id, "tot");
	assert.equal(resolveParadigm("TOT")?.id, "tot");
	assert.equal(resolveParadigm("Tree of Thoughts")?.id, "tot");
	assert.equal(resolveParadigm("tree_of_thoughts")?.id, "tot");
	assert.equal(resolveParadigm("思维树")?.id, "tot");
	assert.equal(resolveParadigm(" 思考帽 ")?.id, "hats");
	assert.equal(resolveParadigm("first principles")?.id, "first-principles");
	assert.equal(resolveParadigm("self-correction")?.id, "critique");
	assert.equal(resolveParadigm("nope")?.id, undefined);
	assert.equal(resolveParadigm(undefined)?.id, undefined);
	assert.equal(resolveParadigm("")?.id, undefined);
});

// ---------------------------------------------------------------- rendering

test("skill: the bundled SKILL.md sits next to the extension, not next to the session cwd", () => {
	// resources_discover resolves skill paths against the session cwd, so the bundled skill
	// must be addressed from the extension's own directory.
	const extensionDir = dirname(fileURLToPath(import.meta.url));
	assert.ok(existsSync(join(extensionDir, "skills", "think-different", "SKILL.md")), "bundled skill missing");
	assert.ok(!existsSync(join(process.cwd(), "skills", "think-different", "SKILL.md")) || extensionDir === process.cwd(), "skill resolves from the session cwd");
});

test("render: section carries the markers, the escape hatch, and the intensity", () => {
	for (const paradigm of PARADIGMS) {
		const section = renderSection(paradigm, "standard", "answer", "session");
		assert.ok(section.includes(paradigm.id), `${paradigm.id}: section names the paradigm`);
		for (const marker of paradigm.markers) {
			assert.ok(section.includes(marker), `${paradigm.id}: section missing marker ${marker}`);
		}
		assert.ok(section.includes("Escape hatch"), `${paradigm.id}: section missing escape hatch`);
		assert.ok(section.includes("visible answer"), `${paradigm.id}: section missing visibility clause`);
		assert.ok(section.includes("Tag discipline"), `${paradigm.id}: section missing tag discipline`);
		assert.ok(section.includes(`Required markers, verbatim: ${paradigm.markers.join(", ")}`), `${paradigm.id}: section missing required-marker line`);
		assert.ok(!section.includes("{{"), `${paradigm.id}: unresolved placeholder in section`);
	}
});

test("render: placement thinking moves the structure out of the answer", () => {
	const paradigm = resolveParadigm("tot")!;
	const section = renderSection(paradigm, "standard", "thinking", "session");
	assert.ok(section.includes("run this paradigm's structure inside your reasoning"), "thinking placement clause missing");
	assert.ok(!section.includes("Emit the structure in your visible answer"), "answer placement clause leaked into thinking placement");
	assert.ok(section.includes("Required markers, verbatim"), "thinking placement must still require markers");
	assert.ok(placementClause("answer", paradigm).includes("visible answer"), "answer placement clause missing");
});

test("render: a concrete task from /think is injected for the turn", () => {
	const paradigm = resolveParadigm("tot")!;
	const withTask = renderSection(paradigm, "standard", "answer", "session", "design a cache layer");
	assert.ok(withTask.includes("Concrete task for this turn: design a cache layer"), "task not injected");
	assert.ok(!renderSection(paradigm, "standard", "answer", "session").includes("Concrete task"), "task line appeared without a task");
});

test("render: light is shorter than standard is shorter than deep", () => {
	const paradigm = resolveParadigm("tot")!;
	const light = renderBody(paradigm, "light");
	const standard = renderBody(paradigm, "standard");
	const deep = renderBody(paradigm, "deep");
	assert.ok(light.length < standard.length, "light must be shorter");
	assert.ok(standard.length < deep.length, "deep must add guidance");
	assert.ok(deep.includes("second-best"), "deep guidance missing");
});

test("render: limits are substituted from the paradigm", () => {
	const paradigm = resolveParadigm("tot")!;
	const body = renderBody(paradigm, "standard");
	assert.ok(body.includes(`at most ${paradigm.limits.branches} first-level branches`), "branches limit not filled");
	assert.ok(body.includes(`at most ${paradigm.limits.depth} levels deep`), "depth limit not filled");
});

test("render: catalogue lists every paradigm in each language, never both", () => {
	for (const lang of ["en", "zh"] as const) {
		const list = renderList(lang);
		for (const paradigm of PARADIGMS) {
			assert.ok(list.includes(paradigm.id), `list missing ${paradigm.id}`);
			assert.ok(list.includes(lang === "zh" ? paradigm.summaryZh : paradigm.summary), `list missing ${lang} summary for ${paradigm.id}`);
		}
		const hasCJK = /[\u3400-\u4DBF\u4E00-\u9FFF]/.test(list);
		const titles = renderList(lang);
		const otherTitles = PARADIGMS.map((paradigm) => (lang === "zh" ? paradigm.title : paradigm.titleZh)).filter((title) => titles.includes(title));
		assert.equal(otherTitles.length, 0, `${lang} list leaked the other language's titles`);
		assert.equal(hasCJK, lang === "zh", `${lang} list has the wrong language`);
	}
	assert.equal(renderList("en").includes(SECTION_TAG), false, "catalogue should not leak the section tag");
});

test("ui: help and status follow the language option", () => {
	const en = helpLines("en");
	const zh = helpLines("zh");
	assert.equal(en.length, zh.length, "help must cover the same commands in both languages");
	assert.ok(zh.some((line) => /[\u4E00-\u9FFF]/.test(line)), "zh help has no Chinese");
	assert.ok(!en.some((line) => /[\u4E00-\u9FFF]/.test(line)), "en help leaked Chinese");

	const paradigm = resolveParadigm("tot")!;
	const base = { mode: "sticky" as const, paradigm, paradigmId: paradigm.id, intensity: "standard" as const, placement: "answer" as const };
	const enText = describeState({ ...base, lang: "en" });
	const zhText = describeState({ ...base, lang: "zh" });
	assert.ok(enText.startsWith("thinking paradigm:"), "en status wrong shape");
	assert.ok(zhText.startsWith("思考范式："), "zh status wrong shape");
	assert.ok(zhText.includes("思维树"), "zh status must use the Chinese paradigm name");
	assert.ok(!zhText.includes(paradigm.title), "zh status leaked the English title");
});

test("render: intensityFor falls back safely", () => {
	assert.equal(intensityFor("light"), "light");
	assert.equal(intensityFor("deep"), "deep");
	assert.equal(intensityFor("turbo", "standard"), "standard");
	assert.equal(intensityFor(undefined, "light"), "light");
});

// ---------------------------------------------------------------- command parsing

test("parse: /think argument shapes", () => {
	assert.equal(parseThinkArgs("").action, "status");
	assert.equal(parseThinkArgs("help").action, "help");
	assert.equal(parseThinkArgs("list").action, "list");
	assert.equal(parseThinkArgs("status").action, "status");
	assert.equal(parseThinkArgs("off").action, "off");
	assert.equal(parseThinkArgs("auto").action, "auto");
	assert.equal(parseThinkArgs("auto deep").action, "auto");
	assert.equal(parseThinkArgs("auto deep").intensity, "deep");
	assert.equal(parseThinkArgs("once tot").action, "once");
	assert.equal(parseThinkArgs("once tot").paradigm?.id, "tot");
	assert.equal(parseThinkArgs("tot").paradigm?.id, "tot");
	assert.equal(parseThinkArgs("tot").action, "set");
	assert.equal(parseThinkArgs("六顶思考帽").paradigm?.id, "hats");
	assert.equal(parseThinkArgs("hats deep").intensity, "deep");
	assert.equal(parseThinkArgs("deep").action, "intensity");
	assert.equal(parseThinkArgs("deep").intensity, "deep");
	assert.equal(parseThinkArgs("bogus").unknown, "bogus");
	assert.equal(parseThinkArgs("once bogus").unknown, "bogus");
	assert.equal(parseThinkArgs("tot design a cache layer").task, "design a cache layer");
	assert.equal(parseThinkArgs("once hats deep adopt no-meeting wednesday").task, "adopt no-meeting wednesday");
	assert.equal(parseThinkArgs("tot deep").task, undefined);
	assert.equal(parseThinkArgs("tot deep").intensity, "deep");
});

// ---------------------------------------------------------------- auto selection

test("select: defect prompts pick hypothesis, decisions pick hats or debate", () => {
	const bug = selectParadigm("The integration test fails intermittently only on CI, root cause please");
	assert.ok(bug.confident, "defect prompt should be confident");
	assert.equal(bug.paradigm?.id, "hypothesis");

	const decision = selectParadigm("Should we adopt a managed queue instead of writing our own? Is it worth it?");
	assert.ok(decision.confident, "decision prompt should be confident");
	assert.ok(["hats", "debate", "angles"].includes(decision.paradigm?.id ?? ""), `got ${decision.paradigm?.id}`);
});

test("select: design prompts pick tot or got", () => {
	const design = selectParadigm("We need to design a caching layer for the read path. Which approach is better: request coalescing or a materialized view?");
	assert.ok(design.confident);
	assert.ok(["tot", "got", "angles"].includes(design.paradigm?.id ?? ""), `got ${design.paradigm?.id}`);
});

test("select: trivial prompts are not given a paradigm", () => {
	const trivial = selectParadigm("git status");
	assert.equal(trivial.confident, false, `score ${trivial.score} should not clear the threshold`);

	const rename = selectParadigm("rename the variable x to width");
	assert.equal(rename.confident, false, `score ${rename.score} should not clear the threshold`);

	assert.equal(selectParadigm("").confident, false);
});

test("select: deterministic for the same prompt", () => {
	const prompt = "why does the build fail with a stack trace?";
	const a = selectParadigm(prompt);
	const b = selectParadigm(prompt);
	assert.equal(a.paradigm?.id, b.paradigm?.id);
	assert.equal(a.score, b.score);
});

// ---------------------------------------------------------------- score parsing

test("scores: extract from the scaffold formats the model is told to use", () => {
	const text = [
		"[Root] Ship the queue.",
		"  |-- [Branch_A] managed queue | Score: 8/10 - ops cost low",
		"  |-- [Branch_B] hand-rolled queue | Score: 4/10 - maintenance risk",
		"  └-- [Branch_C] no queue | 评分：2/10 - backpressure unhandled",
	].join("\n");
	const scores = extractScores(text);
	assert.equal(scores.length, 3);
	assert.deepEqual(
		scores.map((entry) => entry.label),
		["Branch_A", "Branch_B", "Branch_C"],
	);
	assert.deepEqual(
		scores.map((entry) => entry.score),
		[8, 4, 2],
	);
});

test("scores: inherit the label from the line above when the score line has no bracket", () => {
	const scores = extractScores("[Branch_X] async retry\nScore: 7/10 because retries are bounded");
	assert.equal(scores.length, 1);
	assert.equal(scores[0].label, "Branch_X");
	assert.equal(scores[0].score, 7);
});

test("scores: junk and out-of-range values are ignored", () => {
	const scores = extractScores("10/100 ratio\nScore: 12/10\nScore: -3/10\nplain prose");
	assert.equal(scores.length, 0);
});

test("gate: low scorers are pruned in code, not by the model", () => {
	const gate = gateScores("[Branch_A] a | Score: 9/10\n[Branch_B] b | Score: 3/10");
	assert.equal(gate.kept.length, 1);
	assert.equal(gate.kept[0].label, "Branch_A");
	assert.equal(gate.pruned.length, 1);
	assert.ok(gate.note.includes("pruned Branch_B (3/10)"), gate.note);
	assert.ok(gate.note.includes("Build only on: Branch_A (9/10)"), gate.note);
});

test("gate: when every candidate is weak, the best one still survives", () => {
	const gate = gateScores("[Branch_A] a | Score: 2/10\n[Branch_B] b | Score: 1/10");
	assert.equal(gate.kept.length, 1);
	assert.equal(gate.kept[0].label, "Branch_A");
});

test("gate: unparseable output keeps everything and says so", () => {
	const gate = gateScores("some prose with no numbers at all");
	assert.equal(gate.kept.length, 0);
	assert.ok(gate.note.includes("no parseable scores"), gate.note);
});

// ---------------------------------------------------------------- workflow engine

interface ScriptedCall {
	calls: Array<{ system: string; user: string; step: ParadigmStep }>;
	texts: string[];
}

function scriptedModel(texts: string[], record: ScriptedCall) {
	return async (system: string, user: string, step: ParadigmStep): Promise<ModelCallResult> => {
		record.calls.push({ system, user, step });
		const text = texts[record.calls.length - 1] ?? `fallback output for ${step.id}`;
		return { text, usage: { input: 10, output: 20, totalTokens: 30 } };
	};
}

test("workflow: every paradigm runs its full step sequence", async () => {
	for (const paradigm of PARADIGMS) {
		const record: ScriptedCall = { calls: [], texts: [] };
		const result = await runWorkflow(paradigm, "Test task for " + paradigm.id, "standard", scriptedModel([], record));
		assert.equal(result.steps.length, paradigm.steps.length, `${paradigm.id}: step count`);
		assert.equal(result.paradigmId, paradigm.id);
		assert.deepEqual(
			record.calls.map((call) => call.step.id),
			paradigm.steps.map((step) => step.id),
			`${paradigm.id}: step order`,
		);
		assert.equal(result.usage.totalTokens, paradigm.steps.length * 30, `${paradigm.id}: usage aggregated`);
	}
});

test("workflow: no placeholder survives into a model call", async () => {
	for (const paradigm of PARADIGMS) {
		const record: ScriptedCall = { calls: [], texts: [] };
		await runWorkflow(paradigm, "some task", "standard", scriptedModel([], record));
		for (const call of record.calls) {
			assert.ok(!/\{\{\s*\w+\s*\}\}/.test(call.user), `${paradigm.id}.${call.step.id}: unfilled placeholder`);
			assert.ok(!/\{\{\s*\w+\s*\}\}/.test(call.system), `${paradigm.id}.${call.step.id}: unfilled placeholder in system`);
			assert.ok(call.user.length > 0);
			assert.ok(call.system.length > 0);
		}
	}
});

test("workflow: prior steps are threaded into later steps, labelled", async () => {
	const paradigm = resolveParadigm("critique")!;
	const record: ScriptedCall = {
		calls: [],
		texts: ["<draft>first pass</draft>", "<criticism>three holes</criticism>", "<refinement>fixed</refinement>\n<answer>done</answer>"],
	};
	const result = await runWorkflow(paradigm, "fix the parser", "standard", scriptedModel(record.texts, record));

	assert.ok(record.calls[1].user.includes("<draft>first pass</draft>"), "criticism step did not receive the draft");
	assert.ok(record.calls[1].user.includes("### Draft"), "prior output not labelled");
	assert.ok(record.calls[2].user.includes("<criticism>three holes</criticism>"), "refinement step did not receive the criticism");
	assert.ok(result.final.includes("<answer>done</answer>"), "final answer missing");
	assert.equal(result.steps[2].label, "Refinement");
});

test("workflow: score gate prunes externally and the note reaches the next step", async () => {
	const paradigm = resolveParadigm("tot")!;
	const record: ScriptedCall = {
		calls: [],
		texts: [
			"[Branch_A] cache aside | Score: 8/10 - simple\n[Branch_B] write through | Score: 3/10 - latency",
			"[Branch_A.1] TTL 60s | Score: 7/10",
			"[Path] Root -> Branch_A -> Branch_A.1\n<answer>use cache-aside</answer>",
		],
	};
	const result = await runWorkflow(paradigm, "design the cache", "standard", scriptedModel(record.texts, record));

	const gate = result.steps[0].gate;
	assert.ok(gate, "branch step should be gated");
	assert.ok(gate!.includes("pruned Branch_B (3/10)"), gate!);
	assert.ok(record.calls[1].user.includes("Harness gate"), "gate note missing from explore step");
	assert.ok(result.steps[0].text.includes("Branch_A=8"), "parsed scores not recorded");
	assert.ok(result.final.includes("use cache-aside"));
});

test("workflow: only selected step ids run, in registry order", async () => {
	const paradigm = resolveParadigm("hats")!;
	const record: ScriptedCall = { calls: [], texts: [] };
	const result = await runWorkflow(paradigm, "remote work policy", "standard", scriptedModel([], record), { only: ["black", "green", "blue"] });
	assert.deepEqual(
		result.steps.map((step) => step.id),
		["black", "green", "blue"],
	);
});

test("workflow: per-step output caps are enforced", async () => {
	const paradigm = resolveParadigm("hats")!;
	const long = "x".repeat(9000);
	const record: ScriptedCall = { calls: [], texts: [long, long, long, long, long, long] };
	const result = await runWorkflow(paradigm, "topic", "standard", scriptedModel(record.texts, record));
	const white = result.steps[0];
	assert.ok(white.text.length < 2000, `cap not applied (${white.text.length})`);
	assert.ok(white.text.includes("[truncated"), "truncation not reported to the model");
});

test("workflow: a runaway prior context is capped, not dumped whole", async () => {
	const paradigm = resolveParadigm("hats")!;
	const long = "y".repeat(9000);
	const record: ScriptedCall = { calls: [], texts: [long, long, long, long, long, long] };
	await runWorkflow(paradigm, "topic", "standard", scriptedModel(record.texts, record));
	const lastUserCall = record.calls[5].user;
	assert.ok(lastUserCall.length < 20000, `prior context not capped (${lastUserCall.length})`);
});

test("workflow: rendered result names every step for the reader", async () => {
	const paradigm = resolveParadigm("debate")!;
	const record: ScriptedCall = { calls: [], texts: [] };
	const result = await runWorkflow(paradigm, "is the plan sound", "standard", scriptedModel([], record));
	const rendered = renderWorkflowResult(result, "is the plan sound");
	for (const step of paradigm.steps) {
		assert.ok(rendered.includes(step.label), `rendered output missing ${step.label}`);
	}
	assert.ok(rendered.includes("separate model calls"), "rendered output should say it used multiple calls");
});

test("workflow: a failing step rejects instead of returning a half answer silently", async () => {
	const paradigm = resolveParadigm("cot")!;
	const failing = async (): Promise<ModelCallResult> => {
		throw new Error("provider exploded");
	};
	await assert.rejects(() => runWorkflow(paradigm, "task", "standard", failing), /provider exploded/);
});

test("workflow: intensity widens and narrows the actual run, not just the wording", async () => {
	const paradigm = resolveParadigm("tot")!;

	const lightRecord: ScriptedCall = { calls: [], texts: [] };
	await runWorkflow(paradigm, "task", "light", scriptedModel([], lightRecord));
	const deepRecord: ScriptedCall = { calls: [], texts: [] };
	await runWorkflow(paradigm, "task", "deep", scriptedModel([], deepRecord));

	const lightBranches = branchBudget(paradigm, "light");
	const standardBranches = branchBudget(paradigm, "standard");
	const deepBranches = branchBudget(paradigm, "deep");
	assert.ok(lightBranches <= standardBranches, "light must not explore more than standard");
	assert.ok(deepBranches >= standardBranches, "deep must not explore less than standard");
	assert.ok(deepBranches <= 5, "branch budget must stay bounded");

	assert.ok(lightRecord.calls[0].user.includes(`${lightBranches} genuinely different approaches`), "light budget not applied");
	assert.ok(deepRecord.calls[0].user.includes(`${deepBranches} genuinely different approaches`), "deep budget not applied");
	assert.ok(lightRecord.calls[0].user.includes("1 level(s) deep"), "light must cap depth at 1");
	assert.ok(!deepRecord.calls[0].user.includes("1 level(s) deep"), "deep must not inherit the light depth cap");
});

test("workflow: every step is told the harness budget", async () => {
	for (const paradigm of PARADIGMS) {
		const record: ScriptedCall = { calls: [], texts: [] };
		await runWorkflow(paradigm, "budget probe", "standard", scriptedModel([], record));
		for (const call of record.calls) {
			assert.ok(call.user.includes("[Harness budget]"), `${paradigm.id}.${call.step.id}: budget not stated`);
		}
	}
});

test("workflow: step caps follow intensity", () => {
	const paradigm = resolveParadigm("hats")!;
	const step = paradigm.steps.find((entry) => entry.id === "black")!;
	assert.ok(stepCharBudget(step, "light") < stepCharBudget(step, "standard"));
	assert.ok(stepCharBudget(step, "deep") > stepCharBudget(step, "standard"));
});

// ---------------------------------------------------------------- catalogue sanity

test("catalogue: paradigms are distinguishable by their markers", () => {
	const seen = new Map<string, string>();
	for (const paradigm of PARADIGMS) {
		const signature = paradigm.markers.join("|");
		assert.equal(seen.get(signature), undefined, `${paradigm.id} shares markers with ${seen.get(signature)}`);
		seen.set(signature, paradigm.id);
	}
});

test("catalogue: listParadigms exposes the whole registry", () => {
	assert.equal(listParadigms().length, PARADIGMS.length);
});

// ---------------------------------------------------------------- config

test("config: defaults are complete and valid", () => {
	const parsed = parseConfig({});
	assert.equal(parsed.problems.length, 0);
	const merged = mergeConfigs([parsed.config]);
	assert.equal(merged.language, DEFAULT_CONFIG.language);
	assert.equal(merged.placement, DEFAULT_CONFIG.placement);
	assert.equal(merged.intensity, DEFAULT_CONFIG.intensity);
	assert.equal(merged.startup, DEFAULT_CONFIG.startup);
	assert.equal(mergeConfigs([]).language, "en");
});

test("config: language accepts the documented spellings and rejects nonsense", () => {
	for (const value of ["en", "zh", "zh-CN", "中文", " English "]) {
		const parsed = parseConfig({ language: value });
		assert.equal(parsed.problems.length, 0, `${value} rejected`);
		assert.ok(parsed.config.language === "en" || parsed.config.language === "zh");
	}
	const bad = parseConfig({ language: "klingon" });
	assert.equal(bad.config.language, undefined, "invalid language must not be applied");
	assert.equal(bad.problems.length, 1);
	assert.ok(bad.problems[0].includes("language"));
});

test("config: placement and intensity are validated independently", () => {
	const good = parseConfig({ placement: "thinking", intensity: "deep" });
	assert.equal(good.config.placement, "thinking");
	assert.equal(good.config.intensity, "deep");
	const bad = parseConfig({ placement: "side-channel", intensity: "huge" });
	assert.equal(bad.config.placement, undefined);
	assert.equal(bad.config.intensity, undefined);
	assert.equal(bad.problems.length, 2);
});

test("config: startup keeps any non-empty string; unknown paradigms are caught at startup", () => {
	assert.equal(parseConfig({ startup: "tot" }).config.startup, "tot");
	assert.equal(parseConfig({ startup: "六顶帽子" }).config.startup, "六顶帽子");
	assert.equal(parseConfig({ startup: "auto" }).config.startup, "auto");
	assert.equal(parseConfig({ startup: "off" }).config.startup, "off");
	assert.equal(parseConfig({ startup: "  tot  " }).config.startup, "tot", "startup not trimmed");
	// The config layer does not know the registry; resolveParadigm decides.
	assert.equal(resolveParadigm(parseConfig({ startup: "nope" }).config.startup), undefined);
	assert.equal(parseConfig({ startup: 7 }).problems.length, 1);
	assert.equal(parseConfig({ paradigm: "got" }).config.startup, "got", "paradigm is an alias for startup");
});

test("config: unknown keys are reported without discarding valid ones", () => {
	const parsed = parseConfig({ language: "zh", lanugage: "en", placement: "answer" });
	assert.equal(parsed.config.language, "zh");
	assert.equal(parsed.config.placement, "answer");
	assert.ok(parsed.problems.some((problem) => problem.includes("lanugage")), "typo not reported");
});

test("config: comment styles are tolerated without eating commented-out keys", () => {
	const parsed = parseConfigText('{\n\t// "language": "zh",\n\t/* placement */\n\t"placement": "thinking",\n\t"intensity": "deep" // inline\n}\n');
	assert.equal(parsed.problems.length, 0, parsed.problems.join("; "));
	assert.equal(parsed.config.language, undefined, "commented-out key was applied");
	assert.equal(parsed.config.placement, "thinking");
	assert.equal(parsed.config.intensity, "deep");
	assert.equal(stripJsonComments('{ "url": "http://x/y" }'), '{ "url": "http://x/y" }', "comment stripper broke a string");
});

test("config: malformed JSON is reported as one problem, not thrown", () => {
	const parsed = parseConfigText(`{ "language": `);
	assert.equal(parsed.config.language, undefined);
	assert.equal(parsed.problems.length, 1);
});

test("config: merge precedence is later layer over earlier layer", () => {
	const merged = mergeConfigs([
		{ language: "en", intensity: "light", placement: "answer" },
		{ language: "zh", intensity: "deep" },
		{ placement: "thinking" },
	]);
	assert.equal(merged.language, "zh");
	assert.equal(merged.intensity, "deep");
	assert.equal(merged.placement, "thinking");
});

// ---------------------------------------------------------------- placement

test("placement: tagged structure is moved out of the answer", () => {
	const paradigm = resolveParadigm("tot")!;
	const answer = [
		"<thought_tree>",
		"Branch A: cache-aside. Score: 8/10",
		"Branch B: write-behind. Score: 4/10",
		"[Prune] Branch B",
		"</thought_tree>",
		"",
		"<answer>",
		"Use cache-aside with a 60s TTL.",
		"</answer>",
	].join("\n");
	const relocated = extractStructure(answer, paradigm);
	const structure = relocated.structure ?? "";
	assert.ok(structure.length > 0, "nothing was extracted");
	assert.ok(structure.includes("Branch A"), "structure not extracted");
	assert.ok(structure.includes("[Prune]"), "prune line not extracted");
	assert.ok(!relocated.text.includes("Branch A"), "structure still in the answer");
	assert.ok(relocated.text.includes("Use cache-aside"), "conclusion lost");
});

test("placement: heading-form paradigm sections are recognised too", () => {
	const paradigm = resolveParadigm("hats")!;
	const answer = [
		"### ⚪ White Hat",
		"Sales fell 12% in Q3.",
		"### 🔴 Red Hat",
		"The team feels burnt out.",
		"### ⚫ Black Hat",
		"Single-region deploys are a single point of failure.",
		"",
		"Conclusion: ship the canary behind a feature flag.",
	].join("\n");
	const relocated = extractStructure(answer, paradigm);
	const structure = relocated.structure ?? "";
	assert.ok(structure.length > 0, "nothing was extracted");
	assert.ok(structure.includes("White Hat"), "hat sections not extracted");
	assert.ok(structure.includes("Black Hat"), "last hat section not extracted");
	assert.ok(relocated.text.includes("ship the canary"), "conclusion lost");
});

test("placement: nothing to move returns the answer untouched", () => {
	const paradigm = resolveParadigm("cot")!;
	const answer = "Just a plain answer with no structure markers at all.";
	const relocated = extractStructure(answer, paradigm);
	assert.equal(relocated.structure, undefined);
	assert.equal(relocated.text, answer);
});

test("placement: an answer that is only structure is never emptied", () => {
	const paradigm = resolveParadigm("got")!;
	const answer = "<graph_of_thoughts>\nNode A -> Node B\n</graph_of_thoughts>";
	const relocated = extractStructure(answer, paradigm);
	assert.ok(relocated.text.trim().length > 0, "answer was emptied");
});

test("placement: parseThinkArgs takes lang, placement, and config", () => {
	const zh = parseThinkArgs("lang zh");
	assert.equal(zh.action, "language");
	assert.equal(zh.language, "zh");
	const chinese = parseThinkArgs("language 中文");
	assert.equal(chinese.language, "zh");
	assert.equal(chinese.action, "language");
	const bare = parseThinkArgs("lang");
	assert.equal(bare.action, "language");
	assert.equal(bare.language, undefined);
	const placed = parseThinkArgs("placement thinking");
	assert.equal(placed.action, "placement");
	assert.equal(placed.placement, "thinking");
	assert.equal(parseThinkArgs("config").action, "config");
});
