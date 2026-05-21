import { app, BrowserWindow, shell, ipcMain, screen } from "electron";
import * as dotenv from "dotenv";
import * as path from "path";

// Load environment variables from .env file
dotenv.config();

// Isolate userData for E2E tests
if (process.env["IS_TEST"] === "true") {
  const testUserDataPath = path.join(app.getPath("temp"), "chronoflow-test-userdata");
  app.setPath("userData", testUserDataPath);
}

import { autoUpdater } from "electron-updater";
import { initDatabase, closeDatabase } from "./database";
import { logger } from "./utils/logger";
import { registerJiraHandlers } from "./handlers/jira-handlers";
import { registerStoreHandlers } from "./handlers/store-handlers";
import { registerTimerHandlers, broadcastTimerState } from "./handlers/timer-handlers";
import { registerWindowHandlers } from "./handlers/window-handlers";
import { registerIdleHandlers } from "./handlers/idle-handlers";

let mainWindow: BrowserWindow | null = null;
let timerWindow: BrowserWindow | null = null;
let timerWindowMode: "draggable" | "notch" | null = null;

// Handle deep links
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(
      "chronoflow",
      process.execPath,
      [path.resolve(process.argv[1])],
    );
  }
} else {
  app.setAsDefaultProtocolClient("chronoflow");
}

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on(
    "second-instance",
    (_event, commandLine: string[]) => {
      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();

        const url = commandLine.find((arg) =>
          arg.startsWith("chronoflow://"),
        );
        if (url) {
          handleDeepLink(url);
        }
      }
    },
  );

  app.on("open-url", (event, url) => {
    event.preventDefault();
    handleDeepLink(url);
  });
}

function handleDeepLink(url: string) {
  logger.info(`Handling deep link: ${url}`);
  if (mainWindow) {
    mainWindow.webContents.send("app:deep-link", url);
  }
  // Also notify timer window
  if (timerWindow && !timerWindow.isDestroyed()) {
    timerWindow.webContents.send("app:deep-link", url);
  }
}

// ---- Auto Updater ----

function initAutoUpdater() {
  autoUpdater.logger = logger;

  autoUpdater.on("checking-for-update", () => {
    logger.info("Checking for update...");
  });

  autoUpdater.on("update-available", (info) => {
    logger.info("Update available:", info);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("app:update-available", info);
    }
  });

  autoUpdater.on("update-not-available", (info) => {
    logger.info("Update not available:", info);
  });

  autoUpdater.on("error", (err) => {
    logger.error("Error in auto-updater:", err);
  });

  autoUpdater.on("download-progress", (progressObj) => {
    const logMessage = `Download speed: ${progressObj.bytesPerSecond} - Downloaded ${progressObj.percent}% (${progressObj.transferred}/${progressObj.total})`;
    logger.info(logMessage);
  });

  autoUpdater.on("update-downloaded", (info) => {
    logger.info("Update downloaded:", info);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("app:update-downloaded", info);
    }
  });

  autoUpdater.checkForUpdatesAndNotify();
}

function registerUpdaterHandlers() {
  ipcMain.handle("updater:check-for-updates", async () => {
    try {
      if (process.env['NODE_ENV'] === "development") {
        logger.info("Mock checking for updates in development");
        return { success: true };
      }
      const result = await autoUpdater.checkForUpdatesAndNotify();
      return { success: true, result };
    } catch (error: any) {
      logger.error("Failed to check for updates:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("updater:quit-and-install", async () => {
    try {
      if (process.env['NODE_ENV'] === "development") {
        logger.info("Mock quit and install in development");
        return { success: true };
      }
      autoUpdater.quitAndInstall();
      return { success: true };
    } catch (error: any) {
      logger.error("Failed to quit and install update:", error);
      return { success: false, error: error.message };
    }
  });
}

// ---- Main Window ----

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 420,
    height: 800,
    frame: false,
    transparent: false,
    backgroundColor: "#1a1a1a",
    icon: process.platform === "win32"
      ? path.join(__dirname, "../../build/icon.ico")
      : path.join(__dirname, "../../build/icon.png"),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  mainWindow.maximize();

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.webContents.on(
    "did-fail-load",
    (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      logger.error("Renderer failed to load:", {
        errorCode,
        errorDescription,
        validatedURL,
        isMainFrame,
      });

      if (process.env['NODE_ENV'] === "development" && isMainFrame) {
        logger.info("Retrying connection to http://localhost:4200 in 1s...");
        setTimeout(() => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.loadURL("http://localhost:4200");
          }
        }, 1000);
      }
    },
  );

  mainWindow.webContents.on("console-message", (_event, level, message) => {
    logger.info(`[Renderer Console] ${message}`);
  });

  if (process.env['NODE_ENV'] === "development") {
    logger.info("Loading development URL: http://localhost:4200");
    mainWindow.loadURL("http://localhost:4200");
    mainWindow.webContents.openDevTools();
  } else {
    const rendererPath = path.join(
      __dirname,
      "../renderer/browser/index.html",
    );
    logger.info("Loading production HTML:", rendererPath);
    mainWindow.loadFile(rendererPath).catch((error) => {
      logger.error("Failed to load renderer:", error);
    });
  }

  // Check if opened via deep link on cold start
  const urlArg = process.argv.find((arg) =>
    arg.startsWith("chronoflow://"),
  );
  if (urlArg) {
    mainWindow.webContents.on("did-finish-load", () => {
      handleDeepLink(urlArg);
    });
  }

  // When restored (e.g. taskbar click), hide the timer overlay
  mainWindow.on("restore", () => {
    hideTimerWindow();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
    app.quit();
  });
}

let mouseCheckInterval: any = null;

function startMouseTracking() {
  if (process.env["IS_TEST"] === "true") return;
  if (mouseCheckInterval) return;
  mouseCheckInterval = setInterval(() => {
    if (!timerWindow || timerWindow.isDestroyed() || !timerWindow.isVisible()) {
      stopMouseTracking();
      return;
    }
    const cursor = screen.getCursorScreenPoint();
    const bounds = timerWindow.getBounds();
    const isInside = (
      cursor.x >= bounds.x &&
      cursor.x <= bounds.x + bounds.width &&
      cursor.y >= bounds.y &&
      cursor.y <= bounds.y + bounds.height
    );
    if (isInside) {
      timerWindow.setIgnoreMouseEvents(false);
    } else {
      timerWindow.setIgnoreMouseEvents(true, { forward: true });
    }
  }, 100);
}

function stopMouseTracking() {
  if (mouseCheckInterval) {
    clearInterval(mouseCheckInterval);
    mouseCheckInterval = null;
  }
}

function createTimerWindow(mode: "draggable" | "notch") {
  timerWindowMode = mode;
  if (timerWindow && !timerWindow.isDestroyed()) {
    timerWindow.show();
    timerWindow.focus();
    if (mode === "notch") {
      startMouseTracking();
    } else {
      stopMouseTracking();
      timerWindow.setIgnoreMouseEvents(false);
    }
    return;
  }

  const isNotch = mode === "notch";

  timerWindow = new BrowserWindow({
    width: isNotch ? 324 : 328,
    height: isNotch ? 38 : 100,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    hasShadow: false,
    thickFrame: false,
    backgroundColor: "#00000000",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  timerWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  // Position: notch mode at top-center, draggable mode at bottom-right
  const activeDisplay = (mainWindow && !mainWindow.isDestroyed())
    ? screen.getDisplayMatching(mainWindow.getBounds())
    : screen.getPrimaryDisplay();

  if (isNotch) {
    const { width: screenWidth, x: displayX, y: displayY } = activeDisplay.bounds;
    timerWindow.setPosition(
      displayX + Math.round((screenWidth - 324) / 2),
      displayY,
    );
    timerWindow.setAlwaysOnTop(true, "screen-saver");
    if (process.env["IS_TEST"] !== "true") {
      timerWindow.setIgnoreMouseEvents(true, { forward: true });
      startMouseTracking();
    } else {
      timerWindow.setIgnoreMouseEvents(false);
    }
  } else {
    const { width: screenWidth, height: screenHeight, x: displayX, y: displayY } = activeDisplay.workArea;
    timerWindow.setPosition(
      displayX + screenWidth - 340,
      displayY + screenHeight - 140,
    );
  }

  timerWindow.webContents.on("did-finish-load", () => {
    broadcastTimerState(timerWindow, mainWindow);
  });

  timerWindow.webContents.on(
    "did-fail-load",
    (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (process.env['NODE_ENV'] === "development" && isMainFrame) {
        setTimeout(() => {
          if (timerWindow && !timerWindow.isDestroyed()) {
            timerWindow.loadURL(`http://localhost:4200/?windowType=timer&mode=${mode}#/timer-overlay`);
          }
        }, 1000);
      }
    },
  );

  if (process.env['NODE_ENV'] === "development") {
    timerWindow.loadURL(`http://localhost:4200/?windowType=timer&mode=${mode}#/timer-overlay`);
    // Don't open dev tools for timer window in dev, keep it clean
  } else {
    const rendererPath = path.join(
      __dirname,
      "../renderer/browser/index.html",
    );
    timerWindow.loadFile(rendererPath, {
      hash: "/timer-overlay",
      query: { windowType: "timer", mode },
    }).catch((error) => {
      logger.error("Failed to load timer window:", error);
    });
  }

  timerWindow.on("closed", () => {
    timerWindow = null;
    timerWindowMode = null;
    stopMouseTracking();
  });
}

function hideTimerWindow() {
  if (timerWindow && !timerWindow.isDestroyed()) {
    timerWindow.hide();
    stopMouseTracking();
  }
}

// ---- IPC: Timer Window Management ----

function registerTimerWindowHandlers() {
  ipcMain.handle("timer-window:create", async (_, mode: "draggable" | "notch") => {
    try {
      createTimerWindow(mode);
      return { success: true };
    } catch (error: any) {
      logger.error("Failed to create timer window:", error);
      return {
        success: false,
        error: error.message || "Failed to create timer window",
      };
    }
  });

  ipcMain.handle("timer-window:hide", async () => {
    hideTimerWindow();
    return { success: true };
  });

  ipcMain.handle("timer-window:expand", async () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.maximize();
      mainWindow.focus();
    }
    hideTimerWindow();
    return { success: true };
  });

  ipcMain.on("timer-window:set-ignore-mouse", (event, ignore) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && !win.isDestroyed()) {
      if (process.env["IS_TEST"] === "true") {
        win.setIgnoreMouseEvents(false);
      } else if (ignore) {
        win.setIgnoreMouseEvents(true, { forward: true });
      } else {
        win.setIgnoreMouseEvents(false);
      }
    }
  });

  ipcMain.handle("timer-window:resize", async (event, { width, height }) => {
    if (timerWindow && !timerWindow.isDestroyed()) {
      const oldBounds = timerWindow.getBounds();
      
      if (timerWindowMode === "notch") {
        const activeDisplay = screen.getDisplayMatching(oldBounds);
        const { width: screenWidth, x: displayX, y: displayY } = activeDisplay.bounds;
        const newX = displayX + Math.round((screenWidth - width) / 2);
        
        timerWindow.setBounds({
          x: newX,
          y: displayY,
          width: width,
          height: height
        });
      } else {
        timerWindow.setSize(width, height);
      }
    }
    return { success: true };
  });
}

// ---- App Lifecycle ----

app.whenReady().then(async () => {
  logger.info("Application starting...");

  try {
    await initDatabase();
    logger.info("Database initialized successfully");
  } catch (error) {
    logger.error("Database initialization error:", error);
  }

  // Register all IPC handlers
  registerWindowHandlers(() => mainWindow);
  registerStoreHandlers();
  registerJiraHandlers();
  registerTimerHandlers(() => timerWindow, () => mainWindow);
  registerTimerWindowHandlers();
  registerIdleHandlers(() => mainWindow);
  registerUpdaterHandlers();

  createWindow();

  if (process.env['NODE_ENV'] !== "development") {
    initAutoUpdater();
  }

  logger.info("Application started successfully");
});

app.on("window-all-closed", () => {
  closeDatabase();
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  closeDatabase();
  // Clean up timer window
  if (timerWindow && !timerWindow.isDestroyed()) {
    timerWindow.close();
    timerWindow = null;
  }
});

app.on("activate", () => {
  if (mainWindow === null) {
    createWindow();
  }
});

// Dev mode signal handling
if (process.env['NODE_ENV'] === "development") {
  if (process.platform === "win32") {
    process.on("message", (data) => {
      if (data === "graceful-exit") {
        app.quit();
      }
    });
  }
  process.on("SIGINT", () => {
    app.quit();
  });
  process.on("SIGTERM", () => {
    app.quit();
  });
}
