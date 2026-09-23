# SyncDrop — Project Guide

Source of truth: `SYNCDROP_SPEC.txt`. Read it before changing code.

## What it is
A cross-platform file-to-sync-target utility with file-manager integrations.
Right-click files/folders → SyncDrop → pick a target → items are copied (or moved)
into a directory that Syncthing already syncs.
Do NOT describe it as "a Syncthing extension". Syncthing is only the first backend.

## Status
v0.1.0 built: core, CLI, and Thunar/Caja/Dolphin/Nautilus install generators. 67 automated tests pass.
Verified: core, CLI, generated file syntax (python, XML). NOT verified in a real file manager
(Thunar/Caja/Dolphin/Nautilus menus) or across two Syncthing machines. Keep marking these untested.
Extras beyond spec: `--notify`, `config init`, `integrate` command, `cli/main.ts` entry, JSONL history.

## Stack
- TypeScript on current LTS Node.js (declare in `package.json` `engines`), npm
- `node:fs/promises`, `node:path`, `node:os` only. Never shell out to cp/mv/rsync/PowerShell.
- JSON config, JSON-lines history (`history.jsonl`). No database.
- Vitest: unit, integration, filesystem tests (`npm test`; build with `npm run build`).

## Architecture
```
File-manager adapter → CLI → Core engine → Backend → (Syncthing sees filesystem change)
```
- Core is file-manager and OS independent. No Thunar/Dolphin/Nautilus/Windows code in core.
- Adapters only translate a selection into a SyncDrop request/CLI call. No copy/move logic.
- CLI is the stable interface; adapters invoke it.
- Backends live behind an abstraction (`local`, `syncthing`; future: sftp, custom).
- No daemon in MVP. Each invocation runs one operation and exits.

## Layout
`src/cli` · `src/config` · `src/core` (syncdrop, copy, move, validation, conflicts,
history, errors) · `src/backends` · `src/platforms/{linux/{thunar,caja,dolphin,nautilus},windows/explorer}`
· `src/shared` (paths, logging, result) · `config/default.json` · `tests/{unit,integration,fixtures}`
· `packaging/{linux,windows}` · `assets/icons`

## Config
- Per-user, XDG on Linux (`~/.config/syncdrop/`), app-data dir on Windows. No root/admin.
- Fields: `version`, `targets{id:{name,path,backend}}`, `defaults{operation,target,conflict}`.
- Support `~` expansion, unique valid target IDs, explicit schema version, preserve unknown fields.
- GUI (later) must edit this same config. No second config system.

## Behavior rules
- Copy a file → `<target>/<name>`. Copy a dir → `<target>/<dirname>/…` (never flatten).
- Multiple and mixed selections must all work.
- Conflict policies: `ask` (default), `overwrite`, `skip`, `keep-both`.
- `keep-both` names: `report.pdf`, `report (1).pdf`, `report (2).pdf` (deterministic).
- `ask` only when a TTY exists; otherwise fail safely or require an explicit policy.
- Never silently overwrite. Never delete source on copy.
- Move = copy, verify success, then delete source. Never delete source if copy failed.
- Block destination == source or destination inside source tree (no `MyApp/MyApp/…`).
- Validate sources and destinations. Give clear errors. Never claim success on an incomplete op.

## CLI
```
syncdrop --help | --version | --verbose
syncdrop targets | target list
syncdrop add --target <id> [--operation copy|move] [--conflict <policy>] FILE...
syncdrop config path
syncdrop history
```
Exit codes: 0 ok · 1 operation failure · 2 bad args · 3 config error · 4 conflict needs user action.

## Logging and history
- Levels: debug, info, warn, error. `--verbose` enables debug. Never log secrets.
- History entry: timestamp, operation, target, source, destination, success, error. No undo.

## Adapters (build in this order)
1. Thunar — custom actions (`uca.xml`). Start with one "Add to SyncDrop" action; keep room for a dynamic submenu.
2. Dolphin — KDE Service Menu `.desktop`, per-user, calls the CLI.
3. Nautilus — nautilus-python extension, calls the CLI.
3b. Caja — python-caja extension (shares its generator with Nautilus). Added at the user's request, although the spec excluded it for 0.1.
4. Windows Explorer — after Linux MVP; reuse the same core.
Pass absolute paths. One adapter failing must not affect the others. Do not invent APIs.

## Test targets
Fedora 44 MATE (Caja and Thunar, dev, dual-boots Win11) · Fedora 44 Xfce (Thunar) ·
Zorin OS 18 Pro GNOME (Nautilus and Dolphin). Syncthing test folder: `~/SyncDropTest`.
Required core tests: single file, single dir, multiple files, multiple dirs, mixed,
existing file, existing dir, source inside destination, missing source, invalid target,
permission failure, interrupted operation.

## Non-goals for 0.1
No Syncthing API, GUI, daemon, database, cloud, auth, encryption, compression, dedup,
auto-merge, sync monitoring, Windows shell extension, macOS, mobile, updater, telemetry.

## Milestones
0 repo · 1 CLI · 2 core engine · 3 tests · 4 Thunar · 5 Dolphin · 6 Nautilus ·
7 Syncthing validation · 8 GUI · 9 Windows · 10 packaging. Versioning: SemVer, start `0.1.0`.

## Working rules
- Inspect the repo before creating files. Don't replace working code without testing.
- Add tests for non-trivial core logic. Run build and tests before declaring done.
- Report failures accurately. Never claim untested features work.
- Update `README.md` and `INSTALL.md` whenever user-visible behavior or install steps change.
- Don't commit build artifacts. Use Git (`main`, `develop`, `feature/*`).
