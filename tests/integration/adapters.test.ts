import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildServiceMenu, DolphinAdapter } from "../../src/platforms/linux/dolphin/dolphin.js";
import { buildExtension, NautilusAdapter } from "../../src/platforms/linux/nautilus/nautilus.js";
import { buildExtension as buildCaja, CajaAdapter } from "../../src/platforms/linux/caja/caja.js";
import { buildActions, mergeUca, ThunarAdapter } from "../../src/platforms/linux/thunar/thunar.js";
import type { AdapterContext } from "../../src/platforms/types.js";
import { cleanupTmp, tmpDir, write } from "../helpers.js";

cleanupTmp();
const ctx: AdapterContext = {
  cli: { node: "/usr/bin/node", script: "/opt/my apps/syncdrop/dist/cli/main.js" },
  targets: [
    { id: "main", name: "Main Sync", path: "/h/SyncDrop", backend: "syncthing" },
    { id: "docs", name: "Docs & Notes", path: "/h/Docs", backend: "syncthing" },
  ],
};
const saved = { ...process.env };
let home: string;
beforeEach(async () => {
  home = await tmpDir();
  process.env.XDG_CONFIG_HOME = path.join(home, "config");
  process.env.XDG_DATA_HOME = path.join(home, "data");
});
afterEach(() => {
  process.env = { ...saved };
});

describe("standalone binary (no script)", () => {
  const bin: AdapterContext = { ...ctx, cli: { node: "/home/u/.local/bin/syncdrop" } };

  it("invokes the binary directly in every adapter", () => {
    expect(buildActions(bin)).toContain("&quot;/home/u/.local/bin/syncdrop&quot; add --target main");
    expect(buildServiceMenu(bin)).toContain(`Exec="/home/u/.local/bin/syncdrop" "add" "--target" "main"`);
    expect(buildExtension(bin)).toContain('SYNCDROP_CMD = ["/home/u/.local/bin/syncdrop"]');
    expect(buildCaja(bin)).toContain('SYNCDROP_CMD = ["/home/u/.local/bin/syncdrop"]');
  });
});

describe("menu settings", () => {
  it("lists only Copy by default; Move / Link entries appear only when asked for (Thunar, Dolphin)", () => {
    expect(buildServiceMenu(ctx)).not.toContain("Move to");
    const c: AdapterContext = { ...ctx, targets: [...ctx.targets].reverse(), extraOperations: ["move", "link"] };
    const xml = buildActions(c);
    expect(xml.match(/<name>SyncDrop: [^<]*/g)).toEqual([
      "<name>SyncDrop: Copy to Docs &amp; Notes", "<name>SyncDrop: Move to Docs &amp; Notes", "<name>SyncDrop: Link to Docs &amp; Notes",
      "<name>SyncDrop: Copy to Main Sync", "<name>SyncDrop: Move to Main Sync", "<name>SyncDrop: Link to Main Sync", "<name>SyncDrop: Settings",
    ]);
    expect(buildServiceMenu(c)).toContain("Move to Main Sync");
  });

  it("nautilus and caja read the held keys at click time and pick the GTK generation matching the file manager", () => {
    for (const py of [buildExtension(ctx), buildCaja(ctx)]) {
      expect(py).toContain("_held()");
      expect(py).toContain("CONTROL_MASK");
      expect(py).toContain('if shift and modifiers.get("shift")');
    }
    expect(buildExtension(ctx)).toContain('_VER = "4.0"');
    expect(buildCaja(ctx)).toContain('_VER = "2.0"');
    expect(buildCaja(ctx)).toContain('gi.require_version("Gdk", "3.0")');
  });

  it("adapters report whether they are installed", async () => {
    const a = new DolphinAdapter(ctx);
    expect(await a.isInstalled()).toBe(false);
    await a.install();
    expect(await a.isInstalled()).toBe(true);
    await a.uninstall();
    expect(await a.isInstalled()).toBe(false);
  });
});

describe("thunar", () => {
  it("builds one escaped action per target passing %F", () => {
    const xml = buildActions(ctx);
    // one Copy entry per target + Settings
    expect(xml.match(/<action>/g)).toHaveLength(3);
    expect(xml).toContain("SyncDrop: Copy to Docs &amp; Notes");
    expect(xml).toContain("SyncDrop: Settings");
    expect(xml).toContain('add --target main --operation copy --conflict keep-both --notify -- %F');
    expect(xml).toContain("&quot;/opt/my apps/syncdrop/dist/cli/main.js&quot;");
    expect(xml).toContain("<directories/>");
  });

  it("install is idempotent, preserves foreign actions, and uninstall removes only ours", async () => {
    const uca = path.join(home, "config", "Thunar", "uca.xml");
    const foreign = `<action>\n\t<name>Open Terminal</name>\n\t<unique-id>1234</unique-id>\n\t<command>xterm</command>\n</action>`;
    await write(uca, `<?xml version="1.0" encoding="UTF-8"?>\n<actions>\n${foreign}\n</actions>\n`);
    const adapter = new ThunarAdapter(ctx);
    await adapter.install();
    const once = await readFile(uca, "utf8");
    await adapter.install();
    expect(await readFile(uca, "utf8")).toBe(once);
    expect(once).toContain("Open Terminal");
    expect(once.match(/<unique-id>syncdrop-/g)).toHaveLength(3);
    expect((await stat(uca + ".syncdrop.bak")).isFile()).toBe(true);

    await adapter.uninstall();
    const after = await readFile(uca, "utf8");
    expect(after).toContain("Open Terminal");
    expect(after).not.toContain("syncdrop-");
  });

  it("creates uca.xml from nothing", () => {
    const xml = mergeUca(null, buildActions(ctx));
    expect(xml.startsWith("<?xml")).toBe(true);
    expect(xml).toContain("</actions>");
  });
});

describe("dolphin", () => {
  it("builds a submenu service menu with an action per target", () => {
    const d = buildServiceMenu(ctx);
    expect(d).toContain("X-KDE-Submenu=SyncDrop");
    expect(d).toContain("Actions=syncdrop-0-main-copy;syncdrop-1-docs-copy;syncdrop-settings;");
    expect(d).toContain("[Desktop Action syncdrop-1-docs-copy]");
    expect(d).toContain("[Desktop Action syncdrop-settings]");
    expect(d).toContain("Name=Copy to Docs & Notes");
    expect(d).toMatch(/Exec=.*"add" "--target" "main".*%F/);
  });
  it("installs an executable file and uninstalls it", async () => {
    const a = new DolphinAdapter(ctx);
    const { files } = await a.install();
    expect(((await stat(files[0] as string)).mode & 0o111) !== 0).toBe(true);
    await a.uninstall();
    await expect(stat(files[0] as string)).rejects.toThrow();
  });
});

describe("nautilus", () => {
  it("embeds the CLI command in the python extension", () => {
    const py = buildExtension(ctx);
    expect(py).toContain('SYNCDROP_CMD = ["/usr/bin/node","/opt/my apps/syncdrop/dist/cli/main.js"]');
    expect(py).toContain("Nautilus.MenuProvider");
    expect(py).toContain('"menu", "--json"');
    expect(py).toContain("SETTINGS_CMD");
  });
  it("installs and uninstalls the extension file", async () => {
    const a = new NautilusAdapter(ctx);
    const { files } = await a.install();
    expect(await readFile(files[0] as string, "utf8")).toContain("SyncDropExtension");
    await a.uninstall();
    await expect(stat(files[0] as string)).rejects.toThrow();
  });
});

describe("caja", () => {
  it("generates a python-caja extension using the Caja API", () => {
    const py = buildCaja(ctx);
    expect(py).toContain('gi.require_version("Caja", "2.0")');
    expect(py).toContain("from gi.repository import GObject, Caja");
    expect(py).toContain("Caja.MenuProvider");
    expect(py).not.toContain("Nautilus");
  });
  it("nautilus keeps its 4.0 -> 3.0 fallback", () => {
    const py = buildExtension(ctx);
    expect(py).toContain('gi.require_version("Nautilus", "4.0")');
    expect(py).toContain('gi.require_version("Nautilus", "3.0")');
  });
  it("installs to caja-python/extensions and uninstalls", async () => {
    const a = new CajaAdapter(ctx);
    const { files } = await a.install();
    expect(files[0]).toContain(path.join("caja-python", "extensions", "syncdrop.py"));
    expect(await readFile(files[0] as string, "utf8")).toContain("SyncDropExtension");
    await a.uninstall();
    await expect(stat(files[0] as string)).rejects.toThrow();
  });
});
