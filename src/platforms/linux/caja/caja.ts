import { access, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { which } from "../../../shared/paths.js";
import { xdgDataHome } from "../../common.js";
import type { AdapterContext, AdapterReport, FileManagerAdapter } from "../../types.js";
import { buildPythonExtension } from "../python-extension.js";

/** python-caja extension (default file manager on MATE). */
export const buildExtension = (ctx: AdapterContext) =>
  buildPythonExtension(ctx, { module: "Caja", versions: ["2.0"], installName: "caja" });

const EXTENSION_LIBS = [
  "/usr/lib64/caja/extensions-2.0",
  "/usr/lib/caja/extensions-2.0",
  "/usr/lib/x86_64-linux-gnu/caja/extensions-2.0",
  "/usr/lib/aarch64-linux-gnu/caja/extensions-2.0",
];

async function hasCajaPython(): Promise<boolean> {
  for (const dir of EXTENSION_LIBS) {
    try {
      await access(path.join(dir, "libcaja-python.so"));
      return true;
    } catch {
      /* next */
    }
  }
  return false;
}

export class CajaAdapter implements FileManagerAdapter {
  readonly name = "caja" as const;
  constructor(private readonly ctx: AdapterContext) {}

  private get file(): string {
    return path.join(xdgDataHome(), "caja-python", "extensions", "syncdrop.py");
  }

  isSupported = async () => process.platform === "linux" && !!(await which("caja"));

  async install(): Promise<AdapterReport> {
    await mkdir(path.dirname(this.file), { recursive: true });
    await writeFile(this.file, buildExtension(this.ctx));
    const notes = ["Restart Caja: caja -q"];
    if (!(await hasCajaPython())) {
      notes.unshift("WARNING: python-caja not found. Install it (Fedora: python3-caja, Debian/Ubuntu/Zorin: python3-caja).");
    }
    return { files: [this.file], notes };
  }

  async uninstall(): Promise<AdapterReport> {
    await rm(this.file, { force: true });
    return { files: [this.file], notes: ["Restart Caja: caja -q"] };
  }
}
