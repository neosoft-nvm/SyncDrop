import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { Operation } from "../config/types.js";
import { isErrno } from "./errors.js";

export interface HistoryEntry {
  timestamp: string;
  operation: Operation;
  target: string;
  source: string;
  destination?: string;
  success: boolean;
  skipped?: boolean;
  error?: string;
}

export interface HistoryStore {
  append(entry: HistoryEntry): Promise<void>;
}

export const nullHistory: HistoryStore = { async append() {} };

/** One JSON object per line; appends are safe across concurrent invocations. */
export class JsonlHistory implements HistoryStore {
  constructor(readonly file: string) {}

  async append(entry: HistoryEntry): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true });
    await appendFile(this.file, JSON.stringify(entry) + "\n");
  }

  async recent(limit = 20): Promise<HistoryEntry[]> {
    let text: string;
    try {
      text = await readFile(this.file, "utf8");
    } catch (e) {
      if (isErrno(e, "ENOENT")) return [];
      throw e;
    }
    const entries: HistoryEntry[] = [];
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      try {
        entries.push(JSON.parse(line) as HistoryEntry);
      } catch {
        /* ignore a corrupt line */
      }
    }
    return entries.slice(-limit).reverse();
  }
}
