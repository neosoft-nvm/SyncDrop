import type { Config } from "../config/types.js";
import { describeError } from "../core/errors.js";
import { defaultCli } from "../platforms/common.js";
import { ADAPTER_NAMES, createAdapter } from "../platforms/registry.js";
import type { AdapterContext } from "../platforms/types.js";
import type { CliIO } from "./cli.js";

export const adapterContext = (config: Config): AdapterContext => ({
  cli: defaultCli(),
  targets: config.order.map((id) => config.targets[id] as Config["targets"][string]),
  operations: config.menu.operations,
});

/** Rewrite the menus of file managers that already have SyncDrop entries (Nautilus/Caja read the config live). */
export async function refreshMenus(config: Config, io: CliIO): Promise<void> {
  for (const name of ADAPTER_NAMES) {
    const adapter = createAdapter(name, adapterContext(config));
    try {
      if (!(await adapter.isInstalled())) continue;
      await adapter.install();
      io.out(`Updated the ${name} menu (restart ${name} to see it).`);
    } catch (e) {
      io.err(`${name}: ${describeError(e)}`);
    }
  }
}

