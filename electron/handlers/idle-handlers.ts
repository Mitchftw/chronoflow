import { ipcMain, powerMonitor, BrowserWindow } from "electron";

/** System power events forwarded to whichever renderer windows are alive.
 *  Both the main window AND the timer overlay run IdleDetectionService, so
 *  suspend/resume/lock/unlock must fan out to both — otherwise lock events
 *  while the user is staring at the notch/draggable overlay are missed. */
function broadcast(
  event: "power:suspend" | "power:resume" | "power:lock" | "power:unlock",
  getMainWindow: () => BrowserWindow | null,
  getTimerWindow: () => BrowserWindow | null,
) {
  for (const win of [getMainWindow(), getTimerWindow()]) {
    if (win && !win.isDestroyed()) win.webContents.send(event);
  }
}

export function registerIdleHandlers(
  getMainWindow: () => BrowserWindow | null,
  getTimerWindow: () => BrowserWindow | null = () => null,
) {
  // Pollable idle time (seconds since last user input)
  ipcMain.handle("idle:get-time", () => {
    return powerMonitor.getSystemIdleTime();
  });

  // System power events forwarded to BOTH the main window and the
  // timer overlay window (if it's open).
  powerMonitor.on("suspend", () =>
    broadcast("power:suspend", getMainWindow, getTimerWindow),
  );
  powerMonitor.on("resume", () =>
    broadcast("power:resume", getMainWindow, getTimerWindow),
  );
  powerMonitor.on("lock-screen", () =>
    broadcast("power:lock", getMainWindow, getTimerWindow),
  );
  powerMonitor.on("unlock-screen", () =>
    broadcast("power:unlock", getMainWindow, getTimerWindow),
  );
}
