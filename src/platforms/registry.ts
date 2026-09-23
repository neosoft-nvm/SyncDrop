import { ArgsError } from "../core/errors.js";
import { CajaAdapter } from "./linux/caja/caja.js";
import { DolphinAdapter } from "./linux/dolphin/dolphin.js";
import { NautilusAdapter } from "./linux/nautilus/nautilus.js";
import { ThunarAdapter } from "./linux/thunar/thunar.js";
import type { AdapterContext, FileManagerAdapter } from "./types.js";

export const ADAPTER_NAMES = ["thunar", "caja", "dolphin", "nautilus"] as const;

export function createAdapter(name: string, ctx: AdapterContext): FileManagerAdapter {
  switch (name) {
    case "thunar":
      return new ThunarAdapter(ctx);
    case "caja":
      return new CajaAdapter(ctx);
    case "dolphin":
      return new DolphinAdapter(ctx);
    case "nautilus":
      return new NautilusAdapter(ctx);
    default:
      throw new ArgsError(`unknown file manager '${name}' (choose: ${ADAPTER_NAMES.join(", ")}, all)`);
  }
}
