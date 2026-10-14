---
name: skill-paths-resolve-against-session-cwd
description: resources_discover skillPaths are resolved against the session cwd, so an extension's bundled skill must be addressed from import.meta.url
type: lesson
---

`pi.on("resources_discover", () => ({ skillPaths: ["skills/think-different/SKILL.md"] }))` looked
correct and produced `skill path does not exist` for `~/Projects/skills/think-different/SKILL.md` in
every session that did not happen to run inside the extension's own folder. Pi resolves each raw path
with `resolvePath(rawPath, resolvedCwd)` (see `core/skills.js`), so a relative path is a path inside
whatever directory the user started Pi in - not inside the extension.

**Why.** Extension code feels like it lives in its own package, but its runtime working directory is
the user's project. Any relative asset path in an extension (skill, template, prompt file) silently
becomes cwd-relative, which works during development and breaks everywhere else.

**How to apply.** Anchor extension-owned assets to the module itself:

```ts
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SKILL_PATH = join(dirname(fileURLToPath(import.meta.url)), "skills", "think-different", "SKILL.md");
pi.on("resources_discover", async () => ({ skillPaths: [SKILL_PATH] }));
```

Verify it the way the failure appeared: run a headless session from an unrelated cwd
(`cd /tmp && pi --mode json -p "..."`) and check that no `skill path does not exist` diagnostic is
reported and the skill name appears in the session's system prompt. A unit test can pin the invariant
cheaply by asserting the asset exists next to `import.meta.url` of the test file in the same directory.

Related: [[pi-extension-test-split]]
