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

**Placement: enforced twice, because a prompt clause alone is not a guarantee.** `thinking` is the default
(the user chose it for 1.0.0, together with `language: "en"`): the structure lives in the thinking block
and the answer carries only the conclusion. `answer` puts the structure in the visible answer. That is
implemented as:

1. `placementClause()` in the injected contract - what the model is asked to do.
2. `extractStructure()` on `message_end` - if the model wrote the structure into the answer anyway,
   the harness cuts those spans out of the text blocks and re-attaches them as a `thinking` content
   block.

The extractor handles both tag markers (`<thought_tree>`) and emoji/heading markers (`### ⚫ Black Hat`),
and refuses to relocate when the answer would become empty - a model that produced structure but no
conclusion keeps its answer as it is.

**No marker token is ever shown to the user.** The model still writes markers verbatim (that is what
makes a paradigm verifiable), but `message_end` renders them away:

- `placement: "answer"` - `naturalizeMarkers()` rewrites every span into a **bold label** taken from
  `MARKER_HEADINGS` in `paradigms.ts` (`<angle:adversary>` → `**对手视角**`, English session →
  `**Adversary angle**`) and unwraps `<answer>`. Bold, never `###`: the user rejected heading rendering
  (**不要用###，也许可以换成加粗 **） because every section of an answer looked like a document heading.
  `hats` is exempt via `verbatimMarkers: true` and is passed through as the model wrote it.
- `placement: "thinking"` - the structure moves to the thinking block with its markers intact, and
  `stripMarkerDebris()` removes what the model leaked into the answer: a stray `</angle:adversary>`, an
  orphan `<synthesis>`, a bare `angle:pragmatist` line.

Two traps came out of that:

- **A bare marker word is not a span.** Span extraction cannot remove `angle:pragmatist` written without
  brackets, which is exactly what a real session left scattered through the answer. Debris cleanup is a
  separate step, and it drops a marker word only when the word occupies a line by itself - otherwise the
  English word "synthesis" disappears out of real prose.
- **Verification has to follow the rendering.** `livecheck.mjs` counts a marker as present when the answer
  carries the tag **or** its natural-language heading in either language, because with
  `placement: "answer"` the tag is gone before anyone reads it.

**Why this trade-off is deliberate.** A structure nobody can see cannot be verified: the whole test
story for this extension is marker-based. So the model is always asked for markers in every placement,
and the harness is what turns them into bold labels. `thinking` placement is the shipped default because
the user reads conclusions, not scaffolding - the harness keeps the structure visible in the thinking
block rather than deleting it. `livecheck.mjs` therefore pins `placement: "answer"` in its scratch configs
for marker-in-the-answer cases: with the real default the structure would leave the answer and those
assertions would measure the user's taste instead of the code.

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
