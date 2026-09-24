import type { Config, Operation } from "../config/types.js";

export interface MenuEntry {
  target: string;
  operation: Operation;
  label: string;
}

const VERB: Record<Operation, string> = { copy: "Copy to", move: "Move to", link: "Link to" };

export const menuLabel = (operation: Operation, targetName: string) => `${VERB[operation]} ${targetName}`;

/** The entries every file-manager menu shows: targets in configured order, operations in configured order. */
export function menuEntries(config: Config): MenuEntry[] {
  return config.order.flatMap((id) =>
    config.menu.operations.map((operation) => ({
      target: id,
      operation,
      label: menuLabel(operation, (config.targets[id] as { name: string }).name),
    })),
  );
}
