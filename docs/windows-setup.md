# Windows 部署与配置指南（QQ + 微信）

本文件是 `dsh-im-hub` 在 **Windows** 上的部署与配置指南，按步骤把 QQ（NapCat / OneBot v11）与微信（WeChatFerry）接入插件。所有第三方步骤以官方 README 为准，这里只给关键参数和本插件的映射关系。

## 0. 前提

- Windows 10/11，装好 **DeepSeek Harness** 桌面端（Electron 版）。
- 已登录的 **QQ NT**（新版 QQ，NapCat 支持的那个）。
- **微信 PC** 3.9.x（WeChatFerry 只支持特定微信版本，见官方 README，务必先对齐版本）。
- Python 3.9+（跑微信 sidecar 用）。

## 1. 安装插件

在项目目录里执行（PowerShell）：

```powershell
dsh plugin --profile desktop add .
.\scripts\link-peers.ps1
```

`link-peers.ps1` 会把 `@deepseek-ai/schemastery` 等 peer 依赖 junction 到插件自己的 `node_modules/`（`dsh plugin add <本地目录>` 走 link 安装，Node 从插件真实路径解析 import，否则会 `ERR_MODULE_NOT_FOUND`）。

> 若你的 profile 不是 desktop：`.\scripts\link-peers.ps1 -DSH_PROFILE_DIR <profile 路径>`。

改完代码后，**完全退出 DeepSeek Harness 再打开**（或 touch `~/.dsh/profiles/desktop/cordis.patch.yml` 触发热重载）。

## 2. QQ 走 NapCat / OneBot

1. 装 **NapCat**：https://github.com/NapNeko/NapCatQQ （按官方 README，Windows 一键版）。
2. 打开 NapCat 的 WebUI（默认 `http://127.0.0.1:6099`，端口以实际为准），配置 **OneBot 11 正向 WebSocket**：
   - **网络类型**：WebSocket 服务器（正向，让插件主动连你）
   - **监听地址/端口**：`127.0.0.1:3001`（对应插件配置 `qqWsUrl`，默认 `ws://127.0.0.1:3001`）
   - **Access Token**：随便设一个，填到插件 `qqToken`（可留空则不校验）
   - **消息格式**：选 **array**（CQ 数组格式，本插件按 `message: [{type,data}]` 解析）
3. 用 NapCat 登录你的 QQ 号（扫码），拿到 `selfId`（你的 QQ 号）填到插件 `qqSelfId`。

## 3. 微信走 WeChatFerry

1. 装 **WeChatFerry**：https://github.com/lich0821/WeChatFerry （务必按官方 README 对齐微信 PC 版本）。
2. 装 sidecar 依赖：

   ```powershell
   pip install -r .\sidecar\requirements.txt
   ```

   （`requirements.txt` 内容为 `wcferry`、`pynng`、`protobuf`。）

3. 插件设置里把 `wxEnabled` 打开；`wxSidecarPath` 留空时默认用项目自带的 `sidecar/wcferry_bridge.py`，也可以填你自己的路径。

> 微信 sidecar 首次启动会通过 `get_qrcode` 生成登录二维码（base64），插件会打日志提示；扫码登录后 `is_login` 变 true。账号风控风险自行评估（个人号 Hook 有封号可能，与 QQ 插件同理，建议用小号）。

## 4. 配置插件

在 DeepSeek Harness 设置页找到「dsh-im-hub」面板，填：

| 字段 | 说明 |
|---|---|
| `enabled` | 总开关 |
| `persona` | 人设（跨 IM 共享） |
| `provider` / `model` | 默认 `deepseek-account` / `deepseek-v4-pro` |
| `qqEnabled` | 开 QQ |
| `qqWsUrl` | 默认 `ws://127.0.0.1:3001` |
| `qqToken` | NapCat 的 access token（可空） |
| `qqSelfId` | 你的 QQ 号 |
| `wxEnabled` | 开微信 |
| `wxSidecarPath` | 默认走项目自带 sidecar，可留空 |

### L3 身份映射（把同一个人在两个平台归并）

编辑数据目录下的 `identity.json`（数据目录见「运行产物」），数组每项：

```json
{ "unified": "小明", "qq": "123456789", "wechat": "wxid_xxxx" }
```

这样小明在 QQ 和微信发消息会落到同一个 `unifiedId`，共享记忆和会话上下文。

## 5. 验证

1. 打开 `enabled` + `qqEnabled`（和/或 `wxEnabled`）。
2. 让好友在对应平台发一条文本消息。
3. 观察对方是否收到自动回复；看数据目录里的 `state.json`（`lastInboundId`/`lastSentText`）、`memory/*.md`、`session/*.json` 是否在更新。

## 6. 运行产物（数据目录）

优先级：环境变量 `DSH_IM_HUB_DATA` → `baseDir/dsh-im-hub` → `~/.dsh/dsh-im-hub`。

- `state.json` — 每个 `unifiedId` 的去重/冷却状态
- `identity.json` — L3 跨平台身份映射
- `memory/<id>.md` — 长期记忆
- `session/<id>.json` — 会话历史

## 7. 常见问题

- **插件不生效**：确认改完代码后完全重启了 App（或 touch 了 cordis.patch.yml）；确认 `enabled` 和对应平台的开关都开了。
- **QQ 连不上**：确认 NapCat 已登录且 OneBot WS 是「服务器（正向）」模式、端口/ token 与插件一致、消息格式是 array。
- **微信没反应**：确认微信 PC 版本匹配 WeChatFerry；看 sidecar stderr 日志；确认 `pip install -r requirements.txt` 成功。
- **重复回复同一条消息**：属冷却/去重机制，见 `replyCooldownSec` 和 `state.json` 的 `lastInboundId`。

方向③的完整设计与里程碑见 `../DESIGN.md`。
