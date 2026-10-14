#!/usr/bin/env node
/**
 * Live check for pi-think-different.
 *
 * Spawns real `pi --mode json` runs with `--think <paradigm>` and asserts that the
 * assistant answer actually carries the paradigm's structural markers. This is the
 * end-to-end half of the test story: `node --test tests/selftest.ts` proves the logic,
 * this proves the extension loads inside Pi, injects the section, and is obeyed.
 *
 * Run: node tests/livecheck.mjs            (all paradigms)
 *      node tests/livecheck.mjs tot hats   (subset)
 *
 * Requires an authenticated pi model. Each run is one real model request.
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

import { markerHeading, resolveParadigm } from "../src/paradigms.ts";

const RUN_TIMEOUT_MS = Math.max(60_000, Math.min(900_000, Number(process.env.LIVECHECK_TIMEOUT_MS ?? 420_000)));
const CONCURRENCY = Math.max(1, Math.min(4, Number(process.env.LIVECHECK_CONCURRENCY ?? 3)));

/** One prompt per paradigm: short, self-contained, and impossible to answer in the right shape by accident. */
const LIVE_CASES = [
	{ paradigm: "cot", prompt: "A train leaves at 09:00 at 60 km/h. A second leaves the same station at 09:30 at 90 km/h on the same line. When does it catch up? Work the problem out explicitly before answering." },
	{ paradigm: "tot", prompt: "A note-taking app needs offline support. Lay out at least three genuinely different architectural approaches, score each one, prune the weak ones, deepen the survivor, and pick a path. No code, no file reading." },
	{ paradigm: "got", prompt: "A new dashboard UI must bind to an existing REST API. Produce two independent design nodes from different angles, merge them into one node, cross-check the merge against both originals, refine it, and converge. No code, no file reading." },
	{ paradigm: "critique", timeoutMs: 900_000, prompt: "First-pass answer: `function getAverage(nums){ return sum(nums)/len(nums) }` in Python. Then attack your own answer for concrete failure modes and rebuild it." },
	{ paradigm: "hypothesis", prompt: "A test passes locally but fails intermittently only on CI. Enumerate mutually exclusive candidate causes, test each against what is known, eliminate them, and name the surviving cause plus the cheapest confirming check." },
	{ paradigm: "hats", prompt: "Should a 12-person engineering team adopt a strict no-meetings Wednesday? Evaluate it through every thinking hat, then decide." },
	{ paradigm: "debate", prompt: "Position: we should replace our homegrown job queue with a managed service. Argue the strongest case for it, then the strongest case against it, rebut the hardest hit, and judge." },
	{ paradigm: "first-principles", prompt: "Our service polls a status endpoint every second because that is how it has always been done. Discard the convention, list the real constraints, and rebuild the approach from them." },
	{ paradigm: "angles", prompt: "Plan under review: store every audit event in one JSON column per row in Postgres. Examine it from a mechanism angle, an adversary angle, and a cost angle, then synthesise a verdict." },
];

const TOOL_CASE = {
	paradigm: "critique",
	prompt:
		"Call the `think` tool exactly once with mode 'run', paradigm 'critique', intensity 'light', and task 'Should a small new app start on SQLite or on a managed Postgres for its first release?'. " +
		"After the tool result, reply with one short paragraph stating the verdict. Do not read files.",
};

/**
 * Option cases: these prove the config layer and the two new options end to end, by running Pi
 * in a scratch directory that carries a `.pi/pi-think-different.json`, or a scratch agent directory
 * that carries `<agentDir>/pi-think-different.json`.
 */
const OPTION_CASES = [
	{
		paradigm: "lang:zh",
		config: { language: "zh", startup: "tot" },
		prompt: "Call the `think` tool exactly once with no task at all, so it returns the paradigm catalogue. Then reply with the single word 完成. Do not read files.",
	},
	{
		paradigm: "lang:en",
		config: { language: "en", startup: "tot" },
		prompt: "Call the `think` tool exactly once with no task at all, so it returns the paradigm catalogue. Then reply with the single word done. Do not read files.",
	},
	{
		paradigm: "nl:prose",
		config: { language: "zh" },
		timeoutMs: 900_000,
		// One command only: /think with a task must start the turn by itself.
		rpc: [{ id: "cmd-1", type: "prompt", message: "/think 以六顶思考帽的方式思考俄乌战争的结果" }],
	},
	{
		// The same prompt as startup:agent but with hats: seven markers and six sections, so it needs the budget
		// its sibling already has instead of the 420s default.
		paradigm: "startup:config",
		config: { startup: "hats" },
		timeoutMs: 1_500_000,
		prompt: "Should a 12-person engineering team adopt a strict no-meetings Wednesday? Decide after thinking it through.",
	},
	{
		// The agent-level file (<agentDir>/pi-think-different.json) must apply even with no project config.
		paradigm: "startup:agent",
		agentConfig: { startup: "tot", language: "en" },
		timeoutMs: 900_000,
		prompt: "Should a 12-person engineering team adopt a strict no-meetings Wednesday? Decide after thinking it through.",
	},
	{
		paradigm: "placement:thinking",
		config: { startup: "tot", placement: "thinking" },
		prompt: "A note-taking app needs offline support. Consider at least three genuinely different architectural approaches, score each, prune the weak ones, deepen the survivor, and pick a path. No code, no file reading.",
	},
	{
		// A switched paradigm has to land in the turn itself: the system-prompt section only travels as a diff.
		paradigm: "random:switch",
		config: { startup: "random" },
		timeoutMs: 900_000,
		rpc: [
			{ id: "cmd-1", type: "prompt", message: "番茄炒蛋怎么做？简短回答。" },
			{ id: "cmd-2", type: "prompt", message: "黄瓜炒蛋呢？简短回答。" },
		],
	},
	{
		// An active paradigm applies to every prompt, however trivial: the contract must hold without any redo loop.
		paradigm: "mandate:trivial",
		config: { startup: "angles" },
		prompt: "把下面这行里的变量 x 改名为 width：`const x = rows.length;` 只改名字。",
	},
];

/**
 * A scratch cwd whose project config is the one under test.
 *
 * `placement: "answer"` is pinned unless the case overrides it: the real
 * ~/.pi/agent/pi-think-different.json is a live layer in every run here, and a user who set
 * `placement: "thinking"` would otherwise make every marker-in-the-answer case fail for their own taste.
 */
function scratchCwd(config) {
	const dir = mkdtempSync(join(tmpdir(), "think-different-"));
	mkdirSync(join(dir, ".pi"), { recursive: true });
	const effective = { placement: "answer", ...config };
	writeFileSync(join(dir, ".pi", "pi-think-different.json"), `${JSON.stringify(effective, null, "\t")}\n`, "utf8");
	return dir;
}

/**
 * A scratch agent dir whose pi-think-different.json is the one under test.
 * Pi reads its whole config directory from PI_CODING_AGENT_DIR, so the auth/model files are
 * symlinked in and the extension is loaded explicitly with --extension. settings.json is deliberately
 * not symlinked: its installed packages make Pi git-clone them into the scratch dir, which fails there.
 */
function scratchAgentDir(config) {
	const realAgentDir = process.env.PI_CODING_AGENT_DIR?.trim() || join(homedir(), ".pi", "agent");
	const dir = mkdtempSync(join(tmpdir(), "think-agent-"));
	for (const name of ["auth.json", "models.json"]) {
		const source = join(realAgentDir, name);
		if (existsSync(source)) symlinkSync(source, join(dir, name));
	}
	mkdirSync(join(dir, "sessions"), { recursive: true });
	// Same rule as scratchCwd: the placement under assertion is pinned, so the real agent layer of the
	// machine running the check cannot move the structure out of the answer.
	const effective = { placement: "answer", ...config };
	writeFileSync(join(dir, "pi-think-different.json"), `${JSON.stringify(effective, null, "\t")}\n`, "utf8");
	return dir;
}

function collectAssistantText(records) {
	const parts = [];
	for (const record of records) {
		if (record.type !== "message_end") continue;
		const message = record.message;
		if (!message || message.role !== "assistant") continue;
		for (const block of message.content ?? []) {
			if (block.type === "text") parts.push(block.text);
		}
	}
	return parts.join("\n");
}

/**
 * RPC driver for cases that need an extension command: print mode does not expand slash
 * commands, RPC does. Commands are JSONL on stdin, records are split on LF only, and the run
 * ends once every command has had its turn (one `agent_settled` per command).
 */
function runPiRpc(cwd, commands, timeoutMs) {
	return new Promise((resolve, reject) => {
		const child = spawn("pi", ["--mode", "rpc", "--no-session"], { stdio: ["pipe", "pipe", "pipe"], cwd });
		const records = [];
		const responses = new Map();
		let stdout = "";
		let stderr = "";
		let settled = false;
		let sent = 0;
		let turnsSettled = 0;

		const sendNext = () => {
			if (sent >= commands.length) return false;
			child.stdin.write(`${JSON.stringify(commands[sent])}\n`);
			sent += 1;
			return true;
		};

		const finish = (error) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			try {
				child.stdin.end();
			} catch {
				/* already closed */
			}
			if (error) reject(error);
			else resolve({ records, responses, stderr });
		};

		const timer = setTimeout(() => finish(new Error(`pi rpc timed out after ${timeoutMs / 1000}s`)), timeoutMs);

		child.stdin.on("error", () => undefined);
		child.stdout.on("data", (chunk) => {
			stdout += chunk.toString("utf8");
			let newline = stdout.indexOf("\n");
			while (newline >= 0) {
				const line = stdout.slice(0, newline).replace(/\r$/, "").trim();
				stdout = stdout.slice(newline + 1);
				newline = stdout.indexOf("\n");
				if (!line) continue;
				let record;
				try {
					record = JSON.parse(line);
				} catch {
					continue;
				}
				records.push(record);
				if (record.type === "response" && typeof record.id === "string") responses.set(record.id, record);
				// Each command in these cases starts a turn, so the next prompt is chained at the turn boundary.
				// Ending on the first agent_settled instead would end a two-prompt case after its first turn.
				if (record.type === "agent_settled") {
					turnsSettled += 1;
					if (turnsSettled >= commands.length) finish(undefined);
					else sendNext();
				}
			}
		});
		child.stderr.on("data", (chunk) => {
			stderr += chunk.toString("utf8");
		});
		child.on("error", (error) => finish(error));
		child.on("close", (code) => {
			if (settled) return;
			if (code !== 0) finish(new Error(`pi rpc exited with code ${code}: ${stderr.slice(-300)}`));
			else finish(undefined);
		});

		sendNext();
	});
}

/** Message content is either a plain string or an array of blocks, depending on the message kind. */
function collectBlockText(content) {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content.filter((block) => block && block.type === "text").map((block) => block.text).join("\n");
}

function collectAssistantThinking(records) {
	const parts = [];
	for (const record of records) {
		if (record.type !== "message_end") continue;
		const message = record.message;
		if (!message || message.role !== "assistant") continue;
		for (const block of message.content ?? []) {
			if (block.type === "thinking" || block.type === "redacted_thinking") parts.push(block.thinking ?? "");
		}
	}
	return parts.join("\n");
}

/** Text of the last assistant message only: what the user actually reads as the answer. */
function collectFinalAnswerText(records) {
	let last = "";
	for (const record of records) {
		if (record.type !== "message_end") continue;
		const message = record.message;
		if (!message || message.role !== "assistant") continue;
		const text = (message.content ?? []).filter((block) => block.type === "text").map((block) => block.text).join("\n");
		if (text.trim().length > 0) last = text;
	}
	return last;
}

/** Block types of the last assistant message, in order, so placement can be checked positionally. */
function finalAssistantBlockTypes(records) {
	let last = [];
	for (const record of records) {
		if (record.type !== "message_end") continue;
		const message = record.message;
		if (!message || message.role !== "assistant") continue;
		last = (message.content ?? []).map((block) => block.type);
	}
	return last;
}

function collectToolCalls(records) {
	const calls = [];
	for (const record of records) {
		if (record.type !== "message_end") continue;
		const message = record.message;
		if (!message || message.role !== "assistant") continue;
		for (const block of message.content ?? []) {
			if (block.type === "toolCall" || block.type === "tool_use") calls.push(block);
		}
	}
	return calls;
}

function collectToolResults(records) {
	const results = [];
	for (const record of records) {
		if (record.type !== "message_end") continue;
		const message = record.message;
		if (!message || message.role !== "toolResult") continue;
		for (const block of message.content ?? []) {
			if (block.type === "text") results.push(block.text);
		}
	}
	return results.join("\n");
}

function runPi(args, timeoutMs, cwd, env) {
	return new Promise((resolve, reject) => {
		const child = spawn("pi", args, { stdio: ["ignore", "pipe", "pipe"], cwd, env: env ? { ...process.env, ...env } : process.env });
		let stdout = "";
		let stderr = "";
		let settled = false;

		const timer = setTimeout(() => {
			if (settled) return;
			settled = true;
			child.kill("SIGKILL");
			reject(new Error(`pi run timed out after ${timeoutMs / 1000}s`));
		}, timeoutMs);

		child.stdout.on("data", (chunk) => {
			stdout += chunk.toString("utf8");
		});
		child.stderr.on("data", (chunk) => {
			stderr += chunk.toString("utf8");
		});
		child.on("error", (error) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			reject(error);
		});
		child.on("close", (code) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			if (code !== 0) {
				reject(new Error(`pi exited with code ${code}: ${stderr.slice(-400)}`));
				return;
			}
			const records = [];
			for (const line of stdout.split("\n")) {
				const trimmed = line.trim().replace(/^\r/, "");
				if (!trimmed) continue;
				try {
					records.push(JSON.parse(trimmed));
				} catch {
					// Diagnostics occasionally land on stdout; ignore non-JSON lines.
				}
			}
			resolve({ records, stderr });
		});
	});
}

/**
 * A marker counts as present when the answer carries the tag itself or the natural-language label the
 * harness renders in its place (`placement: "answer"` never shows a marker token to the user).
 *
 * `<answer>` is the one marker the harness always removes without replacing it - the conclusion gets no
 * label - so its presence cannot be asserted as a token. What it actually guarantees is that a conclusion
 * survives the structure, so it is checked as "text remains after the last structural section".
 */
function missingMarkers(text, markers) {
	const structural = markers.filter((marker) => marker !== "<answer>");
	const missing = structural.filter((marker) => {
		if (text.includes(marker)) return false;
		return !(text.includes(markerHeading(marker, "en")) || text.includes(markerHeading(marker, "zh")));
	});

	if (!markers.includes("<answer>")) return missing;
	if (text.includes(markerHeading("<answer>", "en")) || text.includes(markerHeading("<answer>", "zh"))) return missing;

	let lastSectionEnd = -1;
	for (const marker of structural) {
		for (const needle of [marker, markerHeading(marker, "en"), markerHeading(marker, "zh")]) {
			const at = text.lastIndexOf(needle);
			if (at >= 0 && at + needle.length > lastSectionEnd) lastSectionEnd = at + needle.length;
		}
	}
	const conclusion = lastSectionEnd >= 0 ? text.slice(lastSectionEnd).trim() : text.trim();
	if (conclusion.length >= 40) return missing;
	return [...missing, "<answer> (no conclusion after the structure)"];
}

async function checkParadigm(entry) {
	const paradigm = resolveParadigm(entry.paradigm);
	if (!paradigm) return { id: entry.paradigm, ok: false, detail: "unknown paradigm in registry" };

	// Hermetic: run in a scratch cwd that pins placement=answer, otherwise the user's own
	// <agentDir>/pi-think-different.json (e.g. placement: "thinking") moves the structure out of the
	// answer and every marker-in-the-answer case fails for the user's taste instead of the code's.
	const { records, stderr } = await runPi(["--mode", "json", "--think", paradigm.id, "-p", entry.prompt], RUN_TIMEOUT_MS, scratchCwd({}));
	const text = collectAssistantText(records);
	const missing = missingMarkers(text, paradigm.markers);
	const extensionErrors = (stderr.match(/think-different[^\n]*/g) ?? []).filter((line) => /error|failed|throw/i.test(line));

	if (missing.length > 0) {
		const head = text.slice(0, 300).replace(/\s+/g, " ");
		const tail = text.slice(-300).replace(/\s+/g, " ");
		return {
			id: paradigm.id,
			ok: false,
			detail: `missing markers: ${missing.join(", ")} | answer ${text.trim().length} chars | head: ${head} | tail: ${tail}`,
		};
	}
	if (extensionErrors.length > 0) return { id: paradigm.id, ok: false, detail: `extension error: ${extensionErrors[0]}` };
	if (text.trim().length === 0) return { id: paradigm.id, ok: false, detail: "assistant produced no text" };
	return { id: paradigm.id, ok: true, detail: `${text.trim().length} chars, all ${paradigm.markers.length} markers present` };
}

async function checkOption(entry) {
	const agentDir = entry.agentConfig ? scratchAgentDir(entry.agentConfig) : undefined;
	const cwd = agentDir ? mkdtempSync(join(tmpdir(), "think-plain-")) : scratchCwd(entry.config);
	const env = agentDir ? { PI_CODING_AGENT_DIR: agentDir } : undefined;
	// With PI_CODING_AGENT_DIR redirected to a scratch dir, extension discovery finds nothing there,
	// so the extension under test is loaded explicitly.
	const jsonArgs = agentDir
		? ["--mode", "json", "-e", join(import.meta.dirname, "..", "src", "index.ts"), "-p", entry.prompt]
		: ["--mode", "json", "-p", entry.prompt];
	const viaRpc = Array.isArray(entry.rpc);
	// Chained cases (RPC drives two turns) nest more model calls and need their own budget.
	const timeoutMs = entry.timeoutMs ?? RUN_TIMEOUT_MS;
	const session = viaRpc ? await runPiRpc(cwd, entry.rpc, timeoutMs) : await runPi(jsonArgs, timeoutMs, cwd, env);
	const { records, stderr } = session;
	const responses = session.responses ?? new Map();
	const extensionErrors = (stderr.match(/think-different[^\n]*/g) ?? []).filter((line) => /error|failed|throw/i.test(line));
	if (extensionErrors.length > 0) return { id: entry.paradigm, ok: false, detail: `extension error: ${extensionErrors[0]}` };

	const toolText = collectToolResults(records);
	const answer = collectFinalAnswerText(records);
	const allText = collectAssistantText(records);
	const thinking = collectAssistantThinking(records);
	const cjk = /[\u3400-\u4DBF\u4E00-\u9FFF]/;

	if (entry.paradigm === "lang:zh" || entry.paradigm === "lang:en") {
		const wantZh = entry.paradigm === "lang:zh";
		if (!toolText.trim()) return { id: entry.paradigm, ok: false, detail: `think tool returned no catalogue (answer: ${answer.slice(0, 120)})` };
		const hasChineseLabels = /适用|开销|别名/.test(toolText);
		const hasEnglishLabels = /best for|cost:|aliases:/.test(toolText);
		const catalogueHasCJK = cjk.test(toolText);
		if (wantZh) {
			if (!hasChineseLabels) return { id: entry.paradigm, ok: false, detail: `catalogue stayed English: ${toolText.slice(0, 200)}` };
			if (hasEnglishLabels) return { id: entry.paradigm, ok: false, detail: `Chinese catalogue leaked English labels: ${toolText.slice(0, 200)}` };
			return { id: entry.paradigm, ok: true, detail: `catalogue rendered in Chinese (${toolText.length} chars)` };
		}
		if (!hasEnglishLabels) return { id: entry.paradigm, ok: false, detail: `catalogue is not English: ${toolText.slice(0, 200)}` };
		if (catalogueHasCJK) return { id: entry.paradigm, ok: false, detail: `English catalogue leaked Chinese: ${toolText.slice(0, 200)}` };
		return { id: entry.paradigm, ok: true, detail: `catalogue rendered in English only (${toolText.length} chars)` };
	}

	if (entry.paradigm === "nl:prose") {
		const paradigm = resolveParadigm("hats");
		const handled = responses.get("cmd-1");
		if (!handled || !handled.success) return { id: entry.paradigm, ok: false, detail: `the /think command was not accepted: ${JSON.stringify(handled ?? "no response")}` };
		if (handled.data?.disposition !== "handled") {
			return { id: entry.paradigm, ok: false, detail: `/think <prose> returned '${handled.data?.disposition}', not 'handled': the extension command did not run` };
		}
		const missing = missingMarkers(allText, paradigm.markers);
		if (missing.length > 0) {
			const typeCounts = {};
			for (const record of records) {
				const type = record.type ?? "?";
				typeCounts[type] = (typeCounts[type] ?? 0) + 1;
			}
			return {
				id: entry.paradigm,
				ok: false,
				detail: `prose did not pin the paradigm; missing markers: ${missing.join(", ")} | answer ${allText.trim().length} chars | records: ${JSON.stringify(typeCounts)} | stderr: ${stderr.slice(-200)}`,
			};
		}
		return { id: entry.paradigm, ok: true, detail: `"/think 以六顶思考帽的方式思考…" pinned ${paradigm.id} and started the turn itself; ${paradigm.markers.length} markers present, ${allText.trim().length} chars` };
	}

	if (entry.paradigm.startsWith("startup:")) {
		const startup = (entry.agentConfig ?? entry.config).startup;
		const paradigm = resolveParadigm(startup);
		const missing = missingMarkers(allText, paradigm.markers);
		if (missing.length > 0) {
			return { id: entry.paradigm, ok: false, detail: `config startup did not pin the paradigm; missing markers: ${missing.join(", ")} | answer ${allText.trim().length} chars | head: ${allText.slice(0, 240).replace(/\s+/g, " ")}` };
		}
		return { id: entry.paradigm, ok: true, detail: `${entry.agentConfig ? "<agentDir>/pi-think-different.json" : ".pi/pi-think-different.json"} startup pinned ${paradigm.id} without any flag; ${paradigm.markers.length} markers present` };
	}

	if (entry.paradigm === "random:switch") {
		// The per-turn reminder is what carries a switched paradigm into the model's context.
		const reminders = [];
		for (const record of records) {
			if (record.type !== "message_end") continue;
			const message = record.message;
			if (!message || message.role !== "custom" || message.customType !== "think_paradigm") continue;
			const text = collectBlockText(message.content);
			const match = text.match(/Thinking paradigm for this turn: ([\w-]+)/);
			if (match) reminders.push({ id: match[1], switched: text.includes("It replaced") });
		}
		const distinct = new Set(reminders.map((reminder) => reminder.id));
		if (reminders.length < 2) {
			return { id: entry.paradigm, ok: false, detail: `expected a per-turn paradigm reminder on each of the 2 turns, found ${reminders.length}: ${JSON.stringify(reminders)}` };
		}
		if (distinct.size < 2) return { id: entry.paradigm, ok: false, detail: `random mode kept the same paradigm across turns: ${reminders.map((r) => r.id).join(", ")}` };
		if (!reminders.some((reminder) => reminder.switched)) return { id: entry.paradigm, ok: false, detail: `paradigm changed but the switch was never announced: ${reminders.map((r) => r.id).join(", ")}` };
		const answered = collectFinalAnswerText(records).trim().length > 0;
		if (!answered) return { id: entry.paradigm, ok: false, detail: `no answer produced while switching paradigms` };
		return { id: entry.paradigm, ok: true, detail: `random mode named a different paradigm on each turn (${[...distinct].join(", ")}) and announced the switch` };
	}

	if (entry.paradigm === "mandate:trivial") {
		const paradigm = resolveParadigm("angles");
		const missing = missingMarkers(allText, paradigm.markers);
		if (missing.length > 0) {
			return {
				id: entry.paradigm,
				ok: false,
				detail: `a trivial prompt got a direct answer with no ${paradigm.id} structure; missing markers: ${missing.join(", ")} | answer ${answer.trim().length} chars | head: ${answer.slice(0, 240).replace(/\s+/g, " ")}`,
			};
		}
		return { id: entry.paradigm, ok: true, detail: `trivial prompt still ran ${paradigm.id} with no redo requested; ${paradigm.markers.length} markers present, ${allText.trim().length} chars` };
	}

	// placement: "thinking"
	const paradigm = resolveParadigm("tot");
	const treeMarker = paradigm.markers[0];
	if (answer.includes(treeMarker)) {
		return { id: entry.paradigm, ok: false, detail: `visible answer still carries the structure: ${answer.slice(0, 300).replace(/\s+/g, " ")}` };
	}
	if (answer.includes("<answer>") || answer.includes("</answer>")) {
		return { id: entry.paradigm, ok: false, detail: `visible answer still wrapped in an answer block: ${answer.slice(0, 200).replace(/\s+/g, " ")}` };
	}
	const blockTypes = finalAssistantBlockTypes(records);
	const lastTextAt = blockTypes.lastIndexOf("text");
	if (lastTextAt >= 0 && blockTypes.slice(lastTextAt + 1).includes("thinking")) {
		return { id: entry.paradigm, ok: false, detail: `thinking landed after the answer: ${blockTypes.join(", ")}` };
	}
	const structureEvidence = thinking.includes(treeMarker) || allText.includes(treeMarker);
	const conclusionOnly = answer.trim().length >= 200;
	if (!structureEvidence && !conclusionOnly) {
		return { id: entry.paradigm, ok: false, detail: `no structure found anywhere and the answer is only ${answer.trim().length} chars` };
	}
	if (!conclusionOnly) {
		return { id: entry.paradigm, ok: false, detail: `answer is ${answer.trim().length} chars; expected a conclusion, got: ${answer.slice(0, 200)}` };
	}
	return {
		id: entry.paradigm,
		ok: true,
		detail: `answer carries no ${treeMarker}; structure ${structureEvidence ? "found in the thinking block" : "kept out of the answer"}, conclusion ${answer.trim().length} chars`,
	};
}

async function checkToolRun() {
	// The tool case chains nested model calls inside one Pi turn, so it needs more room than a single scaffolded answer.
	const { records, stderr } = await runPi(["--mode", "json", "-p", TOOL_CASE.prompt], RUN_TIMEOUT_MS * 3, scratchCwd({}));
	const calls = collectToolCalls(records);
	const call = calls.find((entry) => entry.name === "think");
	const toolText = collectToolResults(records);
	const answer = collectAssistantText(records);

	if (!call) {
		return { id: "tool:run", ok: false, detail: `think tool was not called (calls: ${calls.map((c) => c.name).join(", ") || "none"})${stderr.slice(-200)}` };
	}
	const required = ["Step 1", "Draft", "Criticism", "Refinement"];
	const missing = required.filter((token) => !toolText.includes(token));
	if (missing.length > 0) return { id: "tool:run", ok: false, detail: `tool result missing workflow steps: ${missing.join(", ")}` };
	if (!/verdict|sqlite|postgres/i.test(answer)) return { id: "tool:run", ok: false, detail: "no verdict in the follow-up answer" };
	return { id: "tool:run", ok: true, detail: `think(mode=run) produced ${toolText.length} chars of stepped output; agent answered on it` };
}

async function main() {
	const requested = process.argv.slice(2);
	const wantTool = requested.includes("tool");
	const wantOptions = requested.includes("options");
	const wanted = requested.filter((name) => name !== "tool" && name !== "options");
	const cases = requested.length === 0 ? LIVE_CASES : LIVE_CASES.filter((entry) => wanted.includes(entry.paradigm));
	// An option case can be named directly too, so a slow one can be re-run on its own.
	const optionCases =
		requested.length === 0 || wantOptions ? OPTION_CASES : wanted.length > 0 ? OPTION_CASES.filter((entry) => wanted.includes(entry.paradigm)) : [];

	if (cases.length === 0 && optionCases.length === 0 && !wantTool) {
		const known = [...LIVE_CASES, ...OPTION_CASES].map((entry) => entry.paradigm).join(", ");
		console.error(`No such case. Known: ${known} | options | tool`);
		process.exit(2);
	}

	const results = [];
	const report = (result) => {
		results.push(result);
		console.log(`${result.ok ? "PASS" : "FAIL"} ${result.id.padEnd(18)} ${result.detail}`);
	};

	/** Run a bounded pool of real Pi sessions; each case is independent. */
	async function pool(items, run) {
		let cursor = 0;
		const workerCount = Math.min(CONCURRENCY, items.length);
		const workers = [];
		for (let worker = 0; worker < workerCount; worker += 1) {
			workers.push(
				(async () => {
					while (cursor < items.length) {
						const item = items[cursor];
						cursor += 1;
						try {
							// A timed-out Pi session is usually contention, and a single dropped marker is usually
							// model variance; both are retried once before they are reported as failures.
							const timedOut = (error) => error instanceof Error && /timed out/.test(error.message);
							const flaky = (r) => !r.ok && /missing markers/.test(r.detail ?? "");
							const missingCount = (r) => ((r.detail ?? "").match(/missing markers: ([^|]*)/)?.[1] ?? "").split(",").filter(Boolean).length;
							const label = () => String(item.paradigm ?? "tool:run").padEnd(18);
							try {
								let result = await run(item);
								if (flaky(result)) {
									console.log(`RETRY ${label()} ${result.detail.slice(0, 110)}`);
									const second = await run(item);
									if (second.ok || missingCount(second) < missingCount(result)) {
										result = second;
									} else {
										// Keep the better attempt but say that the miss reproduced, so a systematic
										// contract problem is not mistaken for one unlucky run.
										const again = (second.detail ?? "").match(/missing markers: ([^|]*)/)?.[1]?.trim() ?? "same markers";
										result = { ...result, detail: `${result.detail} | reproduced on retry: ${again}` };
									}
								}
								report(result);
							} catch (error) {
								if (!timedOut(error)) throw error;
								console.log(`RETRY ${label()} ${error.message}`);
								report(await run(item));
							}
						} catch (error) {
							report({ id: item.paradigm ?? "tool:run", ok: false, detail: error.message });
						}
					}
				})(),
			);
		}
		await Promise.all(workers);
	}

	await pool(cases, checkParadigm);

	if (optionCases.length > 0) {
		console.log("\noptions:");
		await pool(optionCases, checkOption);
	}

	if (requested.length === 0 || wantTool) {
		await pool([{ paradigm: "tool:run" }], checkToolRun);
	}

	const failed = results.filter((result) => !result.ok);
	console.log(`\n${results.length - failed.length}/${results.length} live checks passed`);
	process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((error) => {
	console.error(`livecheck crashed: ${error.stack ?? error.message}`);
	process.exit(1);
});
