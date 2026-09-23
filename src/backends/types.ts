import type { BackendId, SyncTarget } from "../config/types.js";

export interface Backend {
  readonly id: BackendId;
  /**
   * Check the target is usable and return the real destination directory.
   * Backends must not require credentials or modify the sync tool's own configuration (MVP).
   */
  prepareTarget(target: SyncTarget): Promise<string>;
}
