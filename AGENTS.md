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
   (`MANDATE_CLAUSE` in `render.ts`, and the bundled skill), **not** by a harness loop: nothing may judge
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

## Architecture

| File | Role | Testable without Pi? |
|---|---|---|
| `index.ts` | all Pi wiring: command, tool, `--think` flag, prompt injection, `message_end` rendering, config load, session state | no |
| `paradigms.ts` | paradigm registry: contracts, markers, aliases, cues, workflow steps | yes (pure) |
| `render.ts` | system-prompt section rendering, intensity layering, `/think` argument parsing | yes (pure) |
| `nlmatch.ts` | prose -> paradigm + task via registry cues | yes (pure) |
| `autoSelect.ts` | heuristic per-prompt paradigm selection | yes (pure) |
| `config.ts` | schema, validation, comment-tolerant parsing, layering | yes (pure) |
| `ui.ts` | every human-facing string, one language per call | yes (pure) |
| `placement.ts` | placement clause + structure extraction + marker rendering | yes (pure) |
| `workflow.ts` | multi-pass engine with external score gating; takes a `ModelCall` parameter | yes (pure) |
| `livecheck.mjs` | end-to-end checks against real `pi --mode json` / `pi --mode rpc` runs | - |

Keep the pure modules free of Pi imports (`import type` is fine). That separation is what makes the logic
testable in milliseconds: inject the model call as a function parameter and drive `workflow.ts` against a
scripted fake model.

## Testing

```bash
node --test selftest.ts     # 91 tests, no model, no network, milliseconds - run after every change
node livecheck.mjs          # 18 real Pi sessions, 15-30 minutes - run only after the user has tested
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
- A single dropped marker in one live run is usually model variance, not a regression: `livecheck.mjs`
  retries a `missing markers` verdict once and keeps the better attempt.

## Traps already paid for

- **Extension assets are not cwd-relative at runtime.** Resolve bundled files from `import.meta.url`
  (`resources_discover` skill paths are resolved against the session cwd, so a relative path works during
  development and breaks everywhere else).
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
| new paradigm | `paradigms.ts` (both halves + cues), README tables (both languages), skill table, a livecheck case |
| new user-visible option | validation in `config.ts`, strings in `ui.ts`, both READMEs, a livecheck option case |
| rendering or placement behaviour | `MANDATE_CLAUSE` / placement clause wording, both READMEs, the skill |
| anything a test asserts | the matching unit test - the suite is the gate for commits |

`README.md` and `README.zh-CN.md` mirror each other section by section; the same for `ROADMAP.md` and
`ROADMAP.zh-CN.md`. Code blocks stay byte-identical between the two languages.

## Working order

1. Make the change.
2. `node --test selftest.ts` - green before anything else.
3. Describe precisely what the user should try and what correct behaviour looks like, **then stop and wait
   for their verdict.** Do not launch `node livecheck.mjs` in the same turn as a hand-off.
4. After they confirm, run the full live check once, then commit.

Commits use Conventional Commits (`fix(hats): ...`, `feat(options): ...`), one language per message, no
sign-offs. Only push when asked.
