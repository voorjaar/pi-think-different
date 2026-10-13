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
/think off                   back to default Pi reasoning
```

Free text after the paradigm is kept as the concrete task and injected as "Concrete task for this
turn", so `/think tot design a cache` both pins the paradigm and points it at the problem.

Intensities: `light` (compact contract), `standard` (full contract), `deep` (full contract plus extra
required coverage).

Start a headless or scripted session with a paradigm already on:

```bash
pi --mode json --think tot -p "Design offline support for a note app"
```

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

35 tests covering: registry integrity and alias uniqueness, marker/contract consistency for every
paradigm, prompt rendering and intensity layering (including the concrete-task line from
`/think <paradigm> <task>`), `/think` argument parsing, auto-selection
(including "trivial prompts get no paradigm"), score extraction, external pruning, and the workflow
engine against a scripted fake model (step order, placeholder filling, prior-step threading, harness
branch budgets per intensity, output caps, `only:` reruns, failure propagation).

Live end-to-end checks (real Pi runs, one model request each):

```bash
node livecheck.mjs            # every paradigm + the think tool in run mode
node livecheck.mjs tot hats   # subset
```

A live check spawns `pi --mode json --think <paradigm> -p "<prompt>"` and fails if the answer is
missing any marker that paradigm is defined by. Verdicts stream in as each run finishes; cases run
through a pool of 3 concurrent Pi sessions (`LIVECHECK_CONCURRENCY=1..4`), each allowed
`LIVECHECK_TIMEOUT_MS` milliseconds (default 420000) before it is retried once. Pass `tool` as an
argument to run only the `think`-tool case.

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
├── index.ts            # Pi wiring: command, tool, flag, prompt injection, session state
├── paradigms.ts        # paradigm registry: contracts, markers, workflow steps (pure)
├── render.ts           # prompt section rendering + /think argument parsing (pure)
├── autoSelect.ts       # heuristic paradigm selection (pure)
├── workflow.ts         # multi-pass engine with external score gating (pure, injectable model)
├── selftest.ts         # unit tests
├── livecheck.mjs       # end-to-end checks against real Pi runs
├── ROADMAP.md          # what counts as "works", and what gets built next
└── skills/think-different/SKILL.md
```

## License

MIT
