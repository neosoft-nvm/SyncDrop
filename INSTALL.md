# SyncDrop Installation

Requires **Node.js 22+**, **npm**, and **Syncthing** with one folder per SyncDrop target. SyncDrop only writes into those folders; Syncthing does the syncing. No step needs root except installing system packages.

> Menu integrations are implemented but not yet verified inside the real file managers. Windows Explorer integration is not available; the CLI works.

## 1. Build and link (all OSes)

```bash
git clone https://github.com/neosoft-nvm/SyncDrop.git
cd SyncDrop
npm install          # also builds (runs `npm run build`)
npm test             # optional
npm link             # puts `syncdrop` on PATH
syncdrop --version
```

If `npm link` needs root on your system, set a user prefix first: `npm config set prefix ~/.local`, and make sure `~/.local/bin` is on `PATH`. The file-manager entries call Node directly by absolute path, so they work even if `PATH` is minimal.

## 2. Configure targets (all OSes)

```bash
syncdrop config init      # writes the default config
syncdrop config path      # shows where it is
```

Edit that file. Each target's `path` must be an existing folder that Syncthing already syncs:

```json
{
  "version": 1,
  "targets": {
    "main": { "name": "Main Sync", "path": "~/SyncDrop", "backend": "syncthing" }
  },
  "defaults": { "operation": "copy", "target": "main", "conflict": "ask" }
}
```

Create the folders (`mkdir -p ~/SyncDrop`), then check with `syncdrop targets` (missing folders are flagged). After adding or renaming targets, re-run `syncdrop integrate install` for Thunar and Dolphin. Caja and Nautilus update themselves.

Smoke test: `syncdrop add --target main --conflict keep-both ~/somefile.txt`

## 3. Fedora 44 MATE or Xfce

Pick the file manager you use. Both can be installed side by side.

### 3a. MATE with Caja (MATE default)

```bash
sudo dnf install nodejs npm syncthing python3-caja libnotify
```

Then steps 1 and 2, and:

```bash
syncdrop integrate install caja
caja -q              # restart Caja
```

Right-click a file or folder and choose **SyncDrop**, then a target. The extension is `~/.local/share/caja-python/extensions/syncdrop.py`. Targets are read when the menu opens, so new targets need no reinstall. On Debian/Ubuntu-based MATE the package is also `python3-caja`.

### 3b. Xfce (default) or MATE with Thunar

```bash
sudo dnf install nodejs npm syncthing thunar libnotify
```

Then steps 1 and 2, and:

```bash
syncdrop integrate install thunar
thunar -q            # restart Thunar
```

Right-click a file or folder and choose **SyncDrop: <target>**. Entries are stored in `~/.config/Thunar/uca.xml` (your other custom actions are kept; a backup is saved as `uca.xml.syncdrop.bak`).

## 4. Zorin OS 18 Pro, Nautilus (GNOME Files)

```bash
sudo apt install nodejs npm syncthing python3-nautilus libnotify-bin
```

Zorin's packaged Node may be older than 22; if `node --version` is below 22, install Node 22 LTS from [nodejs.org](https://nodejs.org) or with `nvm`. Then steps 1 and 2, and:

```bash
syncdrop integrate install nautilus
nautilus -q          # restart Nautilus
```

Right-click a file or folder and choose **SyncDrop**, then a target. The extension is `~/.local/share/nautilus-python/extensions/syncdrop.py`.

## 5. Zorin OS 18 Pro, Dolphin (KDE)

```bash
sudo apt install dolphin nodejs npm syncthing libnotify-bin
```

Then steps 1 and 2, and:

```bash
syncdrop integrate install dolphin
```

Restart Dolphin. Right-click a file or folder and look for **SyncDrop** (it may be under **Actions** or **Services**). The file is `~/.local/share/kio/servicemenus/syncdrop.desktop`. All integrations are independent; install any combination.

Install all detected file managers at once with `syncdrop integrate install all`. Check with `syncdrop integrate status`.

## 6. Windows 11

Explorer integration is not implemented yet. The CLI works:

1. Install Node.js 22+ LTS from [nodejs.org](https://nodejs.org) and Syncthing from [syncthing.net](https://syncthing.net).
2. In PowerShell:
   ```powershell
   git clone https://github.com/neosoft-nvm/SyncDrop.git
   cd SyncDrop
   npm install
   npm link
   syncdrop config init
   syncdrop config path
   ```
3. Edit the config (per-user `%APPDATA%\syncdrop\config.json`) using absolute paths such as `C:\Users\you\SyncDrop`. Windows behavior is untested.

## Verify a Syncthing round trip

1. Add `~/SyncDropTest` as a Syncthing folder shared with a second machine, and add it as a target.
2. On machine A: `syncdrop add --target <id> somefile.txt`
3. Confirm the file arrives on machine B.

## Uninstall

```bash
syncdrop integrate uninstall all
npm unlink -g syncdrop
```

Your config (`syncdrop config path`) and history (`~/.local/state/syncdrop/`) are kept; delete them yourself if you want them gone.

## Troubleshooting

- `syncdrop: command not found`: re-run `npm link` and check your npm global bin is on `PATH`.
- Exit code `3`: config problem. The message says what to fix. Exit code `4`: a file already exists; pass `--conflict overwrite|skip|keep-both`.
- Menu entry missing: restart the file manager; for Caja/Nautilus confirm `python3-caja` / `python3-nautilus` is installed.
- No notification: install `libnotify` / `libnotify-bin` (provides `notify-send`).
- Use `syncdrop --verbose add ...` for debug output, `syncdrop history` for past results.
