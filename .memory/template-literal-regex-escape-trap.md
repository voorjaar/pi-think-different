---
name: template-literal-regex-escape-trap
description: \b and \s inside a JS string or template literal collapse to a backspace / bare letter, so string-built regexes need \\b and \\s - a hats hat-word matcher silently matched nothing
type: lesson
---

`canonicalForAlias` built its word patterns as:

```ts
new RegExp(`\b${escapeRegExp(word)}\b`, "i")   // file literally contained \b
```

Every test returned false: inside a string or template literal `\b` is the escape for **U+0008** and `\s`
is just `s`, so the pattern was `␈black␈` and never matched a heading line. The symptom was a wrong
rendering (`🔵 Black: risk` → 「蓝帽：流程与控制」) with no error anywhere, and a debug print of the
loop showing `word black false` while a hand-run `/black/i` matched the same line.

**How to apply.** In string-built regexes always write `\\b`, `\\s`, `\\w`:

```ts
new RegExp(`\\b${escapeRegExp(word)}\\b`, "i")
```

Two audits worth running on any repo that composes regexes from strings:

```bash
grep -rn 'new RegExp(`' *.ts | grep -v '\\\\\['     # template-literal regexes
grep -rn 'new RegExp("' *.ts
```

`placement.ts` had the same trap in `new RegExp(`^${escapeRegExp(openTag[0])}\s*`)`, which stripped
"<tag>" followed by zero-or-more letter `s` instead of whitespace - harmless-looking, wrong anyway.
Regex *literals* (`/\berror:/i`) are unaffected; only string and template sources are.

When a matcher returns false for an input you can see matches by hand, print `pattern.source` and
`pattern.flags` - invisible control characters show up there immediately.

Related: [[hats-markers-are-fixed-emoji-colour-mapping]], [[scaffold-markers-need-tag-discipline]]
