import { app, BrowserWindow, shell, ipcMain, screen } from "electron";
import * as dotenv from "dotenv";
import * as path from "path";
import * as fs from "fs";

// Load environment variables from .env file
dotenv.config();

// Isolate userData for E2E tests
if (process.env["IS_TEST"] === "true") {
  const testUserDataPath = path.join(app.getPath("temp"), "chronoflow-test-userdata");
  app.setPath("userData", testUserDataPath);
}

import { autoUpdater } from "electron-updater";
import { initDatabase, closeDatabase } from "./database";
import * as db from "./db-service";
import { logger } from "./utils/logger";
import { registerJiraHandlers } from "./handlers/jira-handlers";
import { registerStoreHandlers } from "./handlers/store-handlers";
import { registerTimerHandlers, broadcastTimerState } from "./handlers/timer-handlers";
import { registerWindowHandlers } from "./handlers/window-handlers";
import { registerIdleHandlers } from "./handlers/idle-handlers";

let mainWindow: BrowserWindow | null = null;
let timerWindow: BrowserWindow | null = null;
let timerWindowMode: "draggable" | "notch" | null = null;

// ---- Single-instance heartbeat guard ----
// Windows protocol launches (chronoflow://) can race Electron's
// requestSingleInstanceLock and spawn a second main process. Such a
// duplicate then hangs forever waiting on the SQLite DB the primary has
// open — which freezes the OAuth callback and makes the connection save
// fail. This heartbeat file lets any later main process see the primary is
// alive and exit immediately instead of touching the DB.
const instanceMarkerPath = path.join(
  app.getPath("userData"),
  ".instance-heartbeat",
);
let heartbeatInterval: NodeJS.Timeout | null = null;

function writeHeartbeat(): void {
  try {
    fs.writeFileSync(instanceMarkerPath, String(process.pid), "utf8");
  } catch (err) {
    logger.error("Failed to write instance heartbeat:", err);
  }
}

function anotherInstanceIsAlive(): boolean {
  try {
    const stat = fs.statSync(instanceMarkerPath);
    if (Date.now() - stat.mtimeMs > 15000) return false; // stale heartbeat
    const pid = Number(fs.readFileSync(instanceMarkerPath, "utf8"));
    return Number.isInteger(pid) && pid > 0 && pid !== process.pid;
  } catch {
    return false;
  }
}

function stopHeartbeat(): void {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
  // Only remove the marker if it's OURS — a duplicate instance that exits
  // before writing one must not delete the primary's heartbeat.
  try {
    const pid = Number(fs.readFileSync(instanceMarkerPath, "utf8"));
    if (pid === process.pid) {
      fs.unlinkSync(instanceMarkerPath);
    }
  } catch {
    /* ignore */
  }
}

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
  // Installed app version (from package.json) for the About section.
  // `app.getVersion()` returns the version of the running build, so after
  // an update is installed it reflects the new version.
  ipcMain.handle("app:get-version", () => app.getVersion());

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

// ---- Notch auto-hide state ----
// When enabled, the notch is tucked just off the top of the screen until the
// mouse approaches its expected position; then it slides down. Renderer pin
// requests (e.g. dropdown open, stop-note entry) keep it visible regardless.
let autoHideEnabled = false;
let isPinned = false;
let isCollapsed = false;
// Display the notch should appear on when multiple monitors are in use.
// null = auto: follow the main window's display (fallback: primary).
let notchDisplayId: number | null = null;
let notchAnimation: { startTime: number; fromY: number; toY: number; duration: number } | null = null;
let animationInterval: any = null;
const NOTCH_ANIMATION_DURATION = 200;
const NOTCH_PEEK_PX = 6;
const NOTCH_TRIGGER_ZONE_PX = 14;

function computeCollapsedY(displayY: number, windowHeight: number): number {
  return displayY - windowHeight + NOTCH_PEEK_PX;
}

function resolveNotchDisplay(): Electron.Display {
  if (notchDisplayId !== null) {
    const found = screen.getAllDisplays().find(
      (d) => d.id === notchDisplayId,
    );
    if (found) return found;
  }
  return mainWindow && !mainWindow.isDestroyed()
    ? screen.getDisplayMatching(mainWindow.getBounds())
    : screen.getPrimaryDisplay();
}

function animateNotchTo(targetY: number): void {
  if (!timerWindow || timerWindow.isDestroyed()) return;
  const currentY = timerWindow.getBounds().y;
  if (currentY === targetY || notchAnimation?.toY === targetY) return;
  notchAnimation = {
    startTime: Date.now(),
    fromY: currentY,
    toY: targetY,
    duration: NOTCH_ANIMATION_DURATION,
  };
  if (animationInterval) return;
  animationInterval = setInterval(() => {
    if (!notchAnimation || !timerWindow || timerWindow.isDestroyed()) {
      if (animationInterval) {
        clearInterval(animationInterval);
        animationInterval = null;
      }
      notchAnimation = null;
      return;
    }
    const elapsed = Date.now() - notchAnimation.startTime;
    const t = Math.min(1, elapsed / notchAnimation.duration);
    const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
    const y = Math.round(notchAnimation.fromY + (notchAnimation.toY - notchAnimation.fromY) * eased);
    const bounds = timerWindow.getBounds();
    timerWindow.setBounds({ x: bounds.x, y, width: bounds.width, height: bounds.height });
    if (t >= 1) {
      clearInterval(animationInterval);
      animationInterval = null;
      notchAnimation = null;
    }
  }, 16);
}

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
    const activeDisplay = screen.getDisplayMatching(bounds);
    const { y: displayY } = activeDisplay.bounds;

    if (timerWindowMode === "notch" && autoHideEnabled) {
      const centerX = bounds.x + bounds.width / 2;
      const inHorizontalFootprint =
        cursor.x >= centerX - bounds.width / 2 - 20 &&
        cursor.x <= centerX + bounds.width / 2 + 20;
      const inTriggerZone =
        inHorizontalFootprint &&
        cursor.y <= displayY + NOTCH_TRIGGER_ZONE_PX;
      const inWindow =
        cursor.x >= bounds.x &&
        cursor.x <= bounds.x + bounds.width &&
        cursor.y >= bounds.y &&
        cursor.y <= bounds.y + bounds.height;

      if (isPinned) {
        // Pinned: snap to expanded and capture clicks while inside.
        animateNotchTo(displayY);
        isCollapsed = false;
        timerWindow.setIgnoreMouseEvents(!inWindow);
        return;
      }

      if (isCollapsed) {
        // Hidden — only the 6px peek is visible. Show when cursor enters
        // the trigger zone at the top of the screen.
        timerWindow.setIgnoreMouseEvents(true, { forward: true });
        if (inTriggerZone) {
          animateNotchTo(displayY);
          isCollapsed = false;
          timerWindow.setIgnoreMouseEvents(false);
        }
        return;
      }

      // Expanded (auto-hide on, not pinned, not collapsed).
      if (inWindow) {
        timerWindow.setIgnoreMouseEvents(false);
        return;
      }
      timerWindow.setIgnoreMouseEvents(true, { forward: true });
      animateNotchTo(computeCollapsedY(displayY, bounds.height));
      isCollapsed = true;
      return;
    }

    // Default (draggable mode, or notch without auto-hide): click-through
    // outside the window footprint.
    const isInside =
      cursor.x >= bounds.x &&
      cursor.x <= bounds.x + bounds.width &&
      cursor.y >= bounds.y &&
      cursor.y <= bounds.y + bounds.height;
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
  if (animationInterval) {
    clearInterval(animationInterval);
    animationInterval = null;
  }
  notchAnimation = null;
}

function createTimerWindow(mode: "draggable" | "notch") {
  // If a timer window is already open:
  //   - same mode → just ensure it's visible & focused
  //   - different mode → close it so we can recreate with the new mode & URL
  //     (the window's URL contains ?mode=X which determines what the renderer shows)
  if (timerWindow && !timerWindow.isDestroyed()) {
    if (timerWindowMode === mode) {
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
    // Mode mismatch — close so the next block creates a fresh window with the
    // correct mode URL, size, position, and mouse-tracking flags.
    timerWindow.close();
    timerWindow = null;
    timerWindowMode = null;
  }

  timerWindowMode = mode;

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
  const activeDisplay = resolveNotchDisplay();

  if (isNotch) {
    const { width: screenWidth, x: displayX, y: displayY } = activeDisplay.bounds;
    const initialHeight = isNotch ? 38 : 100;
    const startY = autoHideEnabled
      ? computeCollapsedY(displayY, initialHeight)
      : displayY;
    timerWindow.setPosition(
      displayX + Math.round((screenWidth - 324) / 2),
      startY,
    );
    isCollapsed = autoHideEnabled;
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

  // Capture the reference at registration time so the listener only
  // nulls the global when it still points to *this* window. Without the
  // guard, in the mode-mismatch path a fresh `BrowserWindow` is assigned to
  // `timerWindow` before the listener fires, and we'd clobber the new one.
  const trackedWindow = timerWindow;
  trackedWindow.on("closed", () => {
    if (timerWindow === trackedWindow) {
      timerWindow = null;
      timerWindowMode = null;
      isCollapsed = false;
      isPinned = false;
      notchAnimation = null;
      if (animationInterval) {
        clearInterval(animationInterval);
        animationInterval = null;
      }
    }
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
  // List connected displays so the renderer can offer a screen picker for
  // the notch (multi-monitor setups).
  ipcMain.handle("display:get-displays", async () => {
    try {
      const primary = screen.getPrimaryDisplay();
      const displays = screen.getAllDisplays().map((d) => ({
        id: d.id,
        label: d.label || (d.id === primary.id ? "Primary" : `Display ${d.id}`),
        isPrimary: d.id === primary.id,
        bounds: d.bounds,
        workArea: d.workArea,
      }));
      return { success: true, displays };
    } catch (error: any) {
      logger.error("Failed to list displays:", error);
      return {
        success: false,
        error: error.message || "Failed to list displays",
      };
    }
  });

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

  // Apply a timer-mode change to the *currently open* timer window.
  // No-op if no timer window is open — so toggling the setting in
  // /settings doesn't unexpectedly pop the overlay.
  ipcMain.handle("timer-window:apply-mode", async (_, mode: "draggable" | "notch") => {
    try {
      // Skip the redundant work when nothing has to change. createTimerWindow
      // would still re-toggle mouse-tracking and refocus in that case.
      if (timerWindow && !timerWindow.isDestroyed() && timerWindowMode !== mode) {
        // createTimerWindow owns the close+recreate branch on mode mismatch.
        createTimerWindow(mode);
      }
      return { success: true };
    } catch (error: any) {
      logger.error("Failed to apply timer mode:", error);
      return {
        success: false,
        error: error.message || "Failed to apply timer mode",
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

  // Toggle auto-hide on the notch. Stored as a flag for the next time the
  // notch window is created, and applied to the live window if it's open.
  ipcMain.handle(
    "timer-window:apply-notch-auto-hide",
    async (_, enabled: boolean) => {
      try {
        autoHideEnabled = !!enabled;
        if (
          timerWindow &&
          !timerWindow.isDestroyed() &&
          timerWindowMode === "notch" &&
          timerWindow.isVisible()
        ) {
          const bounds = timerWindow.getBounds();
          const activeDisplay = screen.getDisplayMatching(bounds);
          const targetY = autoHideEnabled
            ? computeCollapsedY(activeDisplay.bounds.y, bounds.height)
            : activeDisplay.bounds.y;
          isCollapsed = autoHideEnabled;
          animateNotchTo(targetY);
        }
        return { success: true };
      } catch (error: any) {
        logger.error("Failed to apply notch auto-hide:", error);
        return {
          success: false,
          error: error.message || "Failed to apply notch auto-hide",
        };
      }
    },
  );

  // Choose which display the notch appears on when multiple monitors are
  // connected. Stores the preference for the next notch creation and moves
  // the live notch window to the chosen display if it's currently open.
  ipcMain.handle(
    "timer-window:apply-notch-display",
    async (_, displayId: number | null) => {
      try {
        notchDisplayId =
          typeof displayId === "number" && Number.isFinite(displayId)
            ? displayId
            : null;
        if (
          timerWindow &&
          !timerWindow.isDestroyed() &&
          timerWindowMode === "notch" &&
          timerWindow.isVisible()
        ) {
          const display = resolveNotchDisplay();
          const { width: screenWidth, x: displayX, y: displayY } =
            display.bounds;
          const bounds = timerWindow.getBounds();
          const newX = displayX + Math.round((screenWidth - bounds.width) / 2);
          const newY = autoHideEnabled
            ? computeCollapsedY(displayY, bounds.height)
            : displayY;
          isCollapsed = autoHideEnabled;
          timerWindow.setBounds({
            x: newX,
            y: newY,
            width: bounds.width,
            height: bounds.height,
          });
        }
        return { success: true };
      } catch (error: any) {
        logger.error("Failed to apply notch display:", error);
        return {
          success: false,
          error: error.message || "Failed to apply notch display",
        };
      }
    },
  );

  // Pin the notch window open while the renderer is running an interaction
  // (dropdown visible, stop-note entry). Prevents auto-hide from collapsing
  // mid-interaction. If currently collapsed and pinned becomes true,
  // immediately animate back to expanded.
  ipcMain.on("timer-window:set-pinned", (_event, pinned: boolean) => {
    isPinned = !!pinned;
    if (
      isPinned &&
      isCollapsed &&
      timerWindow &&
      !timerWindow.isDestroyed() &&
      timerWindowMode === "notch" &&
      autoHideEnabled
    ) {
      const activeDisplay = screen.getDisplayMatching(timerWindow.getBounds());
      animateNotchTo(activeDisplay.bounds.y);
      isCollapsed = false;
    }
  });

  ipcMain.handle("timer-window:resize", async (event, { width, height }) => {
    if (timerWindow && !timerWindow.isDestroyed()) {
      const oldBounds = timerWindow.getBounds();

      if (timerWindowMode === "notch") {
        const activeDisplay = screen.getDisplayMatching(oldBounds);
        const { width: screenWidth, x: displayX, y: displayY } = activeDisplay.bounds;
        const newX = displayX + Math.round((screenWidth - width) / 2);
        // If currently collapsed (auto-hide on), keep the window's Y in the
        // collapsed position so only the 6px peek remains visible. Otherwise
        // dock it at the top of the display.
        const newY = isCollapsed
          ? computeCollapsedY(displayY, height)
          : displayY;

        timerWindow.setBounds({
          x: newX,
          y: newY,
          width: width,
          height: height,
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

  // Duplicate-instance guard: a second process launched while the primary
  // is alive (e.g. the OS launching the app for a chronoflow:// deep link)
  // would hang on the DB lock. Hand off to the running instance and exit.
  if (anotherInstanceIsAlive()) {
    logger.warn(
      "Another ChronoFlow instance is running — exiting to avoid a DB lock hang.",
    );
    app.exit(0);
    return;
  }
  writeHeartbeat();
  heartbeatInterval = setInterval(writeHeartbeat, 5000);

  try {
    await initDatabase();
    logger.info("Database initialized successfully");
  } catch (error) {
    logger.error("Database initialization error:", error);
    stopHeartbeat();
    app.exit(1);
    return;
  }

  // Prime auto-hide from persisted settings so the very first timer-window
  // creation after a cold start honors the user's preference. Settings are
  // also re-applied via IPC when the user toggles the setting, so this is
  // only needed because SettingsService.load() bypasses update() and we
  // would otherwise miss the initial preference.
  try {
    const appSettings = (await db.getSetting("app")) as
      | Record<string, unknown>
      | null;
    if (
      appSettings &&
      typeof appSettings["autoHideNotch"] === "boolean"
    ) {
      autoHideEnabled = appSettings["autoHideNotch"] as boolean;
      logger.info(`Auto-hide primed from settings: ${autoHideEnabled}`);
    }
    if (appSettings && typeof appSettings["notchDisplayId"] === "number") {
      notchDisplayId = appSettings["notchDisplayId"] as number;
      logger.info(`Notch display primed from settings: ${notchDisplayId}`);
    }
  } catch (err) {
    logger.error("Failed to prime auto-hide from settings:", err);
  }

  // Register all IPC handlers
  registerWindowHandlers(() => mainWindow);
  registerStoreHandlers();
  registerJiraHandlers();
  registerTimerHandlers(() => timerWindow, () => mainWindow);
  registerTimerWindowHandlers();
  registerIdleHandlers(() => mainWindow, () => timerWindow);
  registerUpdaterHandlers();

  createWindow();

  if (process.env['NODE_ENV'] !== "development") {
    initAutoUpdater();
  }

  logger.info("Application started successfully");
});

app.on("window-all-closed", () => {
  closeDatabase();
  stopHeartbeat();
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  closeDatabase();
  stopHeartbeat();
  // Clean up timer window
  if (timerWindow && !timerWindow.isDestroyed()) {
    timerWindow.close();
    timerWindow = null;
  }
  isCollapsed = false;
  isPinned = false;
  notchAnimation = null;
  if (animationInterval) {
    clearInterval(animationInterval);
    animationInterval = null;
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
