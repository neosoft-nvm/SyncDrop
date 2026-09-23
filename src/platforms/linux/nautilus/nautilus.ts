import { access, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { which } from "../../../shared/paths.js";
import { xdgDataHome } from "../../common.js";
import { buildPythonExtension } from "../python-extension.js";
import type { AdapterContext, AdapterReport, FileManagerAdapter } from "../../types.js";

const EXTENSION_LIBS = [
  "/usr/lib64/nautilus/extensions-4",
  "/usr/lib/nautilus/extensions-4",
  "/usr/lib/x86_64-linux-gnu/nautilus/extensions-4",
  "/usr/lib/aarch64-linux-gnu/nautilus/extensions-4",
  "/usr/lib64/nautilus/extensions-3.0",
  "/usr/lib/nautilus/extensions-3.0",
  "/usr/lib/x86_64-linux-gnu/nautilus/extensions-3.0",
];

async function hasNautilusPython(): Promise<boolean> {
  for (const dir of EXTENSION_LIBS) {
    try {
      await access(path.join(dir, "libnautilus-python.so"));
      return true;
    } catch {
      /* next */
    }
  }
  return false;
}

/** nautilus-python extension (Nautilus 4 with fallback to 3). */
export const buildExtension = (ctx: AdapterContext) =>
  buildPythonExtension(ctx, { module: "Nautilus", versions: ["4.0", "3.0"], installName: "nautilus" });

export class NautilusAdapter implements FileManagerAdapter {
  readonly name = "nautilus" as const;
  constructor(private readonly ctx: AdapterContext) {}

  private get file(): string {
    return path.join(xdgDataHome(), "nautilus-python", "extensions", "syncdrop.py");
  }

  isSupported = async () => process.platform === "linux" && !!(await which("nautilus"));

  async install(): Promise<AdapterReport> {
    await mkdir(path.dirname(this.file), { recursive: true });
    await writeFile(this.file, buildExtension(this.ctx));
    const notes = ["Restart Nautilus: nautilus -q"];
    if (!(await hasNautilusPython())) {
      notes.unshift("WARNING: nautilus-python not found. Install it (Fedora: python3-nautilus, Debian/Ubuntu/Zorin: python3-nautilus).");
    }
    return { files: [this.file], notes };
  }

  async uninstall(): Promise<AdapterReport> {
    await rm(this.file, { force: true });
    return { files: [this.file], notes: ["Restart Nautilus: nautilus -q"] };
  }
}
