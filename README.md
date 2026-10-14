# pi-think-different

**English** | [简体中文](README.zh-CN.md)

A [Pi](https://github.com/earendil-works/pi) extension that makes the *shape* of the agent's reasoning a user-controllable choice: switch between thinking paradigms (CoT, ToT, GoT, self-critique, hypothesis & elimination, six thinking hats, dialectical debate, first principles, multi-angle sweep) instead of getting one pass of intuition.

## Why two mechanisms

The reference notes behind this extension make the same point twice: a paradigm can be injected as a
prompt contract, or it can be *driven* by code. Both are implemented, because they fail differently.

| Mechanism | What it is | Cost | Use when |
|---|---|---|---|
| **Injected contract** | `/think <paradigm>` adds a `<thinking_paradigm>` section to the system prompt; every substantive turn of the session reasons in that shape | one prompt section | you want the whole session to reason a certain way |
| **Real workflow** | `think` tool with `mode: "run"` executes the paradigm as separate model calls, and the harness - not the model - decides which candidates survive | 3-6 model calls | one answer that must be considered, not plausible |

In run mode the control logic stays in code: the harness parses the scores the model reports
(`Score: 8/10`, `评分：8/10`, `[8/10]`), prunes candidates below 6 itself, and tells the next step
exactly which candidates it may build on. The model never has to hold a whole tree in its own
imagination, which is where single-CoT simulations usually collapse.

## Paradigms

| id | 中文 | Shape of problem it fits | run-mode calls |
|---|---|---|---|
| `cot` | 思维链 | hard question where a silent wrong answer is expensive | 2 |
| `tot` | 思维树 | several viable routes, unclear which | 3 |
| `got` | 思维网 | parts must be merged and cross-checked | 3 |
| `critique` | 自我批判修正 | output must be correct, not just plausible | 3 |
| `hypothesis` | 假设排他法 | something is broken and the cause is unknown | 3 |
| `hats` | 六顶思考帽 | adopt / not adopt, buy / build, policy | 6 |
| `debate` | 正反辩论 | one side already has the momentum | 4 |
| `first-principles` | 第一性原理 | the design survives only because "that is how it is done" | 3 |
| `angles` | 多角度扫描 | reviewing something you just wrote | 4 |

Each paradigm also declares `bestFor`, `cost`, and the structural blocks it must emit
(`<thought_tree>`, `<draft>` / `<criticism>` / `<refinement>`, ⚪🔴⚫🟡🟢🔵, ...). Those markers are
what the live checks assert, so a paradigm that silently degrades into prose is caught.

## Installation

Drop the directory into Pi's extension folder (it is loaded automatically because it contains `index.ts`):

```bash
cp -r pi-think-different ~/.pi/agent/extensions/
```

No build step: Pi loads TypeScript directly. No dependencies beyond Pi itself.

## Usage

```text
/think                       status (picker in interactive mode)
/think list                  catalogue with best-fit guidance
/think tot                   pin Tree of Thoughts for this session
/think 六顶思考帽              same as /think hats (Chinese aliases work)
/think once critique         apply self-critique to the next turn only
/think tot design a cache    pin the paradigm and name the problem to think about
/think auto                  pick a paradigm per prompt by heuristic
/think deep                  raise intensity of the current paradigm
/think lang zh               menus, help, and status in Chinese (en to switch back)
/think placement thinking    keep the structure in the thinking block, answer only the conclusion
/think config                show which config files are in play and their values
/think off                   back to default Pi reasoning
```

You do not have to name the paradigm as a token. If the arguments are prose, the text is scanned for
a paradigm cue and whatever is left becomes the task:

```text
/think 以六顶思考帽的方式思考俄乌战争的结果      → hats, task 俄乌战争的结果
/think rethink our polling from first principles  → first-principles, task rethink our polling
/think 用思维树和六顶思考帽分析这个迁移          → ambiguous: it names two paradigms, so it asks
```

Cues are the registry's own vocabulary (`id`, aliases, titles, plus a `cues` list per paradigm),
longest match wins, and Latin cues need a word boundary - `treewidth` does not select `tot`. When two
different paradigms match, `/think` refuses to guess and asks you to name one.

Free text after the paradigm is kept as the concrete task and injected as "Concrete task for this
turn", so `/think tot design a cache` both pins the paradigm and points it at the problem.

Intensities: `light` (compact contract), `standard` (full contract), `deep` (full contract plus extra
required coverage).

Start a headless or scripted session with a paradigm already on:

```bash
pi --mode json --think tot -p "Design offline support for a note app"
```

## Configuration

Defaults come from two optional JSON files (later wins), and `/think` in the session wins over both:

```text
~/.pi/agent/extensions/pi-think-different/config.json   your defaults
<repo>/.pi/think-different.json                        per-project override
```

Copy `config.example.jsonc` to `config.json` next to `index.ts` to get started. Comments (`//` and `/* */`) are allowed;
a bad value is reported at session start and the rest of the file still applies.

```jsonc
{
  "startup": "tot",        // paradigm id or alias, "auto", or "off"
  "intensity": "standard", // light | standard | deep
  "placement": "thinking", // answer | thinking
  "language": "zh"         // en | zh
}
```

**`language`** changes only the interface: the `/think` picker, `/think list`, help, the status line,
and notifications are rendered in that one language - never both at once. The paradigm contracts
injected into the system prompt stay English, because they are instructions to the model, and your
own prompts are answered in whatever language you write them.

**`placement`** decides where the paradigm's fine-grained structure lives:

| value | visible answer contains |
| --- | --- |
| `answer` (default) | the branches, scores, criticisms, hats - the scaffolding is on display |
| `thinking` | only the conclusion; the structure stays in the thinking block |

`thinking` placement is enforced twice: the contract tells the model to keep the structure in its
reasoning, and if the model puts it in the answer anyway, the harness cuts it out of the answer and
re-attaches it as a thinking block. A structure you cannot see is a structure you cannot verify, so
this is a deliberate trade-off, not a cleanup.

### The `think` tool

Structured reasoning for the current turn:

```json
{ "task": "cache-aside or write-through?", "paradigm": "tot", "mode": "scaffold" }
```

Harness-driven multi-pass reasoning:

```json
{ "task": "cache-aside or write-through?", "paradigm": "tot", "mode": "run" }
```

Run-mode output is labelled step by step. A `Harness gate` line states what was pruned and why, for
example:

```text
Harness gate (external control): pruned Branch_B (3/10). Build only on: Branch_A (9/10).
Do not revive a pruned candidate unless you state the evidence that changes its score.
```

Trust the gate over the model's own confidence: that pruning decision was computed, not asserted.

## Behaviour worth knowing

- **Escape hatch is built into every contract.** A lookup, a rename, or a one-line edit skips the
  structure instead of dressing it up. `/think` is for substantive reasoning, not for ceremony.
- **Markers must be visible.** The contract says to emit the structure in the answer, not only in
  private thinking, so you can see which paradigm actually ran.
- **Session state survives reload and resume.** The active paradigm is stored as a session entry and
  rebuilt from the current branch, so branching, `/reload`, and resuming keep the choice consistent.
- **`/think auto` is a keyword-and-signal heuristic**, not a model call: it scores defect, design,
  decision, and trade-off signals in the prompt and refuses to attach a paradigm to a trivial prompt.
- **The skill ships with the extension.** `skills/think-different/SKILL.md` is contributed through
  `resources_discover`, so the agent knows which paradigm fits which shape without being told.

## Development

See [ROADMAP.md](./ROADMAP.md) for the definition of "a paradigm works" and the planned work.

Unit tests (no model, no network):

```bash
node --test selftest.ts
```

62 tests covering: registry integrity and alias uniqueness, marker/contract consistency for every
paradigm, prompt rendering and intensity layering (including the concrete-task line from
`/think <paradigm> <task>`), placement clauses, `/think` argument parsing - explicit tokens and
prose cue matching - config validation and layering (language spellings, comment-tolerant parsing,
unknown keys, malformed JSON), single-language catalogue and status rendering, structure extraction
from tagged and heading-form answers, auto-selection (including "trivial prompts get no paradigm"),
score extraction, external pruning, and the workflow engine against a scripted fake model (step order,
placeholder filling, prior-step threading, harness branch budgets per intensity, output caps, `only:`
reruns, failure propagation), and the location of the bundled skill.

Live end-to-end checks (real Pi runs, one model request each):

```bash
node livecheck.mjs            # every paradigm + config options + the think tool in run mode
node livecheck.mjs tot hats   # paradigm subset only
node livecheck.mjs options    # config startup, language, placement, and prose /think
```

A paradigm check spawns `pi --mode json --think <paradigm> -p "<prompt>"` and fails if the answer is
missing any marker that paradigm is defined by. Option checks run Pi inside a scratch directory whose
`.pi/think-different.json` sets the option under test, and assert what the user would actually see:
the catalogue language, whether a config `startup` pins a paradigm without any flag, and whether a
`thinking` placement leaves the structure out of the visible answer. The prose case drives Pi in RPC
mode - print mode does not expand slash commands - sends `/think 以六顶思考帽的方式思考俄乌战争的结果`,
requires the command response `disposition: "handled"`, and then requires the next turn to carry the
`six hats` markers. Verdicts stream in as each run finishes; cases run through a pool of 3 concurrent
Pi sessions (`LIVECHECK_CONCURRENCY=1..4`), each allowed `LIVECHECK_TIMEOUT_MS` milliseconds (default
420000) before it is retried once. Pass `tool` as an argument to run only the `think`-tool case.

Every injected contract states its markers verbatim and forbids substituting a heading, bold label,
emoji, or a single code fence for a tag. Models follow that discipline; a paradigm that degrades into
prose fails the check instead of passing quietly.

```bash
npm test                     # unit tests
npm run check                # unit tests + live checks
```

## Layout

```text
pi-think-different/
├── index.ts            # Pi wiring: command, tool, flag, prompt injection, config load, session state
├── paradigms.ts        # paradigm registry: contracts, markers, workflow steps (pure)
├── render.ts           # prompt section rendering + /think argument parsing (pure)
├── nlmatch.ts          # paradigm cues in prose -> paradigm + task (pure)
├── config.ts           # config schema, validation, layering, comment-tolerant parsing (pure)
├── ui.ts               # every human-facing string, in one language at a time (pure)
├── placement.ts        # structure placement: prompt clause + answer extraction (pure)
├── autoSelect.ts       # heuristic paradigm selection (pure)
├── workflow.ts         # multi-pass engine with external score gating (pure, injectable model)
├── selftest.ts         # unit tests
├── livecheck.mjs       # end-to-end checks against real Pi runs
├── config.example.jsonc # copy to config.json to set your defaults
├── ROADMAP.md          # what counts as "works", and what gets built next
└── skills/think-different/SKILL.md
```

## License

MIT
