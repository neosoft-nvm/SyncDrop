import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { isErrno } from "../../../core/errors.js";
import { which } from "../../../shared/paths.js";
import { xdgConfigHome } from "../../common.js";
import { addArgs, cliArgv, menuItems, settingsArgv, type AdapterContext, type AdapterReport, type FileManagerAdapter } from "../../types.js";

const ID_PREFIX = "syncdrop-";
const ACTION_RE = /[ \t]*<action>[\s\S]*?<\/action>[ \t]*\r?\n?/g;

const xmlEscape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const shellQuote = (s: string) => `"${s.replace(/(["\\$`])/g, "\\$1")}"`;

const action = (name: string, id: string, command: string, description: string) =>
  [
    "<action>",
    "\t<icon>folder-remote</icon>",
    `\t<name>${xmlEscape(name)}</name>`,
    `\t<unique-id>${ID_PREFIX}${xmlEscape(id)}</unique-id>`,
    `\t<command>${xmlEscape(command)}</command>`,
    `\t<description>${xmlEscape(description)}</description>`,
    "\t<patterns>*</patterns>",
    "\t<directories/>",
    "\t<audio-files/>",
    "\t<image-files/>",
    "\t<other-files/>",
    "\t<text-files/>",
    "\t<video-files/>",
    "</action>",
  ].join("\n");

/** One Thunar custom action per target and operation, then Settings (Thunar custom actions cannot form submenus). */
export function buildActions(ctx: AdapterContext): string {
  const items = menuItems(ctx).map(({ target: t, operation, label }) =>
    action(
      `SyncDrop: ${label}`,
      `${t.id}-${operation}`,
      [...cliArgv(ctx.cli).map(shellQuote), ...addArgs(t.id, operation), "%F"].join(" "),
      `${label} (SyncDrop target '${t.name}')`,
    ),
  );
  items.push(action("SyncDrop: Settings", "settings", settingsArgv(ctx.cli).map(shellQuote).join(" "), "Open the SyncDrop settings"));
  return items.join("\n");
}

const isOurs = (block: string) => block.includes(`<unique-id>${ID_PREFIX}`);

/** Remove SyncDrop actions, then (optionally) add the given ones. Other actions are untouched. */
export function mergeUca(existing: string | null, actionsXml: string): string {
  const base =
    existing && existing.includes("</actions>")
      ? existing.replace(ACTION_RE, (block) => (isOurs(block) ? "" : block))
      : '<?xml version="1.0" encoding="UTF-8"?>\n<actions>\n</actions>\n';
  if (!actionsXml) return base;
  return base.replace("</actions>", `${actionsXml}\n</actions>`);
}

export class ThunarAdapter implements FileManagerAdapter {
  readonly name = "thunar" as const;
  constructor(private readonly ctx: AdapterContext) {}

  private get file(): string {
    return path.join(xdgConfigHome(), "Thunar", "uca.xml");
  }

  isSupported = async () => process.platform === "linux" && !!(await which("thunar"));

  private async read(): Promise<string | null> {
    try {
      return await readFile(this.file, "utf8");
    } catch (e) {
      if (isErrno(e, "ENOENT")) return null;
      throw e;
    }
  }

  async isInstalled() {
    return ((await this.read()) ?? "").includes(`<unique-id>${ID_PREFIX}`);
  }

  async install(): Promise<AdapterReport> {
    const existing = await this.read();
    await mkdir(path.dirname(this.file), { recursive: true });
    if (existing !== null) await copyFile(this.file, this.file + ".syncdrop.bak").catch(() => {});
    await writeFile(this.file, mergeUca(existing, buildActions(this.ctx)));
    return {
      files: [this.file],
      notes: ["Restart Thunar to load the actions: thunar -q", "Menu changes made in SyncDrop settings are applied for you."],
    };
  }

  async uninstall(): Promise<AdapterReport> {
    const existing = await this.read();
    if (existing === null) return { files: [], notes: ["nothing to remove"] };
    await writeFile(this.file, mergeUca(existing, ""));
    return { files: [this.file], notes: ["Restart Thunar: thunar -q"] };
  }
}
