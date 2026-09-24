import { access, chmod, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { which } from "../../../shared/paths.js";
import { xdgDataHome } from "../../common.js";
import { addArgs, cliArgv, menuItems, settingsArgv, type AdapterContext, type AdapterReport, type FileManagerAdapter } from "../../types.js";

/** Quote one Exec argument per the Desktop Entry spec (quoting, then string escaping). */
const execArg = (s: string) => `"${s.replace(/(["`$\\])/g, "\\$1")}"`.replace(/\\/g, "\\\\");
/** Action ids may only contain alphanumerics and '-'; the index keeps them unique. */
const actionKey = (id: string, i: number) => `syncdrop-${i}-${id.replace(/[^A-Za-z0-9]/g, "-")}`;

/** A KDE Service Menu with a "SyncDrop" submenu: one action per target and operation, then Settings. */
export function buildServiceMenu(ctx: AdapterContext): string {
  const items = menuItems(ctx);
  const keys = [...items.map((m, i) => actionKey(`${m.target.id}-${m.operation}`, i)), "syncdrop-settings"];
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
  items.forEach((m, i) => {
    const exec = [...cliArgv(ctx.cli).map(execArg), ...addArgs(m.target.id, m.operation).map(execArg), "%F"].join(" ");
    lines.push(`[Desktop Action ${keys[i]}]`, `Name=${m.label.replace(/[\r\n]/g, " ")}`, "Icon=folder-sync", `Exec=${exec}`, "");
  });
  lines.push("[Desktop Action syncdrop-settings]", "Name=Settings", "Icon=configure", `Exec=${settingsArgv(ctx.cli).map(execArg).join(" ")}`, "");
  return lines.join("\n");
}

export class DolphinAdapter implements FileManagerAdapter {
  readonly name = "dolphin" as const;
  constructor(private readonly ctx: AdapterContext) {}

  private get file(): string {
    return path.join(xdgDataHome(), "kio", "servicemenus", "syncdrop.desktop");
  }

  isSupported = async () => process.platform === "linux" && !!(await which("dolphin"));

  isInstalled = () => access(this.file).then(() => true, () => false);

  async install(): Promise<AdapterReport> {
    await mkdir(path.dirname(this.file), { recursive: true });
    await writeFile(this.file, buildServiceMenu(this.ctx));
    await chmod(this.file, 0o755); // newer KDE only trusts executable service menus
    return {
      files: [this.file],
      notes: ["Restart Dolphin. Entries appear under right-click > SyncDrop.", "Menu changes made in SyncDrop settings are applied for you."],
    };
  }

  async uninstall(): Promise<AdapterReport> {
    await rm(this.file, { force: true });
    return { files: [this.file], notes: ["Restart Dolphin."] };
  }
}
