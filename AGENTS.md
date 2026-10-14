# AGENTS.md

Working notes for agents editing this extension. Read this before changing code, prompts, or docs.

## What this project is

A Pi extension that makes the *shape* of the agent's reasoning switchable: nine thinking paradigms, each
implemented twice - an injected system-prompt contract, and a harness-driven multi-pass workflow. The
extension is loaded by Pi as TypeScript directly; there is no build step and no dependency beyond Pi.

## Non-negotiable project rules

1. **An active paradigm is not optional.** Once a paradigm is pinned (by `/think`, `startup`, `--think`,
   auto, or random), every reply must run it - including a lookup, a rename, a one-line edit, or small
   talk. Triviality shortens the structure, it never removes it. This is enforced by wording
   (`MANDATE_CLAUSE` in `src/render.ts`, and the bundled skill), **not** by a harness loop: nothing may judge
   a finished reply and demand a redo. A wrong "you skipped the paradigm" claim costs a full turn and
   produces meta-commentary, and marker detection cannot tell "skipped" from "ran it with different
   punctuation".
2. **Markers stay strict.** Every paradigm declares `markers` and the model must write them verbatim -
   that is what makes a paradigm verifiable and what every live check asserts. Never loosen a check to
   accept "a heading that looks like the paradigm".
3. **No `###` headings in anything the user reads.** Sections render as **bold labels** from
   `MARKER_HEADINGS` (`<angle:adversary>` -> `**Adversary angle**` in an English session, and the Chinese
   label for the same marker in a Chinese session). `hats` is exempt: `verbatimMarkers: true` means its
   emoji lines are passed through untouched.
4. **One file, one language.** `README.md` and `AGENTS.md` are English only (the language-switch link line
   is the only exception); `README.zh-CN.md` and `ROADMAP.zh-CN.md` are Chinese only; `ui.ts` emits one
   language per call and never mixes. The injected paradigm contracts are always English - they are
   instructions to the model, not UI. Code comments: English.
5. **Every paradigm needs both halves.** `body` / `compact` / `deep` (contract) and `steps` (workflow). A
   paradigm with only a contract cannot be verified in run mode; one with only steps cannot be pinned for
   a session. Keep `markers` identical between the two halves, and add its `cues` - that list is the
   user's vocabulary for it, and a unit test asserts every cue resolves back to the paradigm that owns it.

## Layout

```text
src/              index.ts (all Pi wiring) + the pure modules
                  paradigms render nlmatch autoSelect config ui placement workflow
tests/            selftest.ts (unit) · livecheck.mjs (real Pi runs)
examples/         config.example.jsonc · agent-config.example.jsonc · headless.sh
skills/           think-different/SKILL.md (bundled, discovered through resources_discover)
assets/           preview.png - the gallery image, referenced by both READMEs and by pi.image through its
                  GitHub raw URL (kept out of package.json "files": a relative path would break in the
                  package gallery, which renders the README from the npm tarball)
tools/            local-only screenshot helpers (uv + Pillow) that build assets/preview.png; gitignored,
                  so neither they nor the image's source screenshot is ever published
.memory/          project memory notes (local to this checkout, gitignored)
docs              README.md README.zh-CN.md ROADMAP.md ROADMAP.zh-CN.md AGENTS.md
```

The entry point is `src/index.ts`, declared in `package.json` (`pi.extensions: ["./src/index.ts"]`) - the
layout Pi documents for packages (see `docs/packages.md`). There is no root `index.ts` and no build step:
Pi loads the TypeScript directly.

Pure modules import each other with `./x.ts` (same directory); tests import them as `../src/x.ts`. Keep
the pure modules free of Pi imports (`import type` is fine). That separation is what makes the logic
testable in milliseconds: inject the model call as a function parameter and drive `workflow.ts` against a
scripted fake model.

## Architecture

| File | Role | Testable without Pi? |
|---|---|---|
| `src/index.ts` | entry + all Pi wiring: command, tool, `--think` flag, prompt injection, `message_end` rendering, config load, session state | no |
| `src/paradigms.ts` | paradigm registry: contracts, markers, aliases, cues, workflow steps | yes (pure) |
| `src/render.ts` | system-prompt section rendering, intensity layering, `/think` argument parsing | yes (pure) |
| `src/nlmatch.ts` | prose -> paradigm + task via registry cues | yes (pure) |
| `src/autoSelect.ts` | heuristic per-prompt paradigm selection | yes (pure) |
| `src/config.ts` | schema, validation, comment-tolerant parsing, layering | yes (pure) |
| `src/ui.ts` | every human-facing string, one language per call | yes (pure) |
| `src/placement.ts` | placement clause + structure extraction + marker rendering | yes (pure) |
| `src/workflow.ts` | multi-pass engine with external score gating; takes a `ModelCall` parameter | yes (pure) |
| `tests/selftest.ts` | unit tests over the pure modules | - |
| `tests/livecheck.mjs` | end-to-end checks against real `pi --mode json` / `pi --mode rpc` runs | - |

## Testing

```bash
node --test tests/selftest.ts   # 98 tests, no model, no network, milliseconds - run after every change
node tests/livecheck.mjs        # 18 real Pi sessions, 30-60 minutes at the 900 s / 1500 s case budgets - run in the background, only after the user has tested

npm test                        # the unit suite
npm run check                   # unit suite + live checks
```

- Live cases run in a **scratch cwd** whose `.pi/pi-think-different.json` states what the case depends on.
  `placement: "answer"` is pinned unless a case overrides it: the user's own
  `~/.pi/agent/pi-think-different.json` sets `placement: "thinking"`, and inheriting it makes every
  marker-in-the-answer assertion measure the user's taste instead of the code.
- The agent-layer case redirects `PI_CODING_AGENT_DIR` to a scratch config dir and symlinks `auth.json`
  and `models.json` only. **Never symlink `settings.json`** there: Pi then git-clones each installed
  extension into the scratch dir and exits 1 before the extension under test loads. Load the extension
  explicitly with `--extension <path>`.
- Slash commands are expanded in interactive and RPC modes only. `pi --mode json -p "/think ..."` sends
  the text to the model as a prompt, so command wiring (prose matching, starting a turn) can only be
  proven through `pi --mode rpc`.
- Multi-call cases nest several model calls inside one Pi turn (`think` with `mode: "run"`); give them
  their own timeout multiplier instead of raising the global one. Verdicts must stream as they land - a
  harness that reports only at the end leaves zero evidence when it times out.
- The **harness** needs a longer wall clock than any single case: `critique`, `startup:config`, and the
  `tool:run` case carry 900 s / 1500 s budgets each, so a 45-minute budget truncates the suite part-way.
  Run it in the background with 60+ minutes, and finish the missing cases by name
  (`node tests/livecheck.mjs critique angles startup:config tool`) instead of re-running all 18.
  `livecheck.mjs` prints the effective `case budgets:` line first - a budget on **any** case kind must
  show up there, because paradigm cases once passed the default timeout straight to `runPi` and a budget
  written on a paradigm case was decoration.
- A single dropped marker in one live run is usually model variance, not a regression: `livecheck.mjs`
  retries a `missing markers` verdict once and keeps the better attempt.

## Traps already paid for

- **Extension assets are not cwd-relative at runtime.** Resolve bundled files from `import.meta.url`
  (`resources_discover` skill paths are resolved against the session cwd, so a relative path works during
  development and breaks everywhere else).
- **`src/index.ts` is one directory deeper than the extension root.** `config.json` and `skills/` live
  next to `package.json`, while the entry module sits in `src/`, so `EXT_DIR` there is
  `join(dirname(fileURLToPath(import.meta.url)), "..")`. Using the plain `dirname` looks for
  `<repo>/src/config.json` and silently drops every config layer.
- **String-built regexes need `\\b`, `\\s`, `\\w`.** Inside a JS string or template literal, `\b` is a
  backspace character and `\s` is the letter `s`; a matcher built that way silently matches nothing. Regex
  literals are unaffected.
- **`getArgumentCompletions` values replace the whole typed argument span.** A completion value is argument
  text only: `auto`, `lang zh`, `placement thinking` - never `/think auto`, which renders as
  `/think /think auto`.
- **An extension slash command does not start a turn.** `registerCommand` handlers run in the input path
  and the harness reports `disposition: "handled"`. If a command carries a task, call
  `pi.sendUserMessage(task)` yourself (and clear any stored task first, or the prompt and the injected
  task line repeat each other).
- **A changed system-prompt section loses to the model's own history.** Pi sends only the diff of prompt
  sections, while the conversation still contains every earlier reply in the previous paradigm's shape.
  `random` and `auto` must name the paradigm *inside the turn* (`before_agent_start` returning a
  `role: "custom"` message), not only in the system prompt.
- **Any heuristic scored by words must be tested with Chinese prompts.** A language without spaces makes a
  `split(/\s+/)` length signal count a whole sentence as one word; `autoSelect.ts` measures mixed units
  (whitespace words plus CJK characters) and carries paired English/CJK signal patterns.
- **Launching `pi` as the direct command of a background agent task eats its output.** A `pi` that *is* the
  agent process adopts the attested-agent role and emits telemetry records instead of its normal JSONL
  stream. Spawn a script that starts Pi instead.
- **`markerAliases` maps tag forms back to emoji** (`"<hat:black>"` -> `⚫`). Even with `verbatimMarkers`,
  span recognition and debris cleanup both go through it, and `stripMarkerDebris` must receive
  `markerTokens(paradigm)` (markers *and* alias tags) or a stray `</hat:black>` survives in the answer.
- A bare marker word is debris only when it occupies a line by itself; otherwise the English word
  "synthesis" disappears out of real prose.
- **`<answer>` never survives rendering.** The harness unwraps it without replacing it (the conclusion gets
  no label), so a live check may not assert it as a token: `missingMarkers` asserts the *other* markers and
  then that a conclusion remains after the last structural section. Asserting the token itself fails every
  paradigm case at once while the paradigm is running correctly.

## Docs that must stay in step

| Change | Also update |
|---|---|
| new paradigm | `src/paradigms.ts` (both halves + cues), README tables (both languages), skill table, a livecheck case |
| new user-visible option | validation in `src/config.ts`, strings in `src/ui.ts`, both READMEs, a livecheck option case |
| rendering or placement behaviour | `MANDATE_CLAUSE` / placement clause wording, both READMEs, the skill |
| anything a test asserts | the matching unit test - the suite is the gate for commits |

`README.md` and `README.zh-CN.md` mirror each other section by section; the same for `ROADMAP.md` and
`ROADMAP.zh-CN.md`. Code blocks stay byte-identical between the two languages.

## Working order

1. Make the change.
2. `node --test tests/selftest.ts` - green before anything else.
3. Describe precisely what the user should try and what correct behaviour looks like, **then stop and wait
   for their verdict.** Do not launch `node tests/livecheck.mjs` in the same turn as a hand-off.
4. After they confirm, run the full live check once, then commit.

Commits use Conventional Commits (`fix(hats): ...`, `feat(options): ...`), one language per message, no
sign-offs. Only push when asked.
