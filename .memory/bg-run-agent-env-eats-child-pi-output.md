---
name: bg-run-agent-env-eats-child-pi-output
description: Launching `pi` as the direct command of a bg_run with isAgent:true makes the child write telemetry records instead of its normal JSONL stream
type: lesson
---

A smoke check run as `bg_run(isAgent: true, command: "pi --mode json --think cot -p '...' > out.jsonl")`
produced a 1 KB `out.jsonl` containing only `background-task-activity`,
`background-task-context-usage`, and `background-task-telemetry` records - no `session`, no
`agent_start`, no assistant message, even though the process exited 0. The identical command wrapped in
a shell script (`diag.sh` invoked from `bg_run`) produced the full 900 KB JSONL transcript.

**Why.** `isAgent: true` marks the *direct* command of the background task as an agent process, so the
background-tasks machinery seeds agent telemetry environment variables into it. A `pi` that is itself
that direct process adopts the attested-agent role and emits telemetry into its output stream instead of
the ordinary event stream the harness is being parsed for. A `pi` spawned by `node livecheck.mjs` is a
grandchild, does not get that role, and behaves normally.

**How to apply.** When a background task must capture a child Pi session's JSONL, launch a script or
program that spawns Pi (a `.sh` wrapper, or the livecheck harness) rather than invoking `pi` as the
task's own command. If a "successful" run yields a suspiciously tiny transcript with only
`background-task-*` record types, suspect this before suspecting the extension.

Related: [[pi-extension-test-split]]
