import { createCipheriv, createDecipheriv } from "crypto";

export function decryptAesEcb(data: Buffer, key: Buffer): Buffer {
  const decipher = createDecipheriv("aes-128-ecb", key, null);
  return Buffer.concat([decipher.update(data), decipher.final()]);
}

export function encryptAesEcb(data: Buffer, key: Buffer): Buffer {
  const cipher = createCipheriv("aes-128-ecb", key, null);
  return Buffer.concat([cipher.update(data), cipher.final()]);
}

export function aesEcbPaddedSize(rawSize: number): number {
  return Math.ceil((rawSize + 1) / 16) * 16;
}

// Images: base64 encodes the raw 16-byte AES key directly
export function decodeImageAesKey(base64Key: string): Buffer {
  const decoded = Buffer.from(base64Key, "base64");
  if (decoded.length === 16) return decoded;
  if (decoded.length === 32 && /^[0-9a-fA-F]{32}$/.test(decoded.toString("ascii"))) {
    return Buffer.from(decoded.toString("ascii"), "hex");
  }
  throw new Error(`Invalid image AES key (decoded length: ${decoded.length})`);
}

// Files/voice/video: base64 encodes the 32-char hex string of the 16-byte key
export function decodeFileAesKey(base64Key: string): Buffer {
  const decoded = Buffer.from(base64Key, "base64");
  if (decoded.length === 16) return decoded;
  if (decoded.length === 32 && /^[0-9a-fA-F]{32}$/.test(decoded.toString("ascii"))) {
    return Buffer.from(decoded.toString("ascii"), "hex");
  }
  throw new Error(`Invalid file AES key (decoded length: ${decoded.length})`);
}

// Auto-detect key format
export function decodeAesKey(base64Key: string): Buffer {
  const decoded = Buffer.from(base64Key, "base64");
  if (decoded.length === 16) return decoded;
  if (decoded.length === 32 && /^[0-9a-fA-F]{32}$/.test(decoded.toString("ascii"))) {
    return Buffer.from(decoded.toString("ascii"), "hex");
  }
  throw new Error(`Invalid AES key (decoded length: ${decoded.length})`);
}

// Encode AES key for upload API (hex string)
export function encodeAesKeyHex(key: Buffer): string {
  return key.toString("hex");
}
