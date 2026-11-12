# dsh-im-hub 设计文档（方向③：跨 IM 统一底座）

> 状态：草案 v1（待用户确认后进入脚手架实现）
> 平台：**Windows only**（用户已拍板：放弃 macOS，只做 Windows）

## 1. 目标与非目标

### 目标
把「一个大脑 + 多个 IM 手」做成一款 DSH 插件：QQ 与微信共用一个 AI 大脑，共享
人设、长期记忆与会话上下文，底层走协议/注入（不是视觉 OCR），后台无头运行，
用自己的号给好友发消息。

### 非目标（本阶段不做）
- 不做 macOS（微信在 mac 上无法走后台个人号，放弃）。
- 不做视觉 OCR 驱动微信（用户明确「不要现在这种视觉的微信」）。
- 不做群聊高级功能（先保证 1v1 私聊跑通，群聊按需再加）。
- 不保证「绝对不封号」（个人号协议/注入有真实风控风险，用户已知悉）。

## 2. 架构总览

```
Windows 机器
├── 微信 PC 端（已登录本人号）
│     └── WeChatFerry 注入（sdk.dll）→ RPC tcp://127.0.0.1:10086/10087
├── QQ（NapCat 托盘）→ OneBot v11 WebSocket ws://127.0.0.1:3001
└── DSH（Cordis 宿主）
      └── dsh-im-hub 插件（Node/JS）
          ├── brain/          # 大脑：人设 + 长期记忆 + 会话 + LLM
          ├── adapter/qq.js   # OneBot v11 WS 客户端（纯 JS，用 ws）
          ├── adapter/wechat.js + sidecar/  # Python sidecar 桥接 WeChatFerry
          ├── normalize/      # IM 事件 → 统一 ConversationEvent
          └── store/          # state.json / memory / session 持久化
```

**关键取舍**：QQ 走 OneBot WS 可以纯 JS 实现；微信 WeChatFerry 的官方客户端是
Python（`pynng` + `protobuf` + `sdk.dll`），在 JS 里重写 protobuf 脆弱且难维护，
所以微信适配器采用 **Python sidecar + JSON-Lines 桥接**：DSH 插件 spawn 一个
Python 子进程，子进程内部用官方 `wcferry` 客户端收发，对外只暴露一行一行的 JSON。

## 3. 统一消息模型

所有 IM 事件先归一化成同一种结构，大脑只认这一种结构：

```ts
interface ConversationEvent {
  platform: 'qq' | 'wechat'
  contactId: string          // 平台原始 id：QQ 号 / 微信 wxid
  contactName: string        // 备注名或昵称（显示用）
  unifiedId: string          // L3：跨平台统一身份（见 §6）
  isGroup: boolean
  roomId?: string            // 群聊时填 room id，私聊为空
  kind: 'text' | 'image' | 'file' | 'voice' | 'sticker' | 'system' | 'revoke'
  text?: string              // kind=text 时
  media?: { path?: string; url?: string; name?: string }
  ts: number                 // 毫秒时间戳
}
```

发送统一走：

```ts
interface OutboundMessage {
  platform: 'qq' | 'wechat'
  contactId: string
  text: string
}
```

## 4. QQ 适配器（NapCat / OneBot v11）

- **协议**：OneBot v11，正/反向 WebSocket 都支持，默认正向（DSH 作为客户端连
  NapCat 的 `ws://127.0.0.1:3001`，带 `accessToken`）。
- **消息格式**：NapCat WS 须选 **array** 格式（沿用 dsh-qq-onebot 的结论）。
- **入站**：`message.private` → 私聊；`message.group` → 群聊；过滤 `post_type=meta_event`。
  文本取 `message` 数组里 `type=text` 的 `data.text`。
- **出站**：`send_private_msg`（`user_id` + `message`）。
- **依赖**：Node 内置 `ws`（或 `undici` 的 WebSocket），不引 pynng/protobuf。

## 5. 微信适配器（WeChatFerry + Python sidecar）

- **WeChatFerry**：`lich0821/WeChatFerry`，Windows 微信个人号注入框架，后台运行。
  RPC：命令通道 `tcp://127.0.0.1:10086`、消息通道 `10087`，`pynng Pair1` + `protobuf`。
- **官方 Python 客户端** `wcferry` 关键接口（已核实）：
  - 登录：`get_qrcode()`（返回二维码，已登录返回空）/ `is_login()` / `get_self_wxid()`。
  - 收消息：`enable_receiving_msg()` 后起 daemon 线程收 `WxMsg` 进 `msgQ`，
    `get_msg(block=True)` 出队（1s 超时）。旧 `enable_recv_msg(callback)` 已废弃。
  - 发消息：`send_text(msg, receiver, aters="")` 返回 0=成功（receiver = wxid 或 roomid）；
    `send_image` / `send_file` / `send_emotion` / `send_rich_text` / `send_pat_msg` / `forward_msg`。
  - 好友：`get_friends()` 过滤掉 `@chatroom` 群、`gh_` 公众号、
    `fmessage/medianote/floatbottle/filehelper/newsapp` 特殊号；`get_contacts()` 全量。
- **sidecar 协议**（JSON-Lines over stdio，DSH 插件 ↔ Python 子进程）：
  - 下行（插件 → sidecar）：`{"id":"...","cmd":"send_text","args":{"text":"...","receiver":"wxid_xxx"}}`
    以及 `{"cmd":"get_qrcode"}` / `{"cmd":"get_friends"}` / `{"cmd":"is_login"}` 等。
  - 上行（sidecar → 插件，逐行）：`{"id":"...","ok":true,"result":...}` 或
    `{"type":"message","msg":{...WxMsg 字段...}}`。
  - sidecar 内部：`Wcf(host=None, block=False)` 自启动 SDK，拿二维码 → 交回插件 →
    插件把二维码转图片发给用户在终端/面板扫码 → 登录后 `enable_receiving_msg()` 持续收。
- **约束**（已核实）：`send_*` 非线程安全，sidecar 内串行化发送；文本里的换行用单反斜杠
  `\n`；`@所有人` 用 `notify@all`。

## 6. L3：跨 IM 身份映射与连续会话

「同一个人微信说一半、QQ 接着接上」的落地方式分两层：

1. **显式身份映射**（v1，可靠）：配置里维护一张映射表，把两个平台的原生 id 归到
   同一个 `unifiedId`：
   ```yaml
   identityMap:
     - unified: friendA
       qq: "123456789"
       wechat: "wxid_xxxxxxxx"
   ```
   消息进来后按 `platform + contactId` 查表得到 `unifiedId`，未映射的私聊按
   `platform:contactId` 自动生成临时 `unifiedId`（单平台也正常工作）。
2. **自动联想**（v2，可选，靠备注名/昵称相似度 + 用户确认，先不做进 v1）。

**会话与记忆按 `unifiedId` 隔离存储**：
- 短期：每个 `unifiedId` 最近 N 轮（默认 20）对话，用于拼 LLM 上下文。
- 长期：每个 `unifiedId` 一份 `memory.md`，由大脑在对话中/定时合并关键事实
  （偏好、称呼、待办），默认 04:30 每日 consolidation。

## 7. 大脑（brain）

- **人设**：全局一份 `persona`（volatile 配置），作为 system prompt。
- **上下文组装**：`[system: persona] + [long-term: memory.md 摘要] + [history: 最近 N 轮] + [新消息]`。
- **LLM**：走 `ctx.llm.stream({ provider, model, messages })`，模型/提供商可配
  （沿用方向②的 `streamText` 经验：chunk 用 `chunk.type`，终态 `error/aborted` 看 `kind`）。
- **回复路由**：从哪个平台来、回哪个平台去（OutboundMessage.platform 与来源一致），
  但上下文包含同一 `unifiedId` 在另一平台的历史（这就是 L3 连续性的来源）。
- **防重**：单实例锁 + 按 `unifiedId` 记录 `lastInboundId/lastSentText`，避免重复回复。

## 8. 配置（Schemastery，设置面板可见字段加 `.volatile()`）

```ts
Config = z.object({
  enabled: z.boolean().default(false).volatile(),          // 总开关
  persona: z.string().default('').volatile(),              // 人设
  provider: z.string().default('deepseek-account').volatile(),
  model: z.string().default('deepseek-v4-pro').volatile(),
  replyCooldownSec: z.number().default(10).volatile(),
  maxHistoryTurns: z.number().default(20).volatile(),
  // QQ
  qqEnabled: z.boolean().default(false).volatile(),
  qqWsUrl: z.string().default('ws://127.0.0.1:3001').volatile(),
  qqToken: z.string().default('').volatile(),
  // 微信
  wxEnabled: z.boolean().default(false).volatile(),
  wxSidecarPath: z.string().default('').volatile(),        // 空则用插件内置 sidecar
  // L3 身份映射
  identityMap: z.array(z.object({
    unified: z.string(), qq: z.string().optional(), wechat: z.string().optional(),
  })).default([]),                                          // 数组先不做 volatile（v1 走文件）
})
```

> 说明：数组类型在 settings 表单里的 editable 支持有限，v1 的 `identityMap` 先落在
> `store/identity.json`（文件热加载），面板只给一个「打开映射文件」提示；后续再考虑面板化。

## 9. 目录结构（脚手架）

```
dsh-im-hub/
├── package.json            # type:module, dsh.bundle.patch, dsh.client, optional peerDeps
├── cordis.patch.yml        # - insert: [{id: dsh-im-hub, name: dsh-im-hub}]
├── lib/
│   ├── index.js            # Config + apply(ctx,config) + 心跳 + 装配各适配器
│   ├── brain.js            # 会话/记忆/上下文组装 + LLM 回复
│   ├── store.js            # state.json / memory / identity 持久化（原子写）
│   ├── normalize.js        # IM → ConversationEvent
│   └── adapters/
│       ├── qq.js           # OneBot v11 WS 客户端
│       └── wechat.js       # spawn Python sidecar + JSON-Lines 桥接
├── sidecar/
│   ├── wcferry_bridge.py   # 官方 wcferry 客户端封装 + stdio JSON 协议
│   └── requirements.txt    # wcferry, pynng, protobuf
├── client.js               # 设置面板（总开关/人设/各平台开关/状态）
├── locale/{zh,en}.json
└── README.md
```

## 10. 里程碑

- **M1 骨架**：插件可加载、Config/状态/记忆目录就绪、空心跳。
- **M2 QQ 适配器**：OneBot WS 收/发，单平台私聊自动回复跑通（Windows + NapCat 运行）。
- **M3 微信适配器**：Python sidecar + WeChatFerry 收/发，单平台私聊自动回复跑通。
- **M4 L3 统一**：identityMap 生效，QQ+微信共享会话/记忆，跨 IM 连续对话。
- **M5 交付**：设置面板、README、权限说明（NapCat/WeChatFerry 安装）、打包发布。

## 11. 已知风险与缓解

| 风险 | 说明 | 缓解 |
|---|---|---|
| 封号/风控 | NapCat、WeChatFerry 都是个人号非官方协议/注入 | 默认低频、单实例、可关；README 明确告知，建议小号 |
| 微信版本升级 | WeChatFerry 绑定特定微信版本（39.x） | 锁版本，README 写明匹配版本 |
| 跨 IM 身份识别 | v1 依赖手动映射 | v2 昵称联想 + 用户确认 |
| sidecar 崩溃 | Python 子进程退出 | 插件监听 exit，自动重启 + 重连 |
