# wechat-claude-bridge

通过微信 iLink Bot API 将微信消息桥接到 Claude Code CLI。

手机微信发消息 → iLink Bot 服务器 → 本脚本 → Claude Code CLI → 回复到微信。

## 前置条件

- Node.js >= 18
- Claude Code CLI 已安装并在 PATH 中可用（`claude --version`）
- 微信账号（用于扫码授权 Bot）

## 安装

```bash
cd wechat-claude-bridge
npm install
```

## 使用

### 1. 登录微信 Bot

```bash
npm run login
```

终端会显示一个二维码，用手机微信扫码并确认授权。授权成功后，账号信息会保存在 `data/accounts.json`。

### 2. 启动桥接服务

```bash
npm start
```

启动后，脚本会持续监听微信消息。收到消息后自动调用 Claude Code CLI 处理并回复。

## 配置

编辑 `config.json`：

```json
{
  "allowedUsers": [],
  "claudePath": "claude",
  "claudeArgs": [],
  "maxResponseLength": 4000,
  "messageChunkSize": 3500,
  "typingIndicator": true
}
```

| 字段 | 说明 |
|------|------|
| `allowedUsers` | 允许的用户 ID 列表，空数组表示允许所有人 |
| `claudePath` | Claude Code CLI 路径，默认 `claude` |
| `claudeArgs` | 传递给 Claude CLI 的额外参数 |
| `maxResponseLength` | 最大响应字符数，超出截断 |
| `messageChunkSize` | 单条消息最大长度（超长自动分段发送） |
| `typingIndicator` | 处理中是否发送"正在输入"状态 |

## 项目结构

```
src/
  main.ts     # 主入口，消息监听和处理循环
  api.ts      # iLink Bot API 客户端
  auth.ts     # 登录、账号管理、cursor 持久化
  claude.ts   # Claude Code CLI 调用
  config.ts   # 配置加载
  types.ts    # 类型定义
config.json   # 配置文件
data/         # 运行时数据（账号、cursor、context token）
```

## 注意事项

- 登录 token 保存在本地 `data/` 目录，不要泄露
- 会话过期（errcode -14）时需要重新 `npm run login`
- Claude Code CLI 的响应时间取决于问题复杂度，默认超时 120 秒
