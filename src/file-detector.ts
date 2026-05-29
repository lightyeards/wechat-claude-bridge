import fs from "fs";
import path from "path";

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg"]);

export function classifyFile(filePath: string): "image" | "file" {
  const ext = path.extname(filePath).toLowerCase();
  return IMAGE_EXTENSIONS.has(ext) ? "image" : "file";
}

// Strip trailing markdown/formatting chars that get caught in path match
function cleanPath(raw: string): string {
  return raw.replace(/[`*_~]+$/, "");
}

export function detectFilePaths(text: string, cwd: string): string[] {
  const candidates = new Set<string>();

  // Markdown code/links: `path` or [text](path) — extract inner path
  const codeRegex = /`([^`]+)`/g;
  let m: RegExpExecArray | null;
  while ((m = codeRegex.exec(text)) !== null) {
    const inner = cleanPath(m[1]);
    if (/^[A-Z]:[\\\/]/.test(inner)) {
      candidates.add(inner);
    }
  }

  // Markdown links: [text](path)
  const mdLinkRegex = /\[([^\]]*)\]\(([^)]+)\)/g;
  while ((m = mdLinkRegex.exec(text)) !== null) {
    const linkPath = m[2];
    if (/^[A-Z]:[\\\/]/.test(linkPath) || linkPath.startsWith("/")) {
      candidates.add(cleanPath(linkPath));
    }
  }

  // Quoted paths
  const quotedRegex = /["']([A-Z]:[\\\/][^"']+)["']/g;
  while ((m = quotedRegex.exec(text)) !== null) {
    candidates.add(cleanPath(m[1]));
  }

  // Bare Windows absolute paths as fallback (after extracting formatted ones)
  const winAbsRegex = /[A-Z]:[\\\/][^\s"'<>\|）】」』,，。；！？\)`:]+/g;
  while ((m = winAbsRegex.exec(text)) !== null) {
    candidates.add(cleanPath(m[0]));
  }

  // Filter to existing files only
  const existing: string[] = [];
  for (const p of candidates) {
    const cleaned = cleanPath(p);
    try {
      if (fs.existsSync(cleaned)) {
        const stat = fs.statSync(cleaned);
        if (stat.isFile()) {
          existing.push(path.resolve(cleaned));
        }
      }
    } catch {
      // skip inaccessible paths
    }
  }

  // Deduplicate
  return [...new Set(existing)];
}
