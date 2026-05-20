import { ipcMain, powerMonitor, BrowserWindow } from "electron";

export function registerIdleHandlers(
  mainWindowGetter: () => BrowserWindow | null,
) {
  // Pollable idle time (seconds since last user input)
  ipcMain.handle("idle:get-time", () => {
    return powerMonitor.getSystemIdleTime();
  });

  // System power events forwarded to renderer
  powerMonitor.on("suspend", () => {
    const win = mainWindowGetter();
    if (win) win.webContents.send("power:suspend");
  });

  powerMonitor.on("resume", () => {
    const win = mainWindowGetter();
    if (win) win.webContents.send("power:resume");
  });

  powerMonitor.on("lock-screen", () => {
    const win = mainWindowGetter();
    if (win) win.webContents.send("power:lock");
  });

  powerMonitor.on("unlock-screen", () => {
    const win = mainWindowGetter();
    if (win) win.webContents.send("power:unlock");
  });
}
