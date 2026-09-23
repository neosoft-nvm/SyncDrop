export const BACKEND_IDS = ["local", "syncthing"] as const;
export type BackendId = (typeof BACKEND_IDS)[number];

export type Operation = "copy" | "move";
export type ConflictPolicy = "ask" | "overwrite" | "skip" | "keep-both";

export const OPERATIONS: readonly Operation[] = ["copy", "move"];
export const CONFLICT_POLICIES: readonly ConflictPolicy[] = ["ask", "overwrite", "skip", "keep-both"];

export interface SyncTarget {
  id: string;
  name: string;
  /** Absolute, `~`-expanded destination directory. */
  path: string;
  backend: BackendId;
}

export interface Defaults {
  operation: Operation;
  target: string;
  conflict: ConflictPolicy;
}

/** Shape of config.json. Unknown fields are allowed and preserved. */
export interface ConfigFile {
  version: number;
  targets: Record<string, { name: string; path: string; backend: string; [k: string]: unknown }>;
  defaults?: Partial<Defaults>;
  [k: string]: unknown;
}

/** Validated, resolved configuration. */
export interface Config {
  version: number;
  targets: Record<string, SyncTarget>;
  defaults: Defaults;
  /** The original parsed file, kept so future writers can preserve unknown fields. */
  raw: ConfigFile;
}
