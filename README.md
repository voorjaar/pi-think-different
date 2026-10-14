# pi-think-different

**English** | [简体中文](README.zh-CN.md)

A [Pi](https://github.com/earendil-works/pi) extension that switches the agent's thinking paradigm. It ships with nine built-in paradigms (listed under [Paradigms](#paradigms)), each available two ways - as a contract injected into the system prompt for the whole session, or as a harness-driven multi-pass workflow for a single question.

## Features

- Nine paradigms (listed under [Paradigms](#paradigms)), each with a prompt contract and a multi-pass workflow.
- `/think` command: pin a paradigm, apply it to one turn, name the task in the same command, or write the request as a plain sentence.
- `/think auto` picks a paradigm per prompt by scoring the prompt; `/think random` rotates paradigms.
- Three intensities: `light`, `standard`, `deep`.
- Session language (`en` / `zh`) and structure placement (`answer` / `thinking`).
- `think` tool with `mode: "run"`: the harness parses reported scores, prunes weak candidates itself, and tells the next step what it may build on.
- Bundled skill (`skills/think-different/SKILL.md`) so the agent knows which paradigm fits which problem shape.

## Installation

```bash
cp -r pi-think-different ~/.pi/agent/extensions/
```

Pi loads `index.ts` directly: no build step, no dependencies beyond Pi itself.

## Usage

```text
/think                       status (picker in interactive mode)
/think list                  catalogue with best-fit guidance
/think tot                   pin Tree of Thoughts for this session
/think hats                  pin the six thinking hats (Chinese aliases work too)
/think once critique         apply self-critique to the next turn only
/think tot design a cache    pin the paradigm and answer this question with it now
/think auto                  pick a paradigm per prompt (always picks one)
/think random                a different paradigm every turn
/think deep                  raise the intensity of the current paradigm
/think lang zh               menus, help, and status in Chinese (en to switch back)
/think placement thinking    keep the structure in the thinking block, answer only the conclusion
/think config                show which config files are in play and their values
/think off                   back to default Pi reasoning
```

A paradigm does not have to be named as a token. When the arguments read like a sentence, the text is scanned for a paradigm cue and the rest becomes the task:

```text
/think rethink our polling from first principles    -> first-principles, task: rethink our polling
/think use six hats on the migration plan           -> hats, task: the migration plan
/think with a thought tree and the six hats ...     -> ambiguous: two paradigms named, so it asks
```

Text after the paradigm is the concrete problem to think about, and `/think tot design a cache` starts the turn immediately. Without a task, the paradigm is only pinned and the next prompt uses it.

Headless and scripted sessions can start with a paradigm already on:

```bash
pi --mode json --think tot -p "Design offline support for a note app"
```

### The `think` tool

Structured reasoning for the current turn (`scaffold`), or the harness-driven multi-pass workflow (`run`):

```json
{ "task": "cache-aside or write-through?", "paradigm": "tot", "mode": "run" }
```

Run-mode output is labelled step by step and states what was pruned and why:

```text
Harness gate (external control): pruned Branch_B (3/10). Build only on: Branch_A (9/10).
```

That gate is computed by the harness from the reported scores, not asserted by the model.

### Notes

- While a paradigm is active, every reply uses it - including a lookup, a rename, or a one-line edit. Triviality shortens the structure, it never removes it.
- The model writes structural markers (`<thought_tree>`, `<draft>`, the six hat emoji) so a paradigm that degrades into prose is detectable; the harness renders them as bold labels in the session language (`**Adversary angle**`, or its Chinese equivalent) and never shows a marker token. `hats` is shown exactly as the model wrote it.

## Paradigms

| id | name | shape of problem it fits | run-mode calls |
|---|---|---|---|
| `cot` | Chain of Thought | hard question where a silent wrong answer is expensive | 2 |
| `tot` | Tree of Thoughts | several viable routes, unclear which | 3 |
| `got` | Graph of Thoughts | parts must be merged and cross-checked | 3 |
| `critique` | Self-Critique and Refinement | output must be correct, not just plausible | 3 |
| `hypothesis` | Hypothesis and Elimination | something is broken and the cause is unknown | 3 |
| `hats` | Six Thinking Hats | adopt or not adopt, buy or build, policy calls | 6 |
| `debate` | Dialectical Debate | one side already has the momentum | 4 |
| `first-principles` | First Principles | the design survives only because "that is how it is done" | 3 |
| `angles` | Multi-Angle Sweep | reviewing something you just wrote | 4 |

## Configuration

Defaults come from three optional JSON files (later wins), and `/think` in the session wins over all of them:

```text
~/.pi/agent/extensions/pi-think-different/config.json   the extension author's defaults
~/.pi/agent/pi-think-different.json                     your defaults for every project
<repo>/.pi/pi-think-different.json                      per-project override
```

Copy `config.example.jsonc` to `config.json` next to `index.ts` to get started. Comments (`//`, `/* */`) are allowed; a bad value is reported at session start and the rest of the file still applies.

```jsonc
{
  "startup": "tot",        // paradigm id or alias, "auto", "random", or "off"
  "intensity": "standard", // light | standard | deep
  "placement": "thinking", // answer | thinking
  "language": "en"         // en | zh
}
```

`language` changes only the interface: the picker, catalogue, help, status line, and notifications render in that one language. `placement` decides where the structure lives:

| value | visible answer contains |
| --- | --- |
| `answer` | the branches, scores, criticisms, hats |
| `thinking` (default) | only the conclusion; the structure stays in the thinking block |

With `thinking`, the contract asks the model to keep the structure in its reasoning, and if it writes it into the answer anyway, the harness moves those sections into the thinking block.

## Development

```bash
node --test selftest.ts     # 91 unit tests: no model, no network
node livecheck.mjs          # end-to-end against real Pi runs (18 cases)
node livecheck.mjs tot hats  # paradigm subset only
node livecheck.mjs options   # config startup, language, placement, prose /think
npm test                     # unit tests
npm run check                # unit tests + live checks
```

Unit tests cover the pure modules: registry and contracts, prompt rendering, argument parsing, config layering, placement, auto-selection, score extraction, and the workflow engine against a scripted fake model. A live paradigm check spawns `pi --mode json --think <paradigm> -p "<prompt>"` and fails if the answer is missing a marker that paradigm is defined by; option checks run Pi in a scratch directory whose config sets the option under test. See [AGENTS.md](./AGENTS.md) for how to work on this extension and [ROADMAP.md](./ROADMAP.md) for what counts as "a paradigm works".

## License

MIT - see [LICENSE](LICENSE).
