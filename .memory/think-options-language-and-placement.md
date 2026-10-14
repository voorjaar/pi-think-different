---
name: think-options-language-and-placement
description: pi-think-different keeps every human-facing string in ui.ts (one language per session) and enforces structure placement twice - prompt clause plus answer extraction
type: decision
---

Two session options were added on top of the paradigm switch: `language` (en | zh) and `placement`
(answer | thinking). Both are configured in layers - built-in defaults < `<extension>/config.json` <
`<agentDir>/pi-think-different.json` < `<cwd>/.pi/pi-think-different.json` < CLI flag < `/think`
during the session, where `agentDir` is `$PI_CODING_AGENT_DIR` else `~/.pi/agent` - and the layering
lives in `config.ts` as pure functions (`extensionConfigPath`, `agentConfigPath`, `projectConfigPath`,
`resolveAgentDir`, `configLayerPaths`) so it is testable without Pi.

**Language: one module, one language.** Every human-facing string (picker options, `/think list`,
help, status line, notifications, error text) is produced by `ui.ts`, which takes a `Language`
argument and never mixes. The earlier code hardcoded English in `index.ts` with Chinese only inside
paradigm titles, so a Chinese user got an English menu with Chinese names in it. Two rules came out of
this:

- Paradigm records carry both variants (`title`/`titleZh`, `summary`/`summaryZh`, `bestFor`/`bestForZh`,
  `cost`/`costZh`), and the *list* function picks one variant per call. A live test asserts the English
  catalogue contains no CJK at all - which is why Chinese **aliases** are filtered out of the English
  list, otherwise `hats` leaks `六顶思考帽` into an otherwise English catalogue.
- The injected `<thinking_paradigm>` contract stays English regardless. It is an instruction to the
  model, not UI, and mixing languages there changes model behaviour for no user benefit.

**Placement: enforced twice, because a prompt clause alone is not a guarantee.** `answer` (default)
asks for the structure in the visible answer. `thinking` wants the structure in the thinking block and
the answer carrying only the conclusion. That is implemented as:

1. `placementClause()` in the injected contract - what the model is asked to do.
2. `extractStructure()` on `message_end` - if the model wrote the structure into the answer anyway,
   the harness cuts those spans out of the text blocks and re-attaches them as a `thinking` content
   block.

The extractor handles both tag markers (`<thought_tree>`) and emoji/heading markers (`### ⚫ Black Hat`),
and refuses to relocate when the answer would become empty - a model that produced structure but no
conclusion keeps its answer as it is.

**Why this trade-off is deliberate.** A structure nobody can see cannot be verified: the whole test
story for this extension is marker-based. So `answer` placement is the default, and `thinking`
placement is opt-in for people who want a clean answer, with the harness keeping the structure visible
in the thinking block rather than deleting it.

**How to apply.** When adding another user-visible option: put its strings in `ui.ts`, its validation in
`config.ts`, and give `livecheck.mjs` an option case that runs Pi in a scratch cwd whose
`.pi/pi-think-different.json` sets the option and asserts what the user would see (catalogue language,
whether `startup` pins a paradigm with no CLI flag, whether the structure left the answer). Unit tests
prove the pure halves; only a real Pi run proves the wiring.

**A layer outside the project needs PI_CODING_AGENT_DIR to be testable live.** Redirecting the agent
dir moves *everything* Pi reads from it - extensions, auth, models - so the scratch agent dir symlinks
`auth.json`, `models.json`, `settings.json`, creates `sessions/`, and loads the extension explicitly
with `--extension <ext>/index.ts`. Without the symlinks the run cannot authenticate and looks like a
paradigm failure rather than a config failure.

Related: [[thinking-paradigm-two-mechanisms]], [[scaffold-markers-need-tag-discipline]], [[pi-extension-test-split]]
