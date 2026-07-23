# Agent 协议：MCP、A2A、厂商协议（OpenAI vs Anthropic）

> Agent 生态的协议分三层：**MCP**（Agent↔工具/数据，跨厂商开放标准）、**A2A**（Agent↔Agent）、以及**厂商自有的工具调用协议**（OpenAI 的 Function Calling / Anthropic 的 Tool Use）——这层是 MCP 要标准化的对象，但实际开发直接面对的就是它。
> 每个按"解决什么问题→怎么工作→关键机制→和其他的关系"讲。

---

## 一、先看全景：各协议各管哪一层

```
┌──────────────────────────────────────────────┐
│  Agent A           Agent B           Agent C  │  ← A2A：Agent 之间互相通信协作
│   │                 │                 │       │
│   ├──厂商协议──┐   ├──厂商协议──┐   ├──厂商协议──┐ │  ← 厂商协议：模型怎么输出
│   │  (OpenAI/   │   │  (OpenAI/   │   │  (OpenAI/   │     "我要调工具" + 怎么回传
│   │  Anthropic) │   │  Anthropic) │   │  Anthropic) │     结果（MCP 底层也走这层）
│   ▼             ▼   ▼             ▼   ▼             ▼ │
│  工具/数据     工具/数据     工具/数据          │  （文件系统、数据库、API、GitHub…）
│                                              │
│   └─ 这些工具可以用 MCP 标准化暴露 ──────────┘  ← MCP：跨厂商统一工具暴露/调用
└──────────────────────────────────────────────┘
```

一句话区分：
- **厂商协议**（OpenAI Function Calling / Anthropic Tool Use）解决"**模型怎么表达'我要调工具'、结果怎么回传**"——是模型 API 的一部分，每家格式不同，是 Agent 开发直接面对的。
- **MCP** 解决"**跨厂商统一工具的暴露和调用**"——把上面各家不同的协议标准化，工具可复用共享。
- **A2A** 解决"**Agent 怎么和其他 Agent 协作**"——Agent 和 Agent 之间。

类比：厂商协议 = 各家电脑自己定的外设接口（互不通用）；MCP = 把外设接口统一成 USB-C（跨厂商通用）；A2A = 让电脑和电脑联网协作。

---

## 二、MCP（Model Context Protocol，模型上下文协议）

### 解决什么问题

以前每个 AI 厂商有自己的工具调用格式（OpenAI `tool_calls`、Claude `tool_use`、Gemini `functionCall`…），接一个外部工具要为每个模型单独适配——**M 个模型 × N 个工具 = M×N 份集成代码**。工具也散落、不可复用。

**MCP**（Anthropic 2024 年 11 月发布）把这事**标准化**：定义一套统一协议，任何 AI 应用接任何 MCP server 都能用。把 M×N 降成 **M+N**（模型方实现一次 MCP client、工具方实现一次 MCP server，即插即用）。官方比作"**AI 应用的 USB-C 接口**"。

### 怎么工作

**Client-Server 架构**，三个角色：
- **Host（宿主）**：AI 应用本身（Claude Desktop、Cursor、IDE、Agent 框架），管理多个 MCP client。
- **Client（客户端）**：嵌在 Host 里，负责和一个 MCP server 通信、发现能力、转发调用。
- **Server（服务器）**：暴露能力的一方，封装外部系统（文件系统、数据库、GitHub、API…）。

```
Host(Claude/Cursor/Agent)
  └─ Client ──MCP协议──▶ Server(文件系统)   → 暴露 Tools/Resources/Prompts
  └─ Client ──MCP协议──▶ Server(GitHub)     → 暴露 Tools/Resources/Prompts
  └─ Client ──MCP协议──▶ Server(数据库)     → 暴露 Tools/Resources/Prompts
```

**通信**：基于 **JSON-RPC 2.0**。流程是 **初始化 → 发现 → 调用**：
1. 初始化：client 和 server 协商能力、协议版本。
2. 发现：client 调 `tools/list` 拿到 server 提供的工具清单（名字、描述、参数 schema）。
3. 调用：模型决定用某工具 → client 发 `tools/call` → server 执行 → 返回结果 → 喂回模型。

### 关键机制

**三大原语（Server 暴露的三类能力）**：
- **Tools（工具）**：可执行的动作（发邮件、调 API、跑脚本），**模型控制**调用、会改变状态。这是最常用的，相当于标准化的函数调用。
- **Resources（资源）**：可读取的数据（文件、DB 记录、配置），**应用控制**何时读、只读、可订阅更新。相当于"只读上下文注入"。
- **Prompts（提示模板）**：预定义对话模板，帮用户快速发起特定任务。

**传输方式**：
- **stdio**：本地进程间通信，Host 把 server 当子进程启动，走标准输入输出。适合本地工具。
- **HTTP + SSE / Streamable HTTP**：远程通信，client 发 HTTP 请求、server 用 SSE 推送响应/通知。适合云端 server。
- 选哪种看部署：本地工具用 stdio（简单安全），远程/共享用 HTTP。

**安全**：Host 可在工具调用前要求用户授权（你用 Claude Code 时看到的权限提示就是这机制）；无状态协议，每次调用独立。

### 和 Function Calling 的区别（面试常问）

- **Function Calling** 是**模型层**的——某家模型的 API 支持的"调函数"格式，绑死该模型。
- **MCP** 是**协议层**的——跨模型、跨应用的开放标准，统一工具暴露和调用方式，工具可复用、可共享。
- 关系：MCP 把"工具怎么暴露/发现/调用"标准化了，底层仍可对接各模型的 function calling。MCP 是对 function calling 的"上层标准化 + 生态化"。

### MCP 怎么做 OAuth（认证授权深挖）

早期的 MCP（2024-11-05 版）没有内置授权支持，靠环境变量传凭据。但 MCP 一旦连生产 API，"谁在请求、能做什么"就成了核心安全问题（Agent 可能被 prompt 注入诱导调危险工具、越权访问数据）。2025-03-26 版引入了基于 **OAuth 2.1** 的授权规范——MCP server 作为**资源服务器（Resource Server）**，复用成熟的 OAuth 而非从零发明。

#### 两种认证模式

- **API 密钥（静态）**：服务端签发一个 key 给客户端，每次请求带。简单，适合系统级访问、可信内部场景。缺点是难撤销、难细粒度、泄露即失控。
- **OAuth 2.1**：用户授权、拿访问令牌（Access Token）、按令牌权限执行。适合面向用户、要"以对应用户的权限执行、随时可撤销"的场景。**远程 MCP server（HTTP 传输）默认走这套**；本地 stdio 传输则从环境取凭据、不走 OAuth。

#### OAuth 2.1 在 MCP 里的完整流程

MCP 用的是**授权码流程 + 强制 PKCE**（OAuth 2.1 把 PKCE 从"推荐"升级为"强制"，禁止了隐式流）。四个关键步骤：

```
① 元数据发现（Discovery）：
   Client GET server的 /.well-known/oauth-authorization-server
   → 拿到授权服务器信息：授权端点(/authorize)、token端点(/token)、
     注册端点(/register)、支持的算法等（RFC 8414）
   若发现失败，回退到预定义默认路径(/authorize、/token、/register)

② 动态客户端注册（DCR，Dynamic Client Registration）：
   Client POST /register → 自行注册成一个 OAuth 客户端、拿到 client_id
   （RFC 7591）——无需手工找服务端签发凭证，Client 即装即用

③ 授权码 + PKCE 流程：
   Client 生成 code_verifier（随机串）+ code_challenge（verifier 的 S256 哈希）
   → 引导用户访问 /authorize（带 client_id、code_challenge、redirect_uri、scope）
   → 用户登录授权
   → 授权服务器回一个短暂的授权码（Authorization Code）
   → Client 用 授权码 + code_verifier 去 /token 换 Access Token
   （PKCE 的作用：即使授权码被中间人截获，没有 code_verifier 也换不到 token）

④ 带令牌调用：
   Client 每次调 MCP server 带 Authorization: Bearer <access-token>
   （禁止放 URL 查询参数；无效令牌返回 401）
   token 过期用 refresh_token 续；可随时撤销
```

#### PKCE 到底是什么（展开讲）

**要解决的问题**：传统授权码流程，客户端用固定的 `client_secret` 证明"我是合法客户端"，换 token 时要带上它。但这有个前提——**客户端能安全保存 secret**。服务器后端可以，可**公共客户端**（手机 App、桌面应用、SPA 前端）不行：密钥写在代码里反编译就拿到、抓包也能看到。一旦 secret 泄露，攻击者只要截获授权码（比如劫持 redirect URL），拿 码 + 偷来的 secret 就能换走 token。

**PKCE 的解法：用动态证明替代固定密钥**。客户端每次授权时**临时生成一对密钥**，只把"一半"（哈希）发给授权服务器，"另一半"（原文）留在自己内存里、不通过网络传。换 token 时才把原文拿出来，服务器验"哈希对不对得上"。

```
① 客户端生成 code_verifier（随机串，43~128 字符，每次不同）
② 算 code_challenge = SHA256(code_verifier)   ← S256 方法，单向哈希
③ 发授权请求时带 code_challenge（告诉服务器"我的证明的指纹是这个"）
④ 用户授权 → 服务器回授权码，同时记住这个 challenge
⑤ 客户端用 授权码 + code_verifier 去 /token 换 token
⑥ 服务器验证：SHA256(code_verifier) == 之前存的 code_challenge？
   是 → 发 token；不是 → 拒绝
```

**为什么安全**：`code_verifier` 只在客户端内存里、每次不同、**从不在网络上明文传**（网上传的只是它的哈希 challenge）。攻击者就算截获了授权码甚至 challenge，**他没有 code_verifier**——哈希是单向的，从 challenge 反推不出 verifier，换不到 token。

**类比**：取快递证明你是收件人。传统方式（client_secret）= 出示身份证，但身份证可能被偷；PKCE = 你下单时设了个**暗号**（verifier），只告诉快递员暗号的"指纹"（challenge，哈希），取件时你说出暗号（verifier），快递员验证指纹对得上才给你——偷你取件码（授权码）的人不知道暗号，取不走。

**为什么 MCP 强制它**：MCP client（Claude Desktop、Cursor 这类桌面/移动应用）正是"公共客户端"——无法安全保存 client_secret。OAuth 2.1 把 PKCE 从"推荐"升级为"强制"，所有公共客户端必须用。MCP 直接采 OAuth 2.1，所以"强制 PKCE"。

一句话：**PKCE = 客户端每次临时生成一对密钥，只传哈希不传原文，让"截获授权码"也换不走 token**——给"存不住固定密钥的公共客户端"的安全补丁。

#### 为什么是 OAuth 2.1 + PKCE（不是老 OAuth 2.0）

- **强制 PKCE**：MCP client 多是"公共客户端"（无法安全保存密钥，如桌面/移动应用），PKCE 防止授权码被截获后冒用——没有 code_verifier 换不到 token。OAuth 2.1 把它从推荐变强制。
- **禁止隐式流**：老 OAuth 2.0 的隐式流把 token 直接放 URL fragment 返回，易泄露，2.1 弃用。
- **Refresh Token 绑定强化**：防盗用。
- 简言之：OAuth 2.1 = OAuth 2.0 的"安全最佳实践"固化成强制要求，MCP 直接采默认安全。

#### 关键机制点

- **MCP server = 资源服务器**：它不自己发 token，而是验证 Bearer token、按 token 的 scope/权限执行。发 token 的是背后的**授权服务器**（可自建、也可接 Azure AD/WorkOS 这类第三方做企业 SSO）。
- **令牌绑定到用户**：所有工具调用以"对应关联用户的权限"执行，且随时可撤销——这是比静态 API key 安全得多的根本点。
- **元数据发现 + DCR 让"即插即用"成立**：Client 不用预先知道 server 用哪个授权服务器、不用手工注册，连上就能发现、自动注册、走授权——这是 MCP 标准化的关键一环。
- **协议版本协商**：请求带 `MCP-Protocol-Version` 头（如 `2025-03-26`），server 据此行为。
- **进阶**：可叠加 JWT 验证（验证 token 签名）、RBAC（按角色细粒度授权）、DPoP/MTLS（更高强度的令牌绑定）。这些是生产加固项，基础流程是上面的授权码+PKCE。

#### 一句话

MCP 的认证授权 = 远程 server 走 **OAuth 2.1（授权码 + 强制 PKCE + DCR + 元数据发现）**，令牌绑定用户、随时可撤销；本地 stdio 从环境取凭据。核心是"谁在请求、能做什么"都可控可审计，而不是裸 API key 一把梭。

---

## 三、A2A（Agent2Agent Protocol，智能体间协议）

### 解决什么问题

Agent 越来越多，但各厂商/框架的 Agent 互不相通（LangGraph 的 Agent 和 CrewAI 的 Agent 没法直接对话、你的 Agent 和 Salesforce 的 Agent 协作要写一堆定制胶水代码）——"**巴别塔困境**"。

**A2A**（Google 2025 年 4 月发布，后捐给 Linux 基金会，50+ 合作伙伴支持）解决这个：定义 Agent 之间的**开放通信标准**，让不同框架/厂商的 Agent 能互相发现、通信、协作。目标是"**Agent 时代的 TCP**"。

### 怎么工作

**通信基础**：基于 **HTTP + JSON-RPC 2.0 + SSE** 构建——复用成熟标准，易和企业 IT 集成。Agent 之间是 HTTP 请求-响应，长任务用 SSE 推送实时进展。

**Client-Server 模型**（但这里是 Agent 对 Agent）：
- **Client Agent（客户端）**：发起任务的一方。
- **Remote Agent（远程/服务端）**：执行任务的一方。
- 一个 Agent 既可当 Client 也可当 Server。

#### 第 1 步：发现——Agent Card（智能体名片）

每个 A2A Server 在 `/.well-known/agent.json` 暴露一个"名片"，Client 先 GET 这个文件了解"你能干什么、怎么调你"。长这样：

```json
{
  "name": "研究助手 Agent",
  "description": "能做资料检索和报告生成",
  "url": "https://research-agent.example.com/a2a",
  "version": "1.0",
  "capabilities": {
    "streaming": true,           // 支持SSE流式
    "pushNotifications": false   // 不支持推送
  },
  "authentication": {
    "schemes": ["OAuth2"]        // 要OAuth2认证
  },
  "skills": [
    {"name": "research", "description": "资料检索"},
    {"name": "report", "description": "生成报告"}
  ]
}
```

Client 看了名片就知道：这个 Agent 能干啥、端点 URL 在哪、要不要认证、支持不支持流式。这是"即插即用"的基础——不用预先知道对方是谁。

#### 第 2 步：发任务——tasks/send

Client 向 Remote Agent 的端点发 JSON-RPC 请求，发起一个 Task：

```json
// POST https://research-agent.example.com/a2a
// JSON-RPC 2.0 请求
{
  "jsonrpc": "2.0",
  "method": "tasks/send",
  "id": "req-001",
  "params": {
    "id": "task-abc123",                    // 任务唯一ID（Client生成）
    "sessionId": "session-xyz",             // 会话ID（多轮对话用）
    "message": {
      "role": "user",
      "parts": [
        {"type": "text", "text": "帮我调研2026年AI Agent市场的规模和趋势"},
        {"type": "data", "data": {"format": "markdown"}}  // 要求输出格式
      ]
    }
  }
}
```

**Message 的结构**：每条消息有 `role`（user/agent）和 `parts`（内容部件）。Part 有三种：
- **TextPart**：`{"type":"text","text":"..."}` —— 文本
- **FilePart**：`{"type":"file",...}` —— 文件（内联字节或 URI）
- **DataPart**：`{"type":"data","data":{...}}` —— 结构化数据（JSON 表单等）

这种多部件设计让 A2A 能传**多模态**内容（一段文本 + 一个文件 + 一个结构化表单）。

#### 第 3 步：跟踪进展——SSE 流式（长任务）

如果任务需要长时间（几分钟甚至几小时），Client 用 `tasks/sendSubscribe`（替代 `tasks/send`），Server 通过 **SSE** 实时推送进展：

```
// Client 发起（method 换成 sendSubscribe）
→ POST /a2a  {"method":"tasks/sendSubscribe","params":{...同上...}}

// Server 通过 SSE 推送事件流：
event: task
data: {"id":"task-abc123","status":{"state":"working","timestamp":"..."}}      ← 状态：进行中

event: task  
data: {"id":"task-abc123","status":{"state":"working","message":{               ← 中间过程输出
       "role":"agent","parts":[{"type":"text","text":"正在搜索市场数据..."}]}}}

event: task
data: {"id":"task-abc123","status":{"state":"input-required","message":{         ← 需要Client补充信息
       "role":"agent","parts":[{"type":"text","text":"要聚焦哪个地区？全球还是中国？"}]}}}
```

**Task 的生命周期状态**：

```
submitted → working → completed     （正常完成）
              ↓
         input-required              （需要Client补充信息，Client回答后继续working）
              ↓
            working → ...
              
任意状态 → failed / canceled        （失败或取消）
```

- `submitted`：刚收到任务
- `working`：正在执行
- `input-required`：需要 Client 补充信息（**这就是"对等主体"的体现**——Agent 能反问、能拒绝，不像工具只能被动执行）
- `completed`：完成
- `failed`/`canceled`：失败/取消

#### 第 4 步：拿结果——Artifact（工件）

任务完成时，Server 推送/返回 **Artifact**（任务输出）：

```json
{
  "id": "task-abc123",
  "status": {"state": "completed"},
  "artifacts": [
    {
      "name": "调研报告",
      "parts": [
        {"type": "text", "text": "# 2026年AI Agent市场调研\n\n## 市场规模\n..."},
        {"type": "file", "file": {"mimeType": "application/pdf", "uri": "https://..."}}
      ]
    }
  ]
}
```

Artifact 也有 parts（和 Message 一样的多部件结构）——输出可以是文本 + 文件 + 结构化数据的组合。

#### 其他接口

| 方法 | 作用 |
|---|---|
| `tasks/send` | 发任务，同步等结果（短任务） |
| `tasks/sendSubscribe` | 发任务 + SSE 流式订阅进展（长任务） |
| `tasks/get` | 查某任务当前状态（轮询，不想用SSE时） |
| `tasks/cancel` | 取消任务 |

### 关键设计点

- **Agent Card 让"即插即用"成立**：Client 不用预先知道对方是谁，GET 名片就知道能干啥、怎么调。
- **Task 是核心单元（不是单条消息）**：A2A 通信围绕"任务"组织，任务有生命周期、能长时运行、能中途要补充信息——这是和"调一次 API"的根本区别。
- **input-required 体现"对等主体"**：Agent 能反问、能要求补充、能拒绝——不像工具只能被动执行。这是 A2A 和 MCP 的本质区别（工具 vs 对等主体）。
- **不共享上下文**：协作时 Agent 保持独立，不共享内存/工具/上下文——靠消息（Message/Part）传递信息。
- **安全协作**：内置认证/授权（对等 OpenAPI 安全方案），Agent 间身份互信。
- **多模态**：Message/Artifact 的 Part 支持文本/文件/结构化数据，不只文字。

### 和 MCP 的关系（核心考点，别混）

| | MCP | A2A |
|---|---|---|
| 连接 | Agent ↔ 工具/数据 | Agent ↔ Agent |
| 对方角色 | 工具（被动被调） | 对等主体（能推理、能拒绝、能反委派） |
| 解决 | 怎么调外部资源 | 怎么和其他 Agent 协作 |

**互补、不冲突**：一个 Agent 用 MCP 连工具拿数据，用 A2A 和别的 Agent 协作。业界已形成"MCP 管能力增强、A2A 管通信协同"的分层栈（IBM 的 ACP 协议也已并入 A2A）。

---

## 四、厂商协议：OpenAI Function Calling vs Anthropic Tool Use

### 解决什么问题

Agent 要调工具，模型得能表达"我要调哪个工具、传什么参数"，结果还得能回传给模型继续推理。**每家模型厂商自己定了这套格式**——OpenAI 叫 Function Calling（后改名 Tool Calling），Anthropic 叫 Tool Use。这是 Agent 开发直接面对的协议层，也是 MCP 想标准化的对象。

两家都解决同一个问题（让模型输出结构化的工具调用意图、回传结果），但**设计哲学和具体格式差很多**——不是"同一个 JSON 换个字段名"，跨平台迁移会踩坑（在 OpenAI 跑得通、到 Anthropic 报 400）。

### 怎么工作（设计哲学差异，最根本）

**OpenAI：工具是"插件"——独立的特殊消息角色**
- 工具调用放在 assistant 消息的 `tool_calls` 字段里，是一个**独立数组**。
- 工具结果用**独立的 `role: "tool"` 消息**回传（和 user/assistant 并列的第四种角色），靠 `tool_call_id` 关联。
- 哲学：工具调用是"特殊事件"，相对独立于对话流。

**Anthropic：工具是"对话的一部分"——内嵌在消息内容块里**
- 工具调用是 assistant 消息 `content` 数组里的一个 `tool_use` **内容块**（和文本块并列）。
- 工具结果是 user 消息 `content` 数组里的 `tool_result` **内容块**，靠 `tool_use_id` 关联。
- 哲学：对话严格 user↔assistant 交替，工具调用不破坏这个节奏，是对话流的一部分（一条 assistant 回复可以文本+工具调用混合）。

### 关键机制对比（逐字段）

**工具定义 schema（请求里怎么声明工具）**：
```
OpenAI：tools=[{"type":"function","function":{"name":"get_weather","description":"...","parameters":{...}}}]
        ↑ 多一层 function 包装，参数叫 parameters
Anthropic：tools=[{"name":"get_weather","description":"...","input_schema":{...}}]
        ↑ 扁平，参数叫 input_schema
```

**模型返回的调用（响应里）**：
```
OpenAI：message.tool_calls = [{"id":"call_abc","type":"function","function":{"name":"get_weather","arguments":"{\"city\":\"北京\"}"}}]
        ↑ arguments 是【字符串】（JSON 字符串，要 json.loads 解析）
Anthropic：content = [{"type":"tool_use","id":"toolu_abc","name":"get_weather","input":{"city":"北京"}}]
        ↑ input 是【对象】（已解析，直接用）
```

**结果回传**：
```
OpenAI：{"role":"tool","tool_call_id":"call_abc","content":"22度"}    ← 独立的 tool 角色
Anthropic：{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_abc","content":"22度"}]}  ← 塞在 user 消息的内容块里
```

**其他差异**：

| 维度 | OpenAI | Anthropic |
|---|---|---|
| 消息角色 | system / user / assistant / **tool** 四种 | 仅 user / assistant（system 是顶层字段、tool_result 在 user 里） |
| system 提示 | messages 里 `role:"system"` | 顶层 `system` 字段（不在 messages 里） |
| content 类型 | 字符串或数组 | **必须数组**（纯文本也要数组形式） |
| max_tokens | 可选 | **必填** |
| 角色顺序 | 无强制交替 | **严格 user↔assistant 交替，首条必 user** |
| 结束原因字段 | `finish_reason`（stop/tool_calls） | `stop_reason`（end_turn/tool_use） |
| 并行多工具 | 支持，返回多个 tool_calls | 支持，多个 tool_use 内容块 |
| 强制调用某工具 | `tool_choice:"required"` | 无 required，有 `{"type":"tool","name":"..."}` 和 `{"type":"any"}` |
| 流式拼接 | `delta.tool_calls[].function.arguments` 增量拼 | `input_json_delta.partial_json` 增量拼 |
| strict 模式 | 有 strict | 有 `strict:true` |

### 跨平台迁移的坑（面试加分）

- **arguments 字符串 vs 对象**：OpenAI 的 arguments 是 JSON 字符串要 `json.loads`，Anthropic 的 input 是对象直接用——跨迁移忘转换会出错。
- **role:tool vs tool_result 内容块**：OpenAI 用独立的 tool 消息，Anthropic 把结果塞进 user 消息的内容块——消息结构完全不同，不能直接搬。
- **system 位置**：OpenAI 在 messages 里，Anthropic 在顶层——搬错位置会 400。
- **content 必须数组**：Anthropic 纯文本也要 `[{"type":"text","text":"..."}]`，OpenAI 可以直接字符串。
- **角色交替**：Anthropic 严格交替、首条必 user，OpenAI 不强制——从 OpenAI 迁到 Anthropic 时连续同角色消息会 400。
- **schema 嵌套**：OpenAI 多一层 `function` 包装、参数叫 `parameters`；Anthropic 扁平、叫 `input_schema`——字段名和结构都不同。

这就是为什么会有 MCP / 适配层（如 LiteLLM、各框架的 provider 适配）——把各家不同的厂商协议翻译成统一接口，一份工具定义跑多家模型。

### 和 MCP 的关系

厂商协议是**模型 API 自带**的、每家不同；MCP 是**跨厂商的开放标准**，把"工具怎么暴露/发现/调用"统一。关系：MCP server 暴露工具，底层对接时仍要转成各家厂商协议的格式喂给模型（MCP client 嵌在 Host 里做这层翻译）。MCP 是对厂商协议的"上层标准化 + 生态化"。

---

## 五、四者对比与选型

| | 厂商协议（OpenAI/Anthropic） | MCP | A2A |
|---|---|---|---|
| 是什么 | 模型 API 自带的工具调用格式 | 跨厂商工具暴露/调用标准 | Agent 间通信标准 |
| 连接对象 | 模型↔工具（每家格式不同） | 工具/数据源（跨厂商统一） | 其他 Agent |
| 提出方 | OpenAI(2023) / Anthropic(2024) | Anthropic(2024.11) | Google(2025.4) |
| 对方角色 | 被动工具 | 被动工具/数据 | 对等主体 |
| 解决的痛点 | 让模型能表达"调工具" | 各家格式不统一→M+N | Agent 互不相通 |
| 关系 | 是 MCP 想标准化的对象 | 把厂商协议标准化（client 做翻译） | 互补，不管工具 |

**怎么选/怎么搭**：
- **直接用某家模型** → 用该家的**厂商协议**（OpenAI Function Calling / Anthropic Tool Use），这是模型 API 自带的、最直接。
- 要**跨模型复用工具/接入生态** → 上 **MCP**（MCP server 暴露工具，底层翻译成各家厂商协议喂模型）。
- 要让 Agent **和别的 Agent 协作**（跨框架/跨厂商）→ 用 **A2A**。
- 常叠加：Agent 用厂商协议调工具（或经 MCP 标准化）、用 A2A 和别的 Agent 协作。

一句话：**厂商协议是各家模型自带的"调工具"格式（OpenAI 插件式、Anthropic 对话内容块式）；MCP 把它标准化成跨厂商通用；A2A 让 Agent 之间能协作**——从"各家自有协议"到"工具标准化"再到"Agent 互联"，三层搭起 Agent 生态。
