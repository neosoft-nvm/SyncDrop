export const BACKEND_IDS = ["local", "syncthing"] as const;
export type BackendId = (typeof BACKEND_IDS)[number];

/** `link` puts a symbolic link to the source in the target instead of copying it. */
export type Operation = "copy" | "move" | "link";
export type ConflictPolicy = "ask" | "overwrite" | "skip" | "keep-both";

export const OPERATIONS: readonly Operation[] = ["copy", "move", "link"];
export const CONFLICT_POLICIES: readonly ConflictPolicy[] = ["ask", "overwrite", "skip", "keep-both"];

export interface SyncTarget {
  id: string;
  name: string;
  /** Absolute, `~`-expanded destination directory. */
  path: string;
  backend: BackendId;
}

/** Which entries the file-manager menus show, and in what order. */
export interface MenuSettings {
  /** Operations offered for every target, in menu order. */
  operations: Operation[];
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
  menu?: { operations?: string[]; order?: string[]; [k: string]: unknown };
  [k: string]: unknown;
}

/** Validated, resolved configuration. */
export interface Config {
  version: number;
  targets: Record<string, SyncTarget>;
  defaults: Defaults;
  menu: MenuSettings;
  /** Target ids in menu order (every target appears exactly once). */
  order: string[];
  /** The original parsed file, kept so future writers can preserve unknown fields. */
  raw: ConfigFile;
}
