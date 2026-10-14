---
name: random-paradigm-switch-needs-turn-message
description: Changing the active thinking paradigm mid-session did not take effect because system-prompt sections travel as a diff while the model's own history keeps the old structure - the switch has to be named in a per-turn message
type: lesson
---

`/think random` picked a new paradigm every turn and the notification said so (`随机思考范式 → debate`),
but the answers kept using the previous paradigm. A three-prompt RPC probe showed the mechanism:

```text
system update: sections=…,thinking_paradigm  paradigm=tot
answer 1: ### 思维树 [Root] …                      ✓ ran tot
system update: sections=thinking_paradigm          paradigm=cot
answer 2: <thought_tree> <root> …                  ✗ still tot
system update: sections=thinking_paradigm          paradigm=debate
answer 3: <thought_tree> <root> …                  ✗ still tot
```

**Why.** Pi rebuilds the system prompt per turn but sends only the *diff* of structured sections
(`diffSystemPromptSections` in `core/system-prompt.js`, applied by `_preparePromptAndToolLoadout`), as
one small system message. The conversation, by contrast, still contains every earlier reply written in
the old paradigm's shape - and for the model that history is the strongest signal about "what this
session does". A changed section in a long context loses to three consecutive `<thought_tree>` answers.

**How to apply.** Name the paradigm *inside the turn*. `before_agent_start` may return
`{ message: { customType, content, display, details } }`, which the harness injects as a `role: "custom"`
message alongside the user prompt:

```ts
// index.ts
const switchedFrom = lastInjectedParadigmId && lastInjectedParadigmId !== paradigm.id ? lastInjectedParadigmId : undefined;
lastInjectedParadigmId = paradigm.id;
return {
  message: {
    customType: "think_paradigm",
    content: [{ type: "text", text: renderTurnReminder(paradigm, state.placement, switchedFrom) }],
    display: false,
  },
};
```

`renderTurnReminder` states the paradigm for *this* turn, its markers verbatim, and - when it changed -
that the previous paradigm is finished and its structure in earlier replies is "finished output, not a
pattern to continue". The contract got the matching sentence too: "a paradigm named in an earlier turn is
expired".

**Side effect that hid the bug.** Naturalization is keyed to the *active* paradigm's markers, so on the
cot/debate turns the leftover `<thought_tree>` tags were not rewritten and stayed visible in the answer -
which made the wrong-paradigm output obvious in the UI.

Related: [[thinking-paradigm-two-mechanisms]], [[paradigm-mandate-no-direct-answer]],
[[think-options-language-and-placement]]
