/**
 * Thinking paradigm registry for pi-think-different.
 *
 * Pure data + pure functions: no Pi imports, so the registry can be unit tested
 * directly with `node --test` and reused by the workflow engine.
 *
 * Each paradigm carries:
 * - `body` / `compact`: the instruction block injected into the system prompt.
 * - `markers`: the structural blocks the model must emit. Used by the injected
 *   contract, by `think` tool output, and by tests to check the paradigm actually ran.
 * - `steps`: a real multi-pass workflow (separate model calls, external control),
 *   used by `think` with `mode: "run"`. This is the "code-driven" path: the model
 *   does not have to imagine the tree, the harness drives it.
 */

export type Intensity = "light" | "standard" | "deep";

export interface ParadigmStep {
	/** Stable step id, usable as `only: [...]` and in tests. */
	id: string;
	/** Human/model readable label used when threading prior output. */
	label: string;
	/** System prompt for this step's model call. */
	system: string;
	/** User prompt template. Placeholders: {{task}} {{last}} {{all}} {{limits}} {{gate}} */
	user: string;
	/** After this step, parse `Score: n/10` style scores and gate low scorers externally. */
	scoreGate?: boolean;
	/** Soft cap on this step's output characters. */
	maxChars?: number;
}

export interface Paradigm {
	id: string;
	title: string;
	/** Chinese label for the picker UI; the user's own vocabulary. */
	titleZh: string;
	emoji: string;
	aliases: string[];
	/**
	 * Phrases users actually write when they mean this paradigm. Used by
	 * `nlmatch.ts` so `/think 以六顶思考帽的方式思考…` resolves without an explicit token.
	 */
	cues?: string[];
	/** One-line summary shown in `/think list` and the picker. */
	summary: string;
	summaryZh: string;
	/** When this paradigm pays for itself. */
	bestFor: string;
	bestForZh: string;
	/** Structural blocks the model must emit. */
	markers: string[];
	/**
	 * Show this paradigm's markers to the user exactly as the model wrote them instead of rewriting each
	 * section as a natural-language heading. Used by `hats`: its emoji labels are the readable form, and a
	 * generated `###` heading above every section reads worse than the line the model already wrote.
	 */
	verbatimMarkers?: boolean;
	/**
	 * Alternative tokens a model commonly writes instead of a declared marker, mapped to the marker they
	 * stand for. They are recognised for extraction and rendering (the heading comes from the canonical
	 * marker), but they are never required by a check - a paradigm is verified by its `markers`.
	 */
	markerAliases?: Record<string, string>;
	/**
	 * Words a model writes in a section heading that say which section it meant. Used only to re-label a
	 * section that was matched through `markerAliases`: when a model writes the wrong colour emoji next to
	 * the right hat name, the name wins and the heading gets the colour this table declares.
	 */
	markerHeadingWords?: Record<string, string>;
	limits: { branches: number; depth: number };
	/** Rough cost, so the user can pick a paradigm knowingly. */
	cost: string;
	costZh: string;
	/** Full instruction block. */
	body: string;
	/** Compact one-paragraph instruction for `intensity: light`. */
	compact: string;
	/** Extra guidance only for `intensity: deep`. */
	deep?: string;
	steps: ParadigmStep[];
	/** Auto-selection signals: matched against the user prompt. */
	keywords: string[];
	/** Phrases that mean "this prompt does not need a paradigm". */
	skipKeywords?: string[];
}

const SKIP_KEYWORDS = [
	"rename",
	"typo",
	"just print",
	"print the",
	"list the files",
	"git status",
	"what is the weather",
	"hello",
	"thanks",
	"谢谢",
	"你好",
];

const COMMON_SKIP = SKIP_KEYWORDS;

import type { Language } from "./config.ts";

/**
 * Natural-language headings for every structural marker.
 *
 * The model always writes the markers verbatim - that is what makes a paradigm verifiable. What the
 * user reads is the heading instead: `placement: "answer"` renders each marker section as a heading in
 * the session language, `placement: "thinking"` keeps the markers inside the thinking block. Either way
 * no `<angle:adversary>` or `</synthesis>` ever lands in the visible answer.
 *
 * Keys are the marker exactly as declared in `markers` (tags with brackets, hats as bare emoji).
 */
export const MARKER_HEADINGS: Record<string, [string, string]> = {
	"<reasoning>": ["Reasoning", "推理"],
	"<answer>": ["Answer", "结论"],
	"<thought_tree>": ["Thought tree", "思维树"],
	"<thought_graph>": ["Thought graph", "思维图"],
	"<draft>": ["Draft", "草稿"],
	"<criticism>": ["Criticism", "批评"],
	"<refinement>": ["Refinement", "修订"],
	"<hypothesis_matrix>": ["Hypothesis matrix", "假设矩阵"],
	"<validation_process>": ["Validation", "验证过程"],
	"⚪": ["⚪ White hat - facts and figures", "⚪ 白帽：事实与数据"],
	"🔴": ["🔴 Red hat - feelings and intuition", "🔴 红帽：感受与直觉"],
	"🔵": ["🔵 Blue hat - process and control", "🔵 蓝帽：流程与控制"],
	"🟡": ["🟡 Yellow hat - benefits and value", "🟡 黄帽：价值与收益"],
	"🟢": ["🟢 Green hat - alternatives and new ideas", "🟢 绿帽：替代方案与新想法"],
	"⚫": ["⚫ Black hat - risk and criticism", "⚫ 黑帽：风险与批判"],
	"<hat:white>": ["⚪ White hat - facts and figures", "⚪ 白帽：事实与数据"],
	"<hat:red>": ["🔴 Red hat - feelings and intuition", "🔴 红帽：感受与直觉"],
	"<hat:black>": ["⚫ Black hat - risk and criticism", "⚫ 黑帽：风险与批判"],
	"<hat:yellow>": ["🟡 Yellow hat - benefits and value", "🟡 黄帽：价值与收益"],
	"<hat:green>": ["🟢 Green hat - alternatives and new ideas", "🟢 绿帽：替代方案与新想法"],
	"<hat:blue>": ["🔵 Blue hat - process and control", "🔵 蓝帽：流程与控制"],
	"<advocate>": ["Advocate", "正方"],
	"<critic>": ["Critic", "反方"],
	"<rebuttal>": ["Rebuttal", "回应"],
	"<judge>": ["Judge", "裁判"],
	"<decomposition>": ["Decomposition", "拆解"],
	"<axioms>": ["First principles", "基本事实"],
	"<rebuild>": ["Rebuild", "重建"],
	"<angle:system>": ["System angle", "系统视角"],
	"<angle:adversary>": ["Adversary angle", "对手视角"],
	"<angle:pragmatist>": ["Pragmatist angle", "务实视角"],
	"<synthesis>": ["Synthesis", "综合"],
};

/** The natural-language heading for a marker, falling back to the marker name without brackets. */
export function markerHeading(marker: string, language: Language): string {
	const heading = MARKER_HEADINGS[marker];
	if (heading) return heading[language === "zh" ? 1 : 0];
	return marker.replace(/^<|>$/g, "");
}

export const PARADIGMS: Paradigm[] = [
	{
		id: "cot",
		title: "Chain of Thought",
		titleZh: "思维链",
		emoji: "🧠",
		aliases: ["chain", "chain-of-thought", "思维链"],
		cues: ["逐步思考", "一步一步", "拆开推理", "展开推理", "show your reasoning", "chain of reasoning", "step by step reasoning"],
		summary: "Explicit premises, decomposition, and self-checks before the answer.",
		summaryZh: "先列出前提、拆解问题、自检，然后才给答案。",
		bestFor: "General hard questions, calculations, anything where a silent wrong answer is expensive.",
		bestForZh: "一般难题、计算，以及错了却不明显的代价高的场合。",
		markers: ["<reasoning>", "<answer>"],
		limits: { branches: 1, depth: 1 },
		cost: "1 pass, cheap",
		costZh: "1 遍，开销低",
		keywords: ["why", "explain", "prove", "calculate", "step by step", "推导", "解释", "为什么"],
		skipKeywords: COMMON_SKIP,
		body: `Apply strict chain-of-thought before answering.

<reasoning>
1. Restate the goal and every hard constraint in your own words.
2. Separate what you actually verified from what you assumed.
3. Decompose into ordered sub-steps and solve them one at a time.
4. For each sub-step, name the check that would prove it wrong, then run that check.
5. Derive the conclusion from the sub-step results, not from intuition.
</reasoning>
<answer>
The conclusion, written so it stands on its own without the reasoning block.
</answer>`,
		compact:
			"Before answering, reason in a <reasoning> block: restate goal and constraints, separate verified facts from assumptions, decompose into sub-steps, self-check each step, then give a standalone <answer>.",
		deep: "Also state the one assumption whose failure would invalidate the whole chain, and what you would test first to confirm it.",
		steps: [
			{
				id: "reason",
				label: "Reasoning",
				system: "You are a rigorous reasoner. Produce only a <reasoning> block: restate goal and constraints, separate verified facts from assumptions, decompose into ordered sub-steps, solve each, and self-check every sub-step.",
				user: "{{task}}",
			},
			{
				id: "answer",
				label: "Answer",
				system: "You write the final answer. Use the supplied reasoning; do not restate it. Produce only an <answer> block that stands on its own.",
				user: "{{task}}\n\nPrior reasoning:\n{{last}}",
			},
		],
	},
	{
		id: "tot",
		title: "Tree of Thoughts",
		titleZh: "思维树",
		emoji: "🌳",
		aliases: ["tree", "tree-of-thoughts", "思维树", "bfs", "dfs"],
		cues: ["思维树", "分叉探索", "多方案比较", "比较几种方案", "几条路线分别", "tree of thoughts", "branch and score", "explore alternatives"],
		summary: "Branch several distinct approaches, score them, prune, backtrack.",
		summaryZh: "分出多条真正不同的路线，打分、剪枝、回溯。",
		bestFor: "Design choices, algorithms, planning, anything with more than one viable route.",
		bestForZh: "设计选型、算法、规划，凡是有不止一条可行路线的问题。",
		markers: ["<thought_tree>", "<answer>"],
		limits: { branches: 3, depth: 2 },
		cost: "1 pass scaffolded / 4 model calls in run mode",
		costZh: "注入契约 1 遍 / run 模式 4 次模型调用",
		keywords: ["approach", "options", "alternative", "design", "plan", "algorithm", "方案", "选型", "设计", "思路"],
		skipKeywords: COMMON_SKIP,
		body: `Apply Tree-of-Thoughts: branch, score, prune, backtrack.

<thought_tree>
[Root] Goal and hard constraints.
  |-- [Branch_A] first distinct approach | Score: x/10 - reason
  |-- [Branch_B] second distinct approach | Score: x/10 - reason
  └-- [Branch_C] third distinct approach | Score: x/10 - reason
[Prune] Name every branch scored below 6 and why it dies.
[Explore] Deepen the best surviving branch by one level: sub-options, each scored.
[Backtrack] If the chosen path hits a dead end, drop to the next-highest branch and say so.
[Path] Root -> ... -> chosen leaf.
</thought_tree>
<answer>
The answer that follows from the chosen path only.
</answer>

Rules: at most {{branches}} first-level branches, at most {{depth}} levels deep. Branches must be genuinely different strategies, not wording variants. Score a branch before exploring it, never after.`,
		compact:
			"Apply Tree-of-Thoughts in a <thought_tree> block: root goal and constraints, 2-3 genuinely different branches each with Score: x/10, prune branches under 6, explore the best branch one level deeper, backtrack if it dead-ends, lock the path, then give the <answer>.",
		deep: "Explore the second-best branch as well, and state the observation that would make you switch paths.",
		steps: [
			{
				id: "branch",
				label: "Branch",
				system: "You generate distinct candidate approaches. Output one line per candidate: '[Branch_X] <approach> | Score: n/10 - <reason>'. No answer yet.",
				user: "{{task}}\n\nGenerate at most {{branches}} genuinely different approaches and score each immediately.",
				scoreGate: true,
			},
			{
				id: "explore",
				label: "Explore",
				system: "You deepen the strongest surviving candidate by one level. Output sub-options as '[Branch_X.Y] <step> | Score: n/10 - <reason>', plus any dead end you hit.",
				user: "{{task}}\n\nCandidates and scores:\n{{last}}\n{{gate}}\nDeepen only the surviving candidates.",
				scoreGate: true,
			},
			{
				id: "converge",
				label: "Converge",
				system: "You lock the winning path and write the answer. Output a '[Path] Root -> ... -> leaf' line, then an <answer> block.",
				user: "{{task}}\n\nBranch stage:\n{{all}}\nPick the best path (backtrack if it dead-ends) and answer.",
			},
		],
	},
	{
		id: "got",
		title: "Graph of Thoughts",
		titleZh: "思维网",
		emoji: "🕸️",
		aliases: ["graph", "graph-of-thoughts", "思维网", "merge"],
		cues: ["思维图", "思维网络", "节点合并", "交叉校验", "graph of thoughts", "merge nodes", "cross-validate"],
		summary: "Independent nodes, then merge, cross-check, and refine them.",
		summaryZh: "先生成互相独立的节点，再合并、交叉校验、精炼。",
		bestFor: "Multi-module work: integrating parts, cross-validating sources, combining designs.",
		bestForZh: "多模块工作：整合各部分、交叉验证来源、合并设计。",
		markers: ["<thought_graph>", "<answer>"],
		limits: { branches: 3, depth: 2 },
		cost: "1 pass scaffolded / 3 model calls in run mode",
		costZh: "注入契约 1 遍 / run 模式 3 次模型调用",
		keywords: ["integrate", "combine", "merge", "cross-check", "interface", "consolidate", "整合", "打通", "交叉验证"],
		skipKeywords: COMMON_SKIP,
		body: `Apply Graph-of-Thoughts: generate independent nodes, then merge and cross-check them.

<thought_graph>
[Generation] [Node_A] <one angle> ; [Node_B] <a different angle, not a rephrasing>.
[Aggregation] Merge([Node_A], [Node_B]) -> [Node_C]: state exactly what each node contributes to the merge.
[Cross-check] Feed [Node_C] back against [Node_A] and [Node_B]; name every conflict, gap, or missing field.
[Refinement] Refine(...) -> [Node_Final]: the corrected node after resolving the conflicts.
[Converge] Lock [Node_Final] as the sole basis of the answer.
</thought_graph>
<answer>
The merged result.
</answer>`,
		compact:
			"Apply Graph-of-Thoughts in a <thought_graph> block: two independent nodes from different angles, Merge(...) -> a combined node, cross-check it against both originals and name conflicts, Refine to a final node, then give the <answer>.",
		deep: "Add a third node from an angle neither of the first two considered, and re-merge.",
		steps: [
			{
				id: "nodes",
				label: "Nodes",
				system: "You produce independent solution nodes from genuinely different angles. Output '[Node_A] ...' and '[Node_B] ...'. Do not combine them yet.",
				user: "{{task}}",
			},
			{
				id: "merge",
				label: "Merge & cross-check",
				system: "You merge nodes and cross-check the merge. Output 'Merge([Node_A], [Node_B]) -> [Node_C]', then list every conflict, gap, or missing field you find when checking [Node_C] against the originals.",
				user: "{{task}}\n\nNodes:\n{{last}}",
			},
			{
				id: "converge",
				label: "Converge",
				system: "You resolve the conflicts into a final node and write the answer. Output 'Refine(...) -> [Node_Final]' then an <answer> block.",
				user: "{{task}}\n\nStage history:\n{{all}}",
			},
		],
	},
	{
		id: "critique",
		title: "Self-Critique Loop",
		titleZh: "自我批判修正",
		emoji: "🔍",
		aliases: ["self-critique", "self-correction", "critic", "自我修正", "自我批判", "红队"],
		cues: ["自我批判", "自我批评", "挑毛病", "找问题", "再审一遍", "self critique", "critique my", "attack your own"],
		summary: "Draft, attack your own draft hardest, then rebuild it.",
		summaryZh: "先起草，再最狠地攻击自己的草稿，然后重建。",
		bestFor: "Code you are about to ship, calculations, claims, prose logic.",
		bestForZh: "即将交付的代码、计算、论断、文字逻辑。",
		markers: ["<draft>", "<criticism>", "<refinement>", "<answer>"],
		limits: { branches: 1, depth: 1 },
		cost: "1 pass scaffolded / 3 model calls in run mode",
		costZh: "注入契约 1 遍 / run 模式 3 次模型调用",
		keywords: ["review", "bug", "fix", "correct", "robust", "edge case", "audit", "检查", "评审", "有没有问题", "对不对"],
		skipKeywords: COMMON_SKIP,
		body: `Run a critique loop on your own answer.

<draft>
Your first-pass answer.
</draft>
<criticism>
Become the harshest reviewer of <draft>. Name at least 3 concrete failure modes: wrong assumptions, missing edge cases, off-by-one or empty/null handling, contract mismatches, security or concurrency traps, unstated preconditions. Do not soften: no "consider adding". If the draft is genuinely solid, attack its weakest boundary instead.
</criticism>
<refinement>
Rebuild the answer so every criticism is closed. State what changed and why.
</refinement>
<answer>
The final version only.
</answer>`,
		compact:
			"Run a critique loop: <draft> first pass, <criticism> naming at least 3 concrete failure modes of that draft, <refinement> rebuilding the answer to close them, then <answer> with the final version.",
		deep: "Run a second critique pass on <refinement> before the <answer>, and report anything the first pass missed.",
		steps: [
			{
				id: "draft",
				label: "Draft",
				system: "You produce a first-pass answer. Be complete but unpolished. Output a <draft> block only.",
				user: "{{task}}",
			},
			{
				id: "criticism",
				label: "Criticism",
				system: "You are the harshest reviewer. Attack the draft: name at least 3 concrete failure modes, missing edge cases, or wrong assumptions. No praise. Output a <criticism> block only.",
				user: "{{task}}\n\nDraft under review:\n{{last}}",
			},
			{
				id: "refinement",
				label: "Refinement",
				system: "You rebuild the answer so every criticism is closed. Output a <refinement> block, then an <answer> block with the final version.",
				user: "{{task}}\n\nDraft:\n{{all}}",
			},
		],
	},
	{
		id: "hypothesis",
		title: "Hypothesis & Elimination",
		titleZh: "假设排他法",
		emoji: "🧪",
		aliases: ["elimination", "hypotheses", "diagnose", "debug", "排查", "假设", "归因", "定位"],
		cues: ["假设排除", "列出可能原因", "逐一排除", "可能的原因", "根因分析", "hypothesis and elimination", "rule out causes", "root cause analysis"],
		summary: "Enumerate falsifiable causes, eliminate them with evidence.",
		summaryZh: "列出可证伪的候选原因，用证据逐个排除。",
		bestFor: "Bugs, outages, flaky tests, 'why is this happening at all'.",
		bestForZh: "Bug、故障、偶发测试、「这到底到底为什么会发生」。",
		markers: ["<hypothesis_matrix>", "<validation_process>", "<answer>"],
		limits: { branches: 4, depth: 1 },
		cost: "1 pass scaffolded / 3 model calls in run mode",
		costZh: "注入契约 1 遍 / run 模式 3 次模型调用",
		keywords: ["why is it failing", "flaky", "intermittent", "root cause", "diagnose", "crash", "regression", "排查", "偶发", "根因"],
		skipKeywords: COMMON_SKIP,
		body: `Diagnose with hypothesis and elimination.

<hypothesis_matrix>
List 3-4 mutually exclusive, falsifiable candidate causes. Each as '[H1] <cause> - falsified by: <what evidence would kill it>'.
</hypothesis_matrix>
<validation_process>
Test each hypothesis one by one against the known facts, logs, and constraints. For each: state the evidence you have, the evidence you lack, and the verdict (eliminated / surviving / untested). Actually eliminate - do not keep every option alive.
</validation_process>
<answer>
The surviving cause, the confidence level, and the single cheapest next check that would confirm or kill it.
</answer>`,
		compact:
			"Diagnose via <hypothesis_matrix> (3-4 mutually exclusive falsifiable causes, each with its falsifying evidence), <validation_process> (test each against known facts and actually eliminate), then <answer> with the surviving cause plus the cheapest confirming check.",
		deep: "Add one hypothesis that would explain the symptoms even if all your current candidates are false.",
		steps: [
			{
				id: "hypotheses",
				label: "Hypotheses",
				system: "You enumerate mutually exclusive, falsifiable candidate causes. Output '[H1] <cause> - falsified by: <evidence>' lines only.",
				user: "{{task}}\n\nList at most {{branches}} candidate causes.",
			},
			{
				id: "validate",
				label: "Validate",
				system: "You stress-test each hypothesis against the known facts and give a verdict: eliminated, surviving, or untested. Commit to eliminating at least one when the evidence allows.",
				user: "{{task}}\n\nHypotheses:\n{{last}}",
				scoreGate: true,
			},
			{
				id: "conclude",
				label: "Conclusion",
				system: "You state the surviving cause, its confidence level, and the single cheapest next check. Output an <answer> block.",
				user: "{{task}}\n\nFull history:\n{{all}}",
			},
		],
	},
	{
		id: "hats",
		title: "Six Thinking Hats",
		titleZh: "六顶思考帽",
		emoji: "🎩",
		aliases: ["six-hats", "de-bono", "六顶思考帽", "思考帽", "帽子"],
		cues: ["六顶思考帽", "六顶帽子", "六个帽子", "德博诺", "six thinking hats", "six hats", "de bono"],
		summary: "Six separate lenses: facts, feeling, risk, value, alternatives, decision.",
		summaryZh: "六个独立的视角：事实、直觉、风险、价值、替代方案、决策。",
		bestFor: "Decisions, proposals, adoption calls, product and process trade-offs.",
		bestForZh: "决策、方案、要不要采纳、产品与流程上的取舍。",
		markers: ["⚪", "🔴", "⚫", "🟡", "🟢", "🔵", "<answer>"],
		verbatimMarkers: true,
		// The colour is fixed by this registry, not chosen by the model: one emoji per hat, and the tag form
		// an earlier contract used is accepted as the same section so a session mid-switch still renders.
		markerAliases: {
			"<hat:white>": "⚪",
			"<hat:red>": "🔴",
			"<hat:black>": "⚫",
			"<hat:yellow>": "🟡",
			"<hat:green>": "🟢",
			"<hat:blue>": "🔵",
		},
		markerHeadingWords: {
			white: "⚪",
			facts: "⚪",
			red: "🔴",
			gut: "🔴",
			black: "⚫",
			risk: "⚫",
			yellow: "🟡",
			value: "🟡",
			green: "🟢",
			alternatives: "🟢",
			blue: "🔵",
			decision: "🔵",
			"白帽": "⚪",
			"事实": "⚪",
			"红帽": "🔴",
			"直觉": "🔴",
			"黑帽": "⚫",
			"风险": "⚫",
			"黄帽": "🟡",
			"价值": "🟡",
			"绿帽": "🟢",
			"替代": "🟢",
			"蓝帽": "🔵",
			"决策": "🔵",
		},
		limits: { branches: 1, depth: 1 },
		cost: "1 pass scaffolded / 6 model calls in run mode",
		costZh: "注入契约 1 遍 / run 模式 6 次模型调用",
		keywords: ["should we", "decision", "adopt", "propose", "trade-off", "worth it", "proposal", "要不要", "决策", "评估这个方案", "值不值"],
		skipKeywords: COMMON_SKIP,
		body: `Evaluate the matter through all six thinking hats, one hat at a time. Stay inside one hat per section; do not blend lenses.

The section marker is the emoji on the left. This mapping is fixed - ⚪ is the white hat, ⚫ is the black hat, 🔵 is the blue hat - so write the emoji exactly as printed and never substitute a different circle, a colour word, or a heading for it.

⚪ White hat (facts): what data is actually available, what is missing, what would have to be measured.
🔴 Red hat (gut): the honest emotional reaction of the people affected, with no justification.
⚫ Black hat (risk): the failure mode, the worst realistic outcome, the fatal flaw, who gets hurt.
🟡 Yellow hat (value): the best realistic outcome, the concrete benefit, why this could work.
🟢 Green hat (alternatives): at least two different ways to get the same goal, including a cheaper or smaller one.
🔵 Blue hat (control): the decision, the conditions that would change it, and the next actions with owners.

Six sections, one per hat, each starting with its own emoji from the table above. ⚫ Black is its own section even if risk already appeared under another hat: naming a risk somewhere else does not count as the black hat, and a hat you have little to say about still gets at least one line.

All six or none: skipping 🟡 because there is nothing optimistic to say, or stopping before 🔵 because the decision is already implied, is not a shorter hats run - it is a different paradigm, and it counts as the paradigm not having run.

<answer>
The decision and the next actions.
</answer>`,
		compact:
			"Evaluate through six separate sections, each opening with its fixed emoji - ⚪ facts, 🔴 gut reaction, ⚫ risks and fatal flaws, 🟡 benefits, 🟢 at least two alternatives, 🔵 decision plus next actions - all six sections, none skipped or merged, then an <answer> block.",
		deep: "For ⚫ and 🟢 produce two additional items each, and in 🔵 state the reversal condition that would make you change the decision.",
		steps: [
			{ id: "white", label: "White hat (facts)", system: "You wear the white hat: facts and data only. No opinions, no risks, no ideas. Be explicit about what is missing.", user: "{{task}}", maxChars: 1200 },
			{ id: "red", label: "Red hat (gut)", system: "You wear the red hat: honest intuitive and emotional reactions of the people involved. No justification allowed.", user: "{{task}}\n\nFacts so far:\n{{last}}", maxChars: 1000 },
			{ id: "black", label: "Black hat (risk)", system: "You wear the black hat: risks, flaws, worst realistic outcome, fatal flaws, who gets hurt. Be specific, not vague.", user: "{{task}}\n\nFacts and reactions:\n{{all}}", maxChars: 1400 },
			{ id: "yellow", label: "Yellow hat (value)", system: "You wear the yellow hat: realistic benefits, upside, why this works. No risk talk.", user: "{{task}}\n\nFacts, reactions, risks:\n{{all}}", maxChars: 1200 },
			{ id: "green", label: "Green hat (alternatives)", system: "You wear the green hat: at least two genuinely different ways to reach the same goal, including a cheaper or smaller option.", user: "{{task}}\n\nSo far:\n{{all}}", maxChars: 1400 },
			{
				id: "blue",
				label: "Blue hat (decision)",
				system: "You wear the blue hat: synthesise the five hats into a decision, list the conditions that would change it, and give next actions. Output an <answer> block.",
				user: "{{task}}\n\nAll hats:\n{{all}}",
			},
		],
	},
	{
		id: "debate",
		title: "Dialectical Debate",
		titleZh: "正反辩论",
		emoji: "⚔️",
		aliases: ["dialectic", "red-team", "steelman", "devil", "辩论", "反驳", "抬杠"],
		cues: ["正反两面", "正方反方", "对抗性论证", "钢人论证", "最强反驳", "辩论一下", "辩一辩", "正反辩论", "辩论", "steelman", "debate both sides", "devil's advocate"],
		summary: "Advocate, hardest critic, rebuttal, then a judge's verdict.",
		summaryZh: "正方、最狠的反方、反驳，然后裁判给出判决。",
		bestFor: "Contested calls where one side is already loaded in the conversation.",
		bestForZh: "对话里已经有一方占了上风的争议判断。",
		markers: ["<advocate>", "<critic>", "<rebuttal>", "<judge>", "<answer>"],
		limits: { branches: 1, depth: 1 },
		cost: "1 pass scaffolded / 4 model calls in run mode",
		costZh: "注入契约 1 遍 / run 模式 4 次模型调用",
		keywords: ["convince", "disagree", "argue", "risk of being wrong", "challenge", "is this right", "辩论", "反驳", "站得住脚", "靠谱吗"],
		skipKeywords: COMMON_SKIP,
		body: `Run a structured debate on the position implied by the request.

<advocate>
The strongest honest case for the leading option, with the evidence that supports it.
</advocate>
<critic>
The strongest case against it. Attack the weakest premise, not a strawman. Steelman the alternative, and state what the advocate is assuming that may be false.
</critic>
<rebuttal>
The advocate answers only the critic's strongest single hit. Concede what must be conceded.
</rebuttal>
<judge>
Verdict: which position survives, what remains unresolved, confidence level, and what evidence would flip it.
</judge>
<answer>
The judged conclusion, stated with its residual uncertainty.
</answer>`,
		compact:
			"Run a debate: <advocate> strongest case for the leading option, <critic> strongest attack on its weakest premise plus a steelman, <rebuttal> answering only the hardest hit, <judge> verdict with confidence, then <answer>.",
		deep: "Add a second critic who attacks the judge's verdict itself.",
		steps: [
			{ id: "advocate", label: "Advocate", system: "You argue the strongest honest case for the leading position, with evidence. Output an <advocate> block.", user: "{{task}}", maxChars: 2000 },
			{ id: "critic", label: "Critic", system: "You argue the strongest case against the leading position. Attack its weakest premise, steelman the alternative. Output a <critic> block.", user: "{{task}}\n\nAdvocate:\n{{last}}", maxChars: 2000 },
			{ id: "rebuttal", label: "Rebuttal", system: "You are the advocate again. Respond only to the critic's single strongest hit, and concede what must be conceded. Output a <rebuttal> block.", user: "{{task}}\n\nCritic:\n{{last}}", maxChars: 1400 },
			{ id: "judge", label: "Judge", system: "You judge the exchange: which position survives, what stays unresolved, confidence level, what would flip it. Output a <judge> block then an <answer> block.", user: "{{task}}\n\nFull exchange:\n{{all}}" },
		],
	},
	{
		id: "first-principles",
		title: "First Principles",
		titleZh: "第一性原理",
		emoji: "⚛️",
		aliases: ["first-principle", "axioms", "decompose", "第一性原理", "本质", "从零推"],
		cues: ["第一性原理", "从本质出发", "抛开惯例", "回到约束", "first principles", "from first principles", "strip the conventions"],
		summary: "Strip conventions, list the real constraints, rebuild from them.",
		summaryZh: "剥掉惯例，列出真实约束，从约束重新构建。",
		bestFor: "When 'everyone does it this way' is the only reason for the current design.",
		bestForZh: "当现有设计唯一的理由是「大家都这么做」的时候。",
		markers: ["<decomposition>", "<axioms>", "<rebuild>", "<answer>"],
		limits: { branches: 1, depth: 1 },
		cost: "1 pass scaffolded / 3 model calls in run mode",
		costZh: "注入契约 1 遍 / run 模式 3 次模型调用",
		keywords: ["from scratch", "rewrite", "convention", "always done", "why do we do it this way", "simplify", "重做", "从零", "惯例", "为什么一定要"],
		skipKeywords: COMMON_SKIP,
		body: `Reason from first principles.

<decomposition>
Break the problem into its indivisible parts. Explicitly list every inherited convention you are discarding ("we always do X because that is how it has been done").
</decomposition>
<axioms>
State the constraints that are actually true - physical limits, cost, latency, API contract, data volume, the real user need. Label each axiom HARD or ASSUMED.
</axioms>
<rebuild>
Rebuild the solution from the axioms alone. State where the rebuild differs from the convention, and whether the difference is justified by an axiom or by an assumption you have not verified.
</rebuild>
<answer>
The rebuilt approach, with the unverified assumptions called out.
</answer>`,
		compact:
			"Reason from first principles: <decomposition> into indivisible parts plus the conventions you discard, <axioms> listing real constraints labelled HARD or ASSUMED, <rebuild> the solution from the axioms, then <answer> with unverified assumptions flagged.",
		deep: "Also name the one axiom that, if it changed, would make the conventional approach correct again.",
		steps: [
			{ id: "decompose", label: "Decomposition", system: "You decompose the problem into indivisible parts and list the inherited conventions being discarded. Output a <decomposition> block.", user: "{{task}}" },
			{ id: "axioms", label: "Axioms", system: "You state the constraints that are actually true, each labelled HARD or ASSUMED. Output an <axioms> block.", user: "{{task}}\n\nDecomposition:\n{{last}}" },
			{ id: "rebuild", label: "Rebuild", system: "You rebuild the solution from the stated axioms alone and flag every unverified assumption. Output a <rebuild> block then an <answer> block.", user: "{{task}}\n\nHistory:\n{{all}}" },
		],
	},
	{
		id: "angles",
		title: "Multi-Angle Sweep",
		titleZh: "多角度扫描",
		emoji: "📐",
		aliases: ["multi-angle", "perspectives", "多角度", "多视角", "换个角度"],
		cues: ["几个不同角度", "不同角度", "换个角度看", "多个视角", "multiple angles", "several angles", "different perspectives"],
		summary: "Three orthogonal angles - mechanism, adversary, cost - then synthesis.",
		summaryZh: "三个互相正交的角度——机制、对手、成本——然后综合。",
		bestFor: "Reviewing code or a plan you wrote and are already attached to.",
		bestForZh: "审查你自己写的、而且已经偏向它的代码或方案。",
		markers: ["<angle:system>", "<angle:adversary>", "<angle:pragmatist>", "<synthesis>", "<answer>"],
		limits: { branches: 1, depth: 1 },
		cost: "1 pass scaffolded / 4 model calls in run mode",
		costZh: "注入契约 1 遍 / run 模式 4 次模型调用",
		keywords: ["review", "look over", "sanity check", "blind spot", "blindspot", "多角度", "盲区", "看看有没有问题"],
		skipKeywords: COMMON_SKIP,
		body: `Sweep three orthogonal angles, then synthesise. Keep each angle separate; do not let one excuse another.

<angle:system>
Mechanism: how it actually works - control flow, data flow, dependencies, failure surface.
</angle:system>
<angle:adversary>
Attack: what breaks it - failure modes, misuse, concurrency, boundary inputs, hidden coupling, what a hostile caller does.
</angle:adversary>
<angle:pragmatist>
Cost: effort to build and maintain, migration burden, what it will look like in a year, and the smaller version that captures most of the value.
</angle:pragmatist>
<synthesis>
What the three angles agree on, where they contradict each other, and the decision you take because of that.
</synthesis>
<answer>
The conclusion plus the one change you would make first.
</answer>`,
		compact:
			"Sweep three separate angles - <angle:system> mechanism and failure surface, <angle:adversary> what breaks it, <angle:pragmatist> cost and the smaller version - then <synthesis> of agreements and contradictions, then <answer>.",
		deep: "Add a fourth angle: what this looks like after six months of change pressure.",
		steps: [
			{ id: "system", label: "Angle: mechanism", system: "You describe only how it works: control flow, data flow, dependencies, failure surface. No opinions. Output an <angle:system> block.", user: "{{task}}", maxChars: 1800 },
			{ id: "adversary", label: "Angle: adversary", system: "You attack it: failure modes, misuse, boundary inputs, concurrency, hidden coupling. Output an <angle:adversary> block.", user: "{{task}}", maxChars: 1800 },
			{ id: "pragmatist", label: "Angle: pragmatist", system: "You cost it: build and maintenance effort, migration burden, maintenance in a year, and the smaller version capturing most value. Output an <angle:pragmatist> block.", user: "{{task}}", maxChars: 1600 },
			{ id: "synthesis", label: "Synthesis", system: "You synthesise the three angles: agreements, contradictions, the decision, and the first change to make. Output a <synthesis> block then an <answer> block.", user: "{{task}}\n\nAngles:\n{{all}}" },
		],
	},
];

export const PARADIGM_IDS = PARADIGMS.map((p) => p.id);

const ALIAS_INDEX = new Map<string, Paradigm>();
for (const paradigm of PARADIGMS) {
	for (const key of [paradigm.id, ...paradigm.aliases]) {
		const normalized = normalizeKey(key);
		if (!ALIAS_INDEX.has(normalized)) ALIAS_INDEX.set(normalized, paradigm);
	}
}

export function normalizeKey(value: string): string {
	return value.trim().toLowerCase().replace(/[\s_]+/g, "-");
}

/** Resolve a paradigm by id or alias. Returns undefined for unknown names. */
export function resolveParadigm(name: string | undefined | null): Paradigm | undefined {
	if (!name) return undefined;
	return ALIAS_INDEX.get(normalizeKey(name));
}

export function listParadigms(): Paradigm[] {
	return PARADIGMS;
}

export function defaultIntensity(): Intensity {
	return "standard";
}

export function isIntensity(value: string | undefined): value is Intensity {
	return value === "light" || value === "standard" || value === "deep";
}
