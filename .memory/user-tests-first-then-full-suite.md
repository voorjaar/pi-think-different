---
name: user-tests-first-then-full-suite
description: In pi-think-different, every change is handed to the user for their own manual test before running the full livecheck suite
type: preference
---

The user set a workflow rule for this project (2026-10-14): **"从现在开始当前项目所有修改都先让我测试，再全量测试"**
- from now on, every modification goes to them for a manual test first, and only after that does the
  full live check run.

**Why it matters here.** `node livecheck.mjs` costs 15-30 minutes of real Pi sessions and its verdicts
are noisy under concurrency (timeouts, one dropped marker). Running it after every small change wastes
that budget and buries the signal. The user also tests in their own real session - with their own
`~/.pi/agent/pi-think-different.json` (`placement: "thinking"`, `language: "zh"`) - which is exactly the
environment a hermetic scratch-cwd suite deliberately excludes. Their test is the integration test the
suite cannot be.

**How to apply.** After a change: run `node --test selftest.ts` (milliseconds, deterministic), describe
precisely what to try and what the correct behaviour looks like, then **stop and wait for their
verdict**. Do not launch `node livecheck.mjs` in the same turn as a hand-off. When they confirm, run
the full suite once and commit.

Related: [[pi-extension-test-split]], [[think-options-language-and-placement]]
