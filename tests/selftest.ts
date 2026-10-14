/**
 * Test suite for pi-think-different.
 *
 * Run: node --test tests/selftest.ts
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

import { pickRandom, selectParadigm } from "../src/autoSelect.ts";
import { listParadigms, markerHeading, PARADIGMS, resolveParadigm } from "../src/paradigms.ts";
import { intensityFor, parseThinkArgs, renderBody, renderSection, renderTurnReminder, SECTION_TAG } from "../src/render.ts";
import { cueVocabulary, matchCues, taskAfterCue } from "../src/nlmatch.ts";
import { DEFAULT_CONFIG, agentConfigPath, configLayerPaths, extensionConfigPath, mergeConfigs, parseConfig, parseConfigText, projectConfigPath, resolveAgentDir, stripJsonComments } from "../src/config.ts";
import { extractStructure, markerTokens, naturalizeMarkers, placeStructureBeforeAnswer, placementClause, stripMarkerDebris, unwrapAnswerBlocks, type PlacementBlock } from "../src/placement.ts";
import { completionItems, describeState, helpLines, renderList, statusLabel } from "../src/ui.ts";
import { branchBudget, extractScores, gateScores, renderWorkflowResult, runWorkflow, stepCharBudget, type ModelCallResult } from "../src/workflow.ts";
import type { ParadigmStep } from "../src/paradigms.ts";

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
	const extensionDir = join(dirname(fileURLToPath(import.meta.url)), "..");
	assert.ok(existsSync(join(extensionDir, "skills", "think-different", "SKILL.md")), "bundled skill missing");
	assert.ok(!existsSync(join(process.cwd(), "skills", "think-different", "SKILL.md")) || extensionDir === process.cwd(), "skill resolves from the session cwd");
});

test("render: section carries the markers, the mandate, and the intensity", () => {
	for (const paradigm of PARADIGMS) {
		const section = renderSection(paradigm, "standard", "answer", "session");
		assert.ok(section.includes(paradigm.id), `${paradigm.id}: section names the paradigm`);
		for (const marker of paradigm.markers) {
			assert.ok(section.includes(marker), `${paradigm.id}: section missing marker ${marker}`);
		}
		assert.ok(section.includes("Application rule, no exceptions"), `${paradigm.id}: section missing the no-exceptions mandate`);
		assert.ok(!section.includes("Escape hatch"), `${paradigm.id}: escape hatch lets the model answer directly`);
		assert.ok(section.includes("visible answer"), `${paradigm.id}: section missing visibility clause`);
		assert.ok(section.includes("Tag discipline"), `${paradigm.id}: section missing tag discipline`);
		assert.ok(section.includes(`Required markers, verbatim: ${paradigm.markers.join(", ")}`), `${paradigm.id}: section missing required-marker line`);
		assert.ok(!section.includes("{{"), `${paradigm.id}: unresolved placeholder in section`);
	}
});

test("render: the per-turn reminder names the paradigm and announces a switch", () => {
	const debate = resolveParadigm("debate");
	assert.ok(debate);

	const plain = renderTurnReminder(debate, "answer");
	assert.ok(plain.includes("Thinking paradigm for this turn: debate"), plain);
	assert.ok(plain.includes(debate.markers.join(", ")), "the reminder must restate the markers for this turn");
	assert.ok(!plain.includes("replaced"), "nothing was switched");

	const switched = renderTurnReminder(debate, "thinking", "tot");
	assert.ok(switched.includes("It replaced tot"), switched);
	assert.ok(switched.includes("moves it into your thinking block"), switched);
	assert.ok(switched.includes("finished"), "the old paradigm must be declared finished");

	// The contract itself forbids continuing an earlier paradigm.
	const section = renderSection(debate, "standard", "answer", "session");
	assert.ok(section.includes("a paradigm named in an earlier turn is expired"), section.slice(0, 300));
});

test("render: placement thinking moves the structure out of the answer", () => {
	const paradigm = resolveParadigm("tot")!;
	const section = renderSection(paradigm, "standard", "thinking", "session");
	// The enforceable path is the answer: the model writes the markers there and the harness relocates them.
	// Asking for a thinking-block-only structure is what let a short-reasoning model answer with one emoji.
	assert.ok(section.includes("the harness moves that structure out of the visible answer"), "thinking placement clause missing");
	assert.ok(!section.includes("Emit the structure in your visible answer"), "answer placement clause leaked into thinking placement");
	assert.ok(section.includes("Required markers, verbatim"), "thinking placement must still require markers");
	assert.ok(placementClause("answer", paradigm).includes("visible answer"), "answer placement clause missing");
});

test("render: private reasoning alone does not count as running the paradigm", () => {
	const clause = placementClause("thinking", resolveParadigm("hats")!);
	assert.ok(clause.includes("private reasoning only is not enough"), clause);
	assert.ok(clause.includes("one marker with nothing under it"), "the clause must reject a single emoji as compliance");
	const section = renderSection(resolveParadigm("hats")!, "standard", "thinking", "session");
	assert.ok(section.includes("Writing the sections is what running the paradigm means"), section.slice(-600));
	assert.ok(renderTurnReminder(resolveParadigm("hats")!, "thinking").includes("spelled out in the text you produce"));
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
	assert.equal(parseThinkArgs("random").action, "random");
	assert.equal(parseThinkArgs("random deep").action, "random");
	assert.equal(parseThinkArgs("random deep").intensity, "deep");
	assert.equal(parseThinkArgs("随机").action, "random");
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

test("parse: command keywords count only as the first token", () => {
	// "config", "status", "list", "off", and "auto" are ordinary words in a developer's task text. They
	// used to hijack the command wherever they appeared, so `/think hats off the record on pricing` turned
	// the paradigm off instead of pinning hats and thinking about the task.
	const cases: Array<[string, string, string]> = [
		["hats off the record on pricing", "hats", "off the record on pricing"],
		["debate config drift in prod", "debate", "config drift in prod"],
		["angles list the risks of the plan", "angles", "list the risks of the plan"],
		["cot status report for the migration", "cot", "status report for the migration"],
		["first-principles auto scaling limits", "first-principles", "auto scaling limits"],
	];
	for (const [raw, id, task] of cases) {
		const parsed = parseThinkArgs(raw);
		assert.equal(parsed.action, "set", `${raw}: became a ${parsed.action} sub-command`);
		assert.equal(parsed.paradigm?.id, id, `${raw}: paradigm not pinned`);
		assert.equal(parsed.task, task, `${raw}: task text lost`);
	}

	// A keyword at the head is still a sub-command.
	assert.equal(parseThinkArgs("lang zh").action, "language");
	assert.equal(parseThinkArgs("lang zh").language, "zh");
	assert.equal(parseThinkArgs("placement thinking").action, "placement");
	assert.equal(parseThinkArgs("once hats deep adopt no-meeting wednesday").action, "once");

	// `/think config` was removed: a bare unknown word is reported as an unknown paradigm rather than a
	// sub-command, and nothing in the picker or the help offers it any more.
	const bare = parseThinkArgs("config");
	assert.equal(bare.action, "set");
	assert.equal(bare.unknown, "config");
	assert.equal(helpLines("en").some((line) => line.includes("/think config")), false, "help still advertises /think config");
	assert.equal(helpLines("zh").some((line) => line.includes("/think config")), false, "zh help still advertises /think config");
	assert.equal(completionItems("en", "c").some((item) => item.value === "config"), false, "picker still offers config");
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

test("select: CJK prompts are not scored as one-word prompts", () => {
	const ask = selectParadigm("帮我看下这个离线方案靠不靠谱");
	assert.ok(ask.confident, `score ${ask.score}: a Chinese sentence used to count as one "word" and lose -2`);

	const alternatives = selectParadigm("这个离线同步方案有哪些替代方案，权衡一下");
	assert.ok(alternatives.confident, `score ${alternatives.score}`);
	assert.ok(["tot", "got", "angles", "hats"].includes(alternatives.paradigm?.id ?? ""), `got ${alternatives.paradigm?.id}`);

	const why = selectParadigm("为什么 livecheck 的 options 用例有时会超时");
	assert.ok(why.confident, `score ${why.score}`);
});

test("select: a short trivial CJK instruction still gets no paradigm", () => {
	const trivial = selectParadigm("改个名字");
	assert.equal(trivial.confident, false, `score ${trivial.score} should not clear the threshold`);
});

test("select: auto always has a best match to fall back on", () => {
	const trivial = selectParadigm("rename the variable x to width");
	assert.equal(trivial.confident, false);
	assert.ok(trivial.best, "auto mode needs a fallback paradigm instead of none");
	assert.ok(trivial.best.id.length > 0);

	assert.equal(selectParadigm("").best, undefined, "an empty prompt has no best match");
});

test("random: the same paradigm is not picked two turns in a row", () => {
	const pool = listParadigms();
	let previous = pickRandom(pool);
	assert.ok(previous);
	for (let turn = 0; turn < 25; turn += 1) {
		const next = pickRandom(pool, previous?.id);
		assert.ok(next);
		assert.notEqual(next.id, previous?.id, `paradigm ${next.id} repeated`);
		previous = next;
	}

	// A seeded generator keeps the test deterministic while still covering every paradigm.
	let seed = 0;
	const seen = new Set<string>();
	for (let turn = 0; turn < 60; turn += 1) {
		seed = (seed * 9301 + 49297) % 233280;
		const picked = pickRandom(pool, undefined, () => seed / 233280);
		if (picked) seen.add(picked.id);
	}
	assert.equal(seen.size, pool.length, "some paradigm can never be picked at random");
});

test("completions: values are argument text, never the command name", () => {
	const empty = completionItems("en", "");
	assert.ok(empty.some((item) => item.value === "auto"), empty.map((item) => item.value).join(", "));
	assert.ok(empty.some((item) => item.value === "random"));
	for (const paradigm of listParadigms()) {
		assert.ok(empty.some((item) => item.value === paradigm.id), `missing ${paradigm.id}`);
	}
	// Pi replaces the whole typed argument span, so a "/think " prefix in the value doubles the command.
	for (const item of [...empty, ...completionItems("zh", "a")]) {
		assert.ok(!item.value.startsWith("/"), `completion value ${item.value} would render as /think /think …`);
		assert.ok(!item.value.includes(" "), `top-level completion ${item.value} must be a single word`);
		assert.ok(item.description.length > 0, "every completion needs a description in the picker");
	}
});

test("completions: prefix filtering and subcommand arguments", () => {
	const a = completionItems("en", "a");
	assert.ok(a.length > 0 && a.every((item) => item.value.startsWith("a")), a.map((item) => item.value).join(", "));

	const lang = completionItems("zh", "lang");
	assert.deepEqual(lang.map((item) => item.value), ["lang en", "lang zh"], "a two-token argument replaces the whole argument span");
	assert.ok(lang.every((item) => /[\u3400-\u4DBF\u4E00-\u9FFF]/.test(item.description)), lang.map((item) => item.description).join(" | "));

	const placement = completionItems("en", "placement th");
	assert.deepEqual(placement.map((item) => item.value), ["placement thinking"], placement.map((item) => item.value).join(", "));

	assert.deepEqual(completionItems("en", "nope"), []);
});

test("select: wording that names a paradigm beats the generic signals", () => {
	// "为什么" and a question mark are cot/defect signals; the named paradigm must still win.
	const named = selectParadigm("用辩论的方式分析一下俄乌战争的结果？");
	assert.equal(named.paradigm?.id, "debate", `auto picked ${named.paradigm?.id}: ${named.reasons.join(" | ")}`);
	assert.equal(named.confident, true);
	assert.ok(named.reasons.some((reason) => reason.includes("named in your wording")), named.reasons.join(" | "));

	const mixed = selectParadigm("为什么这个方案值得辩论一下");
	assert.equal(mixed.paradigm?.id, "debate", `generic 方案/为什么 pulled it to ${mixed.paradigm?.id}`);

	const english = selectParadigm("steelman the migration plan and tell me what breaks");
	assert.equal(english.paradigm?.id, "debate", english.reasons.join(" | "));
});

test("select: every paradigm is reachable from its own cues", () => {
	for (const paradigm of listParadigms()) {
		for (const cue of paradigm.cues ?? []) {
			const prompt = `帮我用${cue}的方式看看这件事靠不靠谱`;
			const selection = selectParadigm(prompt);
			assert.equal(selection.paradigm?.id, paradigm.id, `cue "${cue}" selected ${selection.paradigm?.id}: ${selection.reasons.join(" | ")}`);
		}
	}
});

test("select: wording naming two paradigms is scored, not guessed", () => {
	const both = selectParadigm("用思维树和六顶思考帽评估这个离线方案");
	assert.ok(both.reasons.some((reason) => reason.includes("names several paradigms")), both.reasons.join(" | "));
	assert.ok(both.paradigm, "a scored fallback is still chosen");
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

test("config: three files, in precedence order, named pi-think-different.json", () => {
	const layers = configLayerPaths("/ext", "/agent", "/work/shop");
	assert.deepEqual(
		layers.map((layer) => layer.kind),
		["extension", "agent", "project"],
	);
	assert.deepEqual(
		layers.map((layer) => layer.path),
		[extensionConfigPath("/ext"), agentConfigPath("/agent"), projectConfigPath("/work/shop")],
	);
	assert.equal(layers[0].path, "/ext/config.json");
	assert.equal(layers[1].path, "/agent/pi-think-different.json");
	assert.equal(layers[2].path, "/work/shop/.pi/pi-think-different.json");
});

test("config: agent dir honours PI_CODING_AGENT_DIR", () => {
	assert.equal(resolveAgentDir({}, "/home/u"), "/home/u/.pi/agent");
	assert.equal(resolveAgentDir({ PI_CODING_AGENT_DIR: "/custom/agent" }, "/home/u"), "/custom/agent");
	assert.equal(resolveAgentDir({ PI_CODING_AGENT_DIR: "   " }, "/home/u"), "/home/u/.pi/agent");
});

test("config: agent layer beats the extension layer and loses to the project layer", () => {
	const merged = mergeConfigs([
		{ startup: "cot", language: "en" },
		{ startup: "tot", placement: "thinking" },
		{ startup: "hats" },
	]);
	assert.equal(merged.startup, "hats");
	assert.equal(merged.placement, "thinking");
	assert.equal(merged.language, "en");
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

test("placement: thinking placement unwraps the answer block so the answer has no tags", () => {
	const paradigm = resolveParadigm("tot")!;
	const answer = [
		"<thought_tree>",
		"Branch A: cache-aside. Score: 8/10",
		"</thought_tree>",
		"",
		"<answer>",
		"Use cache-aside with a 60s TTL.",
		"</answer>",
	].join("\n");

	const relocated = extractStructure(answer, paradigm, { unwrapAnswer: true });
	assert.ok(!relocated.text.includes("<answer>"), "opening answer tag left in the visible answer");
	assert.ok(!relocated.text.includes("</answer>"), "closing answer tag left in the visible answer");
	assert.ok(relocated.text.includes("Use cache-aside"), "conclusion lost");
	assert.ok((relocated.structure ?? "").includes("Branch A"), "structure not extracted");
});

test("placement: answer placement keeps the answer block untouched", () => {
	const paradigm = resolveParadigm("tot")!;
	const answer = "<thought_tree>\nBranch A. Score: 8/10\n</thought_tree>\n\n<answer>\nShip cache-aside.\n</answer>";
	const relocated = extractStructure(answer, paradigm);
	assert.ok(relocated.text.includes("<answer>"), "answer block was removed for answer placement");
	assert.ok(relocated.text.includes("Ship cache-aside"), "conclusion lost");
});

test("placement: unwrapAnswerBlocks handles text with no answer tags", () => {
	assert.equal(unwrapAnswerBlocks("just a conclusion"), "just a conclusion");
	assert.equal(unwrapAnswerBlocks("<answer>\nShip it.\n</answer>"), "Ship it.");
});

test("placement: a short first line of body text is not treated as a label", () => {
	// The old test was "under 48 chars and no sentence punctuation", and ASCII `.` was missing from that
	// punctuation set, so length alone decided - and a 46-character sentence of real content disappeared
	// from the answer while a 51-character one survived.
	const tot = resolveParadigm("tot")!;
	const branch = [
		"<thought_tree>",
		"[Branch_A] cron plus a lock file",
		"Score: 8/10",
		"</thought_tree>",
	].join("\n");
	const rendered = naturalizeMarkers(branch, tot, "en");
	assert.ok(rendered.includes("[Branch_A] cron plus a lock file"), "the branch label line was deleted");
	assert.ok(rendered.includes("Score: 8/10"), "the score line was deleted");

	const angles = resolveParadigm("angles")!;
	const sentence = "<angle:system>\nThe scheduler is the only writer of the queue.\nTwo hosts can disagree.\n</angle:system>";
	assert.ok(
		naturalizeMarkers(sentence, angles, "en").includes("The scheduler is the only writer of the queue."),
		"a 46-character sentence was deleted as a label",
	);
});

test("placement: a label line the model wrote is still replaced, not duplicated", () => {
	const tot = resolveParadigm("tot")!;
	const en = naturalizeMarkers("<thought_tree>\n### Tree of Thoughts\nBranch A. Score: 8/10\n</thought_tree>", tot, "en");
	assert.ok(en.includes("**Thought tree**"), "no rendered heading");
	assert.ok(!en.includes("Tree of Thoughts"), "the model's own label line survived next to the heading");
	assert.ok(en.includes("Branch A. Score: 8/10"), "body content lost");

	const zh = naturalizeMarkers("<thought_tree>\n思维树\n分支 A：8/10\n</thought_tree>", tot, "zh");
	assert.ok(zh.includes("**思维树**"), "no rendered Chinese heading");
	assert.ok(!zh.includes("\n思维树\n"), "the model's own Chinese label line survived");
	assert.ok(zh.includes("分支 A：8/10"), "body content lost");

	// A section whose whole body is one line keeps that line: there is nothing else to show.
	const critique = resolveParadigm("critique")!;
	assert.ok(
		naturalizeMarkers("<criticism>\nRace condition in the retry path\n</criticism>", critique, "en").includes("Race condition in the retry path"),
		"a single-line section was emptied",
	);
});

test("placement: a conclusion after the last hat stays in the answer", () => {
	// Real shape from a user session: the model wrote all six hats into the visible answer, then the recipe.
	// The last hat's span used to run to the end of the text minus its final line, so the whole recipe moved
	// to thinking and the answer was left holding one orphaned bullet.
	const hats = resolveParadigm("hats")!;
	const answer = [
		"⚪ 事实：番茄炒蛋是 10 分钟量级的家常菜，变量只有几个。",
		"🔴 直觉：用户今晚就要做，需要能照着执行的步骤。",
		"🟡 价值：说清为什么这样做，比只给步骤更有用。",
		"🟢 优化：蛋液加一点水、热锅宽油快炒、番茄炒到出汁再合蛋。",
		"🔵 结构：材料 → 做法 → 判断点 → 常见失败。",
		"⚫ 风险：鸡蛋炒老、番茄出水太多变汤、过酸。",
		"",
		"## 常见失败与修法",
		"- 蛋老、像橡皮 → 火太小或炒太久。",
		"- 偏淡 → 盐分两次放，比只放一次更入味。",
	].join("\n");

	const relocated = extractStructure(answer, hats, { unwrapAnswer: true });
	const structure = relocated.structure ?? "";
	assert.ok(structure.includes("⚪ 事实"), "the white hat was not extracted");
	assert.ok(structure.includes("⚫ 风险"), "the black hat was not extracted");
	assert.ok(!structure.includes("## 常见失败与修法"), "the conclusion was swallowed into the thinking block");
	assert.ok(relocated.text.includes("## 常见失败与修法"), "the conclusion left the answer");
	assert.ok(relocated.text.includes("- 偏淡 → 盐分两次放，比只放一次更入味。"), "the final line was orphaned out of its own block");
});

test("placement: nested spans do not corrupt the surrounding prose", () => {
	// An outer span holding two inner ones: the second inner span used to survive the dedup, and cutting
	// accepted spans from the back then sliced the already-shortened string with stale offsets.
	const critique = resolveParadigm("critique")!;
	const answer = [
		"Intro prose that must survive.",
		"<draft>",
		"A line",
		"<criticism>x</criticism>",
		"B line",
		"<refinement>y</refinement>",
		"C line",
		"</draft>",
		"Closing prose that must survive.",
	].join("\n");
	const relocated = extractStructure(answer, critique, { unwrapAnswer: true });
	assert.ok((relocated.structure ?? "").includes("C line"), "the outer span was cut short");
	assert.ok(relocated.text.includes("Intro prose that must survive."), "the opening prose was damaged");
	assert.ok(relocated.text.includes("Closing prose that must survive."), "the closing prose was swallowed");
	assert.ok(!relocated.text.includes("\nurvive"), "a word fragment was left in the answer");
});

test("placement: relocated structure lands in the thinking before the answer, never after", () => {
	const content: PlacementBlock[] = [
		{ type: "thinking", thinking: "model's own reasoning" },
		{ type: "text", text: "<thought_tree>Branch A</thought_tree>" },
		{ type: "toolCall", name: "read" },
	];
	const out = placeStructureBeforeAnswer(content, "<thought_tree>Branch A</thought_tree>", "Ship cache-aside.");
	assert.deepEqual(
		out.map((block) => block.type),
		["thinking", "text", "toolCall"],
		"a second Thinking section appeared after the answer",
	);
	assert.equal(out[0].thinking, "model's own reasoning\n\n<thought_tree>Branch A</thought_tree>");
	assert.equal(out[1].text, "Ship cache-aside.");
});

test("placement: with no preceding thinking a thinking block is inserted directly above the answer", () => {
	const content: PlacementBlock[] = [
		{ type: "toolCall", name: "read" },
		{ type: "text", text: "first half" },
		{ type: "text", text: "second half" },
	];
	const out = placeStructureBeforeAnswer(content, "⚪ facts", "the conclusion");
	assert.deepEqual(
		out.map((block) => block.type),
		["toolCall", "thinking", "text"],
		"thinking was not inserted before the answer, or the split answer was not folded into one block",
	);
	assert.equal(out[1].thinking, "⚪ facts");
	assert.equal(out[2].text, "the conclusion");
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

test("placement: marker debris never survives in the visible answer", () => {
	const angles = resolveParadigm("angles");
	assert.ok(angles);

	// The exact mess from a real session: relocated spans leave bare marker lines and stray tags.
	const messy = [
		"它产生的是存活，不是收益。",
		"</angle:adversary>",
		"angle:pragmatist",
		"一年尺度的成本/收益排序：",
		"1. 储蓄率与收入路径。",
		"</angle:pragmatist>",
		"<synthesis>",
		"三个角度在一点上一致。",
	].join("\n\n");

	const clean = stripMarkerDebris(messy, angles.markers);
	for (const marker of angles.markers) {
		assert.ok(!clean.includes(marker.replace(/^<|>$/g, "")), `marker ${marker} survived in the answer`);
	}
	assert.ok(clean.includes("它产生的是存活"));
	assert.ok(clean.includes("三个角度在一点上一致"));
	assert.ok(!clean.includes("\n\n\n"), "stripping must not leave runs of blank lines");

	// Inline tags inside a sentence are removed too.
	const inline = stripMarkerDebris("结论是 <synthesis> 这条规则可审计", angles.markers);
	assert.equal(inline, "结论是  这条规则可审计".replace("  ", " "));

	// A marker word used as ordinary prose in a sentence is left alone.
	const prose = stripMarkerDebris("The synthesis step is where the angles agree.", angles.markers);
	assert.equal(prose, "The synthesis step is where the angles agree.");

	// With no markers there is nothing to strip.
	assert.equal(stripMarkerDebris("plain text", []), "plain text");
});

test("placement: thinking placement tells the model to use natural language instead of markers", () => {
	const angles = resolveParadigm("angles");
	assert.ok(angles);
	const clause = placementClause("thinking", angles);
	assert.ok(clause.includes("<angle:adversary>"), "the clause must name the tokens being banned");
	assert.ok(/natural language/i.test(clause), "the clause must ask for natural-language headings");
	assert.ok(!/\n/.test(clause), "the clause is one paragraph inside the contract section");
});

test("placement: answer placement renders markers as natural-language headings", () => {
	const angles = resolveParadigm("angles");
	assert.ok(angles);

	const tagged = [
		"<angle:system>",
		"系统把市场换成个人的金钱系统。",
		"</angle:system>",
		"<angle:adversary>",
		"它产生的是存活，不是收益。",
		"</angle:adversary>",
		"<synthesis>",
		"三个角度在一点上一致。",
		"</synthesis>",
		"<answer>",
		"结论：先改默认假设。",
		"</answer>",
	].join("\n\n");

	const zh = naturalizeMarkers(tagged, angles, "zh");
	assert.ok(zh.includes("**系统视角**"), zh.slice(0, 200));
	assert.ok(zh.includes("**对手视角**"), zh.slice(0, 200));
	assert.ok(zh.includes("**综合**"), zh.slice(0, 200));
	assert.ok(zh.includes("结论：先改默认假设。"));
	for (const marker of angles.markers) {
		assert.ok(!zh.includes(marker), `marker ${marker} leaked into the visible answer`);
	}
	assert.equal((zh.match(/^#{1,6} /gm) ?? []).length, 0, `no Markdown heading may be generated: ${zh.slice(0, 300)}`);

	const en = naturalizeMarkers(tagged, angles, "en");
	assert.ok(en.includes("**Adversary angle**"), en.slice(0, 200));
	assert.ok(en.includes("**Synthesis**"), en.slice(0, 200));
	assert.ok(!en.includes("<angle:adversary>"));
	for (const label of en.match(/\*\*[^*]+\*\*/g) ?? []) {
		assert.ok(!/[\u4e00-\u9fff]/.test(label), `an English session must not get a Chinese label: ${label}`);
	}
	for (const label of zh.match(/\*\*[^*]+\*\*/g) ?? []) {
		assert.ok(/[\u4e00-\u9fff]/.test(label), `a Chinese session must not get an English label: ${label}`);
	}
});

test("placement: hats markers are one fixed emoji per hat, and the tag form is still accepted", () => {
	const hats = resolveParadigm("hats")!;
	assert.deepEqual(
		hats.markers.slice(0, 6),
		["⚪", "🔴", "⚫", "🟡", "🟢", "🔵"],
		"hats markers are fixed emoji: white, red, black, yellow, green, blue",
	);
	assert.deepEqual(
		hats.markerAliases,
		{ "<hat:white>": "⚪", "<hat:red>": "🔴", "<hat:black>": "⚫", "<hat:yellow>": "🟡", "<hat:green>": "🟢", "<hat:blue>": "🔵" },
		"a session whose model still writes the tag form must render the same hats",
	);

	// Emoji sections are written verbatim: no heading is generated and the body stays on its own line.
	const tagged = ["⚪ 只有菜单和价格已知。", "⚫ 冷冻虾仁未解冻会中心生。", "🔵 先解冻再下锅。"].join("\n");
	const zh = naturalizeMarkers(tagged, hats, "zh");
	assert.equal(zh.trim(), tagged, `hats sections must pass through unchanged: ${zh}`);
	assert.equal((zh.match(/^### /gm) ?? []).length, 0, `no heading may be generated for hats: ${zh}`);

	// The tag form a previous contract asked for is stripped as syntax, but the text under it is kept.
	const tagForm = ["<hat:black>", "虾仁会老。", "</hat:black>", "<answer>", "结论：先解冻。", "</answer>"].join("\n");
	const fromTag = naturalizeMarkers(tagForm, hats, "zh");
	assert.ok(fromTag.includes("虾仁会老。"), fromTag.slice(0, 300));
	assert.ok(fromTag.includes("结论：先解冻。"), fromTag.slice(0, 300));
	assert.ok(!fromTag.includes("hat:"), fromTag.slice(0, 300));
	assert.ok(!stripMarkerDebris("结论如下。\n</hat:black>", markerTokens(hats)).includes("hat:"), "alias debris survived");
});

test("placement: hats sections are passed through exactly as the model wrote them", () => {
	const hats = resolveParadigm("hats")!;
	assert.equal(hats.verbatimMarkers, true, "hats must not be rewritten into generated headings");

	// The real-session shape: a wrong colour and a two-circle label. The harness no longer edits them.
	const mislabelled = ["🔵 Black: risk - rubber shrimp", "🟡/🔵 Blue: control - two routes"].join("\n");
	const out = naturalizeMarkers(mislabelled, hats, "zh");
	assert.equal(out.trim(), mislabelled, out.slice(0, 400));
	assert.equal((out.match(/^### /gm) ?? []).length, 0, `no heading may be generated for hats: ${out.slice(0, 400)}`);
});

test("placement: hats structure still moves to the thinking block with its emoji intact", () => {
	const hats = resolveParadigm("hats")!;
	const answer = [
		"⚪ 白帽：现有信息只有菜单和价格。",
		"⚫ 黑帽：冷冻虾仁未解冻会中心生。",
		"<answer>",
		"结论：先解冻再下锅。",
		"</answer>",
	].join("\n");
	const placed = extractStructure(answer, hats, { unwrapAnswer: true });
	const structure = placed.structure ?? "";
	assert.ok(structure.includes("⚫ 黑帽"), `hats structure did not move: ${JSON.stringify(placed).slice(0, 400)}`);
	assert.ok(placed.text.includes("结论：先解冻再下锅。"), placed.text);
	assert.ok(!placed.text.includes("⚫"), `the black hat stayed in the answer: ${placed.text}`);
});

test("placement: a model that heads each tag gets one heading and keeps its body under it", () => {
	const hats = resolveParadigm("hats")!;
	// The exact shape from a real session: `### <hat:white> label` lines with the body below each one.
	const answer = [
		"### <hat:white> 白帽：事实与数据",
		"现有信息：家常中餐做法，食材为虾仁加鸡蛋。",
		"### <hat:red> 红帽：感受与直觉",
		"多数人怕两件事：虾仁腥、蛋炒老。",
		"### <hat:black> 黑帽：风险与批判",
		"主要失败模式：冷冻虾仁未解冻、虾炒过头变橡皮。",
	].join("\n");
	const out = naturalizeMarkers(answer, hats, "zh");

	assert.ok(!out.includes("<hat:"), out.slice(0, 300));
	assert.ok(out.includes("### 白帽：事实与数据"), out.slice(0, 300));

	// Each body must stay under its own line, and no heading may be added by the harness.
	const at = (needle: string) => out.indexOf(needle);
	assert.ok(at("### 白帽：事实与数据") < at("现有信息"), `body drifted: ${out.slice(0, 400)}`);
	assert.ok(at("### 黑帽：风险与批判") < at("主要失败模式"), `body drifted: ${out.slice(0, 400)}`);
	assert.equal((out.match(/^### /gm) ?? []).length, 3, out.slice(0, 400));
});

test("placement: a mislabelled hat keeps the line the model wrote", () => {
	const hats = resolveParadigm("hats")!;
	// The real-session shape: black labelled with a blue circle, blue with two circles, no trailing newline.
	const mislabelled = ["⚫ Black: risk - 主要失败模式：冷冻虾仁未解冻；虾炒过头变橡皮。", "🟡/🔵 Blue: control - 默认推荐路径 (1) 分炒合锅。"].join("\n");
	const out = naturalizeMarkers(mislabelled, hats, "zh");

	assert.equal(out.trim(), mislabelled, out.slice(0, 400));
	assert.ok(out.includes("主要失败模式："), out.slice(0, 400));
	assert.ok(out.includes("默认推荐路径"), out.slice(0, 400));
});

test("placement: every paradigm label is bold, in the session language, with no heading syntax", () => {
	for (const paradigm of listParadigms()) {
		if (paradigm.verbatimMarkers) continue;
		const tagged = paradigm.markers
			.filter((marker) => marker !== "<answer>")
			.map((marker) => `${marker}\nSection text.\n${marker.replace(/^</, "</")}`)
			.join("\n\n");

		const en = naturalizeMarkers(tagged, paradigm, "en");
		const zh = naturalizeMarkers(tagged, paradigm, "zh");

		assert.equal((en.match(/^#{1,6} /gm) ?? []).length, 0, `${paradigm.id} en: ${en.slice(0, 200)}`);
		assert.equal((zh.match(/^#{1,6} /gm) ?? []).length, 0, `${paradigm.id} zh: ${zh.slice(0, 200)}`);
		for (const marker of paradigm.markers) {
			assert.ok(!en.includes(marker), `${paradigm.id} en marker ${marker} survived: ${en.slice(0, 200)}`);
			assert.ok(!zh.includes(marker), `${paradigm.id} zh marker ${marker} survived: ${zh.slice(0, 200)}`);
		}
		if (en.includes("Section text.") && zh.includes("Section text.")) {
			assert.ok(/\*\*[^*]+\*\*/.test(en), `${paradigm.id}: no bold label rendered: ${en.slice(0, 200)}`);
			for (const label of en.match(/\*\*[^*]+\*\*/g) ?? []) {
				assert.ok(!/[\u4e00-\u9fff]/.test(label), `${paradigm.id} en labels must be English: ${label}`);
			}
			for (const label of zh.match(/\*\*[^*]+\*\*/g) ?? []) {
				assert.ok(/[\u4e00-\u9fff]/.test(label), `${paradigm.id} zh labels must be Chinese: ${label}`);
			}
		}
	}
});

test("ui: the status bar shows the active paradigm's own icon", () => {
	const hats = resolveParadigm("hats")!;
	assert.equal(statusLabel({ lang: "zh", mode: "sticky", paradigm: hats, paradigmId: "hats", intensity: "standard", placement: "answer" }), "🎩 hats");
	assert.equal(statusLabel({ lang: "zh", mode: "auto", paradigm: hats, paradigmId: "hats", intensity: "standard", placement: "answer" }), "🎩 自动 → hats");
	assert.equal(statusLabel({ lang: "en", mode: "random", paradigm: resolveParadigm("tot")!, paradigmId: "tot", intensity: "deep", placement: "thinking" }), "🌳 random → tot · deep");

	// A generic brain next to a paradigm name is what made the bar contradict the answer.
	for (const paradigm of listParadigms()) {
		const label = statusLabel({ lang: "en", mode: "sticky", paradigm, paradigmId: paradigm.id, intensity: "standard", placement: "answer" });
		assert.ok(label.startsWith(paradigm.emoji), `${paradigm.id}: ${label}`);
		assert.ok(label.includes(paradigm.id), `${paradigm.id}: ${label}`);
	}

	assert.equal(statusLabel({ lang: "en", mode: "auto", intensity: "standard", placement: "answer" }), "🧠 auto", "auto before a pick has a fallback icon");
});

test("registry: every marker has a natural-language heading", () => {
	for (const paradigm of listParadigms()) {
		for (const marker of paradigm.markers) {
			const en = markerHeading(marker, "en");
			const zh = markerHeading(marker, "zh");
			assert.notEqual(en, marker, `${paradigm.id} marker ${marker} has no English heading`);
			assert.notEqual(zh, marker, `${paradigm.id} marker ${marker} has no Chinese heading`);
			assert.ok(!/[<>]/.test(en) && !/[<>]/.test(zh), `${paradigm.id} heading for ${marker} still contains brackets`);
		}
	}
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

test("placement: parseThinkArgs takes lang and placement", () => {
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
});

// ---------------------------------------------------------------- natural language /think

test("nlmatch: prose resolves the paradigm and keeps the rest as the task", () => {
	const parsed = parseThinkArgs("以六顶思考帽的方式思考俄乌战争的结果");
	assert.equal(parsed.action, "set");
	assert.equal(parsed.paradigm?.id, "hats", "prose did not resolve to hats");
	assert.equal(parsed.task, "俄乌战争的结果", `task extraction wrong: ${JSON.stringify(parsed.task)}`);
	assert.equal(parsed.unknown, undefined);
	assert.ok(parsed.viaCue, "no cue recorded");
});

test("nlmatch: English prose resolves too", () => {
	const cases: [string, string, string][] = [
		["think about the outcome using six thinking hats", "hats", "think about the outcome using"],
		["rethink our polling from first principles", "first-principles", "rethink our polling"],
		["look at this plan from multiple angles", "angles", "look at this plan from"],
		["rule out causes for the flaky test", "hypothesis", "for the flaky test"],
	];
	for (const [text, expected, taskNeedle] of cases) {
		const parsed = parseThinkArgs(text);
		assert.equal(parsed.paradigm?.id, expected, `${text} -> ${parsed.paradigm?.id ?? parsed.unknown}`);
		assert.ok(parsed.task?.includes(taskNeedle), `${text}: task extraction lost ${taskNeedle} (got ${JSON.stringify(parsed.task)})`);
	}
});

test("nlmatch: an explicit paradigm token always wins over prose", () => {
	const parsed = parseThinkArgs("tot 讨论六顶思考帽的优缺点");
	assert.equal(parsed.paradigm?.id, "tot");
	assert.equal(parsed.viaCue, undefined);
	assert.ok(parsed.task?.includes("六顶思考帽"), `task should keep the prose: ${JSON.stringify(parsed.task)}`);
});

test("nlmatch: two paradigms in one sentence is ambiguous, not guessed", () => {
	const parsed = parseThinkArgs("用思维树和六顶思考帽分析俄乌战争的结果");
	assert.equal(parsed.paradigm, undefined);
	assert.ok(parsed.ambiguous, "ambiguity not reported");
	const ids = (parsed.ambiguous ?? []).map((entry) => entry.id).sort((a, b) => a.localeCompare(b));
	assert.deepEqual(ids, ["hats", "tot"]);
});

test("nlmatch: no cue falls back to the unknown-paradigm warning", () => {
	const parsed = parseThinkArgs("以某种玄学方式思考这件事");
	assert.equal(parsed.paradigm, undefined);
	assert.equal(parsed.ambiguous, undefined);
	assert.equal(parsed.unknown, "以某种玄学方式思考这件事");
});

test("nlmatch: cues need a word boundary in Latin text", () => {
	// "treewidth" contains the alias "tree" but is not a mention of Tree of Thoughts.
	const parsed = parseThinkArgs("tune the treewidth parameter");
	assert.equal(parsed.paradigm, undefined, `matched ${parsed.paradigm?.id} inside a word`);
	assert.notEqual(parsed.unknown, undefined);
});

test("nlmatch: once accepts prose as well", () => {
	const parsed = parseThinkArgs("once 用第一性原理重新设计我们的轮询");
	assert.equal(parsed.action, "once");
	assert.equal(parsed.paradigm?.id, "first-principles");
	assert.equal(parsed.task, "重新设计我们的轮询", `task: ${JSON.stringify(parsed.task)}`);
});

test("nlmatch: intensity and mode keywords still parse around prose", () => {
	const parsed = parseThinkArgs("deep 用多角度评估这个方案");
	assert.equal(parsed.paradigm?.id, "angles");
	assert.equal(parsed.intensity, "deep");
});

test("nlmatch: every cue belongs to a real paradigm and is long enough to be specific", () => {
	for (const paradigm of PARADIGMS) {
		for (const cue of cueVocabulary(paradigm)) {
			assert.ok(cue.length >= 2, `${paradigm.id}: cue too short: ${cue}`);
			assert.ok(!/\s{2,}/.test(cue), `${paradigm.id}: cue has odd whitespace: ${cue}`);
			// Every phrase in the vocabulary must resolve back to the paradigm that owns it.
			const outcome = matchCues(`prefix ${cue} suffix`, PARADIGMS);
			assert.ok(outcome.matches.some((match) => match.paradigm.id === paradigm.id), `${paradigm.id}: cue '${cue}' does not resolve back to it`);
		}
		assert.ok((paradigm.cues ?? []).length > 0, `${paradigm.id}: no cues defined`);
	}
});

test("nlmatch: taskAfterCue strips the scaffolding around the cue", () => {
	const outcome = matchCues("帮我用六顶思考帽的方式评估一下这个并购", PARADIGMS);
	const match = outcome.matches.find((entry) => entry.paradigm.id === "hats")!;
	assert.equal(taskAfterCue("帮我用六顶思考帽的方式评估一下这个并购", match), "这个并购");
});

test("nlmatch: a bare paradigm name is not reported as a task", () => {
	const parsed = parseThinkArgs("用六顶思考帽");
	assert.equal(parsed.paradigm?.id, "hats");
	assert.equal(parsed.task, undefined, `expected no task, got ${JSON.stringify(parsed.task)}`);
});
