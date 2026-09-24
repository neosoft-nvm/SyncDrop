import { menuLabel } from "../core/menu.js";
import type { Operation, SyncTarget } from "../config/types.js";

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
  /** Targets in menu order. */
  targets: SyncTarget[];
  /** Extra per-folder entries besides Copy (Thunar/Dolphin cannot see Ctrl/Shift). Default: none. */
  extraOperations?: Operation[];
}

export interface MenuItem {
  target: SyncTarget;
  operation: Operation;
  label: string;
}

/** Flat, ordered list of menu items for adapters whose menus are generated at install time. */
export function menuItems(ctx: AdapterContext): MenuItem[] {
  const ops: Operation[] = ["copy", ...(ctx.extraOperations ?? [])];
  return ctx.targets.flatMap((target) => ops.map((operation) => ({ target, operation, label: menuLabel(operation, target.name) })));
}

const TERMINAL_SCRIPT =
  'for t in x-terminal-emulator gnome-terminal mate-terminal xfce4-terminal konsole xterm; do ' +
  'command -v "$t" >/dev/null 2>&1 || continue; ' +
  'case "$t" in gnome-terminal) exec "$t" -- "$@";; mate-terminal|xfce4-terminal) exec "$t" -x "$@";; *) exec "$t" -e "$@";; esac; ' +
  'done; exit 1';

/** argv that opens `syncdrop settings` in whichever terminal emulator is installed. */
export const settingsArgv = (cli: CliInvocation): string[] => ["sh", "-c", TERMINAL_SCRIPT, "syncdrop-settings", ...cliArgv(cli), "settings"];

/**
 * Adapters only translate a file-manager selection into a `syncdrop add` call.
 * They contain no copy/move/business logic.
 */
export interface FileManagerAdapter {
  readonly name: "thunar" | "dolphin" | "nautilus" | "caja";
  isSupported(): Promise<boolean>;
  /** True when SyncDrop entries are currently installed for this file manager. */
  isInstalled(): Promise<boolean>;
  install(): Promise<AdapterReport>;
  uninstall(): Promise<AdapterReport>;
}

/** Arguments the file managers pass; `--` guards against paths starting with '-'. */
export const addArgs = (targetId: string, operation: Operation): string[] => [
  "add",
  "--target",
  targetId,
  "--operation",
  operation,
  "--conflict",
  "keep-both",
  "--notify",
  "--",
];
