# SyncDrop Technical Supplement

Details behind [INSTALL.md](INSTALL.md): how the installer works, building from source, releasing, configuration, and troubleshooting.

## Verification status

- Verified: core engine, CLI, `syncdrop setup`, the standalone binary (built and run), `install.sh` in a scratch `$HOME`, generated file syntax (Python, XML). 72 automated tests pass.
- **Not verified:** the menus inside real Thunar/Caja/Dolphin/Nautilus, two-machine Syncthing sync, the interactive `curl | sh` prompt path on a real terminal, Windows.

## How the installer works

`packaging/linux/install.sh` (x86_64 Linux only, refuses root):

1. Downloads `syncdrop-linux-x64.gz` from the latest GitHub release into `~/.local/bin/`.
2. Runs `--version` on it and refuses to install a broken download.
3. Runs `syncdrop setup`, using `/dev/tty` when piped from `curl` (stdin is the script then).

`syncdrop setup` keeps an existing config (else runs the `config init` prompt, or `--path <dir>` to skip it), installs every adapter whose file manager is found, prints adapter notes (restart command, missing `python3-caja`/`python3-nautilus`), and, if the binary's folder is not on `PATH`, prints a WARNING (red on a colour terminal unless `NO_COLOR` is set) with a copy-paste fix for the login shell (`src/shared/pathhint.ts`: fish, zsh, bash, else `~/.profile`). `install.sh` repeats a plain note only when `setup` could not run (no terminal). Menu entries use absolute paths, so PATH never affects them.

### Why a single binary

A Node Single Executable Application bundles Node itself, so end users need no Node, npm, `npm link`, or `PATH` edits. Flatpak was rejected because its sandbox blocks writing the host-side extension files (`~/.local/share/nautilus-python/…`, `uca.xml`). AppImage was rejected because menu entries need a stable executable path and it needs FUSE. `.deb`/`.rpm` need root and two packages to maintain; possible later (milestone 10).

The binary is about 124 MB uncompressed; the release ships it gzipped. File-manager entries call the binary directly (`cli.script` is omitted when running as a binary).

## Build from source

Requires Node.js 22+ and npm. On Ubuntu-based distros `apt install nodejs` gives v18; use [nvm](https://github.com/nvm-sh/nvm) (`nvm install 22`).

```bash
git clone https://github.com/neosoft-nvm/SyncDrop.git
cd SyncDrop
npm install && npm test
node dist/cli/main.js setup
```

### Build and install the standalone binary locally

The base must be an **official** Node binary from nodejs.org; distro packages (for example Fedora's `/usr/bin/node`, about 27 KB) are launchers and produce a broken result.

```bash
node scripts/build-binary.mjs --node /path/to/official/node   # writes release/syncdrop
SYNCDROP_BINARY=release/syncdrop sh packaging/linux/install.sh
```

`SYNCDROP_BINARY` makes the installer copy that file instead of downloading. Output goes to `release/` (git-ignored).

## Publishing a release

Pre-releases: a tag containing `-` (e.g. `v0.2.2-rc.1`, matching `package.json`) is published as a GitHub pre-release, so it never becomes `latest`. Install it with `curl -fsSL https://github.com/neosoft-nvm/SyncDrop/releases/download/v0.2.0-rc.2/install.sh | SYNCDROP_VERSION=v0.2.0-rc.2 sh`.

Push a tag such as `v0.1.0`. `.github/workflows/release.yml` runs the tests, builds the binary with Node 24.18.0 from nodejs.org, and attaches `syncdrop-linux-x64.gz` and `install.sh` to a GitHub release. v0.1.0 was published this way; the workflow ran successfully on GitHub's runner and the `curl` one-liner was checked against the public release in a throwaway HOME.

To release: bump `version` in `package.json` (the only place the version lives; the binary embeds it), merge to `main`, then `git tag -a vX.Y.Z -m "SyncDrop X.Y.Z" main && git push origin vX.Y.Z`. The workflow fails if the tag and `package.json` disagree.

Dry run without publishing: `gh workflow run release --ref <branch>` (or Actions > release > Run workflow). It runs the tests, builds the binary and uploads it as the `syncdrop-linux-x64` artifact. Manual dispatch only works once `release.yml` exists on `main`.

## Configuration

Per-user, no root. `syncdrop config path` prints the location (Linux: `~/.config/syncdrop/config.json`; Windows: `%APPDATA%\syncdrop\config.json`). To add another sync folder use `syncdrop settings`, `syncdrop target add NAME --path DIR`, or edit `targets` in that file. Every settings/target/`config set` change refreshes the menus of file managers that already have SyncDrop entries (Thunar and Dolphin are regenerated; Caja and Nautilus read `syncdrop menu --json` each time the menu opens). The optional `menu` section holds `order` (folder order), `ctrlMove` / `shiftLink` (default true) and `explicitEntries` (default false). An older `menu.operations` list is ignored but kept. Nautilus/Caja menus have one entry per folder and read the held keys when an entry is clicked (`Gtk.get_current_event_state()` on GTK3, the seat keyboard modifier state on GTK4; both **unverified in the real file managers**, and if the keys cannot be read the action is a plain copy). Ctrl+Shift together = link. Thunar and Dolphin cannot read keys, so `explicitEntries` adds Move/Link entries there. Edits are validated, written to a temp file and renamed, and keep unknown fields. `config init` on a terminal also asks for the main target's display name and up to 10 folders in total targets (ids are slugs of the names, e.g. `papers`, `papers-2`). Scripts can skip the prompts: `syncdrop config init --path ~/SyncDrop`. Run as your normal user; under `sudo` the config goes to `/root`.

History: `~/.local/state/syncdrop/history.jsonl`. `syncdrop uninstall` keeps config and history unless `--purge` is given (it then deletes the config file and history file, and their folders if empty). It removes the running binary only when run as the installed single-file binary. Per-adapter removal: `syncdrop integrate uninstall`.

## File-manager integration files

| Manager | Installed file |
|---|---|
| Thunar | `~/.config/Thunar/uca.xml` (other actions kept; backup `uca.xml.syncdrop.bak`) |
| Caja | `~/.local/share/caja-python/extensions/syncdrop.py` (needs `python3-caja`) |
| Nautilus | `~/.local/share/nautilus-python/extensions/syncdrop.py` (needs `python3-nautilus`) |
| Dolphin | `~/.local/share/kio/servicemenus/syncdrop.desktop` |

Menu entries per folder: Copy / Move / Link, then a Settings item. Settings opens `syncdrop settings` in the first terminal emulator found (x-terminal-emulator, gnome-terminal, mate-terminal, xfce4-terminal, konsole, xterm) through a small `sh -c` wrapper. That wrapper and all four menu layouts are **untested in real file managers**. `link` uses `fs.symlink` with the absolute source path.

Manage individually: `syncdrop integrate <install|uninstall|status> [thunar|caja|dolphin|nautilus|all]`. Restart commands: `thunar -q`, `caja -q`, `nautilus -q`; Dolphin just needs a restart.

## Troubleshooting

- Exit code `3`: config problem; the message says what to fix. Exit code `4`: destination exists; pass `--conflict overwrite|skip|keep-both`.
- `syncdrop targets` shows `(missing)`: the folder does not exist; run `syncdrop config init --force` and re-enter the path.
- Debug: `syncdrop --verbose add --target main FILE`; past results: `syncdrop history`.
- Distro packages for the menus: `python3-caja`, `python3-nautilus` (Fedora and Debian/Ubuntu names match), `libnotify` / `libnotify-bin` for notifications.

## Verify a Syncthing round trip

1. Add `~/SyncDropTest` as a Syncthing folder shared with a second machine, and as a target.
2. On machine A: `syncdrop add --target <id> somefile.txt`.
3. Confirm the file arrives on machine B.

## Windows 11

Explorer integration is not implemented. The CLI works from source: install Node 22+ and Syncthing, then in PowerShell run `npm install`, `npm link`, `syncdrop config init` and enter an absolute path such as `C:\Users\you\SyncDrop`. Untested.
