import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { isErrno } from "../../../core/errors.js";
import { which } from "../../../shared/paths.js";
import { xdgConfigHome } from "../../common.js";
import { addArgs, type AdapterContext, type AdapterReport, type FileManagerAdapter } from "../../types.js";

const ID_PREFIX = "syncdrop-";
const ACTION_RE = /[ \t]*<action>[\s\S]*?<\/action>[ \t]*\r?\n?/g;

const xmlEscape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const shellQuote = (s: string) => `"${s.replace(/(["\\$`])/g, "\\$1")}"`;

/** One Thunar custom action per target (Thunar custom actions cannot form submenus). */
export function buildActions(ctx: AdapterContext): string {
  return ctx.targets
    .map((t) => {
      const command = [shellQuote(ctx.cli.node), shellQuote(ctx.cli.script), ...addArgs(t.id), "%F"].join(" ");
      return [
        "<action>",
        "\t<icon>folder-remote</icon>",
        `\t<name>${xmlEscape(`SyncDrop: ${t.name}`)}</name>`,
        `\t<unique-id>${ID_PREFIX}${xmlEscape(t.id)}</unique-id>`,
        `\t<command>${xmlEscape(command)}</command>`,
        `\t<description>${xmlEscape(`Copy the selection to the SyncDrop target '${t.name}'`)}</description>`,
        "\t<patterns>*</patterns>",
        "\t<directories/>",
        "\t<audio-files/>",
        "\t<image-files/>",
        "\t<other-files/>",
        "\t<text-files/>",
        "\t<video-files/>",
        "</action>",
      ].join("\n");
    })
    .join("\n");
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

  async install(): Promise<AdapterReport> {
    const existing = await this.read();
    await mkdir(path.dirname(this.file), { recursive: true });
    if (existing !== null) await copyFile(this.file, this.file + ".syncdrop.bak").catch(() => {});
    await writeFile(this.file, mergeUca(existing, buildActions(this.ctx)));
    return {
      files: [this.file],
      notes: ["Restart Thunar to load the actions: thunar -q", "Re-run install after adding or renaming targets."],
    };
  }

  async uninstall(): Promise<AdapterReport> {
    const existing = await this.read();
    if (existing === null) return { files: [], notes: ["nothing to remove"] };
    await writeFile(this.file, mergeUca(existing, ""));
    return { files: [this.file], notes: ["Restart Thunar: thunar -q"] };
  }
}
