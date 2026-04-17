// Lightweight structured logger. Server-side only. We avoid pulling in pino
// to keep the dependency footprint tiny — JSON.stringify with a stable key
// order is enough for `vercel logs` / `kubectl logs` / dev console scanning.
//
// Usage:
//   const log = createLogger("generation");
//   log.info("upstream_call", { url, timeoutMs });
//   log.warn("extract_skip", { reason: "non-string" });
//   log.error("generation_failed", { err });

type Level = "debug" | "info" | "warn" | "error";

const LEVEL_RANK: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const MIN_LEVEL: Level =
  (process.env.LOG_LEVEL as Level | undefined) ??
  (process.env.NODE_ENV === "production" ? "info" : "debug");

// Truncate any string field that's too long to log. Base64 image payloads
// blow up the log lines and obscure useful structure.
const MAX_STR_LEN = 240;

function shouldEmit(level: Level): boolean {
  return LEVEL_RANK[level] >= LEVEL_RANK[MIN_LEVEL];
}

function summarize(value: unknown, depth = 0): unknown {
  if (value == null) return value;
  if (typeof value === "string") {
    if (value.length <= MAX_STR_LEN) return value;
    return `${value.slice(0, MAX_STR_LEN)}…[+${value.length - MAX_STR_LEN}ch]`;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack?.split("\n").slice(0, 5).join("\n") };
  }
  if (depth >= 4) return "[depth-cap]";
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((v) => summarize(v, depth + 1));
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    let count = 0;
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (count++ >= 30) {
        out["…"] = "[key-cap]";
        break;
      }
      // Drop obviously secret-looking keys defensively.
      if (/api[_-]?key|secret|authorization|password|token/i.test(k)) {
        out[k] = "[REDACTED]";
        continue;
      }
      out[k] = summarize(v, depth + 1);
    }
    return out;
  }
  return String(value);
}

function emit(scope: string, level: Level, event: string, fields?: Record<string, unknown>): void {
  if (!shouldEmit(level)) return;
  const line = {
    t: new Date().toISOString(),
    lvl: level,
    scope,
    evt: event,
    ...(fields ? (summarize(fields) as Record<string, unknown>) : {}),
  };
  // eslint-disable-next-line no-console
  const fn = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  try {
    fn(JSON.stringify(line));
  } catch {
    fn(`[${level}] ${scope} ${event}`);
  }
}

export interface Logger {
  debug: (event: string, fields?: Record<string, unknown>) => void;
  info: (event: string, fields?: Record<string, unknown>) => void;
  warn: (event: string, fields?: Record<string, unknown>) => void;
  error: (event: string, fields?: Record<string, unknown>) => void;
}

export function createLogger(scope: string): Logger {
  return {
    debug: (e, f) => emit(scope, "debug", e, f),
    info: (e, f) => emit(scope, "info", e, f),
    warn: (e, f) => emit(scope, "warn", e, f),
    error: (e, f) => emit(scope, "error", e, f),
  };
}

// Describe the shape of an arbitrary JSON value (key names + value types,
// truncated). Useful for "what did the upstream actually return?" without
// dumping multi-MB base64 payloads.
export function describeShape(value: unknown, depth = 0, maxDepth = 3): unknown {
  if (value == null) return value === null ? "null" : "undefined";
  if (typeof value === "string") return `string(${value.length})`;
  if (typeof value === "number") return `number`;
  if (typeof value === "boolean") return "boolean";
  if (depth >= maxDepth) return "...";
  if (Array.isArray(value)) {
    return value.length === 0
      ? "[]"
      : [`array(${value.length})`, describeShape(value[0], depth + 1, maxDepth)];
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>).slice(0, 30)) {
      out[k] = describeShape(v, depth + 1, maxDepth);
    }
    return out;
  }
  return typeof value;
}
