import { decodeAesKey, encryptAesEcb } from "./crypto.js";
import { httpsGetBinary, httpsPostBinary } from "./api.js";
import type { CDNMedia } from "./types.js";

const DEFAULT_CDN_BASE = "https://ilinkai.weixin.qq.com";

function buildCdnDownloadUrl(encryptQueryParam: string, cdnBaseUrl: string): string {
  return `${cdnBaseUrl}/download?encrypted_query_param=${encodeURIComponent(encryptQueryParam)}`;
}

export async function downloadCdnMedia(cdnMedia: CDNMedia, baseUrl?: string): Promise<Buffer> {
  if (!cdnMedia.aes_key) {
    throw new Error("CDN media missing aes_key");
  }

  const cdnBaseUrl = baseUrl || DEFAULT_CDN_BASE;
  const url = cdnMedia.full_url || buildCdnDownloadUrl(cdnMedia.encrypt_query_param!, cdnBaseUrl);

  const encrypted = await httpsGetBinary(url);
  const key = decodeAesKey(cdnMedia.aes_key);

  return decryptAesEcb(encrypted, key);
}

// Re-export for convenience
import { decryptAesEcb } from "./crypto.js";

export async function uploadBufferToCdn(
  plaintext: Buffer,
  aesKey: Buffer,
  uploadUrl: string
): Promise<string> {
  const ciphertext = encryptAesEcb(plaintext, aesKey);

  const resp = await httpsPostBinary(
    uploadUrl,
    { "Content-Type": "application/octet-stream" },
    ciphertext
  );

  const encryptedParam = resp.headers["x-encrypted-param"];
  if (!encryptedParam || typeof encryptedParam !== "string") {
    throw new Error(`CDN upload failed: no x-encrypted-param header (status ${resp.statusCode})`);
  }

  return encryptedParam;
}
