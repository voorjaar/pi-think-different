---
name: argument-completions-replace-whole-argument-span
description: getArgumentCompletions values replace the entire typed argument span, so a completion value must be argument text only - "/think auto" renders as "/think /think auto"
type: lesson
---

`/think` offered completions built as `{ value: "/think auto", label: "auto" }`. Typing `/think auto`,
accepting the completion, and pressing Enter produced the literal text `/think /think auto` in the input
bar.

**Why.** In `pi-tui/dist/autocomplete.js`, argument completions are produced with
`prefix = commandText.slice(spaceIndex + 1)` - the whole text after the command name - and
`applyCompletion` splices `currentLine.slice(0, cursorCol - prefix.length) + item.value + afterCursor`.
The value is a *replacement for the entire argument span*, not an insertion. Pi's own built-ins follow
this: `/think` levels return `value: level`, `/model` returns `value: "provider/id"`, `/login` returns
`value: provider.id`. None of them repeat the command name.

**How to apply.** In `ui.ts`, `completionItems(language, argumentPrefix)` returns values that are complete
argument text:
- top-level words: `auto`, `random`, `tot`, `hats`, ... (single tokens)
- two-token sub-commands: `lang zh`, `placement thinking` - because the typed prefix is `lang` or `lang `,
  and the value must replace all of it.

A unit test pins the invariant: no completion value may start with `/`, and top-level values must contain
no space. Descriptions are localised in `ui.ts` like every other human-facing string, and the list is not
truncated below the number of paradigms (a cap of 12 silently dropped `critique` from the picker).

Related: [[think-options-language-and-placement]], [[pi-extension-test-split]]
