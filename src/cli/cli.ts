import { stat } from "node:fs/promises";
import readline from "node:readline";
import { loadConfig, writeDefaultConfig } from "../config/config.js";
import { CONFLICT_POLICIES, OPERATIONS, type ConflictPolicy, type Operation } from "../config/types.js";
import type { ConflictResolver } from "../core/conflicts.js";
import { ConflictError, EXIT, SyncDropError, ArgsError, describeError, exitCodeFor } from "../core/errors.js";
import { JsonlHistory } from "../core/history.js";
import { SyncDrop, type OperationResult } from "../core/syncdrop.js";
import { createLogger } from "../shared/logging.js";
import { desktopNotify } from "../shared/notify.js";
import { configFilePath, historyFilePath } from "../shared/paths.js";
import { getVersion } from "../shared/version.js";
import { defaultCli } from "../platforms/common.js";
import { ADAPTER_NAMES, createAdapter } from "../platforms/registry.js";

export interface CliIO {
  out(line: string): void;
  err(line: string): void;
  /** True when a person can answer prompts (TTY on stdin and stdout). */
  interactive: boolean;
  ask(question: string): Promise<string>;
  notify(title: string, body: string): void;
}

const HELP = `syncdrop - send files and folders to a sync target

Usage:
  syncdrop [--verbose] <command> [options]

Commands:
  targets, target list        List configured targets (--json for machine output)
  add FILE...                 Copy or move files/folders into a target
      -t, --target <id>         Target id (default: config defaults.target)
      -o, --operation <op>      copy | move            (default: config)
      -c, --conflict <policy>   ask | overwrite | skip | keep-both
          --notify              Show a desktop notification when done
  config path                 Print the configuration file location
  config init [--force]       Create a default configuration
  history [-n <count>] [--json]   Show recent operations
  integrate <install|uninstall|status> [thunar|dolphin|nautilus|all]
                              Manage file-manager context-menu entries

Global options:
  -h, --help       Show this help
  -V, --version    Show version
  -v, --verbose    Debug logging (stderr)

Exit codes: 0 ok, 1 operation failed, 2 invalid arguments,
            3 configuration error, 4 conflict needs a decision.
`;

interface Parsed {
  positionals: string[];
  flags: Map<string, string | true>;
}

const VALUE_OPTS: Record<string, string> = { "--target": "target", "-t": "target", "--operation": "operation", "-o": "operation", "--conflict": "conflict", "-c": "conflict", "--limit": "limit", "-n": "limit" };
const BOOL_OPTS: Record<string, string> = { "--help": "help", "-h": "help", "--version": "version", "-V": "version", "--verbose": "verbose", "-v": "verbose", "--json": "json", "--notify": "notify", "--force": "force" };

export function parseArgs(argv: string[]): Parsed {
  const positionals: string[] = [];
  const flags = new Map<string, string | true>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (arg === "--") {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (!arg.startsWith("-") || arg === "-") {
      positionals.push(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    const name = eq > 0 && arg.startsWith("--") ? arg.slice(0, eq) : arg;
    if (name in BOOL_OPTS) {
      flags.set(BOOL_OPTS[name] as string, true);
    } else if (name in VALUE_OPTS) {
      const value = eq > 0 && arg.startsWith("--") ? arg.slice(eq + 1) : argv[++i];
      if (value === undefined) throw new ArgsError(`option ${name} needs a value`);
      flags.set(VALUE_OPTS[name] as string, value);
    } else {
      throw new ArgsError(`unknown option '${arg}'`);
    }
  }
  return { positionals, flags };
}

function makeResolver(io: CliIO): ConflictResolver {
  return async ({ destination }) => {
    for (;;) {
      const answer = (
        await io.ask(`'${destination}' already exists. [o]verwrite, [s]kip, [k]eep both, [a]bort (capital = apply to all): `)
      ).trim();
      switch (answer) {
        case "o": return { policy: "overwrite" };
        case "O": return { policy: "overwrite", applyToAll: true };
        case "s": return { policy: "skip" };
        case "S": return { policy: "skip", applyToAll: true };
        case "k": return { policy: "keep-both" };
        case "K": return { policy: "keep-both", applyToAll: true };
        case "a": case "A": case "":
          throw new ConflictError("aborted by user");
      }
    }
  };
}

function describeResult(r: OperationResult): string {
  const verb = r.operation === "move" ? "moved" : "copied";
  if (!r.success) return `FAILED   ${r.source}: ${r.error}`;
  if (r.skipped) return `skipped  ${r.source} (already exists)`;
  const extra = r.skippedItems ? ` (${r.skippedItems} existing item(s) skipped)` : "";
  return `${verb}   ${r.source} -> ${r.destination}${extra}`;
}

async function cmdAdd(p: Parsed, io: CliIO, logger: ReturnType<typeof createLogger>): Promise<number> {
  const config = await loadConfig();
  const targetId = (p.flags.get("target") as string | undefined) ?? config.defaults.target;
  const operation = (p.flags.get("operation") as string | undefined) ?? config.defaults.operation;
  const conflict = (p.flags.get("conflict") as string | undefined) ?? config.defaults.conflict;
  if (!OPERATIONS.includes(operation as Operation)) throw new ArgsError(`--operation must be one of: ${OPERATIONS.join(", ")}`);
  if (!CONFLICT_POLICIES.includes(conflict as ConflictPolicy)) throw new ArgsError(`--conflict must be one of: ${CONFLICT_POLICIES.join(", ")}`);
  const sources = p.positionals.slice(1);
  if (sources.length === 0) throw new ArgsError("add: no files or folders given");

  const sd = new SyncDrop({
    config,
    logger,
    history: new JsonlHistory(historyFilePath()),
    resolver: io.interactive ? makeResolver(io) : undefined,
  });
  const notify = p.flags.has("notify");
  let results: OperationResult[];
  try {
    results = await sd.add({ sources, targetId, operation: operation as Operation, conflict: conflict as ConflictPolicy });
  } catch (e) {
    if (notify) io.notify("SyncDrop failed", describeError(e));
    throw e;
  }

  for (const r of results) (r.success ? io.out : io.err)(describeResult(r));
  const failed = results.filter((r) => !r.success);
  if (notify) {
    const target = config.targets[targetId]?.name ?? targetId;
    io.notify(
      failed.length ? "SyncDrop: some items failed" : "SyncDrop",
      failed.length ? failed.map((r) => r.error).join("\n") : `${results.length} item(s) sent to ${target}`,
    );
  }
  if (failed.length === 0) return EXIT.OK;
  return failed.some((r) => r.errorCode !== "CONFLICT") ? EXIT.FAILURE : EXIT.CONFLICT;
}

async function cmdTargets(p: Parsed, io: CliIO): Promise<number> {
  const config = await loadConfig();
  const rows = await Promise.all(
    Object.values(config.targets).map(async (t) => ({
      id: t.id,
      name: t.name,
      backend: t.backend,
      path: t.path,
      exists: await stat(t.path).then((s) => s.isDirectory(), () => false),
    })),
  );
  if (p.flags.has("json")) {
    io.out(JSON.stringify(rows, null, 2));
    return EXIT.OK;
  }
  const w = (k: "id" | "name" | "backend") => Math.max(k.length, ...rows.map((r) => r[k].length));
  const [wi, wn, wb] = [w("id"), w("name"), w("backend")];
  io.out(`${"ID".padEnd(wi)}  ${"NAME".padEnd(wn)}  ${"BACKEND".padEnd(wb)}  PATH`);
  for (const r of rows) {
    io.out(`${r.id.padEnd(wi)}  ${r.name.padEnd(wn)}  ${r.backend.padEnd(wb)}  ${r.path}${r.exists ? "" : "  (missing)"}`);
  }
  return EXIT.OK;
}

async function cmdConfig(p: Parsed, io: CliIO): Promise<number> {
  const sub = p.positionals[1];
  if (sub === "path") {
    io.out(configFilePath());
    return EXIT.OK;
  }
  if (sub === "init") {
    await writeDefaultConfig(configFilePath(), p.flags.has("force"));
    io.out(`created ${configFilePath()}`);
    return EXIT.OK;
  }
  throw new ArgsError("config: expected 'path' or 'init'");
}

async function cmdHistory(p: Parsed, io: CliIO): Promise<number> {
  const limit = Number(p.flags.get("limit") ?? 20);
  if (!Number.isInteger(limit) || limit < 1) throw new ArgsError("--limit must be a positive integer");
  const entries = await new JsonlHistory(historyFilePath()).recent(limit);
  if (p.flags.has("json")) {
    io.out(JSON.stringify(entries, null, 2));
    return EXIT.OK;
  }
  if (entries.length === 0) io.out("no history yet");
  for (const e of entries) {
    const state = e.success ? (e.skipped ? "SKIP" : "OK  ") : "FAIL";
    io.out(`${e.timestamp}  ${state}  ${e.operation}  ${e.target}  ${e.source}${e.destination ? " -> " + e.destination : ""}${e.error ? "  (" + e.error + ")" : ""}`);
  }
  return EXIT.OK;
}

async function cmdIntegrate(p: Parsed, io: CliIO): Promise<number> {
  const action = p.positionals[1];
  const which = p.positionals[2] ?? "all";
  if (action !== "install" && action !== "uninstall" && action !== "status") {
    throw new ArgsError("integrate: expected install, uninstall or status");
  }
  const config = await loadConfig();
  const ctx = { cli: defaultCli(), targets: Object.values(config.targets) };
  const names = which === "all" ? [...ADAPTER_NAMES] : [which];
  let code: number = EXIT.OK;
  for (const name of names) {
    const adapter = createAdapter(name, ctx);
    const supported = await adapter.isSupported();
    if (action === "status") {
      io.out(`${name}: ${supported ? "file manager found" : "file manager not found"}`);
      continue;
    }
    if (!supported && which === "all") {
      io.out(`${name}: not installed, skipping`);
      continue;
    }
    if (!supported) io.err(`${name}: warning: file manager not found on PATH, installing anyway`);
    try {
      const report = action === "install" ? await adapter.install() : await adapter.uninstall();
      io.out(`${name}: ${action === "install" ? "installed" : "removed"} ${report.files.join(", ")}`);
      report.notes.forEach((n) => io.out(`  ${n}`));
    } catch (e) {
      io.err(`${name}: ${describeError(e)}`);
      code = EXIT.FAILURE; // one adapter failing must not stop the others
    }
  }
  return code;
}

/** Run the CLI and return the process exit code. */
export async function run(argv: string[], io: CliIO): Promise<number> {
  try {
    const p = parseArgs(argv);
    if (p.flags.has("version")) {
      io.out(getVersion());
      return EXIT.OK;
    }
    const command = p.positionals[0];
    if (p.flags.has("help") || !command || command === "help") {
      io.out(HELP);
      return EXIT.OK;
    }
    const logger = createLogger(p.flags.has("verbose") ? "debug" : "warn", (l) => io.err(l));
    switch (command) {
      case "add":
        return await cmdAdd(p, io, logger);
      case "targets":
        return await cmdTargets(p, io);
      case "target":
        if (p.positionals[1] === "list") return await cmdTargets(p, io);
        throw new ArgsError("target: expected 'list'");
      case "config":
        return await cmdConfig(p, io);
      case "history":
        return await cmdHistory(p, io);
      case "integrate":
        return await cmdIntegrate(p, io);
      default:
        throw new ArgsError(`unknown command '${command}'. Try 'syncdrop --help'.`);
    }
  } catch (e) {
    io.err(`syncdrop: ${describeError(e)}`);
    return e instanceof SyncDropError ? exitCodeFor(e.code) : EXIT.FAILURE;
  }
}

export function createProcessIO(): CliIO {
  return {
    out: (l) => void process.stdout.write(l + "\n"),
    err: (l) => void process.stderr.write(l + "\n"),
    interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY),
    ask: (q) =>
      new Promise<string>((resolve) => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
        rl.once("close", () => resolve(""));
        rl.question(q, (a) => {
          resolve(a);
          rl.close();
        });
      }),
    notify: desktopNotify,
  };
}
