# pi-think-different

[English](README.md) | **简体中文**

一个 [Pi](https://github.com/earendil-works/pi) 扩展，用来切换 agent 的思考范式。它内置九种思考方式（见[范式](#范式)一节），每种都有两套用法——作为注入系统提示词的契约，覆盖整个会话；或者作为 harness 驱动的多轮工作流，处理单个问题。

![一个正在用六顶思考帽回答「要不要把每晚的 cron 换成队列加 worker」的 Pi 会话：六个段落分别由固定的帽子 emoji 开头（白、红、黑、黄、绿、蓝），后面是无标签的结论，再下面是 /think hats 命令行与 hats 状态栏。](https://raw.githubusercontent.com/voorjaar/pi-think-different/main/assets/preview.png)

## 特性

- 九个范式（见[范式](#范式)一节），每个都同时有提示词契约和多轮工作流两套实现。
- `/think` 命令：固定范式、只用于一个回合、在同一条命令里点明任务，或者直接用一句自然语言提要求。
- `/think auto` 给提示词打分后逐个提示词选范式；`/think random` 每轮轮换。
- 三种强度：`light`、`standard`、`deep`。
- 会话语言（`en` / `zh`）与结构放置（`answer` / `thinking`）。
- `think` 工具的 `mode: "run"`：harness 解析模型报出的分数，自己剪掉弱候选，并告诉下一步能在哪些候选上继续。
- 自带 skill（`skills/think-different/SKILL.md`），agent 无需被告知就知道哪种范式适合哪种问题形状。

## 安装

```bash
pi install npm:pi-think-different
```

Pi 直接加载 `src/index.ts`：无需构建步骤，除 Pi 本身之外没有依赖。本地 checkout 则用 `pi install ./pi-think-different` 从目录加载。

## 使用

```text
/think                       状态（交互模式下是选择器）
/think list                  带「适合什么」说明的清单
/think tot                   为本会话固定思维树
/think hats                  固定六顶思考帽（中文别名同样可用）
/think once critique         只对下一个回合用自我批判
/think tot design a cache    固定范式并立刻用它回答这个问题
/think auto                  每个提示词选一个范式（总会选）
/think random                每轮换一个范式
/think deep                  提高当前范式的强度
/think lang zh               菜单、帮助、状态栏改用中文（`en` 切回）
/think placement thinking    结构留在思考区，回答只给结论
/think off                   回到 Pi 默认的推理
```

范式不必写成一个 token。当参数读起来像一句话时，文本会被扫描范式线索，剩下的部分成为任务：

```text
/think rethink our polling from first principles    -> first-principles，任务：rethink our polling
/think use six hats on the migration plan           -> hats，任务：the migration plan
/think with a thought tree and the six hats ...     -> 歧义：点了两个范式，所以它反问你
```

范式后面的文本就是要思考的具体问题，`/think tot design a cache` 会直接启动回合。不带任务时只固定范式，下一个提示词使用它。

无头与脚本会话可以让范式一开始就开着：

```bash
pi --mode json --think tot -p "Design offline support for a note app"
```

### `think` 工具

为当前回合做结构化推理（`scaffold`），或者跑 harness 驱动的多轮工作流（`run`）：

```json
{ "task": "cache-aside or write-through?", "paradigm": "tot", "mode": "run" }
```

run 模式的输出按步骤标注，并说明剪掉了什么、为什么：

```text
Harness gate (external control): pruned Branch_B (3/10). Build only on: Branch_A (9/10).
```

这一行是 harness 根据报出的分数算出来的，不是模型自己声称的。

### 说明

- 范式处于开启状态时，每个回答都会用它——查询、改名、一行改动也不例外。琐碎只让结构变短，不会让结构消失。
- 模型必须写出结构标记（`<thought_tree>`、`<draft>`、六顶帽子的 emoji），这样退化成正文的范式能被察觉；harness 把它们渲染成当前会话语言的加粗标签（`**Adversary angle**`，中文会话则是它的中文对应），不会让你看到标记 token。`hats` 按模型写下的原样显示，六个 emoji 由码位钉死（`⚫ U+26AB` 等）——否则模型会在黑帽的位置写一个长得像的符号（🫥、🌑、●）。

## 范式

| id | 名称 | 适合的问题形状 | run 模式调用次数 |
|---|---|---|---|
| `cot` | 思维链 | 难题，而一个悄悄出错的答案代价很高 | 2 |
| `tot` | 思维树 | 有几条可行路径，不确定哪条 | 3 |
| `got` | 思维网 | 各部分必须合并并交叉校验 | 3 |
| `critique` | 自我批判修正 | 输出必须正确，而不只是像样 | 3 |
| `hypothesis` | 假设排他法 | 有东西坏了，原因未知 | 3 |
| `hats` | 六顶思考帽 | 采纳与否、买还是自建、政策性取舍 | 6 |
| `debate` | 正反辩论 | 一方已经占了势头 | 4 |
| `first-principles` | 第一性原理 | 这个设计只是因为「大家都这么做」才活到今天 | 3 |
| `angles` | 多角度扫描 | 检视你刚写出来的东西 | 4 |

## 配置

默认值来自三个可选的 JSON 文件（后者覆盖前者），而会话里的 `/think` 又覆盖全部三者：

```text
~/.pi/agent/extensions/pi-think-different/config.json   扩展自带默认
~/.pi/agent/pi-think-different.json                    你的全局默认（所有项目）
<repo>/.pi/pi-think-different.json                     单个项目的覆盖
```

把 `examples/config.example.jsonc` 复制成扩展目录下的 `config.json`（`package.json` 旁边）即可开始。支持注释（`//`、`/* */`）；某个取值不合法时会在会话启动时提示，文件其余部分照常生效。`examples/agent-config.example.jsonc` 是同一份内容给 `~/.pi/agent/pi-think-different.json` 用的，`examples/headless.sh` 列出命令行用法。

```jsonc
{
  "startup": "tot",        // 范式 id 或别名、"auto"、"random"、"off"
  "intensity": "standard", // light | standard | deep
  "placement": "thinking", // answer | thinking
  "language": "en"         // en | zh
}
```

`language` 只改界面：选择器、清单、帮助、状态栏、提示消息都用这一种语言。`placement` 决定结构落在哪里：

| 取值 | 可见回答里包含 |
| --- | --- |
| `answer` | 分支、评分、批判、帽子 |
| `thinking`（默认） | 只有结论；结构留在思考区 |

用 `thinking` 时，模型把带标记的结构写在它产出的正文里，harness 再把这些段落作为加粗小标题移到思考区——回答只留结论。这是有意选的：只要求「结构留在私有推理里」根本无法验证，真实会话里一个推理预算短的模型在 `once hats` 那一轮只写了一个 emoji 就正常作答了。

## 开发

```bash
node --test tests/selftest.ts    # 98 个单元测试：无模型、无网络
node tests/livecheck.mjs         # 针对真实 Pi 会话的端到端检查（18 用例）
node tests/livecheck.mjs tot hats  # 只跑指定范式子集
node tests/livecheck.mjs options   # 配置 startup、语言、放置、自然语言 /think
node tests/livecheck.mjs startup:config  # 单独重跑一条选项用例
npm test                         # 单元测试
npm run check                    # 单元测试 + 实跑检查
```

单元测试覆盖纯逻辑模块：注册表与契约、提示词渲染、参数解析、配置分层、结构放置、自动选型、评分解析，以及用脚本化假模型驱动的工作流引擎。范式实跑检查会启动 `pi --mode json --think <范式> -p "<提示词>"`，如果回答里缺少该范式定义所依赖的任一标记就判定失败；选项检查在一个临时目录里跑 Pi，该目录的配置设定待验选项。慢用例（`critique`、`startup:config`，以及 `think` 工具那条）各自带 900 秒 / 1500 秒的预算，所以全量跑需要一个 60 分钟以上的时间窗口；判定会随完成逐条打印，剩下的可以按名字补跑。如何在这个扩展上干活见 [AGENTS.md](./AGENTS.md)，「一个范式算不算正常工作」的定义见 [ROADMAP.md](./ROADMAP.md)。

## 许可证

MIT —— 见 [LICENSE](LICENSE)。
