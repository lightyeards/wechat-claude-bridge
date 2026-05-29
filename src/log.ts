type LogLevel = "error" | "info" | "debug";

let level: LogLevel = "info";

const LEVEL_ORDER: Record<LogLevel, number> = {
  error: 0,
  info: 1,
  debug: 2,
};

export function setLogLevel(l: LogLevel) {
  level = l;
}

export function shouldLog(l: LogLevel): boolean {
  return LEVEL_ORDER[l] <= LEVEL_ORDER[level];
}

export function logError(...args: unknown[]) {
  console.error(...args);
}

export function logInfo(...args: unknown[]) {
  if (shouldLog("info")) console.log(...args);
}

export function logDebug(...args: unknown[]) {
  if (shouldLog("debug")) console.log(...args);
}
