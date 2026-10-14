---
name: auto-select-cjk-length-signal
description: /think auto never fired for Chinese prompts because prompt length was measured by whitespace words, so a whole CJK sentence counted as one word and took a -2 "very short prompt" penalty
type: lesson
---

`/think auto` scored every prompt against complexity signals plus a length signal. The length signal
was `prompt.trim().split(/\s+/).length`, and Chinese has no spaces between words: 「帮我看下这个离线方案靠不靠谱」
is **one** "word", so it took `very short prompt -2` and ended at score 1 against a threshold of 3.
Nearly every Chinese prompt failed, and because the non-confident path printed nothing, the mode looked
broken rather than merely under-scored.

**Why it stayed hidden.** The auto cases in `livecheck.mjs` used English prompts, and the unit tests
for `selectParadigm` were English too, so the scoring was only ever measured on text where the word
count is meaningful.

**How to apply.** Two rules now live in `autoSelect.ts`:

- Length is measured in mixed units: `whitespaceWords + CJKCharacters`, with thresholds 40 / 18 / 6.
- The complexity signals come in pairs - an English word-boundary pattern and a CJK pattern
  (`为什么|怎么办|如何|要不要`, `报错|失败|崩溃|异常|偶发|超时`, `设计|架构|重构|迁移|选型|评估|对比`,
  `权衡|取舍|利弊|替代|选项|方案`, `决定|决策|采纳`). A heuristic keyword table is only bilingual if the
  patterns themselves are.

And in `index.ts`: when auto mode is armed but scores the prompt below the threshold, it now notifies
`autoSelectionSkippedMessage` with the score and reasons. An armed mode that silently selects nothing
is indistinguishable from a broken mode.

Any heuristic scored by *words* must be tested with CJK prompts - a language without spaces breaks
word-based thresholds silently.

Related: [[think-prose-cue-matching]], [[think-options-language-and-placement]], [[pi-extension-test-split]]
