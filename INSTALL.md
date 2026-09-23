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

3. When it asks for your sync folder, type the folder's path (or press **Enter** to use `~/SyncDrop`). If the folder doesn't exist, say **Y** to create it.
4. Log out and back in, or restart your file manager.

Don't use `sudo`. Nothing here needs an administrator password.

## Use it

Right-click a file or folder, choose **SyncDrop**, then pick where to send it. You'll get a small notification when it's done, and Syncthing does the rest.

If a file with the same name is already there, SyncDrop keeps both (`report.pdf` and `report (1).pdf`). It never overwrites anything.

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
