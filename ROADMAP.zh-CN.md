# 路线图

[English](./ROADMAP.md) | **简体中文**

`pi-think-different` 是什么、不是什么，以及接下来做什么。

## 当前状态（v1.0.0）

每个范式都有两套可用的层：

| 层 | 机制 | 代价 | 状态 |
|---|---|---|---|
| 注入契约 | `/think <范式>` 往系统提示词里写一段 `<thinking_paradigm>` | 一段提示词 | 已发布，实跑验证 |
| 真实工作流 | `think({mode:"run"})` 把范式拆成多次模型调用；harness 解析报出的分数并在代码里剪枝 | 3-6 次模型调用 | 已发布，实跑验证 |

九个范式已发布——`cot`、`tot`、`got`、`critique`、`hypothesis`、`hats`、`debate`、`first-principles`、`angles`——每个都有脚手架契约、步骤工作流、逐字列出的必需标记，以及一条会启动真实 `pi --mode json` 会话、缺标记就失败的实跑检查。

已发布的控制能力：

- `/think`（状态与选择器）、`list`、`off`、`once`、`<范式>`、`[强度]`、`[任务]`、`config`。
- 自然语言参数：一行读起来像句子的 `/think` 会按线索解析出范式，其余部分作为任务；点了两个范式时拒绝猜。
- 带任务的 `/think` 会自己启动回合，所以答案在同一条命令里就到。
- `auto`（总会定一个范式，绝不「不选」）与 `random`（每轮换一个）。
- 无头与脚本会话用的 `--think <范式>`。
- `light | standard | deep` 三种强度。
- 界面语言 `lang en|zh`，结构放置 `placement answer|thinking`（默认是 `thinking`，配合 `language: "en"`）。
- 参数补全，其 value 替换整段已输入的参数。
- 状态栏指示使用当前范式自己的图标，auto 与 random 显示本轮真正启用的范式。
- 会话状态作为会话条目保存并从当前分支重建，因此分支切换、`/reload`、恢复会话都保持一致。
- 配置分层：`config.json` < `<agentDir>/pi-think-different.json` < `.pi/pi-think-different.json` < 命令行 flag < `/think`。
- 随扩展发布的 skill（`skills/think-different/SKILL.md`），路径从扩展目录解析。

已发布的渲染行为：模型逐字写出标记，harness 显示当前会话语言的加粗标签、从不显示标记 token，任何范式都不渲染成 `###` 标题，`hats` 按模型写下的原样显示。

已发布的强制要求：范式开启期间每个回答都使用它——包括琐碎的那些——这条写在契约与 skill 里，而不是靠重答循环去执法。

已发布的测试覆盖：纯逻辑模块上 98 个单元测试，以及 18 条实跑用例（9 个范式、`think` 工具的 run 模式，加上 8 条选项用例：语言、自然语言 `/think`、项目配置里的 `startup`、全局配置层里的 `startup`、`thinking` 放置、`random` 切换、琐碎提示词的强制）。实跑用例都在临时目录里运行，因此真实用户自己的配置层不会改变判定结果。

## 「算不算正常工作」的定义

一个范式只有在下面全部成立时才算完成：

1. 契约点名这个范式真正具备的操作（ToT 的分支与剪枝、假设排他法的排除、六顶帽子的每顶一段），而不是泛泛的「再想想」。
2. 它的必需标记在注入契约里逐字列出。
3. 一次真实 Pi 会话能产出这些标记。`node tests/livecheck.mjs <范式>` 是裁决者。
4. 存在 harness 驱动的 run 模式，而且它的剪枝/合并决定是代码算出来的，不是模型声称的。
5. 单元测试用脚本化假模型覆盖它的 workflow。
6. 它的线索能解析回它自己：点名它的措辞在 `/think` 与 `auto` 里都会选中它。

只在某一次转录里「看起来很有想法」不算完成。

## 下一步：让合规可度量

- **标记合规遥测。** 把「跑了哪个范式、什么强度、标记是否出现」作为会话条目记录下来。目前合规只能从外部通过 livecheck 看到。
- **强制要求的达成率。** 琐碎提示词用例只测一条提示词。对每个范式跑一组固定的短提示词，报告结构实际出现的比例——那才是契约里那句强制应当推动的数字。
- **自动选型准确率。** `auto` 由关键词与形状信号打分。建一套带标签的提示词集（每条都有人类会选的范式），报告每个范式的命中率，而不是靠看例子。
- **「退化」与「缺失」分开。** 合并了两个帽子段落或改了标记名的运行，与完全无视范式的运行是两种不同的失败。两者分开报告，免得把一次抖动当成范式坏了。反复出现的是黑帽那个圆圈：模型会在 `⚫` 的位置写 🫥、🫄 或 🌑。hats 契约现在把六个 emoji 按码位钉死（`⚫ U+26AB` 等），并把这些长得像的符号明确算成那一顶帽子没跑；`hats` 仍然是 `verbatimMarkers`，harness 依旧不改写它们。

## 下一步：值得加的范式

每个新范式都必须两套机制一起发布，不能只给一段提示词。

| 候选 | 为什么 | 难在哪 |
|---|---|---|
| `means-ends` | 有子目标的目标：从结果倒推做计划 | 计划正是 agent 容易过头的地方，需要显式前置条件 |
| `analogy` | 把「这就像 X」当成一个刻意操作，并且说明类比的失效处 | 类比会偷带错误假设 |
| `pre-mortem` | 先假设已经失败，再解释为什么——在承诺之前 | 需要扛住乐观模型的配合 |
| `red-team` | 攻击方打方案，防守方必须就地补上 | 一个回合里的两个角色会塌成独白 |
| `rubric` | 按用户给出的显式评分表打分 | 评分表解析与分数门控 |
| `map-reduce` | 把大问题拆成独立分片再合并 | 怎么拆本身就是个难题 |

## 下一步：harness 质量

- **分数门控校准。** 剪枝目前保留 6 分以上的候选。这个阈值是选出来的，不是量出来的。从实跑里收集分数，检查门控是否保住了最终胜出的候选。
- **跨范式比较。** 同一个任务、两个范式，对比答案。目前没有办法知道在某类问题上 ToT 是否真的赢过 `angles`。
- **强度要量出来，而不是猜。** `light` 是更小的字符预算和更少分支。在一组固定任务上比较答案质量与预算的关系。
- **成本报告。** 显示每个范式 `mode: "run"` 花掉的 token，让「答案重要时用 run 模式」带一个数字，而不是一种感觉。
- **run 模式续跑。** 目前 `only:` 能重跑单个步骤；把步骤输出持久化，让中断的工作流从最后一个完成的步骤继续，而不是从头开始。
- **确定性的工具路径。** run 模式的实跑检查依赖外层模型主动调用 `think`。加一种从命令层强制跑工作流的办法，这样工作流可以在不依赖模型配合的情况下被验证。

## 非目标

- 不是模型路由或思考强度控制。这里的 `--think` 选的是*范式*，不是推理强度；那件事仍由 Pi 自己的思考层级负责。
- 不是记忆或知识系统。范式塑造推理，不存储推理。
- 不是通用 agent 框架。没有子 agent、没有编排图、没有后台 worker。
- 不是为某一个模型调提示词。契约是为了在较弱的模型上也能成立而写的，这正是剪枝留在代码里的原因。
- 不是可自选样式的渲染器。标签就是当前会话语言的加粗文本，`hats` 原样显示。这件事已经定案，不再作为一个偏好暴露出来。

## 用纯函数探针发现的 bug（2026-10-14）

这些不是跑 Pi 发现的，而是拿真实的模型输出形状去驱动纯模块发现的。每一个在正常使用里都会发生，而当时单元测试一个都没覆盖到——所以在这里「单测全绿」不等于正确。**1 到 7 已修**，每个都有一条以症状命名的回归测试；**8 和 9 仍然开放**，等各自的决定。

**1. 任务里的词劫持了 `/think` 命令。** *已修* `src/render.ts` 的 `parseThinkArgs` 在任何位置都接受 `help | list | status | off | auto | random | once | config | lang | placement` 作为子命令，即使前面已经出现过范式 token。关键词赢，范式根本没生效，而且会话状态会被顺手改掉：

```text
/think hats off the record on pricing        -> action=off      the paradigm is turned off
/think debate config drift in prod           -> action=config   prints config paths only
/think angles list the risks of the plan     -> action=list     prints the catalogue only
/think cot status report for the migration   -> action=status
/think first-principles auto scaling limits  -> action=auto     switches to auto mode
```

已修：命令关键词只认 token 索引 0。`lang zh`、`placement thinking`、`auto deep`、`once hats deep` 全部照常工作；测试里没有任何一条依赖关键词出现在后面的位置。强度 token 是同一个问题的较轻版本（`/think cot deep dive into the parser` 会静默吃掉 "deep"），保留原样，因为那种读法往往正是用户想要的。测试：`parse: command keywords count only as the first token`。

**2. `placement: "answer"` 会删掉小节的第一行。** *已修* `src/placement.ts` 里 `naturalizeMarkers` 的 `labelOnly` 判据是：小节首行不足 48 字符、且不含 `。！？!?;，,` 中的任何一个，就认定它是冗余标签并删除——而 ASCII 的 `.` 不在那个集合里，所以真正起作用的判据只剩长度。于是一段正文会从用户阅读的答案里消失：

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

已修：长度启发式去掉了。只有首行确实是标签时才删——`#{1,6}` 标题、显式的 `Black: risk - …` 前缀（本来就处理过）、或者有效词全部已经出现在即将打印的标题里的文本（轻度词干归一，中文走按字符包含的变体）。标签行下面没有正文时保留，删了小节就空了。测试：`placement: a short first line of body text is not treated as a label`、`placement: a label line the model wrote is still replaced, not duplicated`。

**3. `placement: "thinking"` 在小节嵌套时把文本切碎。** *已修* `extractStructure` 的去重只把每个 span 和前一个排序后的 span 比，而不是和「目前最大的 end」比，于是外层 span 里的**第二个**嵌套 span 被保留。再从后往前切时，前面 span 的偏移在已经变短的字符串上失效：

```text
input:  Intro prose that must survive. / <draft> ... <criticism>x</criticism> ... <refinement>y</refinement> ... </draft> / Closing prose that must survive.
structure: <draft> ... Closing prose that must s      <- prose swallowed into the thinking block
answer:    Intro prose that must survive. / urvive.   <- word fragment left behind
```

同一机制在 hats 上更常见：一顶帽子的正文里提到另一顶帽子的 emoji（`⚪ Facts: the ⚫ black hat is the one people skip`）时，小节会从中间被劈开，正文第二行留在可见答案里，其余搬进思考块。已修：`dropNestedSpans` 与目前最大的结束偏移比较，`extractStructure` 和 `naturalizeMarkers` 里同一处 filter 一起改；hats 正文提到另一顶帽子时，提取现在会直接放弃而不是留下半截小节。测试：`placement: nested spans do not corrupt the surrounding prose`。

**4. `injectedParadigm` 从不清空。** *已修* `src/index.ts` 只在 `before_agent_start` 里赋值，没有任何地方重置。所以 `/think off` 之后——或者 `/think once <paradigm>` 用完之后——下一轮并没有注入契约，但 `message_end` 仍然按那个旧范式的 placement 和残迹清理规则处理一个普通回答。`cot` 是最糟的情况：`<answer>` 和 `<reasoning>` 会从普通正文里被剥掉，包括引用它们的代码块。已修：`before_agent_start` 在决定之前先把 `injectedParadigm` 清空，所以没有契约的那一轮也不会被渲染。这一条靠手测而不是单元测试验证——它住在 Pi 接线里。

**5. `placement: "thinking"` 连结论一起搬走。** *已修* 这一条不是探针发现的，而是读 `~/.pi/agent/sessions` 下的真实会话记录发现的：模型把六顶帽**和**菜谱一起写进了可见答案，而用户最后看到的只有一行——`- 偏淡 → 盐分两次放（蛋液里一点、番茄里一点），比只放一次更入味。` `findSectionSpan` 给未闭合的裸标记小节（emoji 帽子没有闭合标签）没有终点，于是黑帽的跨度一直跑到全文末尾，再恰好退回一行：从 `⚫ 风险` 到最后一个项目符号全部搬进思考块，只剩下最后那一行。

已修：裸标记小节同时在下一个空行处结束——一顶帽是一个块，不是剩下的整篇——而且「退回上一行」只在停止标记真的落在行中间时才执行，最后一行不再被赶出自己的小节。把那次会话自己的文本重放进 `extractStructure` 后，答案里保住 863 字符的菜谱，思考块里搬进去 343 字符的帽子。测试：`placement: a conclusion after the last hat stays in the answer`。

**6. `/think config` 在交互模式下没有任何输出。** *已修——命令删掉了* 它连着调了两次 `ctx.ui.notify(…, "info")`：先 `configPathsMessage(...)`，再 `describe()`。Pi 交互模式的状态渲染不会追加第二行：`showStatus` 发现聊天区最后两个子元素正好是上一次的 `lastStatusText` 和它的 spacer 时，就复用那个组件，于是第二次调用把第一次覆盖了，屏幕上只剩熟悉的 `思考范式：…` 那一行。RPC 模式把每个 notify 当成独立的 `extension_ui_request` 记录发出来，两条都在，所以测试罩里看起来一切正常。已修：子命令、帮助行、补全项全部删除；`/think config` 现在按未知词处理，报出来并附范式清单。

**7. `placement: "thinking"` 在推理预算短的那一轮直接蒸发。** *已修* 来自用户的会话记录：`/think once hats` + 「如何做番茄炒蛋」。契约完整送到了模型——会话记录里完整的 `thinking_paradigm` 段落和本轮提醒都在——而模型只写了 211 字符的推理：先说自己在用六顶帽，然后打了一个 `🟢` 就正常作答。没有任何机制能拦住：`message_end` 只能把模型写在**答案**里的结构搬走，一个没有标记的思考块对它完全不可见，所以 `thinking` 是唯一一个根本没有执行路径的 placement。

已修：thinking 的 placement 子句现在走那条可验证的路——把带标记的小节写在你产出的正文里，harness 再搬进思考区并渲染成加粗标题——而且直接写清楚：只在私有推理里存在「无法验证也无法搬走」，「只说出范式名字、或者写一个下面没有内容的标记，不算跑了范式」。`MANDATE_CLAUSE` 里加了同一句。测试：`render: private reasoning alone does not count as running the paradigm`、`render: placement thinking moves the structure out of the answer`。

**8. run 模式的分数解析太松。** `extractScores` 接受任意一行上的 `n/10`，所以正文里出现「8/10 timeouts」或一个日期就会造出一个假候选，gate 注记接着告诉下一步「Build only on: item-1 (8/10)」。反过来，一行只写方括号标签、后面跟多条 `Score: n/10` 时只会产出一条记录（label 会去重），后面的分数被静默忽略。

**9. 两处上报上的装饰性问题。** `think` 工具把 `cost` 报成全 0，而它的 token 累加是真实的；`paradigms.ts` 里有一个步骤模板已经含 `{{limits}}`，所以 `runWorkflow` 会为那个步骤把 harness 预算行打印两次。

## 已知的粗糙处

- 标记检查是严格的，而且严格是刻意的：退化成正文的范式必须大声失败。代价是带 emoji 标记的范式偶发抖动，所以「缺标记」的判定会重试一次并保留更好的那次结果。
- `<answer>` 会被 harness 解包且不留替代标签，所以在渲染后的回答里它不能作为一个 token 被断言。实跑检查断言的是结构标记，然后断言结论在结构之后仍然存在。
- 实跑检查慢且花真实 token：18 条用例大约是并发线程池上 20-30 分钟的真实 Pi 会话。单元测试是快循环，livecheck 是发布前的闸门。
- `auto` 选型是关键词加信号启发式。在形状混合的提示词上会选错（「把这个坏掉的东西重构一下，顺便选个新设计」），所以点名范式的措辞优先于打分。
- 嵌套的 `mode: "run"` 调用不继承任何工具权限，所以工作流步骤不能读文件。它们只能基于已经知道的东西思考。

## 验证命令

```bash
node --test tests/selftest.ts                 # 快、离线、无模型
node tests/livecheck.mjs                      # 全部范式 + 选项 + think(mode:"run")
node tests/livecheck.mjs tot hats             # 只跑子集
node tests/livecheck.mjs options              # 配置 startup、语言、放置、自然语言 /think
node tests/livecheck.mjs tool                 # 只跑多调用的工具用例
npm run check                           # 两者都跑
```
