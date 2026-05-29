import fs from "fs";
import crypto from "crypto";
import { encryptAesEcb, aesEcbPaddedSize, encodeAesKeyHex } from "./crypto.js";
import { uploadBufferToCdn } from "./cdn.js";
import { getUploadUrl } from "./api.js";
import type { AccountData, CdnUploadResult } from "./types.js";

function generateFileKey(): string {
  const timestamp = Date.now().toString(36);
  const random = crypto.randomBytes(8).toString("hex");
  return `${timestamp}_${random}`;
}

export async function uploadFile(
  account: AccountData,
  filePath: string,
  toUserId: string,
  mediaType: "image" | "file"
): Promise<CdnUploadResult> {
  const rawBuf = fs.readFileSync(filePath);
  const rawSize = rawBuf.length;
  const rawMd5 = crypto.createHash("md5").update(rawBuf).digest("hex");

  const aesKey = crypto.randomBytes(16);
  const paddedSize = aesEcbPaddedSize(rawSize);
  const fileKey = generateFileKey();

  // media_type: 1=image, 3=file
  const mediaTypeNum = mediaType === "image" ? 1 : 3;

  const uploadParams = {
    filekey: fileKey,
    media_type: mediaTypeNum,
    to_user_id: toUserId,
    rawsize: rawSize,
    rawfilemd5: rawMd5,
    filesize: paddedSize,
    no_need_thumb: true,
    aeskey: encodeAesKeyHex(aesKey),
  };

  console.log(`[上传] getUploadUrl 参数: ${JSON.stringify(uploadParams)}`);

  const uploadResp = await getUploadUrl(account, uploadParams);

  console.log(`[上传] getUploadUrl 响应: ${JSON.stringify(uploadResp)}`);

  if (uploadResp.errcode && uploadResp.errcode !== 0) {
    throw new Error(`getUploadUrl failed: ${uploadResp.errmsg || JSON.stringify(uploadResp)}`);
  }

  // Prefer upload_full_url; otherwise construct from upload_param + CDN base
  let uploadUrl = uploadResp.upload_full_url;
  if (!uploadUrl && uploadResp.upload_param) {
    const cdnBase = account.baseurl || "https://ilinkai.weixin.qq.com";
    uploadUrl = `${cdnBase}/upload?encrypted_query_param=${encodeURIComponent(uploadResp.upload_param)}&filekey=${encodeURIComponent(uploadResp.filekey || fileKey)}`;
  }

  if (!uploadUrl) {
    throw new Error("getUploadUrl returned no upload URL");
  }

  console.log(`[上传] CDN 上传 URL: ${uploadUrl}`);

  const encryptedParam = await uploadBufferToCdn(rawBuf, aesKey, uploadUrl);

  console.log(`[上传] CDN encrypted param: ${encryptedParam.slice(0, 50)}...`);

  const aesKeyEncoded = Buffer.from(aesKey.toString("hex")).toString("base64");

  return {
    encryptedQueryParam: encryptedParam,
    aesKeyEncoded,
    rawSize,
    fileSize: paddedSize,
    md5: rawMd5,
    fileKey: uploadResp.filekey || fileKey,
  };
}
