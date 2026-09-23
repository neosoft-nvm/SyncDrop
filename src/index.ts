export { SyncDrop, type AddRequest, type OperationResult, type SyncDropOptions } from "./core/syncdrop.js";
export { loadConfig, validateConfig, writeDefaultConfig } from "./config/config.js";
export type { Config, ConflictPolicy, Operation, SyncTarget } from "./config/types.js";
export { JsonlHistory, type HistoryEntry, type HistoryStore } from "./core/history.js";
export type { ConflictResolver } from "./core/conflicts.js";
export * from "./core/errors.js";
