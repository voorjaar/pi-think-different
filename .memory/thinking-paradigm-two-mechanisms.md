---
name: thinking-paradigm-two-mechanisms
description: pi-think-different implements each thinking paradigm twice - an injected prompt contract and a harness-driven multi-pass workflow - because they fail differently
type: decision
---

pi-think-different gives every thinking paradigm two implementations instead of one:

1. **Injected contract** - `/think <paradigm>` writes a `<thinking_paradigm>` section into the
   structured system prompt (`event.systemPromptOptions.sections`), so the whole session reasons in
   that shape for one prompt section of cost.
2. **Real workflow** - the `think` tool with `mode: "run"` executes the paradigm as separate model
   calls, and the harness keeps control: `workflow.ts` parses the scores the model reports, prunes
   candidates below 6 in code, and tells the next step which candidates it may build on.

**Why.** Single-CoT simulation of ToT/GoT degrades on weaker models: the model has to hold the whole
tree, the scoring, and the pruning in one stream of text, and it quietly stops pruning. External
control makes the tree real - the pruning decision is computed from parsed `Score: n/10` lines, not
asserted by the reasoner. The reference notes behind this project make exactly this distinction
(prompt-only skill vs code-driven skill), and both halves are worth shipping: injection is cheap and
session-wide, the workflow is expensive and answer-specific.

**How to apply.** When adding a new paradigm, fill in both halves: `body`/`compact` (contract) and
`steps` (workflow). A paradigm with only a contract cannot be verified end-to-end in run mode; a
paradigm with only steps cannot be pinned for a session. Keep `markers` identical between the two
halves - the live checks assert those markers on real model output, so a paradigm that silently
degrades into prose fails loudly.

Related: [[pi-extension-test-split]]
