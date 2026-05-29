import { loadAccounts, loadCursor, saveCursor, loadContextToken, saveContextToken, loadSession, saveSession, clearSession, listSessions, switchSession, saveSessionHistoryOnly, doLogin, addRecentFile, getRecentFiles } from "./auth.js";
import { getUpdates, sendTextMessage, sendTyping, getConfig, sendImageMessage, sendFileMessage } from "./api.js";
import { callClaude } from "./claude.js";
import { downloadCdnMedia } from "./cdn.js";
import { uploadFile } from "./upload.js";
import { detectFilePaths, classifyFile } from "./file-detector.js";
import { loadConfig } from "./config.js";
import { setLogLevel, logError, logInfo, logDebug } from "./log.js";
import type { AccountData, WeixinMessage, AppConfig, CDNMedia } from "./types.js";
import { MessageType, MessageItemType } from "./types.js";
import { tmpdir } from "os";
import { join } from "path";
import { writeFileSync, unlinkSync, mkdirSync } from "fs";

const POLL_RETRY_MS = 2_000;
const MAX_CONSECUTIVE_FAILURES = 3;
const BACKOFF_MS = 30_000;
const SESSION_EXPIRED_ERRCODE = -14;
const TYPING_KEEPALIVE_MS = 5_000;

function extractText(msg: WeixinMessage): string {
  if (!msg.item_list) return "";
  for (const item of msg.item_list) {
    if (item.type === MessageItemType.TEXT && item.text_item?.text) {
      return item.text_item.text;
    }
    if (item.type === MessageItemType.VOICE && item.voice_item?.text) {
      return item.voice_item.text;
    }
  }
  return "";
}

type MessageContent =
  | { type: "text"; text: string }
  | { type: "image"; text?: string; cdnMedia: CDNMedia }
  | { type: "file"; fileName?: string; cdnMedia: CDNMedia };

function extractMessageContent(msg: WeixinMessage): MessageContent | null {
  if (!msg.item_list || msg.item_list.length === 0) {
    return null;
  }

  for (const item of msg.item_list) {
    if (item.type === MessageItemType.TEXT && item.text_item?.text) {
      return { type: "text", text: item.text_item.text };
    }
    if (item.type === MessageItemType.VOICE && item.voice_item?.text) {
      return { type: "text", text: item.voice_item.text };
    }
    if (item.type === MessageItemType.IMAGE && item.image_item) {
      const cdnMedia = item.image_item.media || item.image_item.image_url?.cdn_media;
      if (cdnMedia?.encrypt_query_param) {
        if (!cdnMedia.aes_key && item.image_item.aeskey) {
          cdnMedia.aes_key = Buffer.from(item.image_item.aeskey, "hex").toString("base64");
        }
        return {
          type: "image",
          text: item.text_item?.text,
          cdnMedia,
        };
      }
    }
    if (item.type === MessageItemType.FILE && item.file_item) {
      const cdnMedia = item.file_item.media || item.file_item.file_url?.cdn_media;
      if (cdnMedia?.encrypt_query_param) {
        return {
          type: "file",
          fileName: item.file_item.file_name,
          cdnMedia,
        };
      }
    }
  }

  return null;
}

function getDownloadDir(config: AppConfig): string {
  if (config.downloadDir) return config.downloadDir;
  const dir = join(tmpdir(), "wechat-claude-bridge");
  try { mkdirSync(dir, { recursive: true }); } catch {}
  return dir;
}

function chunkText(text: string, maxSize: number): string[] {
  if (text.length <= maxSize) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    let cutAt = Math.min(maxSize, remaining.length);
    if (cutAt < remaining.length) {
      const lastNewline = remaining.lastIndexOf("\n", cutAt);
      if (lastNewline > maxSize * 0.5) cutAt = lastNewline + 1;
    }
    chunks.push(remaining.slice(0, cutAt));
    remaining = remaining.slice(cutAt);
  }
  return chunks;
}

function isUserAllowed(userId: string | undefined, config: AppConfig): boolean {
  if (!userId) return false;
  if (!config.allowedUsers || config.allowedUsers.length === 0) return true;
  return config.allowedUsers.includes(userId);
}

async function startTypingLoop(
  account: AccountData,
  userId: string,
  abortSignal: AbortSignal
): Promise<void> {
  try {
    const configResp = await getConfig(account, userId);
    const ticket = configResp.typing_ticket;
    if (!ticket) return;

    while (!abortSignal.aborted) {
      await sendTyping(account, userId, ticket, 1).catch(() => {});
      await new Promise((r) => {
        const timer = setTimeout(r, TYPING_KEEPALIVE_MS);
        abortSignal.addEventListener("abort", () => {
          clearTimeout(timer);
          r(undefined);
        }, { once: true });
      });
    }
    await sendTyping(account, userId, ticket, 2).catch(() => {});
  } catch {
    // typing indicator is best-effort
  }
}

async function handleFileOutput(
  account: AccountData,
  userId: string,
  outputText: string,
  config: AppConfig,
  savedToken?: string
) {
  const paths = detectFilePaths(outputText, config.claudeCwd || process.cwd());
  for (const p of paths) {
    addRecentFile(account.ilink_bot_id, userId, p);
  }

  if (!config.enableFileUpload || paths.length === 0) return;

  for (const p of paths) {
    try {
      const mediaType = classifyFile(p);
      const fileName = p.split(/[\\\/]/).pop() || "file";
      logInfo(`[上传] ${mediaType}: ${p}`);

      const result = await uploadFile(account, p, userId, mediaType);
      const cdnMedia: CDNMedia = {
        encrypt_query_param: result.encryptedQueryParam,
        aes_key: result.aesKeyEncoded,
        encrypt_type: 1,
      };

      if (mediaType === "image") {
        await sendImageMessage(account, userId, cdnMedia, result.fileSize, savedToken);
      } else {
        await sendFileMessage(account, userId, cdnMedia, fileName, String(result.rawSize), savedToken);
      }
      logInfo(`[上传] 已发送 ${fileName}`);
    } catch (err) {
      logError(`[上传] 失败 ${p}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

async function processMessage(
  msg: WeixinMessage,
  account: AccountData,
  config: AppConfig
) {
  const userId = msg.from_user_id;
  if (!userId) return;

  if (msg.message_type !== MessageType.USER) return;
  if (!isUserAllowed(userId, config)) {
    logDebug(`[过滤] 忽略未授权用户: ${userId}`);
    return;
  }

  const contextToken = msg.context_token;
  if (contextToken) {
    saveContextToken(account.ilink_bot_id, userId, contextToken);
  }
  const savedToken = contextToken || loadContextToken(account.ilink_bot_id, userId);

  const content = extractMessageContent(msg);
  if (!content) return;

  if (content.type === "text") {
    const trimmed = content.text.trim();
    if (!trimmed) return;

    logInfo(`[消息] ${userId}: ${trimmed.slice(0, 100)}${trimmed.length > 100 ? "..." : ""}`);

    // ===== 斜杠命令 =====

    if (trimmed === "/clear" || trimmed === "/new") {
      clearSession(account.ilink_bot_id, userId);
      logDebug(`[命令] ${userId}: ${trimmed}`);
      await sendTextMessage(account, userId, "已开始新对话", savedToken);
      return;
    }

    if (trimmed === "/history") {
      const sessions = listSessions(account.ilink_bot_id, userId);
      if (sessions.length === 0) {
        await sendTextMessage(account, userId, "暂无历史对话", savedToken);
      } else {
        const currentId = loadSession(account.ilink_bot_id, userId);
        const lines = sessions.map((s, i) => {
          const d = new Date(s.time);
          const time = `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
          const tag = s.id === currentId ? " ←当前" : "";
          return `**${i + 1}.** ${s.title}${tag}  ${time}`;
        });
        await sendTextMessage(account, userId, `📋 历史对话\n---\n${lines.join("\n")}\n---\n/switch N 切换对话`, savedToken);
      }
      logDebug(`[命令] ${userId}: /history (${sessions.length} 条)`);
      return;
    }

    const switchMatch = trimmed.match(/^\/switch\s+(\d+)$/);
    if (switchMatch) {
      const idx = parseInt(switchMatch[1], 10) - 1;
      const sessions = listSessions(account.ilink_bot_id, userId);
      if (idx < 0 || idx >= sessions.length) {
        await sendTextMessage(account, userId, `无效编号，当前共 ${sessions.length} 个对话`, savedToken);
      } else {
        const target = sessions[idx];
        switchSession(account.ilink_bot_id, userId, target.id);
        await sendTextMessage(account, userId, `已切换到: ${target.title}`, savedToken);
      }
      logDebug(`[命令] ${userId}: /switch ${switchMatch[1]}`);
      return;
    }

    if (trimmed === "/filelist") {
      const files = getRecentFiles(account.ilink_bot_id, userId);
      if (files.length === 0) {
        await sendTextMessage(account, userId, "暂无文件记录", savedToken);
      } else {
        const lines = files.map((f, i) => {
          const name = f.split(/[\\\/]/).pop() || f;
          const tag = i === 0 ? " ←最近" : "";
          return `**${i + 1}.** ${name}${tag}\n    ${f}`;
        });
        await sendTextMessage(account, userId, `📁 文件列表\n---\n${lines.join("\n")}\n---\n/getfile N 获取文件`, savedToken);
      }
      logDebug(`[命令] ${userId}: /filelist (${files.length} 个)`);
      return;
    }

    const getfileMatch = trimmed.match(/^\/getfile(?:\s+(.+))?$/);
    if (getfileMatch) {
      const arg = getfileMatch[1]?.trim() || "1";
      const files = getRecentFiles(account.ilink_bot_id, userId);
      let targetFile = "";

      const numIdx = parseInt(arg, 10);
      if (!isNaN(numIdx) && numIdx > 0 && numIdx <= files.length) {
        targetFile = files[numIdx - 1];
      } else if (/^[A-Z]:[\\\/]/.test(arg) || /^\//.test(arg)) {
        targetFile = arg;
      }

      if (!targetFile) {
        await sendTextMessage(account, userId, `无效编号或路径，当前共 ${files.length} 个文件。/filelist 查看列表`, savedToken);
        logInfo(`[命令] ${userId}: /getfile ${arg} (未找到)`);
        return;
      }

      try {
        const mediaType = classifyFile(targetFile);
        const fileName = targetFile.split(/[\\\/]/).pop() || "file";
        logInfo(`[命令] ${userId}: /getfile → ${fileName}`);

        const result = await uploadFile(account, targetFile, userId, mediaType);
        const cdnMedia: CDNMedia = {
          encrypt_query_param: result.encryptedQueryParam,
          aes_key: result.aesKeyEncoded,
          encrypt_type: 1,
        };

        if (mediaType === "image") {
          await sendImageMessage(account, userId, cdnMedia, result.fileSize, savedToken);
        } else {
          await sendFileMessage(account, userId, cdnMedia, fileName, String(result.rawSize), savedToken);
        }
        logInfo(`[上传] 已发送 ${fileName}`);
      } catch (err) {
        const errMsg = `发送文件失败: ${err instanceof Error ? err.message : String(err)}`;
        logError(`[上传] ${errMsg}`);
        await sendTextMessage(account, userId, errMsg, savedToken).catch(() => {});
      }
      return;
    }

    const btwMatch = trimmed.match(/^\/btw\s+(.+)/);
    if (btwMatch) {
      const btwMessage = btwMatch[1];
      logDebug(`[命令] ${userId}: /btw ${btwMessage.slice(0, 50)}`);

      const typingController = new AbortController();
      let typingPromise: Promise<void> | undefined;
      if (config.typingIndicator) {
        typingPromise = startTypingLoop(account, userId, typingController.signal);
      }

      try {
        let result = await callClaude(btwMessage, {
          claudePath: config.claudePath,
          args: config.claudeArgs,
          timeoutMs: 300_000,
          cwd: config.claudeCwd,
        });

        if (!result.success && result.error?.includes("No conversation found")) {
          result = await callClaude(btwMessage, {
            claudePath: config.claudePath,
            args: config.claudeArgs,
            timeoutMs: 300_000,
            cwd: config.claudeCwd,
          });
        }

        if (result.sessionId) {
          saveSessionHistoryOnly(account.ilink_bot_id, userId, result.sessionId, `/btw ${btwMessage.slice(0, 30)}`);
        }

        typingController.abort();
        await typingPromise?.catch(() => {});

        const responseText = result.success
          ? result.output || "(无输出)"
          : `错误: ${result.error || result.output || "未知错误"}`;

        const maxSize = config.messageChunkSize || 3500;
        const chunks = chunkText(responseText.slice(0, config.maxResponseLength || 4000), maxSize);
        for (const chunk of chunks) {
          await sendTextMessage(account, userId, chunk, savedToken);
        }

        await handleFileOutput(account, userId, responseText, config, savedToken);
      } catch (err) {
        typingController.abort();
        await typingPromise?.catch(() => {});
        logError(`[btw] ${err instanceof Error ? err.message : String(err)}`);
        await sendTextMessage(account, userId, `处理出错: ${err instanceof Error ? err.message : String(err)}`).catch(() => {});
      }
      return;
    }

    await handleTextMessage(content.text, account, userId, config, savedToken);
    return;
  }

  if (content.type === "image") {
    logInfo(`[图片] ${userId}`);
    await handleMediaMessage(content.text || "描述这张图片", content.cdnMedia, "image", account, userId, config, savedToken);
    return;
  }

  if (content.type === "file") {
    logInfo(`[文件] ${userId}: ${content.fileName || "unknown"}`);
    await handleMediaMessage(
      `分析这个文件: ${content.fileName || "未知文件"}`,
      content.cdnMedia,
      "file",
      account, userId, config, savedToken
    );
    return;
  }
}

async function handleTextMessage(
  text: string,
  account: AccountData,
  userId: string,
  config: AppConfig,
  savedToken?: string
) {
  const typingController = new AbortController();
  let typingPromise: Promise<void> | undefined;
  if (config.typingIndicator) {
    typingPromise = startTypingLoop(account, userId, typingController.signal);
  }

  try {
    const sessionId = loadSession(account.ilink_bot_id, userId);
    let result = await callClaude(text, {
      claudePath: config.claudePath,
      args: config.claudeArgs,
      timeoutMs: 300_000,
      sessionId,
      cwd: config.claudeCwd,
    });

    if (!result.success && result.error?.includes("No conversation found")) {
      logInfo(`[会话] 旧 session 已过期，重新开始对话`);
      clearSession(account.ilink_bot_id, userId);
      result = await callClaude(text, {
        claudePath: config.claudePath,
        args: config.claudeArgs,
        timeoutMs: 300_000,
        cwd: config.claudeCwd,
      });
    }

    if (result.sessionId) {
      saveSession(account.ilink_bot_id, userId, result.sessionId, text.slice(0, 30));
    }

    typingController.abort();
    await typingPromise?.catch(() => {});

    const responseText = result.success
      ? result.output || "(无输出)"
      : `错误: ${result.error || result.output || "未知错误"}`;

    const maxSize = config.messageChunkSize || 3500;
    const chunks = chunkText(responseText.slice(0, config.maxResponseLength || 4000), maxSize);

    for (const chunk of chunks) {
      await sendTextMessage(account, userId, chunk, savedToken);
    }

    logDebug(`[回复] ${responseText.slice(0, 80)}${responseText.length > 80 ? "..." : ""}`);

    await handleFileOutput(account, userId, responseText, config, savedToken);
  } catch (err) {
    typingController.abort();
    await typingPromise?.catch(() => {});
    const errMsg = `处理消息时出错: ${err instanceof Error ? err.message : String(err)}`;
    logError(`[错误] ${errMsg}`);
    await sendTextMessage(account, userId, errMsg).catch(() => {});
  }
}

async function handleMediaMessage(
  prompt: string,
  cdnMedia: CDNMedia,
  mediaType: "image" | "file",
  account: AccountData,
  userId: string,
  config: AppConfig,
  savedToken?: string
) {
  const downloadDir = getDownloadDir(config);
  const ext = mediaType === "image" ? ".png" : ".bin";
  const localFile = join(downloadDir, `media-${Date.now()}${ext}`);

  const typingController = new AbortController();
  let typingPromise: Promise<void> | undefined;
  if (config.typingIndicator) {
    typingPromise = startTypingLoop(account, userId, typingController.signal);
  }

  try {
    const data = await downloadCdnMedia(cdnMedia, account.baseurl);
    writeFileSync(localFile, data);
    logDebug(`[CDN] 下载完成: ${localFile} (${data.length} bytes)`);

    const sessionId = loadSession(account.ilink_bot_id, userId);
    const claudeOptions: Parameters<typeof callClaude>[1] = {
      claudePath: config.claudePath,
      args: config.claudeArgs,
      timeoutMs: 180_000,
      sessionId,
      cwd: config.claudeCwd,
      ...(mediaType === "image" ? { imagePath: localFile } : { filePath: localFile }),
    };

    let result = await callClaude(prompt, claudeOptions);

    if (!result.success && result.error?.includes("No conversation found")) {
      logInfo(`[会话] 旧 session 已过期，重新开始对话`);
      clearSession(account.ilink_bot_id, userId);
      const retryOptions = { ...claudeOptions };
      delete retryOptions.sessionId;
      result = await callClaude(prompt, retryOptions);
    }

    if (result.sessionId) {
      saveSession(account.ilink_bot_id, userId, result.sessionId, prompt.slice(0, 30));
    }

    typingController.abort();
    await typingPromise?.catch(() => {});

    const responseText = result.success
      ? result.output || "(无输出)"
      : `错误: ${result.error || result.output || "未知错误"}`;

    const maxSize = config.messageChunkSize || 3500;
    const chunks = chunkText(responseText.slice(0, config.maxResponseLength || 4000), maxSize);
    for (const chunk of chunks) {
      await sendTextMessage(account, userId, chunk, savedToken);
    }

    logDebug(`[回复] ${responseText.slice(0, 80)}${responseText.length > 80 ? "..." : ""}`);

    await handleFileOutput(account, userId, responseText, config, savedToken);
  } catch (err) {
    typingController.abort();
    await typingPromise?.catch(() => {});
    const errMsg = `处理${mediaType === "image" ? "图片" : "文件"}时出错: ${err instanceof Error ? err.message : String(err)}`;
    logError(`[错误] ${errMsg}`);
    await sendTextMessage(account, userId, errMsg).catch(() => {});
  } finally {
    try { unlinkSync(localFile); } catch {}
  }
}

async function runMonitor(account: AccountData, config: AppConfig) {
  let cursor = loadCursor(account.ilink_bot_id);
  let consecutiveFailures = 0;

  logInfo(`[监控] 开始监听账号 ${account.ilink_bot_id}...`);

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const resp = await getUpdates(account, cursor);

      if (resp.errcode === SESSION_EXPIRED_ERRCODE) {
        logError(`[错误] 账号 ${account.ilink_bot_id} 会话过期 (errcode -14)，请重新登录`);
        return;
      }

      if (resp.errcode && resp.errcode !== 0) {
        throw new Error(`getUpdates 错误: errcode=${resp.errcode}, errmsg=${resp.errmsg}`);
      }

      consecutiveFailures = 0;

      const newCursor = resp.get_updates_buf;
      if (newCursor) {
        cursor = newCursor;
        saveCursor(account.ilink_bot_id, cursor);
      }

      const messages = resp.msgs || resp.msg_list || [];
      for (const msg of messages) {
        logDebug(`[调试] msg_id=${msg.message_id} type=${msg.message_type} from=${msg.from_user_id}`);
        await processMessage(msg, account, config);
      }
    } catch (err) {
      consecutiveFailures++;
      const delay = consecutiveFailures >= MAX_CONSECUTIVE_FAILURES ? BACKOFF_MS : POLL_RETRY_MS;
      logError(
        `[错误] getUpdates 失败 (${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES}): ${
          err instanceof Error ? err.message : String(err)
        }, ${delay / 1000}s 后重试`
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--login")) {
    await doLogin();
    return;
  }

  const config = loadConfig();
  const accounts = loadAccounts();

  setLogLevel(config.logLevel || "error");

  if (accounts.length === 0) {
    console.log("没有已登录的账号。请先运行: npm run login");
    process.exit(1);
  }

  console.log(`已加载 ${accounts.length} 个账号 | 日志级别: ${config.logLevel || "error"}`);
  console.log("---");

  const monitors = accounts.map((account) => runMonitor(account, config));
  const results = await Promise.allSettled(monitors);
  for (const r of results) {
    if (r.status === "rejected") {
      logError("[错误] 监控异常退出:", r.reason);
    }
  }
  console.log("[桥接] 所有账号监控已停止");
}

main().catch((err) => {
  console.error("启动失败:", err);
  process.exit(1);
});
