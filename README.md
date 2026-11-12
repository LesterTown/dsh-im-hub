# dsh-im-hub

跨 IM 统一底座（方向③）：QQ 与微信共用一个 AI 大脑，共享人设、长期记忆与会话上下文。

- **QQ**：NapCat / OneBot v11（协议接入，纯 JS WebSocket 客户端）。
- **微信**：WeChatFerry（Windows 后台个人号注入，Python sidecar 桥接）。
- **大脑**：一个 DSH 插件，按 `unifiedId` 隔离会话/记忆，尽量做到 L3 跨 IM 连续对话。

> 平台：**Windows only**（微信后台个人号在 macOS 不可用）。
> 风险：NapCat 与 WeChatFerry 均为个人号非官方协议/注入，有封号风控风险，建议用专用小号。

## 目录

```
lib/index.js         入口：Config + 心跳 + 适配器装配 + 回复管线
lib/pipeline.js      回复管线核心（去重/冷却/组上下文/回发/持久化，可单测）
lib/brain.js         上下文组装 + LLM 回复 + 长期记忆合并
lib/store.js         state / memory / identity 持久化（原子写）
lib/normalize.js     QQ/微信事件 → 统一 ConversationEvent
lib/adapters/qq.js      OneBot v11 WS 客户端
lib/adapters/wechat.js   spawn Python sidecar 桥接
sidecar/wcferry_bridge.py  WeChatFerry stdio JSON 协议
client.js            设置面板
scripts/link-peers.{sh,ps1}  软链/junction peer 依赖（link 安装用）
docs/windows-setup.md        Windows 部署与配置指南
test/                 单元测试（node --test）
DESIGN.md            设计文档
```

## 依赖

- Node >= 22（用到全局 `WebSocket`）。
- QQ：运行 NapCat，开启正向 WebSocket（`ws://127.0.0.1:3001`，消息格式选 array），配置 accessToken。
- 微信：Windows 上装匹配版本的微信 PC 端 + WeChatFerry，`pip install -r sidecar/requirements.txt`。

## 安装（Windows 上的 DSH）

```powershell
dsh plugin --profile desktop add <path-to-dsh-im-hub>
.\scripts\link-peers.ps1   # junction peer 依赖，避免 ERR_MODULE_NOT_FOUND
# 完全退出并重开 DeepSeek Harness
```

（macOS/Linux 用 `scripts/link-peers.sh`。）完整部署步骤见 `docs/windows-setup.md`。

在设置页「跨 IM 自动回复」里填人设、开总开关和各平台开关。
L3 身份映射在数据目录下的 `identity.json`（数组）：`[{"unified":"friendA","qq":"123456789","wechat":"wxid_xxx"}]`。

## 配置项（设置面板可改，均为 volatile）

| 字段 | 默认 | 说明 |
|---|---|---|
| enabled | false | 总开关 |
| persona | '' | 人设（system prompt） |
| provider / model | deepseek-account / deepseek-v4-pro | LLM |
| replyCooldownSec | 10 | 同人回复冷却 |
| maxHistoryTurns | 20 | 短期历史轮数 |
| qqEnabled / qqWsUrl / qqToken / qqSelfId | — | QQ 适配器 |
| wxEnabled / wxSidecarPath | — | 微信适配器 |

## 状态与记忆

数据目录优先级：`DSH_IM_HUB_DATA` → `baseDir/dsh-im-hub` → `~/.dsh/dsh-im-hub`。

- `state.json`：每个 `unifiedId` 的 lastInboundId / lastSentText / lastTs（去重）。
- `memory/<id>.md`：长期记忆（对话自动追加合并）。
- `session/<id>.json`：短期最近 N 轮。
- `identity.json`：L3 跨平台身份映射。

## 开发

```bash
npm run check   # 语法检查（node --check）
npm test        # 单元测试（35 项，覆盖归一化/存储/记忆/管线/两适配器协议）
```

## 状态

M1 骨架 / M2 QQ（NapCat）/ M3 微信（WeChatFerry）/ M4 L3 统一 / M5 交付，均已完成；`npm test` 35 项全绿。

## License

MIT
