# 开源 Agent 源码解析:hermes-agent

> 基于 `github.com/NousResearch/hermes-agent` 的 **main 分支**(最新,v2026.7.x)。聚焦**多 IM 对接的工程实现**这一条主线——架构、通信协议、流式输出、会话并发。重在核心逻辑和机制,关键处附代码片段。

---

## 一、为什么解析它 / 看什么

hermes-agent 是一个能接入二十多个 IM(钉钉/飞书/企微/Slack/Discord/Telegram/WhatsApp/Signal/Matrix/Mattermost/Email/微信/QQ/元宝…)的 Agent 框架。它的价值不在 agent 推理多强,而在**把"Agent 对接多 IM"这件脏活做得很完整、可读**——这正是工业级 Agent 落地最容易被忽略、面试也最容易问住的部分。

解析聚焦四个工程问题:
1. 接二十多个 IM,怎么不写二十多份重复逻辑?(适配架构)
2. Agent 跟每个 IM 之间到底用什么协议通信?(澄清"是不是都走 SSE")
3. HTTP API 不支持流式,IM 里的打字效果怎么实现的?
4. Agent 处理中用户又发消息怎么办?(会话并发)

---

## 二、整体架构:IM 接入层与 agent 核心解耦

仓库分两层,脏活全在接入层,且和 agent 核心解耦:

- **接入层(gateway/)**:IM 收发、协议适配、流式输出、会话状态。agent 只产生/消费统一消息,永远不碰任何 IM 的原生 API。
- **agent 核心(agent/、hermes/)**:推理、工具、记忆(本文不展开)。
- **acp_adapter/**:对外用 Agent Communication Protocol 暴露 agent 能力。
- **providers/**:模型 provider;**tools/、skills/**:工具与技能;**web/、tui_gateway/**:前端。

**认知**:接入层和 agent 核心靠"统一消息模型"解耦——这正是 DDD 反腐败层的思想:IM 是外部系统,接入层把它的概念翻译进内部统一模型,不让外部脏概念(钉钉 session_webhook、飞书 file_key、企微加密)污染 agent 核心。

---

## 三、多 IM 适配架构:Channel Adapter + 统一消息模型 + 插件化

### 1. 每 IM 一个 adapter 模块

接入层把 IM 适配拆成两类:
- **原生内置**(gateway/platforms/):只留少数——signal、whatsapp_cloud、weixin、yuanbao、bluebubbles、webhook、api_server 等 + 共享基类与辅助。
- **插件式**(plugins/platforms/):**主流 IM 全在这里**——dingtalk、feishu、wecom、slack、discord、telegram、matrix、mattermost、email、google_chat、irc、line、simplex、teams、whatsapp、sms、homeassistant、ntfy、photon、raft 等。

**关键演进**:不是"内置一堆 + 少量插件",而是**主流 IM 已全面插件化、内置只留少数**。新接 IM 走插件,完全不碰核心代码——这是"加 IM 不改主逻辑"设计的极致形态。

### 2. 统一消息模型 + 适配器基类

这是"各 IM 原生格式 ↔ 内部统一格式"双向翻译的枢纽,定义在接入层基类文件里:

- **`MessageEvent`**(统一入站消息):跨 IM 标准字段——`text`(纯文本兜底)、`source`(会话来源)、`message_id`、`reply_to_message_id`/`reply_to_text`(上下文注入用)、`raw_message`(原始报文兜底透传)、`media_urls`/`media_types` 等。各 IM 原生报文进 adapter 后翻译成它,agent 核心只认这个。
- **`BasePlatformAdapter(ABC)`**:定义 `connect()`/`disconnect()`/`send_draft()` 等统一接口,每个 IM 的 adapter 继承它填实现。
- 辅助:`MessageType`(TEXT/PHOTO/...)、`SendResult`、`EphemeralReply`(短时消息)。

### 3. 注册表替代 if/elif(自注册发现)

注册表的注释原话点明设计意图:
> Allows platform adapters (built-in and plugin) to self-register so the gateway can **discover and instantiate them without hardcoded if/elif chains**.

机制:插件 adapter 调 `register(PlatformEntry(...))` 注册自己;gateway 用 `create_adapter(name, config)` 按名发现实例化。**新接 IM = 注册一个 entry,主逻辑零改动**。`PlatformEntry` 自描述:工厂函数、依赖检查、配置校验、必需环境变量、安装提示(如 `pip install irc`)。

### 4. 对应到设计模式

这就是**适配器模式 + 反腐败层(ACL)**:adapter 把外部 IM 的概念翻译进内部统一模型,隔离脏概念。和《领域建模》里限界上下文一个思想。

---

## 四、Agent ↔ IM 通信协议:不是都走 SSE!

### 1. 先分清两个方向(最易混)

- **方向 A:Agent ↔ IM 平台**(收/发 IM 消息)——协议由 IM 厂商定,Agent 只能适配。**主流 WebSocket,不是 SSE**。
- **方向 B:Agent → 前端用户**(流式输出打字效果)——协议 Agent 自己定,这层常用 SSE。

用户常误以为"Agent↔IM 走 SSE",实际方向 A 几乎不用 SSE。

### 2. 协议五花八门(实锤)

各 IM 入站协议各不相同:
- **WebSocket 系**:企微(持久 WebSocket,wss://openws.work.weixin.qq.com)、Discord、Mattermost 等——IM 需要"接收消息"方向,WebSocket 全双工更合适,厂商自家长连接都选它。企微还**同时支持 webhook 回调**(有独立的 callback_adapter)。
- **Webhook / long polling**:Telegram(webhook 模式 或 getUpdates 轮询)。
- **IMAP 轮询**:Email(IMAP 拉收 + SMTP 发)。
- **SSE**:**只有 Signal 用**——注释原话 "Inbound messages arrive via SSE (Server-Sent Events) streaming",还专门写了退避重连(`SSE_RETRY_DELAY_INITIAL=2.0, MAX=60.0`)。
- 出站(发消息)大多走各 IM 的 HTTP 发消息 API。

**关键观察**:WebSocket 是方向 A 主流;**SSE 只有 Signal 一家**;还有 webhook、long polling、IMAP 轮询。协议五花八门,所以才需要 adapter 层统一翻译。**协议不是按"收/发方向"分,是按"哪个 IM"分**——WebSocket 全双工收发可同协议,但具体每 IM 收发可能不同(企微收发都 WebSocket,钉钉收 WS 发 HTTP),全看 IM 厂商给的接口。

---

## 五、流式输出怎么实现:HTTP API 不支持流式,靠 edit 消息模拟

### 1. 核心思路:占位消息 + 反复 edit

HTTP 发消息 API 是"一次性发一条、发完就定",没法边发边长。流式消费器用"先发占位消息拿 message_id,再反复调 IM 的 edit API 更新内容"模拟打字:
1. **第一条**:调发消息 API 发占位消息,拿 `message_id`。
2. **后续**:Agent 吐新 token → 调"编辑消息"API 更新那条内容。
3. **结束**:最后一次 edit 写完整答案 + `finalize` 定稿。

前提:该 IM 有"编辑消息"API,所以有 `SUPPORTS_MESSAGE_EDITING` / `supports_draft_streaming` 能力声明,不支持的降级成"生成完一次性发"。

### 2. 不能每个 token 都 edit——节流优化(关键片段)

如果每 token 都发 HTTP edit,IM 立刻限流封号。流式消费器做了一堆节流,核心是**攒够间隔才 edit**:

```python
now = time.monotonic()
elapsed = now - self._last_edit_time
if elapsed >= self._current_edit_interval:   # 攒够间隔才真正 edit
    ...发 edit...
    self._last_edit_time = time.monotonic()
```

token 在间隔内只攒在内存里,攒够一次性 edit 上去——既防限流,又让用户看到"一段一段长出来"。其它节流:

```python
# 内容去重:和上次发的一样就跳过,无意义 edit
if text == self._last_sent_text:
    return True

# 太短不发:只有 1~2 字符+光标时不开新消息
_MIN_NEW_MSG_CHARS = 4
if (self._message_id is None and self.cfg.cursor in text
        and len(_visible_stripped) < _MIN_NEW_MSG_CHARS):
    return True   # 攒着,防光标▉卡成豆腐块(Telegram/Matrix 报过这 bug)

# 自适应退避:edit 被限流失败 → 间隔翻倍(adaptive backoff)
self._current_edit_interval = min(self._current_edit_interval * 2, 上限)
```

外加:
- **光标 strip**:流式光标▉在 edit/定稿时 strip 掉,防残留成豆腐块。
- **分段开新消息**:tool boundary(调工具)时 finalize 当前消息 + 开新消息,避免一条无限长。
- **finalize 定稿**:`REQUIRES_EDIT_FINALIZE` 声明——钉钉 AI 卡片等要求显式 finalize,否则消息停在草稿态不入历史。

### 3. 两条实现路径(按 IM 能力分)

- **路径 A:edit-based(主流)**——发真实消息拿 message_id → 反复 edit → 定稿。消息一直在用户历史里。
- **路径 B:draft streaming(Telegram)**——中间帧走 `send_draft()`(草稿态,不进历史、没 message_id);最终答案走正常 sendMessage,草稿被真实消息自然覆盖。注释:"drafts have no message_id... the regular sendMessage clears the draft naturally"。

### 4. 一句话

HTTP API 不支持流式,Hermes 靠 **"发 1 条占位消息拿 message_id + 反复调 edit API 更新内容"** 模拟打字。优化全围绕"别把 IM edit API 打爆":时间节流(攒够间隔才 edit)、内容去重、太短不发(防光标豆腐块)、自适应退避(被限流翻倍间隔)、分段开新消息、finalize 定稿。有原生草稿流式的 IM(Telegram)走 draft→sendMessage,不用 edit。

---

## 六、会话并发:处理中又来消息怎么办

### 1. 核心策略:同会话串行 + pending 队列

Agent 正在处理一个 turn(含流式 edit 全套)时,同会话又来消息 → **不立即处理**,存进 `pending_messages`(按 session_key)。当前 turn 完整跑完(含最后一次 edit + finalize)后,取 pending 里那条作下一个 turn。

**为什么必须串行、不能并发处理两条**:
- 两个 turn 抢着 edit **同一条消息**(同 session 流式消息是同一条 message_id),内容互相覆盖、乱跳。
- Agent 会话状态(context/记忆)被两个 turn 同时读写,不一致。
- 流式窗口、token 计费、工具调用状态会串。

### 2. 连发合并(关键片段)

`merge_pending_message_event` 的注释点出两个真实场景:

```python
# 图片连发(burst):用户一次发多张照片(相册爆发成多条 PHOTO 事件)
# → 合并成一条排队,下个 turn 一起看整个相册,而不是只处理第一张
if existing_is_photo and incoming_is_photo:
    existing.media_urls.extend(event.media_urls)   # 媒体合并

# 文字连发(merge_text):用户一句话分几条打("对了""再加一句")
# → append 进队列而非替换,防只留最后一条把前面思想截断
if merge_text and ...:
    existing.text = _merge_caption(existing.text, event.text)   # 文本拼接
```

这正处理"处理期间又发消息"的真实场景:常是**补充/修正同一想法**,所以合并而非各算独立 turn。

### 3. 重启中断续传

session 有 `resume_pending` 标志:gateway 重启中断的 session,下次保留 session_id 续上(区别于"强制清除"信号,后者总是优先)。

### 4. 业界两种策略对比(hermes 选排队合并)

| 策略 | 做法 | 典型 | 代价 |
|---|---|---|---|
| **排队 + 合并**(hermes) | 新消息存 pending,当前 turn 完成后接着处理;连发合并 | 大部分 IM bot | 第二条要等;上下文完整不丢思想 |
| **中断 + 重来** | 用户发新消息 = 取消当前 turn,新消息重新开始 | ChatGPT 网页(生成时再发会打断) | 响应快贴"改主意";但浪费已生成 token、前面工作丢 |

hermes 选排队合并,因为 **IM bot 场景连发多为补充同一想法**(分几条打一句话常见),合并比打断合理;且 IM 里"中断当前流式 edit"会让消息停半截、体验割裂。ChatGPT 网页能中断是因前端可控(直接停渲染),IM 端没那么自由。

---

## 七、其它工程优化

| 优化 | 机制 |
|---|---|
| **附件本地缓存** | IM 附件多要先下载再上传目标 IM 拿 media_id;缓存避免重复下载,定时清(24h)防磁盘涨 |
| **限流** | 各 IM 发送配额不同,adapter 内置限流(signal_rate_limit、http client 连接数上限)防打爆 |
| **幂等去重** | IM 回调/IMAP 可能重发,按 message_id 去重防重复处理(如 Email 的 seen_uids) |
| **UTF-16 长度** | Discord/Slack 字数限制按 UTF-16 码元算(emoji/中文算多码元),用 utf16_len 算并在超限截断前缀,防被截断 |
| **代理出网** | 企业内网出网代理(resolve_proxy_url / proxy_kwargs) |
| **SSRF 防护** | 防 redirect 跳内网(_ssrf_redirect_guard) |
| **日志脱敏** | URL 脱敏防凭据泄露(safe_url_for_log) |

---

## 八、面试要点速查

1. **接二十多个 IM 怎么不写 N 份重复逻辑?** → 每 IM 一个 adapter 模块 + 统一消息模型 `MessageEvent` + 基类 `BasePlatformAdapter` + 注册表自注册(替代 if/elif);主流 IM 全插件化,新接 IM 走插件、主逻辑零改动。思想 = DDD 反腐败层。
2. **Agent↔IM 是 SSE 吗?** → 不是。主流 WebSocket(企微/Discord/Mattermost),还有 webhook/long polling/IMAP 轮询,**SSE 只有 Signal 用**。SSE 用在 Agent→前端网页的流式输出(方向 B)。
3. **HTTP API 不支持流式,IM 打字效果怎么做?** → 发 1 条占位消息拿 message_id + 反复调 edit API 更新内容模拟;节流(时间间隔/内容去重/太短不发/自适应退避)+ finalize 定稿;Telegram 走 draft→sendMessage 不用 edit。能力声明 `SUPPORTS_MESSAGE_EDITING` 控制降级。
4. **处理中用户又发消息怎么办?** → 同会话串行,新消息进 pending 队列;连发合并(图片 burst 合相册、文字 append 防截断);当前 turn 完成后接着处理。不并发是因两 turn 抢同一条 edit 消息、状态打架。hermes 选排队合并而非 ChatGPT 式中断重来。
5. **做了哪些工程优化?** → 附件本地缓存(24h 清)、限流、幂等去重(message_id)、UTF-16 长度防截断、代理出网、SSRF 防护、日志脱敏。

---

## 九、可延伸:其它开源 Agent

`~/open-source-project/` 下还有可对比解析的项目:`opencode`、`everything-claude-code`、`oh-my-claudecode`、`learn-claude-code`(Claude Code 类)、`TradingAgents`(多 Agent 交易)、`multi-repo-orchestrator`、`follow-builders`、`ai-berkshire`。后续可按同一深度解析对比,重点看推理框架选型、工具调用、记忆/上下文、多 Agent 协作、安全——和本篇的"多 IM 接入"互补(本篇讲接入层,那些讲推理层)。
