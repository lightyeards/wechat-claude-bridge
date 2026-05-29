import { spawn } from "child_process";
import { writeFileSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

export interface ClaudeResult {
  success: boolean;
  output: string;
  sessionId?: string;
  error?: string;
}

export async function callClaude(
  message: string,
  options?: {
    claudePath?: string;
    args?: string[];
    timeoutMs?: number;
    sessionId?: string;
    cwd?: string;
    imagePath?: string;
    filePath?: string;
  }
): Promise<ClaudeResult> {
  const claudePath = options?.claudePath || "claude";
  const timeoutMs = options?.timeoutMs || 300_000;

  // Build prompt with image/file context
  const systemPrefix = "你通过微信桥接与用户对话。用户发的图片你能看到，你创建的文件会自动发送给用户。当用户要文件时直接创建即可，不要说你无法发送。\n\n";
  let prompt = message;
  if (options?.imagePath) {
    prompt = `${systemPrefix}Read the image at "${options.imagePath}" and respond to the following message:\n\n${message}`;
  } else if (options?.filePath) {
    prompt = `${systemPrefix}Read the file at "${options.filePath}" and respond to the following message:\n\n${message}`;
  } else {
    prompt = `${systemPrefix}${message}`;
  }

  // Write prompt to temp file to avoid shell escaping issues
  const tmpFile = join(tmpdir(), `claude-prompt-${Date.now()}.txt`);
  writeFileSync(tmpFile, prompt, "utf-8");

  const extraArgs = [
    ...(options?.sessionId ? ["--resume", options.sessionId] : []),
    ...(options?.args || []),
  ];

  // Use stdin to pass prompt: echo the file content and pipe to claude -p
  const isWin = process.platform === "win32";
  const shellCmd = isWin
    ? `type "${tmpFile}" | "${claudePath}" -p --output-format json ${extraArgs.join(" ")}`
    : `cat "${tmpFile}" | "${claudePath}" -p --output-format json ${extraArgs.join(" ")}`;

  return new Promise((resolve) => {
    const proc = spawn(shellCmd, [], {
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      ...(options?.cwd ? { cwd: options.cwd } : {}),
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    proc.stdout.on("data", (data: Buffer) => stdoutChunks.push(data));
    proc.stderr.on("data", (data: Buffer) => stderrChunks.push(data));

    const timer = setTimeout(() => {
      proc.kill("SIGTERM");
      try { unlinkSync(tmpFile); } catch {}
      resolve({
        success: false,
        output: "",
        error: "Claude Code CLI 超时",
      });
    }, timeoutMs);

    proc.on("close", (code) => {
      clearTimeout(timer);
      try { unlinkSync(tmpFile); } catch {}
      const stdout = Buffer.concat(stdoutChunks).toString("utf-8").trim();
      const stderr = Buffer.concat(stderrChunks).toString("utf-8").trim();

      if (code === 0 && stdout) {
        try {
          const json = JSON.parse(stdout);
          resolve({
            success: true,
            output: json.result || stdout,
            sessionId: json.session_id,
          });
        } catch {
          resolve({
            success: true,
            output: stdout,
          });
        }
      } else {
        resolve({
          success: false,
          output: stdout,
          error: stderr || `进程退出码: ${code}`,
        });
      }
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      try { unlinkSync(tmpFile); } catch {}
      resolve({
        success: false,
        output: "",
        error: `启动 Claude Code CLI 失败: ${err.message}`,
      });
    });
  });
}
