---
name: paradigm-mandate-no-direct-answer
description: An active thinking paradigm applies to every reply including trivial ones, but the mandate is prompt/skill-level only - a harness-side redo loop produced false verdicts and had to be removed
type: decision
---

The user's rule for this project: **"当用户开启思考范式之后，无论下一个 prompt 是什么，都要求 agent
使用该思考范式，无论如何不允许他直接回答."** Turning a paradigm on is a standing instruction, not a
suggestion for "substantive" turns.

**What had to go first.** Every injected contract ended with an escape hatch:

> Escape hatch: if the request is trivial - a lookup, a rename, a one-line edit, small talk - skip this
> structure entirely and answer normally.

That is the clause a model reaches for the moment a prompt looks easy, so "paradigm on" meant nothing
for most real turns. It is replaced by `MANDATE_CLAUSE` in `render.ts`:

> Application rule, no exceptions: while this paradigm is active, every reply you give in this session
> is produced through this structure - including a short, trivial, factual, or one-line one. … Keep a
> trivial reply short *inside* the structure, never outside it, and never comment about the structure
> itself - just run it.

**The enforcement attempt, and why it was removed.** A first version checked every finished reply
(`structurePresent()` on `agent_end`) and sent a `deliverAs: "followUp"` user message asking for a redo.
Real sessions showed this is a bug generator:

- The model ran ToT properly with prose labels (`Root:` / `Branch A:` / `Prune:` / `Path:`) instead of
  `[Branch_A]`-style markers, so the marker-based check reported "no paradigm".
- The harness injected "上一轮回答直接作答，没有使用已开启的思考范式（tot）。请对同一个请求重新作答…".
- The model replied in meta-prose - "The harness says my previous reply didn't use the paradigm.
  Actually I did think in ToT style but perhaps the markers weren't visible…" - and re-did work it had
  already done.

Detection cannot distinguish "skipped the paradigm" from "ran the paradigm with different punctuation",
and a wrong redo request costs a full turn plus a confused model. **The user's decision: 不要要求重答，
只需在 skill 说明里写清即可.**

**How to apply.** The mandate is stated, never policed:

- `MANDATE_CLAUSE` in the injected contract (every paradigm, every intensity, every placement).
- A "An active paradigm is not optional" section in `skills/think-different/SKILL.md`, including
  "Nothing will ask you to redo it … never write meta-commentary about whether the structure was seen."
- `livecheck.mjs` keeps a `mandate:trivial` case (`startup: "angles"` + "把变量 x 改名为 width") that
  measures whether the mandate wording actually holds, with the usual one retry for model variance.

Related: [[thinking-paradigm-two-mechanisms]], [[think-options-language-and-placement]],
[[scaffold-markers-need-tag-discipline]], [[auto-select-cjk-length-signal]]
