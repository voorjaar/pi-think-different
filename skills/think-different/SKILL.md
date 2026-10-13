---
name: think-different
description: "Switch thinking paradigms when a problem needs more than one pass of intuition. Use when the task is a design choice with several viable routes (tot), multi-module integration or cross-validation (got), code or claims that must survive review (critique), a 'why is this broken' investigation (hypothesis), an adopt/not-adopt decision (hats), a contested call you are already attached to (debate), a design held in place only by convention (first-principles), or a review of something you just wrote (angles). Also use when the user says 换个角度, 多角度, 用思维树, 六顶思考帽, 第一性原理, or asks to /think. Do not use for lookups, renames, or one-line edits."
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

- **Emit the paradigm's tags literally.** Each contract lists `Required markers, verbatim`. Write them
  on their own lines; do not swap a tag for a heading, bold label, emoji, table, or one big code fence.
  A paradigm that shows up as plain prose did not run, and the session's checks treat it as missing.
- One paradigm per problem. Do not stack paradigms; pick the one matching the problem's shape.
- After a `mode: "run"` result, act on the final step. Do not re-run the same paradigm on the same
  question hoping for a different verdict - add a constraint or a new piece of evidence instead.
- For a lookup, a rename, or a one-line edit, skip the whole apparatus and just answer.
- The user can pin a paradigm for the whole session with `/think <paradigm>`, name the problem at the
  same time with `/think <paradigm> <task>`, ask for a single turn with `/think once <paradigm>`, let
  the extension choose per prompt with `/think auto`, or turn it off with `/think off`. Respect what the
  user pinned: if `/think` already set a paradigm, follow it rather than calling `think` for the same
  shape again.
