export type ErrorCode = "ARGS" | "CONFIG" | "CONFLICT" | "OPERATION";

export const EXIT = { OK: 0, FAILURE: 1, ARGS: 2, CONFIG: 3, CONFLICT: 4 } as const;

export function exitCodeFor(code: ErrorCode): number {
  switch (code) {
    case "ARGS":
      return EXIT.ARGS;
    case "CONFIG":
      return EXIT.CONFIG;
    case "CONFLICT":
      return EXIT.CONFLICT;
    default:
      return EXIT.FAILURE;
  }
}

export class SyncDropError extends Error {
  constructor(
    message: string,
    readonly code: ErrorCode,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ArgsError extends SyncDropError {
  constructor(message: string) {
    super(message, "ARGS");
  }
}
export class ConfigError extends SyncDropError {
  constructor(message: string) {
    super(message, "CONFIG");
  }
}
export class ConflictError extends SyncDropError {
  constructor(message: string) {
    super(message, "CONFLICT");
  }
}
export class OperationError extends SyncDropError {
  constructor(message: string) {
    super(message, "OPERATION");
  }
}

export function isErrno(e: unknown, ...codes: string[]): boolean {
  return typeof e === "object" && e !== null && codes.includes((e as NodeJS.ErrnoException).code ?? "");
}

/** Turn any thrown value into a short, user-facing message. */
export function describeError(e: unknown): string {
  if (e instanceof SyncDropError) return e.message;
  const errno = e as NodeJS.ErrnoException;
  const where = errno?.path ? `: ${errno.path}` : "";
  switch (errno?.code) {
    case "EACCES":
    case "EPERM":
      return `permission denied${where}`;
    case "ENOENT":
      return `no such file or directory${where}`;
    case "ENOSPC":
      return `no space left on device${where}`;
    case "EROFS":
      return `read-only file system${where}`;
    case "ENAMETOOLONG":
      return `file name too long${where}`;
    default:
      return e instanceof Error ? e.message : String(e);
  }
}
