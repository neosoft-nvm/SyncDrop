import path from "node:path";
import { getBackend } from "../backends/registry.js";
import type { Config, ConflictPolicy, Operation } from "../config/types.js";
import { silentLogger, type Logger } from "../shared/logging.js";
import type { ConflictResolver } from "./conflicts.js";
import { copyEntry, lstatOrNull, type CopyContext } from "./copy.js";
import { ArgsError, OperationError, SyncDropError, describeError } from "./errors.js";
import { nullHistory, type HistoryStore } from "./history.js";
import { linkEntry } from "./link.js";
import { moveEntry } from "./move.js";
import { assertSafeDestination } from "./validation.js";

export interface AddRequest {
  sources: string[];
  targetId: string;
  operation?: Operation;
  conflict?: ConflictPolicy;
}

export interface OperationResult {
  success: boolean;
  source: string;
  destination?: string;
  operation: Operation;
  /** True when the source was skipped entirely because of a conflict. */
  skipped?: boolean;
  /** Items skipped inside a merged directory. */
  skippedItems?: number;
  error?: string;
  errorCode?: SyncDropError["code"];
}

export interface SyncDropOptions {
  config: Config;
  logger?: Logger;
  history?: HistoryStore;
  resolver?: ConflictResolver;
  cwd?: string;
}

export class SyncDrop {
  private readonly config: Config;
  private readonly log: Logger;
  private readonly history: HistoryStore;
  private readonly resolver?: ConflictResolver;
  private readonly cwd: string;

  constructor(opts: SyncDropOptions) {
    this.config = opts.config;
    this.log = opts.logger ?? silentLogger;
    this.history = opts.history ?? nullHistory;
    this.resolver = opts.resolver;
    this.cwd = opts.cwd ?? process.cwd();
  }

  /**
   * Add sources to a target. Request-level problems (unknown target, missing or
   * unwritable destination) throw; per-source problems are returned as failed results.
   */
  async add(req: AddRequest): Promise<OperationResult[]> {
    const target = this.config.targets[req.targetId];
    if (!target) {
      const known = Object.keys(this.config.targets).join(", ") || "(none)";
      throw new ArgsError(`unknown target '${req.targetId}'. Available targets: ${known}`);
    }
    if (req.sources.length === 0) throw new ArgsError("no files or folders given");

    const operation = req.operation ?? this.config.defaults.operation;
    const destDir = await getBackend(target.backend).prepareTarget(target);
    const ctx: CopyContext = {
      policy: req.conflict ?? this.config.defaults.conflict,
      resolve: this.resolver,
      stats: { copied: 0, skipped: 0 },
    };
    this.log.debug("add", { target: target.id, destDir, operation, policy: ctx.policy });

    const results: OperationResult[] = [];
    const seen = new Set<string>();
    for (const raw of req.sources) {
      const source = path.resolve(this.cwd, raw);
      if (seen.has(source)) continue;
      seen.add(source);

      const result = await this.addOne(source, destDir, operation, ctx);
      results.push(result);
      this.log.debug("result", { ...result });
      try {
        await this.history.append({
          timestamp: new Date().toISOString(),
          operation,
          target: target.id,
          source,
          destination: result.destination,
          success: result.success,
          skipped: result.skipped,
          error: result.error,
        });
      } catch (e) {
        this.log.warn(`could not write history: ${describeError(e)}`);
      }
    }
    return results;
  }

  private async addOne(
    source: string,
    destDir: string,
    operation: Operation,
    ctx: CopyContext,
  ): Promise<OperationResult> {
    try {
      if (!(await lstatOrNull(source))) throw new OperationError(`source does not exist: ${source}`);
      await assertSafeDestination(source, destDir);
      const dest = path.join(destDir, path.basename(source));
      const skippedBefore = ctx.stats.skipped;
      const run = operation === "move" ? moveEntry : operation === "link" ? linkEntry : copyEntry;
      const final = await run(source, dest, ctx);
      const skippedItems = ctx.stats.skipped - skippedBefore;
      if (final === null) return { success: true, source, operation, skipped: true };
      return { success: true, source, destination: final, operation, ...(skippedItems ? { skippedItems } : {}) };
    } catch (e) {
      return {
        success: false,
        source,
        operation,
        error: describeError(e),
        errorCode: e instanceof SyncDropError ? e.code : "OPERATION",
      };
    }
  }
}
