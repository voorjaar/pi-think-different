---
name: think-prose-cue-matching
description: /think accepts prose by matching registry cues (longest match, word boundaries, refuse on ambiguity) instead of requiring an explicit paradigm token
type: decision
---

`/think 以六顶思考帽的方式思考俄乌战争的结果` used to fail: `parseThinkArgs` treated the whole
sentence as one paradigm token and reported `Unknown thinking paradigm`. Users who think in sentences
should not have to remember the CLI shape.

**How it resolves now** (`nlmatch.ts`, pure):

- The vocabulary is the registry's own words: `id`, `title`, `titleZh`, `aliases`, plus a new per-paradigm
  `cues` list (`六顶思考帽`, `第一性原理`, `换个角度看`, `rule out causes`, `steelman`...). No semantic
  guessing, no embeddings - a fixed phrase list, so behaviour is explainable and testable.
- Longest phrase wins; a match nested inside a longer accepted match is dropped, so `六顶思考帽` does
  not also fire the shorter `思考帽`.
- Latin cues require a word boundary: `treewidth` must not select `tot`. CJK cues are plain substrings.
- The task is what remains after removing the cue span and peeling connective scaffolding from the
  front (`以`, `用的方式`, `帮我`, `分析一下`, `看看`...), so the sentence yields `俄乌战争的结果`.
- **Two different paradigms matching is not resolved by guessing.** `用思维树和六顶思考帽分析…` returns
  `ambiguous` with both candidates and `/think` asks the user to name one. Silently picking a paradigm
  would be a hidden state change in a reasoning tool.
- Explicit tokens still win: `/think tot 讨论六顶思考帽的优缺点` keeps `tot` and the hats phrase stays
  in the task. Cue matching only runs when no explicit token resolved.

**Why the live check for it uses RPC mode.** Extension slash commands are expanded in interactive and
RPC modes only - print mode (`pi --mode json -p "/think …"`) sends the text to the model as a prompt and
never runs the command. So the prose case drives `pi --mode rpc --no-session`, writes JSONL commands on
stdin (split on LF only; `readline` also splits on U+2028/2029), chains prompt #2 after prompt #1
reports `disposition: "handled"`, and asserts the next turn carries the `hats` markers.

**How to apply.** When adding a paradigm, add its `cues` in the registry - that is the user's vocabulary
for it, and a unit test asserts every cue resolves back to the paradigm that owns it. When a new input
shape needs a live check, first determine which Pi mode actually executes that path; headless print mode
cannot prove command wiring.

**The same vocabulary is what `/think auto` must consult too.** Auto mode scored prompts on generic
complexity signals plus per-paradigm `keywords`, so "用辩论的方式分析一下俄乌战争的结果？" scored on
`question +1 / CJK +1 / medium +1` and landed on `cot` - the generic signals are stronger than debate's
keyword list, and `辩论` was only an *alias*, which auto never read. Fix in `autoSelect.ts`: run
`matchCues(prompt, listParadigms())` first, and when exactly one paradigm is named, that paradigm wins
outright (`confident: true`, reason `named in your wording: "辩论" → debate`). Two paradigms named is
still not guessed: the cue override is skipped, the scoring decides, and the reasons say so.

A unit test pins the invariant for the whole registry: every cue of every paradigm, embedded in a
neutral sentence, must resolve back to the paradigm that owns it.

Related: [[think-options-language-and-placement]], [[pi-extension-test-split]], [[auto-select-cjk-length-signal]]
