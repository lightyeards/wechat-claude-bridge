import https from "https";
import {
  type AccountData,
  type GetUpdatesResponse,
  type SendMessageRequest,
  type GetConfigResponse,
  type GetUploadUrlRequest,
  type GetUploadUrlResponse,
  type CDNMedia,
  MessageType,
  MessageState,
  MessageItemType,
} from "./types.js";

const DEFAULT_BASE_URL = "https://ilinkai.weixin.qq.com";

function makeHeaders(account: AccountData): Record<string, string> {
  return {
    "Content-Type": "application/json",
    AuthorizationType: "ilink_bot_token",
    Authorization: `Bearer ${account.bot_token}`,
    "X-WECHAT-UIN": account.ilink_bot_id,
    "iLink-App-Id": "bot",
    "iLink-App-ClientVersion": "0x00000601",
  };
}

function httpsPost(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  timeoutMs = 40_000
): Promise<string> {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const data = JSON.stringify(body);
    const req = https.request(
      {
        hostname: urlObj.hostname,
        port: 443,
        path: urlObj.pathname + urlObj.search,
        method: "POST",
        headers: { ...headers, "Content-Length": Buffer.byteLength(data) },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
      }
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error(`Request timeout: ${url}`));
    });
    req.write(data);
    req.end();
  });
}

function httpsGet(url: string, timeoutMs = 40_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const req = https.get(
      {
        hostname: urlObj.hostname,
        port: 443,
        path: urlObj.pathname + urlObj.search,
        timeout: timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
      }
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error(`Request timeout: ${url}`));
    });
  });
}

function httpsGetBinary(url: string, timeoutMs = 60_000): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const req = https.get(
      {
        hostname: urlObj.hostname,
        port: 443,
        path: urlObj.pathname + urlObj.search,
        timeout: timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks)));
      }
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error(`Request timeout: ${url}`));
    });
  });
}

export { httpsGetBinary };

function httpsPostBinary(
  url: string,
  headers: Record<string, string>,
  body: Buffer,
  timeoutMs = 60_000
): Promise<{ statusCode: number; headers: import("http").IncomingHttpHeaders; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const req = https.request(
      {
        hostname: urlObj.hostname,
        port: 443,
        path: urlObj.pathname + urlObj.search,
        method: "POST",
        headers: { ...headers, "Content-Length": body.length },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () =>
          resolve({
            statusCode: res.statusCode || 0,
            headers: res.headers,
            body: Buffer.concat(chunks),
          })
        );
      }
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error(`Request timeout: ${url}`));
    });
    req.write(body);
    req.end();
  });
}

export { httpsPostBinary };

export async function getUpdates(
  account: AccountData,
  cursor: string
): Promise<GetUpdatesResponse> {
  const baseUrl = account.baseurl || DEFAULT_BASE_URL;
  const url = `${baseUrl}/ilink/bot/getupdates`;
  const raw = await httpsPost(url, makeHeaders(account), {
    get_updates_buf: cursor,
  });
  return JSON.parse(raw) as GetUpdatesResponse;
}

export async function sendTextMessage(
  account: AccountData,
  toUserId: string,
  text: string,
  contextToken?: string
): Promise<void> {
  const baseUrl = account.baseurl || DEFAULT_BASE_URL;
  const url = `${baseUrl}/ilink/bot/sendmessage`;
  const clientId = `bridge-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const req: SendMessageRequest = {
    msg: {
      from_user_id: "",
      to_user_id: toUserId,
      client_id: clientId,
      message_type: MessageType.BOT,
      message_state: MessageState.FINISH,
      item_list: text
        ? [{ type: MessageItemType.TEXT, text_item: { text } }]
        : undefined,
      context_token: contextToken,
    },
  };
  await httpsPost(url, makeHeaders(account), req);
}

export async function sendTyping(
  account: AccountData,
  ilinkUserId: string,
  typingTicket: string,
  status: number
): Promise<void> {
  const baseUrl = account.baseurl || DEFAULT_BASE_URL;
  const url = `${baseUrl}/ilink/bot/sendtyping`;
  await httpsPost(url, makeHeaders(account), {
    ilink_user_id: ilinkUserId,
    typing_ticket: typingTicket,
    status,
  });
}

export async function getConfig(
  account: AccountData,
  ilinkUserId: string
): Promise<GetConfigResponse> {
  const baseUrl = account.baseurl || DEFAULT_BASE_URL;
  const url = `${baseUrl}/ilink/bot/getconfig`;
  const raw = await httpsPost(url, makeHeaders(account), {
    ilink_user_id: ilinkUserId,
  });
  return JSON.parse(raw) as GetConfigResponse;
}

export async function fetchQRCode(
  botType = "3"
): Promise<{ qrcode: string; qrcodeImgContent?: string }> {
  const url = `${DEFAULT_BASE_URL}/ilink/bot/get_bot_qrcode?bot_type=${encodeURIComponent(botType)}`;
  const raw = await httpsGet(url);
  const resp = JSON.parse(raw);
  if (resp.ret !== 0 && resp.ret !== undefined) {
    throw new Error(`fetchQRCode failed: ${resp.errmsg || JSON.stringify(resp)}`);
  }
  return { qrcode: resp.qrcode, qrcodeImgContent: resp.qrcode_img_content };
}

export async function pollQRStatus(qrcode: string): Promise<{
  status: string;
  bot_token?: string;
  ilink_bot_id?: string;
  baseurl?: string;
  ilink_user_id?: string;
  redirect_host?: string;
}> {
  const url = `${DEFAULT_BASE_URL}/ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`;
  const raw = await httpsGet(url, 35_000);
  return JSON.parse(raw);
}

export async function getUploadUrl(
  account: AccountData,
  params: GetUploadUrlRequest
): Promise<GetUploadUrlResponse> {
  const baseUrl = account.baseurl || DEFAULT_BASE_URL;
  const url = `${baseUrl}/ilink/bot/getuploadurl`;
  const raw = await httpsPost(url, makeHeaders(account), params);
  return JSON.parse(raw) as GetUploadUrlResponse;
}

export async function sendImageMessage(
  account: AccountData,
  toUserId: string,
  cdnMedia: CDNMedia,
  midSize: number,
  contextToken?: string
): Promise<void> {
  const baseUrl = account.baseurl || DEFAULT_BASE_URL;
  const url = `${baseUrl}/ilink/bot/sendmessage`;
  const clientId = `bridge-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const req = {
    msg: {
      from_user_id: "",
      to_user_id: toUserId,
      client_id: clientId,
      message_type: MessageType.BOT,
      message_state: MessageState.FINISH,
      item_list: [
        {
          type: MessageItemType.IMAGE,
          image_item: {
            media: cdnMedia,
            mid_size: midSize,
          },
        },
      ],
      context_token: contextToken,
    },
  };
  const raw = await httpsPost(url, makeHeaders(account), req);
  console.log(`[API] sendImageMessage 响应: ${raw}`);
}

export async function sendFileMessage(
  account: AccountData,
  toUserId: string,
  cdnMedia: CDNMedia,
  fileName: string,
  fileSize: string,
  contextToken?: string
): Promise<void> {
  const baseUrl = account.baseurl || DEFAULT_BASE_URL;
  const url = `${baseUrl}/ilink/bot/sendmessage`;
  const clientId = `bridge-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const req = {
    msg: {
      from_user_id: "",
      to_user_id: toUserId,
      client_id: clientId,
      message_type: MessageType.BOT,
      message_state: MessageState.FINISH,
      item_list: [
        {
          type: MessageItemType.FILE,
          file_item: {
            media: cdnMedia,
            file_name: fileName,
            len: fileSize,
          },
        },
      ],
      context_token: contextToken,
    },
  };
  console.log(`[API] sendFileMessage 请求: ${JSON.stringify(req)}`);
  const raw = await httpsPost(url, makeHeaders(account), req);
  console.log(`[API] sendFileMessage 响应: ${raw}`);
}
