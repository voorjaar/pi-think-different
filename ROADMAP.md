# ROADMAP

[English](./ROADMAP.md) | [简体中文](./ROADMAP.zh-CN.md)

What `pi-think-different` is, what it is not, and what gets built next.

## Where it stands (v0.4.0)

Two working layers per paradigm:

| Layer | Mechanism | Cost | Status |
|---|---|---|---|
| Injected contract | `/think <paradigm>` writes a `<thinking_paradigm>` section into the system prompt | one prompt section | shipped, verified live |
| Real workflow | `think({mode:"run"})` runs the paradigm as separate model calls; the harness parses reported scores and prunes in code | 3-6 model calls | shipped, verified live |

Nine paradigms shipped: `cot`, `tot`, `got`, `critique`, `hypothesis`, `hats`, `debate`,
`first-principles`, `angles`. Each one has a scaffold contract, a step workflow, verbatim required
markers, and a live check that runs a real `pi --mode json` session and fails if a marker is missing.

Controls shipped: `/think` (status/picker), `list`, `off`, `auto`, `once`, `<paradigm>`,
`[intensity]`, `[task]`; prose arguments (`/think 以六顶思考帽的方式思考俄乌战争的结果` resolves the
paradigm from its cue and keeps the rest as the task, and refuses to guess when two paradigms match);
`--think <paradigm>` CLI flag; `light | standard | deep` intensities; `lang en|zh` for the interface
language; `placement answer|thinking` for where the structure lives; `config` to show the layered
config in play (`config.json` < `.pi/think-different.json` < flag < `/think`); status-line indicator;
session persistence across restarts and session trees; contributed skill.

Live checks cover all three wiring paths a user can reach: `--think` (print mode), the `think` tool,
and the `/think` command - the last one through RPC mode, because print mode does not expand slash
commands.

## Definition of "works"

A paradigm is done only when all of these hold:

1. Its contract names operators the paradigm actually has (branches and pruning for ToT, elimination
   for hypothesis, one hat per section for hats) - not generic "think harder" language.
2. Its required markers are listed verbatim in the injected contract.
3. A real Pi run produces those markers. `node livecheck.mjs <paradigm>` is the arbiter.
4. A harness-driven run mode exists and its pruning/merge decision is computed in code, not asserted
   by the model.
5. Unit tests cover its workflow against a scripted fake model.

Anything that only "looks thoughtful" in one transcript does not count.

## Next: make the shape cheaper to keep

- **Marker compliance telemetry.** Record which paradigm ran, at what intensity, and whether its
  markers appeared, as a session entry. Today compliance is only visible from outside, via livecheck.
- **Soft marker groups.** `hats` checks six emoji; a model that writes `⚫ Black` vs `Black hat`
  flake-fails. Keep strict tags as the contract, but let the checker report "degraded" separately from
  "absent" so a flake is not mistaken for a broken paradigm.
- **Cost reporting.** Show tokens spent by `mode:"run"` per paradigm so "use run mode when the answer
  matters" comes with a number instead of a vibe.
- **Run-mode resume.** `only:` reruns one step today; persist step outputs so a crashed or interrupted
  workflow can resume from the last completed step instead of restarting.

## Next: paradigms worth adding

Each new paradigm must ship both layers, not just a prompt.

| Candidate | Why | The hard part |
|---|---|---|
| `means-ends` | Goals with sub-goals: plan by working backwards from the outcome | Planning is where agents overreach; needs explicit preconditions |
| `analogy` | "This is like X" as a deliberate operator, with the disanalogy stated | Analogies smuggle in wrong assumptions |
| `pre-mortem` | Assume failure happened, then explain why - before committing | Needs to survive contact with an optimistic model |
| `red-team` | Adversary attacks the plan while a defender must patch it in place | Two roles in one pass collapse into monologue |
| `rubric` | Score against an explicit rubric the user supplies | Rubric parsing and score gating |
| `map-reduce` | Split a large question into independent shards, then merge | Shard splitting is itself a hard decision |

## Next: harness quality

- **Score gate calibration.** Pruning currently keeps candidates scoring 6+. That threshold was picked,
  not measured. Collect scores from live runs and check whether the gate keeps the eventual winner.
- **Cross-paradigm comparison.** Same task, two paradigms, diff the answers. Right now there is no way
  to know whether ToT beat `angles` on a given problem class.
- **Intensity measured, not guessed.** `light` is 0.6x char budget and fewer branches. Compare answer
  quality against budget on a fixed task set.
- **Deterministic tool path.** The `mode:"run"` live check depends on the outer model choosing to call
  `think`. Add a way to force a workflow run from the command layer so the workflow can be verified
  without model cooperation.

## Non-goals

- Not a model-routing or thinking-level control. `--think` here selects a *paradigm*, not reasoning
  effort; Pi's own thinking levels stay in charge of that.
- Not a memory or knowledge system. Paradigms shape reasoning; they do not store it.
- Not a general agent framework. No sub-agents, no orchestration graph, no background workers.
- Not prompt-optimisation for one model. Contracts are written to survive weaker models, which is why
  pruning lives in code.

## Known rough edges

- Marker checks are strict. Strictness is deliberate: a paradigm that degrades into prose must fail
  loudly. The cost is occasional flakiness on emoji-marked paradigms (`hats`).
- Live checks are slow and cost real tokens: 10 cases is roughly 20 minutes of real Pi sessions.
  Unit tests are the fast loop; livecheck is the gate before a release.
- `auto` selection is keyword-and-signal heuristics. It will mis-pick on prompts that mix shapes
  ("refactor this broken thing and pick a new design").
- Nested `mode:"run"` calls inherit no tool access, so workflow steps cannot read files. They think
  about what they already know.

## Verification commands

```bash
node --test selftest.ts                 # fast, offline, no model
node livecheck.mjs                      # all paradigms + think(mode:"run")
node livecheck.mjs tot hats             # subset
node livecheck.mjs tool                 # only the multi-call tool case
npm run check                           # both
```
