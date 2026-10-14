---
name: hats-markers-are-fixed-emoji-colour-mapping
description: hats keeps emoji markers with a registry-fixed colour mapping (⚪白 ⚫黑 🔵蓝 …), is rendered verbatim with no `###` heading replacement, and must always use all six hats
type: decision
---

A `hats` session with `placement: "thinking"` showed the model's own structure in the Thinking block:

```text
🟡 Yellow: value — shrimp brings 鲜味 …
🔵 Black: risk — 虾仁腥/老/橡皮 …        ← black hat, blue circle
🟡/🔵 Blue: control — decision …          ← two circles on one label
Then <answer>.
```

The paradigm had run correctly; only the colour attached to each hat was wrong.

**The chosen fix.** An earlier iteration replaced the emoji with `<hat:white>` … `<hat:blue>` tags. The
user rejected that: **不要模型使用标记，还是用原来的 emoji，固定下来，每个颜色对应哪个 emoji** - the emoji
is the marker, and the registry, not the model, decides which circle means which hat. Tags as markers also
made "the model wrote tags, the harness matched emoji" mismatches possible mid-session.

**How to apply.**

- `markers: ["⚪", "🔴", "⚫", "🟡", "🟢", "🔵", "<answer>"]`, and the contract body prints the mapping as a
  table plus the sentence "the section marker is the emoji on the left … never substitute a different
  circle, a colour word, or a heading for it".
- **`verbatimMarkers: true` — no heading replacement for hats.** The harness used to rewrite each section as
  `### ⚫ 黑帽：风险与批判`; the user rejected that too: **不要执行替换修复了, ### 标记的效果不好** and chose
  "模型原样" for how a hat should look. `naturalizeMarkers` (and `naturalizeThinkingBlocks`, which now returns
  the block untouched) leaves the model's own line — `⚫ Black: risk - …` — exactly as written. Bracketed tag
  syntax is still stripped, because the user asked for emoji rather than tags.
- **No paradigm renders `###` headings.** The next message was **其他思考方式 ### 也不要替换成中文了**, and the
  follow-up chose the replacement style: **不要用###，也许可以换成加粗 **, 另外英文的时候要替换成对应的英文**.
  So non-verbatim paradigms render each section as a **bold label** (`<angle:adversary>` → `**对手视角**` in a
  Chinese session, `**Adversary angle**` in an English one). `markerHeading(marker, language)` already picks
  the variant by session language; a unit test now asserts no generated `#{1,6} ` heading anywhere, that every
  English-session label is CJK-free, and that every Chinese-session label contains CJK.
- **All six hats, every time.** The user asked for this to be stated in the skill: **在skill里面强调下每次必须
  使用六顶帽子,不要遗漏**. `skills/think-different/SKILL.md` opens its rules list with it (skipping 🟡 or
  stopping before 🔵 "is not a shorter hats run: it is a different paradigm"), and the hats contract carries
  the same sentence in `body` and `compact`. Blue is named as the hat a rushed answer drops.
- `markerAliases` maps the **tag form back to the emoji** (`"<hat:black>": "⚫"`). It is still needed: span
  recognition (`extractStructure`, so `placement: "thinking"` can move the six sections out of the answer) and
  debris cleanup both go through it, even though the alias no longer drives any relabelling.
- `stripMarkerDebris` must receive `markerTokens(paradigm)` (markers **and** alias tags), or a stray
  `</hat:black>` survives in the answer.

**Span rules six-section paradigms need** (`findSectionSpan`, still used by `extractStructure`):

- An unclosed section ends at the next section token - nobody closes six sections.
- A line prefix that is only `#` and spaces is absorbed into the span, so a `### ⚫ Black Hat` line is one
  section and not two.
- The whole-line extension applies **only when the section token starts the line** (`🟡/🔵 Blue: …`), and
  end-of-text counts as the line end.
- `naturalizeThinkingBlocks` in `index.ts` heading-ises markers in **thinking** blocks for the paradigms that
  are not verbatim — with `placement: "thinking"` the thinking block is what the user reads there.

**Status bar.** `statusLabel` used a fixed `🧠` for every pinned paradigm, so the bar read `🧠 hats` while
the answer was wearing hats. The icon is now `paradigm.emoji` (`🎩 hats`, `🌳 random → tot`), and
`updateStatus` is called from `before_agent_start` so auto/random show the paradigm actually armed for this
turn instead of an empty `paradigmId`.

Related: [[scaffold-markers-need-tag-discipline]], [[think-options-language-and-placement]],
[[template-literal-regex-escape-trap]]
