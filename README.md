# SyncDrop

A cross-platform file-to-sync-target utility with file-manager integrations.

**Select → Right-click → SyncDrop → Target → File appears in your synchronized folder.**

> **Status: v0.1.0.** The core engine, CLI and Thunar/Caja/Dolphin/Nautilus integrations are implemented and the core is covered by 64 automated tests. The file-manager menus have **not yet been tried in the real file managers**, and cross-machine Syncthing sync has not been validated. Treat those as untested.

## What it does

SyncDrop adds a context-menu entry to your file manager. You pick files and/or folders, choose a target, and SyncDrop copies (or moves) them into that target's directory. [Syncthing](https://syncthing.net) then syncs that directory to your other devices.

SyncDrop only performs ordinary filesystem operations. It does not configure, start, or talk to Syncthing. Each target must point to a folder you have already added to Syncthing.

## How it works

```
File manager adapter → SyncDrop CLI → Core engine → Backend → Syncthing picks up the change
```

- **Core engine**: config, validation, copy/move, conflicts, history, logging. Has no file-manager code.
- **Adapters**: translate a file-manager selection into a CLI call. They contain no copy logic.
- **Backends**: `syncthing` first (plain filesystem writes); others possible later.

## Support

| Component | Status |
|---|---|
| CLI and core engine | Implemented, tested |
| Thunar (Xfce/MATE) | Implemented, menu untested in Thunar |
| Caja (MATE default) | Implemented, menu untested in Caja |
| Dolphin (KDE) | Implemented, untested (no Dolphin available yet) |
| Nautilus (GNOME Files) | Implemented, menu untested in Nautilus |
| GUI, Windows Explorer, packaging | Not started |

Target platforms: Fedora 44 (MATE, Xfce), Zorin OS 18 Pro (GNOME), then Windows 11.

Menus: Caja, Nautilus and Dolphin show a **SyncDrop** submenu with one entry per target. Thunar cannot nest custom actions, so it shows one **SyncDrop: <target>** entry per target. File-manager actions use `--conflict keep-both` (nothing is overwritten) and show a desktop notification.

## Configuration

Per-user JSON file. Linux: `~/.config/syncdrop/`. Run `syncdrop config path` to see the exact location.

```json
{
  "version": 1,
  "targets": {
    "main":     { "name": "Main Sync", "path": "~/SyncDrop",           "backend": "syncthing" },
    "projects": { "name": "Projects",  "path": "~/SyncDrop/Projects",  "backend": "syncthing" }
  },
  "defaults": { "operation": "copy", "target": "main", "conflict": "ask" }
}
```

- Target IDs must be unique.
- `~` is expanded on Linux.
- Unknown fields are preserved.

## CLI usage

```bash
syncdrop --help
syncdrop --version
syncdrop targets                                   # list targets
syncdrop add --target projects ./MyApp report.pdf  # copy items
syncdrop add --target projects --operation move ./old
syncdrop add --target main --conflict keep-both ./notes.txt
syncdrop config path                               # print config location
syncdrop config init                               # write a default config
syncdrop history -n 10
syncdrop integrate install all                     # add file-manager menu entries
syncdrop integrate uninstall caja
syncdrop --verbose add --target main ./file.txt    # debug logging
```

Exit codes: `0` success · `1` operation failed · `2` invalid arguments · `3` config error · `4` conflict needs user action.

## Behavior and safety

- Copying a folder keeps the folder itself: `MyApp/` → `<target>/MyApp/…`. Nothing is flattened.
- Existing files are never silently overwritten. Conflict policies: `ask` (default), `overwrite`, `skip`, `keep-both`.
- `keep-both` produces `report.pdf`, `report (1).pdf`, `report (2).pdf`.
- `ask` needs an interactive terminal; otherwise SyncDrop stops with exit code 4 and asks you to pass `--conflict`.
- Merging into an existing folder never clobbers: conflicts inside it follow the same policy.
- Files are written to a temp name and renamed, so Syncthing never sees a half-copied file.
- Copy never deletes the source. Move deletes the source only after the copy succeeds.
- Copying a folder into itself or a subfolder of itself is refused.
- No root/admin rights needed.

## Development

Requires Node.js 22 or newer and npm.

```bash
npm install
npm run build
npm test
```

Stack: TypeScript, Node.js, Vitest. History is stored as JSON lines in `~/.local/state/syncdrop/history.jsonl`. Full requirements are in [SYNCDROP_SPEC.txt](SYNCDROP_SPEC.txt); contributor rules are in [CLAUDE.md](CLAUDE.md).

## Installation

See [INSTALL.md](INSTALL.md).

## Roadmap

`0.1` CLI/core + Linux integrations incl. Caja (current, pending real-world testing) → `0.2` Thunar → `0.3` Dolphin → `0.4` Nautilus → `0.5` GUI → `0.6` Windows → `1.0` stable. Versioning follows SemVer.

## Not in 0.1

Syncthing API integration, GUI, background daemon, database, cloud/accounts, encryption, telemetry.
