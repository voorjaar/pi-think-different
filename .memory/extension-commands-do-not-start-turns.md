---
name: extension-commands-do-not-start-turns
description: A Pi extension slash command only handles input - if it should also make the agent think, it must call pi.sendUserMessage() itself
type: lesson
---

`/think 以六顶思考帽的方式思考俄乌战争的结果` pinned the paradigm, printed the status line, and then
sat there. Nothing reasoned until the user typed a second prompt. The command had parsed the task and
stored it in `pendingTask` for the *next* turn, which is invisible behaviour for something that reads
like a question.

**Why it happens.** `registerCommand` handlers run in the input path: Pi expands the command, the
handler does its thing, and the RPC/interactive layer reports `disposition: "handled"` - meaning no run
was started for that message. A handler that wants the agent to actually work must start the run:

```ts
// index.ts
function startTurnWithTask(task: string): void {
	pendingTask = undefined;              // the prompt IS the task; do not inject it twice
	pi.sendUserMessage(task);             // always triggers a turn
	// if a run is already streaming, sendUserMessage throws without deliverAs:
	// pi.sendUserMessage(task, { deliverAs: "followUp" });
}
```

`pi.sendMessage(custom, { triggerTurn: true })` is the alternative when the message should be a custom
message rather than a user message; `sendUserMessage` is what makes the transcript look like the user
asked the question they asked.

**How to apply.** Whenever a command takes both a setting and a question, split the behaviours:
setting only → no turn; setting + task → `sendUserMessage(task)` so the answer arrives in the same
command. Clear any stored task before sending, otherwise the prompt and the injected
"Concrete task for this turn" line repeat each other.

Verify it in RPC mode, not print mode: the live case sends exactly one command
(`/think <prose>`) and requires `agent_settled` plus the paradigm's markers in the resulting answer. If
the extension never starts a run, the case times out with an empty answer - which is what a shutdown or
a missing `sendUserMessage` both look like, so print the record-type counts in the failure detail.

Related: [[think-prose-cue-matching]], [[pi-extension-test-split]]
