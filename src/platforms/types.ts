import type { SyncTarget } from "../config/types.js";

/**
 * How file-manager entries invoke SyncDrop: `<node> <script> <args...>`,
 * or just `<node> <args...>` when `node` is the self-contained syncdrop binary (no script).
 */
export interface CliInvocation {
  node: string;
  script?: string;
}

export const cliArgv = (cli: CliInvocation): string[] => (cli.script ? [cli.node, cli.script] : [cli.node]);

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
  readonly name: "thunar" | "dolphin" | "nautilus" | "caja";
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
