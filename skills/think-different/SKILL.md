---
name: think-different
description: "Switch thinking paradigms when a problem needs more than one pass of intuition. Use when the task is a design choice with several viable routes (tot), multi-module integration or cross-validation (got), code or claims that must survive review (critique), a 'why is this broken' investigation (hypothesis), an adopt/not-adopt decision (hats), a contested call you are already attached to (debate), a design held in place only by convention (first-principles), or a review of something you just wrote (angles). Also use when the user says 换个角度, 多角度, 用思维树, 六顶思考帽, 第一性原理, or asks to /think. Choosing a paradigm is for substantial problems - but once the user has pinned one, every reply runs it, trivial or not."
allowed-tools: think bash read
---

# Thinking Paradigms

Pi's default reasoning is one pass of intuition. This extension makes the *shape* of the
reasoning a user-controllable choice, in two layers:

1. **Injected contract** (`/think <paradigm>`): the paradigm's structure is added to the system
   prompt as a `<thinking_paradigm>` section, so every substantive turn of the session reasons in
   that shape.
2. **Real workflow** (`think` tool with `mode: "run"`): the paradigm runs as separate model calls,
   and the harness keeps control - it parses the scores the model reports, prunes weak candidates
   itself, and tells the next step what it may build on. Use this when a considered answer matters
   more than speed.

## An active paradigm is not optional

When the user turns a paradigm on - `/think hats`, `startup` in a config file, `--think tot`, or auto /
random mode having chosen one - that is a standing instruction for the rest of the session:

- **Every reply goes through it, whatever the prompt says.** A rename, a lookup, "what day is it",
  small talk: run the structure and keep the reply short *inside* it. Never answer directly because
  the request looked trivial.
- **Triviality changes the length, never the shape.** For "rename x to width" under `tot`, the tree is
  three lines, not a paragraph of justification.
- **Nothing will ask you to redo it.** The harness does not judge finished replies and does not send
  follow-ups asking for the structure again - that mechanism produced false verdicts on replies that
  had already reasoned properly. So run the structure the first time, and never write meta-commentary
  about whether the structure was seen.
- **Markers are still required even though the user never sees them.** With `placement: "answer"` the
  harness renders each marker section as a natural-language heading (`<angle:adversary>` becomes
  `### 对手视角`), so your own tags may be absent from what you later read back. That is rendering, not
  a failure - write the markers anyway.

## Pick the paradigm by the shape of the problem

| Situation | Paradigm |
|---|---|
| More than one viable route, unclear which | `tot` - branch, score, prune, backtrack |
| Several parts must be combined and cross-checked | `got` - nodes, merge, cross-check, refine |
| Output must be correct, not just plausible | `critique` - draft, attack, rebuild |
| Something is broken and the cause is unknown | `hypothesis` - falsifiable causes, elimination |
| Adopt / not adopt, buy / build, policy call | `hats` - facts, gut, risk, value, alternatives, decision |
| One side already has the momentum | `debate` - advocate, critic, rebuttal, verdict |
| The design survives only because "that's how it's done" | `first-principles` - strip conventions, rebuild from constraints |
| You just wrote it and you are attached to it | `angles` - mechanism, adversary, cost |

If you cannot decide, `angles` is the cheapest multi-lens option and `cot` is the cheapest
structure at all.

## How to use it

Structured reasoning for the current turn:

```
think({ task: "should the read path use cache-aside or write-through?", paradigm: "tot", mode: "scaffold" })
```

A considered answer, driven by the harness instead of by imagination:

```
think({ task: "should the read path use cache-aside or write-through?", paradigm: "tot", mode: "run" })
```

`mode: "run"` output is step-by-step: each step is one model call, and any step marked with a
`Harness gate` line records what the harness pruned and why. Trust the gate over the model's own
confidence: the pruning decision was made in code from the scores, not asserted by the reasoner.

Rules that keep this useful:

- **`hats` means all six hats, every time.** ⚪ White, 🔴 Red, ⚫ Black, 🟡 Yellow, 🟢 Green, 🔵 Blue - each one
  starting its own section, each with at least one line, in that order. Skipping Yellow because "there is
  nothing optimistic to say", folding Black into White, or stopping before Blue is not a shorter hats run:
  it is a different paradigm, and the session's checks count it as missing. Blue is the section where the
  decision, the sequence, and the next step get written, so it is the one a rushed answer drops.
- **Emit the paradigm's tags literally.** Each contract lists `Required markers, verbatim`. Write them
  on their own lines; do not swap a tag for a heading, bold label, emoji, table, or one big code fence.
  A paradigm that shows up as plain prose did not run, and the session's checks treat it as missing.
  `hats` is the exception in form, not in discipline: its markers are the six fixed emoji (⚪🔴⚫🟡🟢🔵) plus
  `<answer>`, and the harness shows those lines to the user exactly as written.
- One paradigm per problem. Do not stack paradigms; pick the one matching the problem's shape.
- After a `mode: "run"` result, act on the final step. Do not re-run the same paradigm on the same
  question hoping for a different verdict - add a constraint or a new piece of evidence instead.
- **While a paradigm is active there is no escape hatch.** Lookups, renames, one-line edits, and
  questions with obvious answers all get the structure, in the shortest honest form it can take.
- The user can pin a paradigm for the whole session with `/think <paradigm>`, name the problem at the
  same time with `/think <paradigm> <task>`, ask for a single turn with `/think once <paradigm>`, let
  the extension choose per prompt with `/think auto` (it always chooses one, never none), take a
  different one every turn with `/think random`, or turn it off with `/think off`. Respect what the
  user pinned: if `/think` already set a paradigm, follow it rather than calling `think` for the same
  shape again.
- `/think` also accepts prose: `/think 以六顶思考帽的方式思考俄乌战争的结果` resolves to `hats` with
  the rest of the sentence as the task. If it reports the wording matched two paradigms, ask the user
  which one instead of picking for them.
- A `/think` call that carries a task starts the turn itself: the task is sent as the prompt, so the
  reasoning happens in that same command. Do not answer the same question again afterwards, and do not
  call `think` for that task a second time.
- Two session options change what the user sees, not how you reason: `/think lang en|zh` renders the
  menus, catalogue, and status in one language at a time, and `/think placement answer|thinking` decides
  whether the paradigm's structure appears in the visible answer or stays in the thinking block. With
  `thinking` placement, keep branches, scores, and critiques out of the answer text and let the answer
  carry the conclusion only.
- Defaults live in `~/.pi/agent/extensions/pi-think-different/config.json` (extension),
  `~/.pi/agent/pi-think-different.json` (your defaults for every project), and
  `<repo>/.pi/pi-think-different.json` (per-project), in that precedence order; each holds `startup`,
  `intensity`, `placement`, `language`. `/think config` shows what is in play. Do not edit
  those files unless the user asks you to.
