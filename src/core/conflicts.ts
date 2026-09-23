import path from "node:path";
import type { ConflictPolicy } from "../config/types.js";

export type ResolvedPolicy = Exclude<ConflictPolicy, "ask">;

export interface ConflictInfo {
  source: string;
  destination: string;
}

export interface ConflictAnswer {
  policy: ResolvedPolicy;
  /** Reuse this policy for the rest of the request. */
  applyToAll?: boolean;
}

/** Called for each conflict when the policy is `ask`. Throw ConflictError to abort. */
export type ConflictResolver = (info: ConflictInfo) => Promise<ConflictAnswer>;

/**
 * Deterministic "keep both" name: `report.pdf` -> `report (1).pdf`, `report (2).pdf`, ...
 * Directories get the suffix on the full name.
 */
export function keepBothName(destination: string, n: number, isDirectory: boolean): string {
  const dir = path.dirname(destination);
  const base = path.basename(destination);
  if (isDirectory) return path.join(dir, `${base} (${n})`);
  const { name, ext } = path.parse(base);
  return path.join(dir, `${name} (${n})${ext}`);
}
