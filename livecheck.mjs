#!/usr/bin/env node
/**
 * Live check for pi-think-different.
 *
 * Spawns real `pi --mode json` runs with `--think <paradigm>` and asserts that the
 * assistant answer actually carries the paradigm's structural markers. This is the
 * end-to-end half of the test story: `node --test selftest.ts` proves the logic,
 * this proves the extension loads inside Pi, injects the section, and is obeyed.
 *
 * Run: node livecheck.mjs            (all paradigms)
 *      node livecheck.mjs tot hats   (subset)
 *
 * Requires an authenticated pi model. Each run is one real model request.
 */

import { spawn } from "node:child_process";
import process from "node:process";

import { resolveParadigm } from "./paradigms.ts";

const RUN_TIMEOUT_MS = Math.max(60_000, Math.min(900_000, Number(process.env.LIVECHECK_TIMEOUT_MS ?? 420_000)));
const CONCURRENCY = Math.max(1, Math.min(4, Number(process.env.LIVECHECK_CONCURRENCY ?? 3)));

/** One prompt per paradigm: short, self-contained, and impossible to answer in the right shape by accident. */
const LIVE_CASES = [
	{ paradigm: "cot", prompt: "A train leaves at 09:00 at 60 km/h. A second leaves the same station at 09:30 at 90 km/h on the same line. When does it catch up? Work the problem out explicitly before answering." },
	{ paradigm: "tot", prompt: "A note-taking app needs offline support. Lay out at least three genuinely different architectural approaches, score each one, prune the weak ones, deepen the survivor, and pick a path. No code, no file reading." },
	{ paradigm: "got", prompt: "A new dashboard UI must bind to an existing REST API. Produce two independent design nodes from different angles, merge them into one node, cross-check the merge against both originals, refine it, and converge. No code, no file reading." },
	{ paradigm: "critique", prompt: "First-pass answer: `function getAverage(nums){ return sum(nums)/len(nums) }` in Python. Then attack your own answer for concrete failure modes and rebuild it." },
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

function runPi(args, timeoutMs) {
	return new Promise((resolve, reject) => {
		const child = spawn("pi", args, { stdio: ["ignore", "pipe", "pipe"] });
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

function missingMarkers(text, markers) {
	return markers.filter((marker) => !text.includes(marker));
}

async function checkParadigm(entry) {
	const paradigm = resolveParadigm(entry.paradigm);
	if (!paradigm) return { id: entry.paradigm, ok: false, detail: "unknown paradigm in registry" };

	const { records, stderr } = await runPi(["--mode", "json", "--think", paradigm.id, "-p", entry.prompt], RUN_TIMEOUT_MS);
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

async function checkToolRun() {
	// The tool case chains nested model calls inside one Pi turn, so it needs more room than a single scaffolded answer.
	const { records, stderr } = await runPi(["--mode", "json", "-p", TOOL_CASE.prompt], RUN_TIMEOUT_MS * 3);
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
	const wanted = requested.filter((name) => name !== "tool");
	const cases = requested.length === 0 ? LIVE_CASES : LIVE_CASES.filter((entry) => wanted.includes(entry.paradigm));
	if (cases.length === 0 && !wantTool) {
		console.error(`No such paradigm. Known: ${LIVE_CASES.map((entry) => entry.paradigm).join(", ")}`);
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
							try {
								report(await run(item));
							} catch (error) {
								// A timed-out Pi session is usually contention, not a broken contract.
								if (!/timed out/.test(error.message)) throw error;
								console.log(`RETRY ${String(item.paradigm ?? "tool:run").padEnd(18)} ${error.message}`);
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
