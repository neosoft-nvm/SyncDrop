# SyncDrop Installation

Requires **Node.js 22+**, **npm**, and **Syncthing** with one folder per SyncDrop target. SyncDrop only writes into those folders; Syncthing does the syncing. No step needs root except installing system packages (and `npm link` on some systems).

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

If `npm link` fails with `EACCES` (common with a system-wide Node), either re-run it with `sudo npm link`, or set a user prefix first: `npm config set prefix ~/.local`, and make sure `~/.local/bin` is on `PATH`. The file-manager entries call Node directly by absolute path, so they work even if `PATH` is minimal.

## 2. Tell SyncDrop which folder to use (all OSes)

SyncDrop copies your files into one folder, and Syncthing syncs that folder to your other devices. SyncDrop can't tell which folder Syncthing uses, so it asks you once.

1. **Find the folder in Syncthing.** Open Syncthing (usually <http://127.0.0.1:8384>) and note the path of a folder it already syncs. Or click **Add Folder**, choose a new one such as `~/SyncDrop`, and share it with your other devices.

2. **Run the setup script and answer its questions:**

   ```bash
   syncdrop config init
   ```

   ```
   SyncDrop copies files into a folder that Syncthing already syncs.
   Path of that folder [~/SyncDrop]:
   ```

   Type the path from step 1 and press Enter. Press Enter alone to accept `~/SyncDrop`. If the folder doesn't exist yet, the script offers to create it.

3. **Check it:**

   ```bash
   syncdrop targets
   ```

   You should see a `main` line with your path and no `(missing)`. If it says `(missing)`, run `syncdrop config init --force` and enter the correct path.

Run this as your normal user, not with `sudo`. Under `sudo` the settings go to `/root` and your file manager will never see them.

> **Good to know:** the script saves your answer in a small settings file (`syncdrop config path` shows where). You don't need to open it. Only open it later if you want to add a second sync folder as another target. After adding one, re-run `syncdrop integrate install` for Thunar and Dolphin. Caja and Nautilus update on their own. Scripts can skip the question with `syncdrop config init --path ~/SyncDrop`.

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
   syncdrop targets
   ```
3. When asked for the folder, enter an absolute path such as `C:\Users\you\SyncDrop`. The config is per-user at `%APPDATA%\syncdrop\config.json`. Windows behavior is untested.

## Check that it works

Copy a test file from a terminal:

```bash
echo hello > ~/test.txt
syncdrop add --target main --conflict keep-both ~/test.txt
```

It should print `copied`, and `test.txt` should appear in your sync folder. Then right-click a file in your file manager and use the SyncDrop menu.

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
