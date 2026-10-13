---
name: scaffold-markers-need-tag-discipline
description: Models follow a thinking paradigm's substance but drop its XML tags unless the contract explicitly forbids substituting headings and code fences
type: lesson
---

The first live run of `/think tot` produced a textbook Tree-of-Thoughts answer - root goal, three
distinct branches, `Score: 8/10` per branch, an explicit `[Prune]`, and a one-level `[Explore]` - but
it wrapped everything in `## 🌳 Tree of Thoughts` inside a single code fence. The literal
`<thought_tree>` and `<answer>` tags were gone, so the marker-based live check failed even though the
paradigm had clearly run.

**Why.** A scaffold that *shows* tags in its example is not a scaffold that *requires* them. Models
treat XML-ish tags as a suggested style and reach for the Markdown idiom they use everywhere else
(heading + fenced block). Structure that is only implied is structure that quietly disappears, and
then it cannot be verified.

**How to apply.** State tag discipline explicitly in every injected contract:

> Tag discipline (this is verified mechanically): write each tag exactly as spelled, on its own line.
> Do not replace a tag with a heading, bold label, emoji, or table, and do not bury the entire
> structure inside one code fence. If the tags are missing, the paradigm counts as not run.

Keep the markers themselves strict rather than loosening the check to accept "a heading that looks
like the paradigm": the whole point of markers is that a paradigm which degrades into prose fails
loudly. When a live check fails, print the head and tail of the answer, not just the missing marker -
the difference between "model ignored the paradigm" and "model did the paradigm with different
punctuation" is only visible in the text.

Related: [[thinking-paradigm-two-mechanisms]], [[pi-extension-test-split]]
