import type { SyncTarget } from "../config/types.js";

/** How file-manager entries invoke SyncDrop: `<node> <script> <args...>`. */
export interface CliInvocation {
  node: string;
  script: string;
}

export interface AdapterReport {
  files: string[];
  notes: string[];
}

export interface AdapterContext {
  cli: CliInvocation;
  targets: SyncTarget[];
}

/**
 * Adapters only translate a file-manager selection into a `syncdrop add` call.
 * They contain no copy/move/business logic.
 */
export interface FileManagerAdapter {
  readonly name: "thunar" | "dolphin" | "nautilus";
  isSupported(): Promise<boolean>;
  install(): Promise<AdapterReport>;
  uninstall(): Promise<AdapterReport>;
}

/** Arguments the file managers pass; `--` guards against paths starting with '-'. */
export const addArgs = (targetId: string): string[] => [
  "add",
  "--target",
  targetId,
  "--conflict",
  "keep-both",
  "--notify",
  "--",
];
