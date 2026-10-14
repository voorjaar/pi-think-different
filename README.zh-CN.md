# pi-think-different

[English](README.md) | **简体中文**

一个 [Pi](https://github.com/earendil-works/pi) 扩展，把 agent 推理的「形状」变成用户可选的东西：在多种思考范式之间切换（思维链 CoT、思维树 ToT、思维网 GoT、自我批判修正、假设排他法、六顶思考帽、正反辩论、第一性原理、多角度扫描），而不是只拿到一遍直觉。

## 为什么是两套机制

本扩展背后的参考笔记反复强调同一件事：范式既可以作为提示词契约注入，也可以由代码真正驱动。两种都实现了，因为它们失效的方式不同。

| 机制 | 是什么 | 成本 | 什么时候用 |
|---|---|---|---|
| **契约注入** | `/think <范式>` 往系统提示里加一段 `<thinking_paradigm>`，本会话后续每个实质性回合都按该形状推理 | 一段提示词 | 你希望整个会话都用某种方式思考 |
| **真实工作流** | `think` 工具配合 `mode: "run"`，把范式拆成多次独立模型调用，并且由 harness（不是模型）决定哪些候选存活 | 3–6 次模型调用 | 某个答案需要「被推敲过」，而不只是看着合理 |

run 模式的控制逻辑留在代码里：harness 解析模型给出的评分（`Score: 8/10`、`评分：8/10`、`[8/10]`），自己剪掉低于 6 分的候选，然后明确告诉下一步只能基于哪些候选继续。模型不必在自己的想象中装下一整棵树——而这正是单遍 CoT 模拟最常崩掉的地方。

## 范式一览

| id | 中文 | 适配的问题形状 | run 模式调用次数 |
|---|---|---|---|
| `cot` | 思维链 | 答错了代价很高的难题 | 2 |
| `tot` | 思维树 | 有多条可行路线，不知道选哪条 | 3 |
| `got` | 思维网 | 多个部分需要合并并交叉验证 | 3 |
| `critique` | 自我批判修正 | 输出必须正确，而不只是看着对 | 3 |
| `hypothesis` | 假设排他法 | 东西坏了但原因未知 | 3 |
| `hats` | 六顶思考帽 | 采纳/不采纳、自研/采购、政策决定 | 6 |
| `debate` | 正反辩论 | 一方已经占据话语优势 | 4 |
| `first-principles` | 第一性原理 | 现有设计只靠「一直这么做」维持 | 3 |
| `angles` | 多角度扫描 | 审视自己刚写出来的东西 | 4 |

每个范式还声明了 `bestFor`、`cost`，以及必须出现的结构块（`<thought_tree>`、`<draft>` / `<criticism>` / `<refinement>`、⚪🔴⚫🟡🟢🔵 等）。这些标记正是实跑检查所断言的内容，所以某个范式悄悄退化成普通散文时会被抓到。

## 安装

把目录放进 Pi 的扩展目录即可（因为里面有 `index.ts`，会自动加载）：

```bash
cp -r pi-think-different ~/.pi/agent/extensions/
```

不需要构建步骤：Pi 直接加载 TypeScript。除 Pi 本身外没有依赖。

## 使用

```text
/think                       查看状态（交互模式下打开选择器）
/think list                  范式清单及适配场景
/think tot                   本会话固定使用思维树
/think 六顶思考帽              等同 /think hats（支持中文别名）
/think once critique         只对下一个回合启用自我批判
/think tot design a cache    固定范式，同时点名要思考的具体问题
/think auto                  每个提示词按启发式自动选范式
/think deep                  提高当前范式的强度
/think lang zh               菜单、帮助、状态改用中文（/think lang en 切回英文）
/think placement thinking    结构留在思考区，回答只给结论
/think config                查看当前生效的配置文件与取值
/think off                   回到 Pi 默认推理
```

范式不一定要写成 token。如果参数是一句自然语言，会在文里找范式线索，剩下的部分当作任务：

```text
/think 以六顶思考帽的方式思考俄乌战争的结果      → hats，任务「俄乌战争的结果」
/think rethink our polling from first principles  → first-principles，任务「rethink our polling」
/think 用思维树和六顶思考帽分析这个迁移          → 歧义：同时点了两个范式，所以它会反问
```

线索就是注册表自己的词表（`id`、别名、标题，加上每个范式的 `cues`），最长匹配优先，拉丁线索要求词边界——`treewidth` 不会选中 `tot`。当两个不同范式同时命中时，`/think` 不猜，而是请你明确指定一个。

范式后面的自由文本会作为具体任务保留，并以「Concrete task for this turn」注入下一回合，所以 `/think tot design a cache` 既固定范式，也指明思考对象。

强度分三档：`light`（精简契约）、`standard`（完整契约）、`deep`（完整契约外加额外覆盖要求）。

无头或脚本化会话可以直接带着范式启动：

```bash
pi --mode json --think tot -p "Design offline support for a note app"
```

## 配置

默认值来自两个可选的 JSON 文件（后者覆盖前者），而会话里的 `/think` 又覆盖两者：

```text
~/.pi/agent/extensions/pi-think-different/config.json   个人默认
<repo>/.pi/think-different.json                        项目覆盖
```

把 `config.example.jsonc` 复制成同目录下的 `config.json` 即可开始。支持注释（`//` 与 `/* */`）；某个取值不合法时会在会话启动时提示，文件其余部分照常生效。

```jsonc
{
  "startup": "tot",        // 范式 id 或别名、"auto"、"off"
  "intensity": "standard", // light | standard | deep
  "placement": "thinking", // answer | thinking
  "language": "zh"         // en | zh
}
```

**`language`** 只改界面：`/think` 选择器、`/think list`、帮助、状态栏、提示消息都用这一种语言，不会中英同时出现。注入系统提示词的范式契约保持英文，因为那是给模型的指令；你自己的提示词仍然按你写的语言回答。

**`placement`** 决定范式的细粒度结构落在哪里：

| 取值 | 可见回答里包含 |
| --- | --- |
| `answer`（默认） | 分支、评分、批判、帽子——脚手架全部展示 |
| `thinking` | 只有结论；结构留在思考区 |

`thinking`  placement 有两道保障：契约要求模型把结构放在推理里；如果它还是写进了回答，harness 会把结构从回答里剪掉并重新挂成思考区内容。看不见的结构就无法核验，所以这是一次有意取舍，而不是单纯的美化。

### `think` 工具

当前回合的结构化推理：

```json
{ "task": "cache-aside or write-through?", "paradigm": "tot", "mode": "scaffold" }
```

由 harness 驱动的多遍推理：

```json
{ "task": "cache-aside or write-through?", "paradigm": "tot", "mode": "run" }
```

run 模式的输出按步骤标注。`Harness gate` 一行会说明剪掉了什么、为什么剪：

```text
Harness gate (external control): pruned Branch_B (3/10). Build only on: Branch_A (9/10).
Do not revive a pruned candidate unless you state the evidence that changes its score.
```

遇到分歧时相信 gate，而不是模型自己的自信度：那个剪枝决定是算出来的，不是模型声称的。

## 值得知道的行为

- **每个契约都自带逃生门。** 查询、改名、一行改动会直接跳过结构，而不是给它套一层仪式。`/think` 服务于实质性推理。
- **标记必须可见。** 契约要求在可见回答里输出结构，而不是只藏在私有思考里，这样你能看出到底跑了哪个范式。
- **会话状态能穿过 reload 和 resume。** 当前范式作为会话条目保存，并从当前分支重建，因此分支切换、`/reload`、恢复会话都不会让选择前后不一致。
- **`/think auto` 是关键词加信号启发式**，不是模型调用：它给提示词里的缺陷、设计、决策、权衡信号打分，并且拒绝给琐碎提示词挂范式。
- **skill 随扩展一起发布。** `skills/think-different/SKILL.md` 通过 `resources_discover` 贡献，agent 无需被告知就知道哪种形状配哪个范式。

## 开发

「一个范式算不算正常工作」的定义以及后续计划见 [ROADMAP.zh-CN.md](./ROADMAP.zh-CN.md)。

单元测试（不用模型、不用网络）：

```bash
node --test selftest.ts
```

51 个测试覆盖：注册表完整性与别名唯一性、每个范式的标记与契约一致性、提示词渲染与强度分层（包括 `/think <范式> <任务>` 带入的具体任务行）、位置子句、`/think` 参数解析（显式 token 与自然语言线索匹配）、配置校验与分层覆盖（语言拼写、容错注释、未知键、坏 JSON）、单语言的清单与状态文案、从标签式与标题式回答里提取结构、自动选型（包括「琐碎提示词不挂范式」）、评分解析、外部剪枝，用脚本化假模型驱动的工作流引擎（步骤顺序、占位符填充、前序结果传递、各强度的候选宽度预算、输出上限、`only:` 局部重跑、失败传播），以及内置 skill 的位置。

端到端实跑检查（真实 Pi 会话，每次一个模型请求）：

```bash
node livecheck.mjs            # 全部范式 + 配置选项 + think 工具的 run 模式
node livecheck.mjs tot hats   # 只跑范式子集
node livecheck.mjs options    # 配置启动、语言、结构位置、自然语言 /think
```

范式检查会启动 `pi --mode json --think <范式> -p "<提示词>"`，如果回答里缺少该范式定义所依赖的任一标记就判定失败。选项检查在一个临时目录里跑 Pi，该目录的 `.pi/think-different.json` 设定待验选项，然后断言用户真正会看到的东西：清单用哪种语言、配置的 `startup` 能否不用任何 flag 就固定范式、`thinking` 位置是否把结构留在可见回答之外。自然语言用例走 RPC 模式（print 模式不展开斜杠命令），发出 `/think 以六顶思考帽的方式思考俄乌战争的结果`，要求命令响应的 `disposition` 为 `"handled"`，然后要求下一回合带着六顶帽子的标记。每条判定在对应实跑结束后立刻输出；用例通过 3 个并发 Pi 会话的线程池执行（`LIVECHECK_CONCURRENCY=1..4`），单次实跑超时由 `LIVECHECK_TIMEOUT_MS` 控制（默认 420000 毫秒），超时后重试一次。传入 `tool` 参数则只跑 `think` 工具的用例。

每个注入的契约都会逐字列出它要求的标记，并明确禁止用标题、加粗、emoji 或一整段代码围栏替代标签。模型遵守这一纪律；退化成普通散文的范式会直接报错，而不是蒙混过关。

```bash
npm test                     # 单元测试
npm run check                # 单元测试 + 实跑检查
```

## 目录结构

```text
pi-think-different/
├── index.ts            # Pi 接线：命令、工具、CLI flag、提示词注入、配置加载、会话状态
├── paradigms.ts        # 范式注册表：契约、标记、工作流步骤（纯函数）
├── render.ts           # 提示词段落渲染 + /think 参数解析（纯函数）
├── nlmatch.ts          # 从自然语言里找范式线索 → 范式 + 任务（纯函数）
├── config.ts           # 配置 schema、校验、分层覆盖、容错解析（纯函数）
├── ui.ts               # 所有人类可见文案，一次只用一种语言（纯函数）
├── placement.ts        # 结构位置：提示词子句 + 从回答里提取结构（纯函数）
├── autoSelect.ts       # 启发式范式选型（纯函数）
├── workflow.ts         # 带外部评分门控的多遍引擎（纯函数，模型调用可注入）
├── selftest.ts         # 单元测试
├── livecheck.mjs       # 针对真实 Pi 会话的端到端检查
├── config.example.jsonc # 复制成 config.json 即可设定默认值
├── ROADMAP.zh-CN.md    # 「正常工作」的判定标准，以及下一步计划
└── skills/think-different/SKILL.md
```

## 许可证

MIT
