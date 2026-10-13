---
name: pi-extension-test-split
description: How to test a Pi extension - pure logic under `node --test` on .ts directly, plus a separate live check that spawns real `pi --mode json` runs
type: lesson
---

Pi extension code splits cleanly into two testable halves, and each half needs a different harness.

**Pure logic: `node --test selftest.ts`.** Node 23+ strips TypeScript types natively, so a Pi
extension's pure modules (registries, prompt renderers, parsers, workflow engines) can be imported
directly by `node --test` with no build step and no jiti. Keep those modules free of Pi imports
(`import type` is fine), and the tests run offline in milliseconds. Inject the model call as a
function parameter (`ModelCall`) so the workflow engine can be tested against a scripted fake model -
that is what makes step order, prior-step threading, caps, and pruning testable at all.

**Extension wiring: a live check.** Command handlers, event handlers, tool registration, and prompt
injection cannot be unit tested without a Pi runtime. Instead spawn real headless runs:

```bash
pi --mode json --think tot -p "<prompt that only fits that shape>"
```

Parse stdout as strict JSONL (split on LF only; `readline` mis-handles Unicode separators), collect
`message_end` records with `role === "assistant"`, and assert the structural markers the extension is
supposed to produce. Diagnostics land on stderr; extension load errors show up there too.

**Why.** Type-checking an extension against the Pi API in an editor is unreliable (the extension
directory has no `node_modules` for `@earendil-works/*`), so "the LSP says cannot find module" is
usually noise, not a bug. Only a real Pi run proves the extension loads, registers its command/tool,
and that the model obeys the injected contract.

**How to apply.** Ship both: `node --test selftest.ts` for the logic and `node livecheck.mjs` for the
behavior. Keep the live prompts short and self-contained so a failure means the paradigm contract
failed, not that the model went exploring the repository.

**Live checks need a pool and streaming output.** Nine sequential real Pi runs blew a 1500 s budget and
printed nothing until the end, so a timeout left zero evidence. Run cases through a small worker pool
(`LIVECHECK_CONCURRENCY`, 3 by default) and print each verdict the moment it lands. A check harness
that reports only at the end is unusable under a timeout.

**Budget the multi-call case separately.** A single scaffolded answer finishes in well under 420 s, but
the `think(mode:"run")` case nests three model calls inside one Pi turn and needs roughly 3x that.
Give chained cases their own multiplier instead of raising the global timeout, otherwise a slow chained
case masks fast single-pass failures.

Related: [[thinking-paradigm-two-mechanisms]]
