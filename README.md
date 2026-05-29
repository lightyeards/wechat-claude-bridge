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
cp config.example.json config.json
# 编辑 config.json 填入你的配置
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

## 功能

- **多账号支持** — 同时监听多个 Bot 账号
- **对话连续性** — 自动维护 Claude CLI session，支持上下文续接
- **收发图片/文件** — 用户发图片或文件，Claude 自动分析；Claude 创建的文件自动发送回微信
- **斜杠命令** — 从微信端管理对话
- **可配置日志** — 支持 error / info / debug 三级日志

### 斜杠命令

| 命令 | 说明 |
|------|------|
| `/new` 或 `/clear` | 开始新对话 |
| `/history` | 查看历史对话列表 |
| `/switch 2` | 切换到第 2 个历史对话 |
| `/btw 今天星期几` | 临时提问，不影响当前对话 |
| `/filelist` | 查看对话中最近出现的文件列表 |
| `/getfile` | 发送最近的文件到微信（等同 `/getfile 1`） |
| `/getfile 3` | 发送列表中第 3 个文件 |
| `/getfile D:\path\file.txt` | 发送指定路径的文件 |

## 配置

复制 `config.example.json` 为 `config.json` 并按需修改：

```json
{
  "allowedUsers": [],
  "claudePath": "claude",
  "claudeArgs": ["--allowedTools", "Read,Glob,Grep,Edit,Write,Bash"],
  "claudeCwd": "",
  "maxResponseLength": 4000,
  "messageChunkSize": 3500,
  "typingIndicator": true,
  "enableFileUpload": true,
  "downloadDir": "",
  "logLevel": "error"
}
```

| 字段 | 说明 |
|------|------|
| `allowedUsers` | 允许的用户 ID 列表，空数组表示允许所有人 |
| `claudePath` | Claude Code CLI 路径，默认 `claude` |
| `claudeArgs` | 传递给 Claude CLI 的额外参数 |
| `claudeCwd` | Claude Code 的工作目录，决定可访问的文件范围 |
| `maxResponseLength` | 最大响应字符数，超出截断 |
| `messageChunkSize` | 单条消息最大长度（超长自动分段发送） |
| `typingIndicator` | 处理中是否发送"正在输入"状态 |
| `enableFileUpload` | 是否将 Claude 创建的文件自动上传并发送到微信 |
| `downloadDir` | 微信图片/文件的临时保存目录，为空则使用系统临时目录 |
| `logLevel` | 日志级别：`error`（仅错误）、`info`（常规信息）、`debug`（调试详情） |

## 项目结构

```
src/
  main.ts          # 消息监听、处理路由、斜杠命令
  api.ts           # iLink Bot API（收发消息、上传文件、CDN 操作）
  auth.ts          # 登录、账号管理、session 持久化、最近文件记录
  claude.ts        # Claude Code CLI 调用（-p 模式 + --resume）
  cdn.ts           # CDN 文件下载（解密）和上传（加密）
  crypto.ts        # AES-128-ECB 加解密
  upload.ts        # 文件上传管道（MD5 → getUploadUrl → CDN 上传）
  file-detector.ts # 从 Claude 输出中检测文件路径
  config.ts        # 配置加载
  log.ts           # 分级日志
  types.ts         # 类型定义
config.example.json # 配置示例
data/              # 运行时数据（git 已忽略）
```

## 注意事项

- 登录 token 保存在本地 `data/` 目录，不要泄露
- 会话过期（errcode -14）时需要重新 `npm run login`
- Claude Code CLI 默认超时 300 秒，复杂任务可能需要等待
- `data/` 和 `config.json` 已在 `.gitignore` 中排除，不会上传到 Git

## License

MIT
