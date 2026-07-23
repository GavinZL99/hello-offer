# ReAct：执行链路、失败重试与降级兜底

## 一、解决什么问题

单次 LLM 调用是**无状态的一问一答**——你问、它答，仅此而已。它有三个短板：不知道实时信息、干不了实际动作、做不了"先查 A 再查 B 然后综合"的长链路任务。

**ReAct（Reasoning + Acting）** 解决后两个：让模型在一个**循环**里反复"**推理（Thought）→ 行动（Action，调工具）→ 观察（Observation，看结果）**"，直到完成任务。关键在于模型**自主决定每一步干什么**、且每步都能看到上一步的真实结果来纠偏——不是闷头调一堆工具，而是边想边做边调整。

## 二、流程是什么

一轮 ReAct 的完整数据流（以 Claude API 为例）：

```
① 组装请求：system + 历史 messages + 工具定义(tools) → 调模型
② 模型返回 response，看 stop_reason（详见下文）
③ 若要调工具：解析 response.content 里的 tool_use 块（每个有 id / name / input）
④ 执行工具：dispatch(name, input) → 拿到结果
⑤ 把 assistant 回合（含 tool_use 块）原样追加进 messages
   再把 tool_result（tool_use_id 对上、content=结果）作为 user 回合追加
⑥ 回到 ①——模型这次能看到"我上一步调了什么、结果是什么"
```

### 完整代码示例（带注释，可跑）

下面是一个完整的 ReAct Agent，定义了两个工具（查天气、查时间），能回答"北京和上海哪个更热"这种需要**多步、调多次工具**的问题。读通这段就懂了 ReAct 的骨架。

```python
import anthropic

client = anthropic.Anthropic()

# ========== 1. 定义工具：函数本身 + 给模型看的 schema ==========

def get_weather(city: str) -> str:
    """模拟天气查询"""
    data = {"北京": "晴 30度", "上海": "多云 28度"}
    return data.get(city, f"查不到{city}的天气")

def get_time() -> str:
    """模拟时间查询"""
    return "现在是下午3点"

# 工具注册表：name → 函数
TOOL_FUNCS = {"get_weather": get_weather, "get_time": get_time}

# 给模型看的工具说明书（schema）
tools = [
    {
        "name": "get_weather",
        "description": "查某城市当前天气。当用户问天气、温度、是否要带伞时调用。",
        "input_schema": {
            "type": "object",
            "properties": {"city": {"type": "string", "description": "城市名"}},
            "required": ["city"],
        },
    },
    {
        "name": "get_time",
        "description": "查当前时间。当用户问现在几点时调用。",
        "input_schema": {"type": "object", "properties": {}},
    },
]

# ========== 2. ReAct 循环 ==========

messages = [{"role": "user", "content": "北京和上海哪个更热？"}]
round_num = 0

while True:
    round_num += 1
    print(f"\n{'='*50}")
    print(f"第 {round_num} 轮")

    # ① 组装请求 → 调模型
    resp = client.messages.create(
        model="claude-opus-4-8",
        max_tokens=4096,
        tools=tools,
        messages=messages,
    )

    # ② 看 stop_reason：模型为什么停？
    print(f"  stop_reason = {resp.stop_reason}")

    # 如果模型说完了 → 跳出循环
    if resp.stop_reason == "end_turn":
        # 提取最终文本回答
        final_text = "".join(b.text for b in resp.content if b.type == "text")
        print(f"  最终回答：{final_text}")
        break

    # ③ 模型要调工具（stop_reason == "tool_use"）
    #    解析 response.content 里的 tool_use 块
    tool_calls = [b for b in resp.content if b.type == "tool_use"]
    for tc in tool_calls:
        print(f"  模型想调工具：{tc.name}({tc.input})")

    # ⑤a 把模型的回复（含 tool_use 块）原样追加进 messages
    #    这一步很关键——模型下一轮要靠它知道自己上一步干了什么
    messages.append({"role": "assistant", "content": resp.content})

    # ④ 执行工具，收集结果
    tool_results = []
    for tc in tool_calls:
        func = TOOL_FUNCS[tc.name]               # 找到对应函数
        result = func(**tc.input)                # 执行
        print(f"  工具返回：{result}")
        tool_results.append({
            "type": "tool_result",
            "tool_use_id": tc.id,                # ★ id 必须对上
            "content": result,
        })

    # ⑤b 把工具结果作为 user 回合追加进 messages
    messages.append({"role": "user", "content": tool_results})

    # ⑥ 回到 while 循环顶部 → 下一轮，模型能看到工具结果了
```

### 运行起来长什么样

```
==================================================
第 1 轮
  stop_reason = tool_use
  模型想调工具：get_weather({'city': '北京'})
  工具返回：晴 30度

==================================================
第 2 轮
  stop_reason = tool_use
  模型想调工具：get_weather({'city': '上海'})
  工具返回：多云 28度

==================================================
第 3 轮
  stop_reason = end_turn
  最终回答：北京 30度，上海 28度，北京更热。
```

**发生了什么**：
- 第 1 轮：模型看到"北京和上海哪个更热"，决定先查北京 → 调 `get_weather` → 结果"晴 30度"回填。
- 第 2 轮：模型看到北京的结果，决定再查上海 → 调 `get_weather` → 结果"多云 28度"回填。
- 第 3 轮：模型两个城市的天气都有了，不再调工具，直接综合回答 → `end_turn`，循环结束。

这就是 ReAct：**模型自己决定每步干啥（先查北京、再查上海、最后综合），每步看到上一步结果再决定下一步**——不是你写死的流程，是模型运行时自主的。

### messages 在每轮后长什么样（理解 context 怎么累积）

```python
# 初始
messages = [
    {"role": "user", "content": "北京和上海哪个更热？"}
]

# 第1轮后（查了北京）
messages = [
    {"role": "user", "content": "北京和上海哪个更热？"},
    {"role": "assistant", "content": [TextBlock("我查一下"), ToolUseBlock(id="toolu_1", name="get_weather", input={"city":"北京"})]},
    {"role": "user", "content": [{"type":"tool_result","tool_use_id":"toolu_1","content":"晴 30度"}]}
]

# 第2轮后（又查了上海）—— messages 更长了
messages = [
    {"role": "user", "content": "北京和上海哪个更热？"},
    {"role": "assistant", "content": [TextBlock("我查一下"), ToolUseBlock(id="toolu_1", ...)]},
    {"role": "user", "content": [{"type":"tool_result","tool_use_id":"toolu_1","content":"晴 30度"}]},
    {"role": "assistant", "content": [ToolUseBlock(id="toolu_2", name="get_weather", input={"city":"上海"})]},
    {"role": "user", "content": [{"type":"tool_result","tool_use_id":"toolu_2","content":"多云 28度"}]}
]
# 第3轮：模型看到所有历史，综合回答，end_turn，不再追加
```

**关键观察**：messages 每轮都在变长——assistant 回复 + tool_result 不断追加。这就是 context 怎么累积的，也是为什么长对话会爆窗口（见《上下文管理》）。模型每轮都能看到**完整历史**（包括它之前调了什么、结果是什么），所以能"记住"前面的步骤、做出连贯的决策。

### stop_reason 各值的含义与处理（循环的"方向盘"）

模型为什么停、下一步怎么办，全看这个字段：

| stop_reason | 含义 | 怎么处理 |
|---|---|---|
| `tool_use` | 模型要调工具（可能一次多个） | 进入 ③④⑤，执行工具后回 ① 继续循环 |
| `end_turn` | 模型说完了 | **跳出循环**，结束 |
| `pause_turn` | 服务端工具（web_search/code_exec 这类 Anthropic 托管的）撞了内部迭代上限 | 把 assistant 回合原样回传再请求一次即续跑，**别加"继续"这类用户消息**（API 检测到尾部 server_tool_use 会自动续） |
| `max_tokens` | 输出被截断 | 加大 max_tokens 或改流式 |
| `refusal` | 安全拒绝 | **别读 content[0]**（可能空），走降级/换模型 |

**关键判断**：循环终止看 stop_reason 是不是 `end_turn`，**不是看"有没有文本"**——模型可能一边输出文字一边还要调工具，文本存在 ≠ 结束。

### 几个容易踩的实现细节

- **tool_use_id 一一对上**：每个 tool_use 块都要有且仅有一个 tool_result 回填，ID 匹配，否则 API 报错。
- **assistant 回合原样回传**：把 `response.content`（含 tool_use 块）整段追加进 messages，不要只回传文本——模型靠它知道上一步干了什么、调了什么。
- **多工具并行**：一次 response 可能要调多个工具，无依赖的并行执行（IO 密集显著加速），结果一次性回填。
- **tool_use 块的 input 解析**：input 是 JSON，用 `json.loads` 解析，别用字符串匹配（模型可能用不同的 Unicode/转义）。
- **手写 vs tool runner**：生产用 SDK 的 tool runner（自动跑这个循环），手写的价值在"理解 + 要插审批/日志/条件执行时拿回控制权"。

## 三、使用中会遇到哪些问题

1. **工具执行失败**：你的函数抛异常/返回错误（查不到、参数非法、下游服务挂）。
2. **模型 API 调用失败**：429 限流 / 5xx 服务端错 / 超时——长任务里模型调用很多次，一次抖动可能整任务挂。
3. **死循环 / 重复调用**：模型反复调同一工具、或一直"我再试试"，烧 token 不收尾。
4. **任务做不完卡死**：复杂任务跑到一半卡住，既没完成也没正常结束。

## 四、解决方案

### 1. 工具失败 → 不中断循环，回填错误让模型纠错

**核心原则**：工具失败**别抛异常中断循环**，把错误包成 `tool_result`、`is_error: true` + **可操作**的错误信息回给模型，让它自己决定重试、换工具、还是换思路。

```
{"type":"tool_result","tool_use_id":id,"content":"错误：城市名'xyz'找不到，请给有效城市名","is_error":true}
```

为什么这样做：模型看到"这个工具调失败了、原因是 X"，会自己调整（换个参数重试、或换别的方法）。如果直接抛异常，整个 Agent 崩，用户什么都拿不到。

**按错误类型分类处理**（不是所有错误都一样）：

| 错误类型 | 例子 | 回填什么 | 模型预期行为 |
|---|---|---|---|
| **参数错** | month=13、city="xyz" | "month=13 非法，应为1-12" | 改参数重试 |
| **下游服务挂** | 天气 API 503 | "天气服务暂时不可用" | 换工具或告诉用户"暂不可用" |
| **权限不足** | 无权删该文件 | "无权限执行此操作" | 不重试、换思路或告诉用户 |
| **超时** | DB 查询超时 | "查询超时，请缩小范围" | 改参数（缩小范围）重试或换路 |
| **找不到** | 搜索无结果 | "未找到匹配结果" | 换关键词或告诉用户"没找到" |

**错误信息要"可操作"**——告诉模型**哪里错了、怎么改**，而不是只回 "error" 或 "失败"。区别：
- 不可操作：`"error"` → 模型不知道怎么改，可能原样重试（陷入循环）。
- 可操作：`"城市名'xyz'找不到，请给有效城市名如'北京'"` → 模型知道要换城市名。

**工具内部重试 vs 回填给模型**：
- **临时性错误**（网络抖动、429 限流）→ 工具函数**内部**做有限重试（2~3 次、退避），不暴露给模型——模型不该为网络抖物操心。
- **永久性错误**（参数错、权限不足、找不到）→ 不重试，直接 `is_error` 回填给模型纠错。

**重试限制**：同一工具+同一参数失败 N 次后，注入"这个工具连续失败了，换别的方式"，防止模型死磕一个失败的工具。

### 2. 模型 API 失败 → 自动重试 + 退避

SDK 默认重试 429/5xx（指数退避）。几个要点：
- **429（限流）**：读 `retry-after` 响应头，按它等；指数退避（1s、2s、4s…）。
- **5xx（服务端错）**：重试。
- **4xx（除 429）**：**不重试**——请求本身错（参数/权限），重试也没用。
- 设 `max_retries` 上限（默认 2，长任务可调高）。
- 长任务里模型调用很多次，一定要有重试，否则一次网络抖动整个任务挂。

### 3. 死循环 / 重复调用 → 防护机制（逐层加码）

Agent 会在单次会话里反复调同一工具（比如反复搜同一个词、反复读同一个文件）、或 A→B→A 来回转、或一直"我再试试"——烧 token 不收尾。要**逐层加码**防住:

**第 1 层：max_iterations 硬上限（兜底）**
- 单次会话/单任务最多 N 轮工具调用（如 25 轮），到顶强制停。
- 这是最底层的保险——即使上面所有检测都没生效，这个硬上限也能兜住，不会无限跑下去。
- N 怎么定：简单任务 10、常规 25、复杂长任务 50~100。太高没意义（烧太多 token 才停）、太低会误杀正常多步任务。

**第 2 层：重复调用检测（最有效）**
- **记录"已调过什么"**：维护一个本次会话的工具调用历史 `[(tool_name, params_hash), ...]`。
- **检测重复**：同一工具 + 近似参数连调 N 次（如 3 次），注入"你已经查过 X 了，结果是 Y，别再查"或强制结束。
- **近似参数**：不是完全相等才算重复——参数的**语义近似**就算（比如搜"北京天气"和"北京 今日天气"是重复）。简单做法：参数 JSON 做个 hash 完全匹配；进阶：关键字段提取比较。
- 这层最有效是因为**大部分死循环就是"模型忘了自己查过、又查一遍"**——给它看历史、或主动提醒"你查过了"就能打断。

**第 3 层：循环模式检测（A→B→A）**
- 检测工具调用**序列**里有没有"来回"模式——A 的结果导致调 B、B 的结果又导致调 A，形成振荡。
- 检测方法：看最近 N 步的调用序列里有没有长度 2~3 的重复子串（A,B,A,B,A,B...）。
- 发现后注入"你在 A 和 B 之间来回打转了，停下来想想有没有别的路"或强制结束。

**第 4 层：进度停滞检测（最智能）**
- **连续几轮没新进展**就算停滞：工具返回的结果和上轮一样、或没产生新输出、或模型连续几轮只输出"我再试试"没实际调用。
- 检测方法：比较最近 K 轮的工具结果/模型输出有没有**实质变化**（简单做：结果的 hash 相同；进阶：语义比较）。
- 停滞就主动收尾——把已完成的部分整理出来返回，别继续空转。

**第 5 层：token/成本上限**
- 单次会话总 token 超阈值就停（task budget 或硬上限）——即使没检测到"重复"，跑太久/太贵也该停。
- 和 max_iterations 互补：iterations 限制"步数"、token 限制"花费"，双保险。

**第 6 层：system prompt 约束（软）**
- 明确"够了就停、别重复同样的调用、没进展就结束、不要反复试同一个失败的方法"。
- 软防护——模型可能不听，但加上比不加好，且和其他层配合能减少触发频率。

**第 7 层：会话级状态注入（让模型"记得"调过什么）**
- 每轮把"本次会话已调过的工具+结果摘要"注入 context（或让模型能查调用历史）——模型"看见"自己调过什么，就不容易重复调。
- 这是从根上减少"忘了又调一遍"——大部分重复调用就是因为模型在长 context 里"忘了"自己干过什么。

**整体逻辑**：从"模型自觉"（prompt 约束 + 状态注入减少遗忘）到"代码检测"（重复检测 + 循环模式 + 进度停滞）到"硬兜底"（max_iterations + token 上限），层层加码。**最有效的是第 2 层重复调用检测**——因为大部分死循环就是"忘了又调一遍"。

### 4. 卡死 → 任务级超时 + 降级收尾

- **任务超时**：整个 Agent 跑超 X 分钟就中断。
- **进度停滞检测**：连续几轮没新进展（没新工具结果、没新产出）就主动收尾，把已完成的部分整理出来返回。

### 降级兜底（Fallsafe：每一层都有 Plan B）

线上 Agent 不能"一处失败全盘崩"，三层降级：

| 层 | 主路径 | 降级 |
|---|---|---|
| **工具层** | 主数据源 | 备用数据源 → 缓存 → "暂时查不到"兜底 |
| **模型层** | 主模型（Opus） | 429/5xx 时切便宜模型（Sonnet/Haiku）；Claude 有 server-side `fallbacks` 自动切 |
| **任务层** | 完整完成 | 做不完 → 返回部分结果 + 说明"做到哪、为何没完" |

**兜底哲学**：每一层都问"失败了怎么办"，且失败要**可观测**（日志/事件流能追溯是哪层降的级）。比无限转或直接报错强得多。

一句话：ReAct 的可靠性 = 循环本身（按 stop_reason 正确驱动）+ 三层失败处理（工具层 is_error 回填、API 层重试、任务层超时降级）+ 每层兜底。
