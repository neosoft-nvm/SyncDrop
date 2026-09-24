import type { Config, Operation } from "../config/types.js";

export interface MenuFolder {
  target: string;
  label: string;
}

/** What a file-manager menu shows, and which held key changes the action. */
export interface MenuModel {
  /** One entry per folder, in configured order. */
  folders: MenuFolder[];
  /** Action chosen when the key is held; null = disabled. */
  modifiers: { ctrl: Operation | null; shift: Operation | null };
  /** Extra per-folder entries for file managers that cannot see held keys (Thunar, Dolphin). */
  extraOperations: Operation[];
}

const VERB: Record<Operation, string> = { copy: "Copy to", move: "Move to", link: "Link to" };

export const menuLabel = (operation: Operation, targetName: string) => `${VERB[operation]} ${targetName}`;

export function menuModel(config: Config): MenuModel {
  const { ctrlMove, shiftLink, explicitEntries } = config.menu;
  const extras: Operation[] = explicitEntries ? [...(ctrlMove ? (["move"] as const) : []), ...(shiftLink ? (["link"] as const) : [])] : [];
  return {
    folders: config.order.map((id) => ({ target: id, label: menuLabel("copy", (config.targets[id] as { name: string }).name) })),
    modifiers: { ctrl: ctrlMove ? "move" : null, shift: shiftLink ? "link" : null },
    extraOperations: extras,
  };
}
