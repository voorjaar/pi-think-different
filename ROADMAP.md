# ROADMAP

[English](./ROADMAP.md) | [简体中文](./ROADMAP.zh-CN.md)

What `pi-think-different` is, what it is not, and what gets built next.

## Where it stands (v1.0.0)

Two working layers per paradigm:

| Layer | Mechanism | Cost | Status |
|---|---|---|---|
| Injected contract | `/think <paradigm>` writes a `<thinking_paradigm>` section into the system prompt | one prompt section | shipped, verified live |
| Real workflow | `think({mode:"run"})` runs the paradigm as separate model calls; the harness parses reported scores and prunes in code | 3-6 model calls | shipped, verified live |

Nine paradigms shipped - `cot`, `tot`, `got`, `critique`, `hypothesis`, `hats`, `debate`,
`first-principles`, `angles` - each with a scaffold contract, a step workflow, verbatim required markers,
and a live check that runs a real `pi --mode json` session and fails if a marker is missing.

Controls shipped:

- `/think` (status and picker), `list`, `off`, `once`, `<paradigm>`, `[intensity]`, `[task]`, `config`.
- Prose arguments: a `/think` line that reads like a sentence resolves the paradigm from its cue, keeps
  the rest as the task, and refuses to guess when two paradigms are named.
- A `/think` call that carries a task starts the turn itself, so the answer arrives in the same command.
- `auto` (always commits to a paradigm, never none) and `random` (a different paradigm every turn).
- `--think <paradigm>` for headless and scripted sessions.
- `light | standard | deep` intensities.
- `lang en|zh` for the interface language, `placement answer|thinking` for where the structure lives
  (`thinking` is the default, with `language: "en"`).
- Argument completions whose values replace the typed argument span.
- Status-line indicator carrying the active paradigm's own icon, including the paradigm auto or random
  actually armed for this turn.
- Session state persisted as a session entry and rebuilt from the current branch, so branching,
  `/reload`, and resume stay consistent.
- Config layering: `config.json` < `<agentDir>/pi-think-different.json` < `.pi/pi-think-different.json`
  < CLI flag < `/think`.
- Contributed skill (`skills/think-different/SKILL.md`) resolved from the extension directory.

Rendering shipped: the model writes markers verbatim, the harness shows bold labels in the session
language and never a marker token, no paradigm is rendered as a `###` heading, and `hats` is shown exactly
as the model wrote it.

Compliance shipped: while a paradigm is active every reply uses it - including trivial ones - stated in
the contract and the skill rather than policed by a redo loop.

Test coverage shipped: 91 unit tests over the pure modules, and 18 live cases (9 paradigms, the `think`
tool in run mode, and 8 option cases: language, prose `/think`, `startup` from the project config,
`startup` from the agent-level config, `thinking` placement, `random` switching, and the trivial-prompt
mandate). Live cases run in scratch directories so a real user's own config layer cannot change a verdict.

## Definition of "works"

A paradigm is done only when all of these hold:

1. Its contract names operators the paradigm actually has (branches and pruning for ToT, elimination for
   hypothesis, one hat per section for hats) - not generic "think harder" language.
2. Its required markers are listed verbatim in the injected contract.
3. A real Pi run produces those markers. `node tests/livecheck.mjs <paradigm>` is the arbiter.
4. A harness-driven run mode exists and its pruning/merge decision is computed in code, not asserted by
   the model.
5. Unit tests cover its workflow against a scripted fake model.
6. Its cues resolve back to it: wording that names the paradigm selects it, in `/think` and in `auto`.

Anything that only "looks thoughtful" in one transcript does not count.

## Next: make compliance measurable

- **Marker compliance telemetry.** Record which paradigm ran, at what intensity, and whether its markers
  appeared, as a session entry. Today compliance is only visible from outside, via livecheck.
- **Mandate compliance rate.** The trivial-prompt case measures one prompt. Run a fixed set of short
  prompts against each paradigm and report how often the structure actually appears - that is the number
  the mandate clause is supposed to move.
- **Auto-selection accuracy.** `auto` is scored by keyword and shape signals. Build a labelled prompt set
  (each prompt with the paradigm a human would pick) and report the hit rate per paradigm instead of
  eyeballing cases.
- **Degraded versus absent.** A run that merges two hat sections or renames a marker is a different
  failure from one that ignored the paradigm. Report both separately so a flake is not mistaken for a
  broken paradigm.

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

- **Score gate calibration.** Pruning keeps candidates scoring 6+. That threshold was picked, not
  measured. Collect scores from live runs and check whether the gate keeps the eventual winner.
- **Cross-paradigm comparison.** Same task, two paradigms, diff the answers. Right now there is no way to
  know whether ToT beat `angles` on a given problem class.
- **Intensity measured, not guessed.** `light` is a smaller character budget and fewer branches. Compare
  answer quality against budget on a fixed task set.
- **Cost reporting.** Show tokens spent by `mode: "run"` per paradigm, so "use run mode when the answer
  matters" comes with a number instead of a vibe.
- **Run-mode resume.** `only:` reruns one step today; persist step outputs so an interrupted workflow
  resumes from the last completed step instead of restarting.
- **Deterministic tool path.** The run-mode live check depends on the outer model choosing to call `think`.
  Add a way to force a workflow run from the command layer so the workflow can be verified without model
  cooperation.

## Non-goals

- Not a model-routing or thinking-level control. `--think` here selects a *paradigm*, not reasoning effort;
  Pi's own thinking levels stay in charge of that.
- Not a memory or knowledge system. Paradigms shape reasoning; they do not store it.
- Not a general agent framework. No sub-agents, no orchestration graph, no background workers.
- Not prompt-optimisation for one model. Contracts are written to survive weaker models, which is why
  pruning lives in code.
- Not a renderer with user-chosen styles. Labels are bold text in the session language; `hats` is
  verbatim. That is settled, not a preference to expose.

## Open bugs found by pure-function probes (2026-10-14)

Found by driving the pure modules with realistic model output - not by running Pi. Every one is reachable
in normal use, and none of them is covered by the 91 unit tests, so a green suite is not evidence of
correctness here. Reported without fixes: each fix changes visible behaviour and needs its own decision
plus a regression test.

**1. A task word hijacks the `/think` command.** `parseThinkArgs` (`src/render.ts`) accepts
`help | list | status | off | auto | random | once | config | lang | placement` as a sub-command wherever
the token appears, even after the paradigm token. The keyword wins, the paradigm is never applied, and the
session state may change as a side effect:

```text
/think hats off the record on pricing        -> action=off      the paradigm is turned off
/think debate config drift in prod           -> action=config   prints config paths only
/think angles list the risks of the plan     -> action=list     prints the catalogue only
/think cot status report for the migration   -> action=status
/think first-principles auto scaling limits  -> action=auto     switches to auto mode
```

Fix direction: recognise command keywords only at token index 0. `lang zh`, `placement thinking`,
`auto deep`, and `once hats deep` all keep working; nothing in the current suite depends on a keyword in a
later position. Intensity tokens are a milder version of the same problem (`/think cot deep dive into the
parser` silently loses "deep") and are usually harmless because that reading is the intended one.

**2. `placement: "answer"` deletes the first line of a section.** The `labelOnly` test in
`naturalizeMarkers` (`src/placement.ts`) treats a section's first line as a redundant label when it is
under 48 characters and contains none of `。！？!?;，,` - and ASCII `.` is not in that set, so the only real
discriminator is length. A short sentence of body text is then dropped from the answer the user reads:

```text
<thought_tree>
[Branch_A] cron plus a lock file     <- 46 chars: deleted
Score: 8/10
</thought_tree>

<angle:system>
The scheduler is the only writer of the queue.   <- 46 chars: deleted
Two hosts means two clocks that can disagree.    <- 51 chars: kept
</angle:system>
```

Fix direction: drop the length heuristic. Treat the first line as a label only when it is genuinely a
label - a `#{1,6}` heading, an explicit `Black: risk - …` prefix (already handled), or text that is
redundant with the heading about to be printed.

**3. `placement: "thinking"` corrupts text when spans nest.** The dedup filter in `extractStructure`
compares each span only with the immediately previous sorted span instead of the running maximum end, so
the *second* span nested inside an outer one survives. Cutting spans from the back then slices the already
shortened string with stale offsets:

```text
input:  Intro prose that must survive. / <draft> ... <criticism>x</criticism> ... <refinement>y</refinement> ... </draft> / Closing prose that must survive.
structure: <draft> ... Closing prose that must s      <- prose swallowed into the thinking block
answer:    Intro prose that must survive. / urvive.   <- word fragment left behind
```

The same mechanism splits a hats section when one hat's body mentions another hat's emoji
(`⚪ Facts: the ⚫ black hat is the one people skip`): the section is cut mid-way and its second line stays
in the visible answer while the rest moves to thinking. Fix direction: compare against the running maximum
end, in `extractStructure` and in the identical filter inside `naturalizeMarkers`.

**4. `injectedParadigm` is never cleared.** `src/index.ts` assigns it in `before_agent_start` and nowhere
resets it, so after `/think off` - or once `/think once <paradigm>` has been consumed - the next turn gets
no contract injected but `message_end` still applies that paradigm's placement and debris rules to a plain
answer. `cot` is the worst case: `<answer>` and `<reasoning>` are stripped from ordinary prose, including
from a code block that quotes them.

**5. Run-mode score parsing is loose.** `extractScores` accepts any `n/10` on a line, so prose containing
"8/10 timeouts" or a date produces a phantom candidate and the gate note tells the next step to "Build only
on: item-1 (8/10)". Conversely, a bracketed label on its own line followed by several `Score: n/10` lines
yields one entry (labels are deduplicated), so the later scores are silently ignored.

**6. Two cosmetic reporting gaps.** The `think` tool reports `cost` as all zeros while its token totals
are real, and one step template in `paradigms.ts` already contains `{{limits}}`, so `runWorkflow` prints
the harness budget line twice for that step.

## Known rough edges

- Marker checks are strict, and strictness is deliberate: a paradigm that degrades into prose must fail
  loudly. The cost is occasional flakiness on emoji-marked paradigms, so a `missing markers` verdict is
  retried once and the better attempt is kept.
- `<answer>` is unwrapped by the harness without a replacement label, so it cannot be asserted as a token
  in a rendered answer. The live check asserts the structural markers and then that a conclusion survives
  the structure.
- Live checks are slow and cost real tokens: 18 cases are roughly 20-30 minutes of real Pi sessions across
  a pool of concurrent runs. Unit tests are the fast loop; livecheck is the gate before a release.
- `auto` selection is keyword-and-signal heuristics. It will mis-pick on prompts that mix shapes
  ("refactor this broken thing and pick a new design"), which is why wording that names a paradigm
  outranks the scoring.
- Nested `mode: "run"` calls inherit no tool access, so workflow steps cannot read files. They think about
  what they already know.

## Verification commands

```bash
node --test tests/selftest.ts                 # fast, offline, no model
node tests/livecheck.mjs                      # all paradigms + options + think(mode:"run")
node tests/livecheck.mjs tot hats             # subset
node tests/livecheck.mjs options              # config startup, language, placement, prose /think
node tests/livecheck.mjs tool                 # only the multi-call tool case
npm run check                           # both
```
