import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import type { AppConfig } from "./types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CONFIG_FILE = path.resolve(__dirname, "..", "config.json");

const DEFAULT_CONFIG: AppConfig = {
  allowedUsers: [],
  claudePath: "claude",
  claudeArgs: [],
  maxResponseLength: 4000,
  messageChunkSize: 3500,
  typingIndicator: true,
  enableFileUpload: false,
  downloadDir: "",
  logLevel: "error",
};

export function loadConfig(): AppConfig {
  if (!fs.existsSync(CONFIG_FILE)) {
    saveConfig(DEFAULT_CONFIG);
    return DEFAULT_CONFIG;
  }
  const raw = fs.readFileSync(CONFIG_FILE, "utf-8");
  return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
}

export function saveConfig(config: AppConfig) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), "utf-8");
}
