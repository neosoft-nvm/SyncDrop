import { spawn } from "node:child_process";

/** Best-effort desktop notification (Linux notify-send). Never throws. */
export function desktopNotify(title: string, body: string): void {
  if (process.platform !== "linux") return;
  try {
    const child = spawn("notify-send", ["--app-name=SyncDrop", title, body], {
      stdio: "ignore",
      detached: true,
    });
    child.on("error", () => {});
    child.unref();
  } catch {
    /* notifications are optional */
  }
}
