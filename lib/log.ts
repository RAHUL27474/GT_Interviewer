// Readable backend logs: "12:04:31 [ai] Questions ready (6) in 8.2s". Set LOG_LEVEL=warn to quieten, debug for more.

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 } as const;
type Level = keyof typeof LEVELS;
const min = LEVELS[(process.env.LOG_LEVEL?.toLowerCase() as Level) || "info"] ?? LEVELS.info;

const COLOR: Record<Level, string> = { debug: "\x1b[90m", info: "\x1b[36m", warn: "\x1b[33m", error: "\x1b[31m" };
const RESET = "\x1b[0m";

function write(level: Level, scope: string, msg: string, err?: unknown) {
  if (LEVELS[level] < min) return;
  const time = new Date().toLocaleTimeString("en-GB", { hour12: false });
  const line = `${time} ${COLOR[level]}[${scope}]${RESET} ${msg}`;
  const out = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  if (err === undefined) out(line);
  else out(line, err instanceof Error ? (level === "error" ? err : err.message) : err);
}

export function logger(scope: string) {
  return {
    debug: (msg: string) => write("debug", scope, msg),
    info: (msg: string) => write("info", scope, msg),
    warn: (msg: string, err?: unknown) => write("warn", scope, msg, err),
    error: (msg: string, err?: unknown) => write("error", scope, msg, err),
  };
}

/** Seconds since `start` (from Date.now()), e.g. "3.4s". */
export const since = (start: number) => `${((Date.now() - start) / 1000).toFixed(1)}s`;

/** Short, readable candidate label for logs: "Rahul Chaudhary (217ebd1d)". */
export const who = (c: { id: string; fullName?: string }) => `${c.fullName ?? "candidate"} (${c.id.slice(0, 8)})`;
