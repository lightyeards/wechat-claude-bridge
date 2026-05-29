import path from "path";
import fs from "fs";
import qrcode from "qrcode-terminal";
import { fetchQRCode, pollQRStatus } from "./api.js";
import type { AccountData, SessionInfo } from "./types.js";

import { fileURLToPath } from "url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ACCOUNTS_DIR = path.resolve(__dirname, "..", "data");
const ACCOUNTS_FILE = path.join(ACCOUNTS_DIR, "accounts.json");
const CURSORS_FILE = path.join(ACCOUNTS_DIR, "cursors.json");
const CONTEXT_FILE = path.join(ACCOUNTS_DIR, "context_tokens.json");
const SESSIONS_FILE = path.join(ACCOUNTS_DIR, "sessions.json");

function ensureDataDir() {
  if (!fs.existsSync(ACCOUNTS_DIR)) {
    fs.mkdirSync(ACCOUNTS_DIR, { recursive: true });
  }
}

export function loadAccounts(): AccountData[] {
  ensureDataDir();
  if (!fs.existsSync(ACCOUNTS_FILE)) return [];
  const raw = fs.readFileSync(ACCOUNTS_FILE, "utf-8");
  return JSON.parse(raw) as AccountData[];
}

export function saveAccounts(accounts: AccountData[]) {
  ensureDataDir();
  fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2), "utf-8");
}

export function loadCursor(accountId: string): string {
  ensureDataDir();
  if (!fs.existsSync(CURSORS_FILE)) return "";
  const raw = fs.readFileSync(CURSORS_FILE, "utf-8");
  const map = JSON.parse(raw) as Record<string, string>;
  return map[accountId] || "";
}

export function saveCursor(accountId: string, cursor: string) {
  ensureDataDir();
  let map: Record<string, string> = {};
  if (fs.existsSync(CURSORS_FILE)) {
    map = JSON.parse(fs.readFileSync(CURSORS_FILE, "utf-8"));
  }
  map[accountId] = cursor;
  fs.writeFileSync(CURSORS_FILE, JSON.stringify(map, null, 2), "utf-8");
}

export function loadContextToken(accountId: string, userId: string): string | undefined {
  ensureDataDir();
  if (!fs.existsSync(CONTEXT_FILE)) return undefined;
  const raw = fs.readFileSync(CONTEXT_FILE, "utf-8");
  const map = JSON.parse(raw) as Record<string, Record<string, string>>;
  return map[accountId]?.[userId];
}

export function saveContextToken(accountId: string, userId: string, token: string) {
  ensureDataDir();
  let map: Record<string, Record<string, string>> = {};
  if (fs.existsSync(CONTEXT_FILE)) {
    map = JSON.parse(fs.readFileSync(CONTEXT_FILE, "utf-8"));
  }
  if (!map[accountId]) map[accountId] = {};
  map[accountId][userId] = token;
  fs.writeFileSync(CONTEXT_FILE, JSON.stringify(map, null, 2), "utf-8");
}

interface SessionData {
  current?: string;
  history: SessionInfo[];
}

function loadSessionData(accountId: string, userId: string): SessionData {
  ensureDataDir();
  if (!fs.existsSync(SESSIONS_FILE)) return { history: [] };
  const map = JSON.parse(fs.readFileSync(SESSIONS_FILE, "utf-8")) as Record<string, unknown>;
  const val = map[`${accountId}:${userId}`];
  if (!val) return { history: [] };
  // Migrate old format: "key": "sessionId" → "key": { current, history }
  if (typeof val === "string") {
    const migrated: SessionData = { current: val, history: [{ id: val, title: "历史对话", time: Date.now() }] };
    map[`${accountId}:${userId}`] = migrated;
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(map, null, 2), "utf-8");
    return migrated;
  }
  return val as SessionData;
}

function saveSessionData(accountId: string, userId: string, data: SessionData) {
  ensureDataDir();
  let map: Record<string, SessionData> = {};
  if (fs.existsSync(SESSIONS_FILE)) {
    map = JSON.parse(fs.readFileSync(SESSIONS_FILE, "utf-8"));
  }
  map[`${accountId}:${userId}`] = data;
  fs.writeFileSync(SESSIONS_FILE, JSON.stringify(map, null, 2), "utf-8");
}

export function loadSession(accountId: string, userId: string): string | undefined {
  return loadSessionData(accountId, userId).current;
}

export function saveSession(accountId: string, userId: string, sessionId: string, title?: string) {
  const data = loadSessionData(accountId, userId);
  data.current = sessionId;
  // Upsert into history
  const existing = data.history.findIndex((s) => s.id === sessionId);
  if (existing >= 0) {
    data.history[existing].time = Date.now();
    if (title) data.history[existing].title = title;
  } else {
    data.history.unshift({
      id: sessionId,
      title: title || "新对话",
      time: Date.now(),
    });
  }
  saveSessionData(accountId, userId, data);
}

export function clearSession(accountId: string, userId: string) {
  const data = loadSessionData(accountId, userId);
  data.current = undefined;
  saveSessionData(accountId, userId, data);
}

export function listSessions(accountId: string, userId: string): SessionInfo[] {
  return loadSessionData(accountId, userId).history;
}

export function switchSession(accountId: string, userId: string, sessionId: string): boolean {
  const data = loadSessionData(accountId, userId);
  const found = data.history.some((s) => s.id === sessionId);
  if (!found) return false;
  data.current = sessionId;
  saveSessionData(accountId, userId, data);
  return true;
}

// Save session to history only, without changing current (for /btw)
export function saveSessionHistoryOnly(accountId: string, userId: string, sessionId: string, title: string) {
  const data = loadSessionData(accountId, userId);
  if (!data.history.some((s) => s.id === sessionId)) {
    data.history.unshift({ id: sessionId, title, time: Date.now() });
    saveSessionData(accountId, userId, data);
  }
}

// ===== Recent files tracking =====
const RECENT_FILES_FILE = path.join(ACCOUNTS_DIR, "recent_files.json");
const MAX_RECENT_FILES = 10;

function loadRecentFilesMap(): Record<string, string[]> {
  ensureDataDir();
  if (!fs.existsSync(RECENT_FILES_FILE)) return {};
  return JSON.parse(fs.readFileSync(RECENT_FILES_FILE, "utf-8")) as Record<string, string[]>;
}

function saveRecentFilesMap(map: Record<string, string[]>) {
  ensureDataDir();
  fs.writeFileSync(RECENT_FILES_FILE, JSON.stringify(map, null, 2), "utf-8");
}

function recentFilesKey(accountId: string, userId: string): string {
  return `${accountId}:${userId}`;
}

export function addRecentFile(accountId: string, userId: string, filePath: string) {
  const map = loadRecentFilesMap();
  const key = recentFilesKey(accountId, userId);
  let list = map[key] || [];
  // Remove duplicate
  list = list.filter((p) => p !== filePath);
  // Add to front
  list.unshift(filePath);
  // Keep max 10
  if (list.length > MAX_RECENT_FILES) list = list.slice(0, MAX_RECENT_FILES);
  map[key] = list;
  saveRecentFilesMap(map);
}

export function getRecentFiles(accountId: string, userId: string): string[] {
  const map = loadRecentFilesMap();
  const key = recentFilesKey(accountId, userId);
  const list = map[key] || [];
  // Filter to only existing files
  return list.filter((p) => {
    try { return fs.existsSync(p) && fs.statSync(p).isFile(); } catch { return false; }
  });
}

const QR_REFRESH_LIMIT = 3;
const LOGIN_TIMEOUT_MS = 8 * 60_000;

export async function loginWithQR(): Promise<AccountData> {
  const startTime = Date.now();
  let refreshCount = 0;
  let currentQrcode = "";

  while (Date.now() - startTime < LOGIN_TIMEOUT_MS) {
    if (!currentQrcode) {
      console.log("[登录] 正在获取二维码...");
      const qrResp = await fetchQRCode();
      currentQrcode = qrResp.qrcode;

      if (!currentQrcode) {
        throw new Error("获取二维码失败：服务器未返回二维码数据");
      }

      const qrContent = qrResp.qrcodeImgContent || currentQrcode;
      console.log("\n请用微信扫描以下二维码授权：\n");
      qrcode.generate(qrContent, { small: true }, (qrcodeStr) => {
        console.log(qrcodeStr);
      });
      console.log("\n等待扫码...");
    }

    const statusResp = await pollQRStatus(currentQrcode);

    switch (statusResp.status) {
      case "confirmed":
        if (!statusResp.bot_token || !statusResp.ilink_bot_id) {
          throw new Error("登录成功但未获取到 token");
        }
        console.log("[登录] 授权成功！");
        const account: AccountData = {
          ilink_bot_id: statusResp.ilink_bot_id,
          bot_token: statusResp.bot_token,
          baseurl: statusResp.baseurl || "https://ilinkai.weixin.qq.com",
          ilink_user_id: statusResp.ilink_user_id,
        };
        return account;

      case "scaned":
        console.log("[登录] 已扫码，请在手机上确认授权...");
        break;

      case "expired":
        refreshCount++;
        if (refreshCount >= QR_REFRESH_LIMIT) {
          throw new Error("二维码已过期且刷新次数已达上限，请重新登录");
        }
        console.log(`[登录] 二维码已过期，正在刷新 (${refreshCount}/${QR_REFRESH_LIMIT})...`);
        currentQrcode = "";
        break;

      case "scaned_but_redirect":
        if (statusResp.redirect_host) {
          console.log(`[登录] 重定向到 ${statusResp.redirect_host}`);
        }
        break;

      case "wait":
      default:
        break;
    }

    await new Promise((r) => setTimeout(r, 1000));
  }

  throw new Error("登录超时（8分钟），请重试");
}

export async function doLogin() {
  const account = await loginWithQR();
  const accounts = loadAccounts();
  const existingIdx = accounts.findIndex(
    (a) => a.ilink_bot_id === account.ilink_bot_id
  );
  if (existingIdx >= 0) {
    accounts[existingIdx] = account;
    console.log(`[登录] 更新账号: ${account.ilink_bot_id}`);
  } else {
    accounts.push(account);
    console.log(`[登录] 新增账号: ${account.ilink_bot_id}`);
  }
  saveAccounts(accounts);
  console.log("[登录] 账号已保存，可以运行 npm start 启动桥接服务");
}
