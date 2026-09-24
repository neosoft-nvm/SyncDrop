# Installing SyncDrop

SyncDrop adds a **SyncDrop** option to your right-click menu. Pick a file or folder, choose where to send it, and it lands in a folder that [Syncthing](https://syncthing.net) already syncs to your other devices.

**Before you start:** install Syncthing and have one synced folder ready. Open <http://127.0.0.1:8384> in your browser to see your folders or add one.

> **Heads up:** this is an early version. The install steps work, but the right-click menus have not yet been confirmed in every file manager, and Windows is not supported yet.

## Install

1. Open the **Terminal** app.
2. Copy this line, paste it into the Terminal, and press **Enter**:

   ```
   curl -fsSL https://github.com/neosoft-nvm/SyncDrop/releases/latest/download/install.sh | sh
   ```

3. When it asks for your sync folder, type the folder's path (or press **Enter** to use `~/SyncDrop`). If the folder doesn't exist, say **Y** to create it. If you mistype a path, it tells you what's wrong and asks again; nothing is quit. Press **Enter** on an empty answer to skip an extra folder.
   Next it asks what **name** to show in the right-click menu for that folder (Enter keeps the suggestion, which is the folder's own name, e.g. `~/Documents` suggests "Documents"). Then it asks whether you want to add more folders: answer **y**, say how many (1 to 6), and it walks you through each one (path, then menu name).
4. Log out and back in, or restart your file manager.
5. If the installer shows a red **WARNING about PATH**, read [If it says "PATH"](#if-it-says-path) below. It only affects typing `syncdrop` in a terminal, not the right-click menu.

Don't use `sudo`. Nothing here needs an administrator password.

## If it says "PATH"

SyncDrop installs to `~/.local/bin`. If your computer doesn't look in that folder, typing `syncdrop` in a terminal gives "command not found". **The right-click menu still works**, so you can ignore the warning if you only use the menu.

To fix it, paste the line for your terminal, press **Enter**, then open a new terminal window:

| Your shell | Line to paste |
|---|---|
| bash (most common) | `echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc` |
| zsh | `echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc` |
| fish | `fish_add_path ~/.local/bin` |
| not sure | `echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.profile`, then log out and back in |

Not sure which you use? Run `echo $SHELL`. Many systems add `~/.local/bin` to PATH by themselves at the next login, so logging out and back in may be all you need. Check with `syncdrop --version`.

## Use it

Right-click a file or folder, choose **SyncDrop**, then pick an action and a folder: **Copy to…**, **Move to…** (removes the original after copying) or **Link to…** (puts a shortcut to the original in that folder instead of a copy). You'll get a small notification when it's done, and Syncthing does the rest.

If a file with the same name is already there, SyncDrop keeps both (`report.pdf` and `report (1).pdf`). It never overwrites anything.

## Change the menu

Right-click, choose **SyncDrop**, then **Settings** (or run `syncdrop settings` in a terminal). There you can:

- pick the default action and what to do when a file already exists,
- choose which of Copy / Move / Link appear, and put them in the order you like,
- add, rename, remove and re-order your folders,
- add or remove the SyncDrop menu in each file manager on this computer.

Changes are saved right away. Restart your file manager to see them (Nautilus and Caja pick them up on their own). Removing a folder from the menu never deletes it on disk.

## If something goes wrong

| Problem | Fix |
|---|---|
| No **SyncDrop** in the right-click menu | Log out and back in, then check again. |
| The installer says to install `python3-caja` or `python3-nautilus` | Copy the command it shows, run it, then run `syncdrop setup`. |
| Terminal says `syncdrop: command not found` | Log out and back in. The right-click menu works either way. |
| No pop-up when a file is sent | Install `libnotify` (Fedora) or `libnotify-bin` (Ubuntu, Zorin). |

## Update or remove

- **Update:** run the install line again. Your settings are kept.
- **Remove:** run `syncdrop uninstall`. It removes the right-click menu entries and the `syncdrop` program, and keeps your settings and history. To delete those too, run `syncdrop uninstall --purge`. Then restart your file manager. Your synced files are never touched.

Developer or advanced setup: see [TECHSUPP.md](TECHSUPP.md).
