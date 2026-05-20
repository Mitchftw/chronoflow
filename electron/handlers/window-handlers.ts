import { ipcMain, BrowserWindow } from "electron";
import { getDatabasePath } from "../database";

/**
 * Register all window-related IPC handlers
 */
export function registerWindowHandlers(
  getMainWindow: () => BrowserWindow | null,
) {
  ipcMain.handle("window:minimize", () => {
    const mainWindow = getMainWindow();
    mainWindow?.minimize();
  });

  ipcMain.handle("window:maximize", () => {
    const mainWindow = getMainWindow();
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow?.maximize();
    }
  });

  ipcMain.handle("window:close", () => {
    const mainWindow = getMainWindow();
    mainWindow?.close();
  });

  ipcMain.handle("db:get-path", () => {
    return getDatabasePath();
  });
}
