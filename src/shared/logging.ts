export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

const ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const SECRET_KEY = /api[-_]?key|token|secret|password|authorization/i;

export function redact(meta: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(meta).map(([k, v]) => [k, SECRET_KEY.test(k) ? "[redacted]" : v]),
  );
}

export function createLogger(
  level: LogLevel = "warn",
  write: (line: string) => void = (line) => process.stderr.write(line + "\n"),
): Logger {
  const emit = (lvl: LogLevel) => (message: string, meta?: Record<string, unknown>) => {
    if (ORDER[lvl] < ORDER[level]) return;
    const tail = meta ? " " + JSON.stringify(redact(meta)) : "";
    write(`[${lvl}] ${message}${tail}`);
  };
  return { debug: emit("debug"), info: emit("info"), warn: emit("warn"), error: emit("error") };
}

export const silentLogger: Logger = { debug() {}, info() {}, warn() {}, error() {} };
