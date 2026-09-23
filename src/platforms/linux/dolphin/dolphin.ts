import { chmod, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { which } from "../../../shared/paths.js";
import { xdgDataHome } from "../../common.js";
import { addArgs, type AdapterContext, type AdapterReport, type FileManagerAdapter } from "../../types.js";

/** Quote one Exec argument per the Desktop Entry spec (quoting, then string escaping). */
const execArg = (s: string) => `"${s.replace(/(["`$\\])/g, "\\$1")}"`.replace(/\\/g, "\\\\");
/** Action ids may only contain alphanumerics and '-'; the index keeps them unique. */
const actionKey = (id: string, i: number) => `syncdrop-${i}-${id.replace(/[^A-Za-z0-9]/g, "-")}`;

/** A KDE Service Menu with a "SyncDrop" submenu containing one action per target. */
export function buildServiceMenu(ctx: AdapterContext): string {
  const keys = ctx.targets.map((t, i) => actionKey(t.id, i));
  const lines = [
    "[Desktop Entry]",
    "Type=Service",
    "Name=SyncDrop",
    "MimeType=all/all;inode/directory;",
    "X-KDE-ServiceTypes=KonqPopupMenu/Plugin",
    "X-KDE-Submenu=SyncDrop",
    "Icon=folder-sync",
    `Actions=${keys.join(";")};`,
    "",
  ];
  ctx.targets.forEach((t, i) => {
    const exec = [execArg(ctx.cli.node), execArg(ctx.cli.script), ...addArgs(t.id).map(execArg), "%F"].join(" ");
    lines.push(`[Desktop Action ${keys[i]}]`, `Name=${t.name.replace(/[\r\n]/g, " ")}`, "Icon=folder-sync", `Exec=${exec}`, "");
  });
  return lines.join("\n");
}

export class DolphinAdapter implements FileManagerAdapter {
  readonly name = "dolphin" as const;
  constructor(private readonly ctx: AdapterContext) {}

  private get file(): string {
    return path.join(xdgDataHome(), "kio", "servicemenus", "syncdrop.desktop");
  }

  isSupported = async () => process.platform === "linux" && !!(await which("dolphin"));

  async install(): Promise<AdapterReport> {
    await mkdir(path.dirname(this.file), { recursive: true });
    await writeFile(this.file, buildServiceMenu(this.ctx));
    await chmod(this.file, 0o755); // newer KDE only trusts executable service menus
    return {
      files: [this.file],
      notes: ["Restart Dolphin. Entries appear under right-click > SyncDrop.", "Re-run install after adding or renaming targets."],
    };
  }

  async uninstall(): Promise<AdapterReport> {
    await rm(this.file, { force: true });
    return { files: [this.file], notes: ["Restart Dolphin."] };
  }
}
