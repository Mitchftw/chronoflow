import { ipcMain, BrowserWindow } from "electron";
import { randomUUID } from "crypto";
import * as dbService from "../db-service";
import { logger } from "../utils/logger";

/**
 * In-memory timer state — the main process is the authoritative timekeeper.
 * The renderer can query elapsed time without maintaining its own interval.
 */
let timerState: {
  issueId: string | null;
  entryId: string | null;
  startTime: number | null;
  isRunning: boolean;
  isPaused: boolean;
  pausedElapsed: number; // ms accumulated before pause
  pauseStart: number | null; // timestamp when pause started
} = {
  issueId: null,
  entryId: null,
  startTime: null,
  isRunning: false,
  isPaused: false,
  pausedElapsed: 0,
  pauseStart: null,
};

/**
 * Notify the timer window (if open) of current state via webContents.send
 */
function broadcastTimerState(timerWindow: BrowserWindow | null) {
  if (!timerWindow || timerWindow.isDestroyed()) return;
  timerWindow.webContents.send("timer:state-update", getTimerState());
}

function getTimerStateElapsed(atTime?: number): number {
  if (!timerState.isRunning) return 0;

  let elapsed = timerState.pausedElapsed || 0;

  if (timerState.isPaused) {
    // Don't add current running time when paused
    return Math.floor(elapsed / 1000);
  }

  // Add time since start (minus pause periods)
  if (timerState.startTime) {
    const endTimestamp = atTime || Date.now();
    elapsed += endTimestamp - timerState.startTime;
  }

  return Math.floor(elapsed / 1000);
}

function getTimerState() {
  return {
    isRunning: timerState.isRunning,
    isPaused: timerState.isPaused,
    issueId: timerState.issueId,
    entryId: timerState.entryId,
    startTime: timerState.startTime,
    elapsed: getTimerStateElapsed(),
  };
}

/**
 * Register all timer-related IPC handlers.
 * Pass in a getter for the timer window so we can push state updates.
 */
export function registerTimerHandlers(
  getTimerWindow: () => BrowserWindow | null,
) {
  // Start tracking time for an issue
  ipcMain.handle("timer:start", async (_, issueId: string) => {
    try {
      if (timerState.isRunning && !timerState.isPaused) {
        return {
          success: false,
          error: "A timer is already running. Stop it first.",
        };
      }

      // If paused, resume instead
      if (timerState.isRunning && timerState.isPaused) {
        timerState.isPaused = false;
        timerState.pauseStart = null;
        // Adjust start time to account for pause duration
        // This keeps the elapsed calculation simple
        broadcastTimerState(getTimerWindow());
        return { success: true, data: getTimerState() };
      }

      const now = Date.now();
      const today = new Date().toISOString().slice(0, 10);

      // Create a new time entry
      const entryId = randomUUID();
      await dbService.createTimeEntry({
        id: entryId,
        issueId,
        startTime: new Date(now).toISOString().slice(11, 19),
        endTime: null,
        date: today,
        note: '',
        jiraWorklogId: null,
      });

      timerState = {
        issueId,
        entryId,
        startTime: now,
        isRunning: true,
        isPaused: false,
        pausedElapsed: 0,
        pauseStart: null,
      };

      // Mark the issue as running
      const issue = await dbService.getIssue(issueId);
      if (issue) {
        await dbService.updateIssue(issueId, {
          isRunning: true,
          startTime: now,
        });
      }

      broadcastTimerState(getTimerWindow());
      logger.info(`Timer started for issue: ${issueId}`);
      return { success: true, data: getTimerState() };
    } catch (error: any) {
      logger.error("Failed to start timer:", error);
      return {
        success: false,
        error: error.message || "Failed to start timer",
      };
    }
  });

  // Stop tracking time
  ipcMain.handle("timer:stop", async (_, stopTime?: number) => {
    try {
      if (!timerState.isRunning) {
        return { success: false, error: "No timer is running." };
      }

      const entryId = timerState.entryId;
      const issueId = timerState.issueId;
      const endTimestamp = stopTime || Date.now();
      const elapsedSeconds = getTimerStateElapsed(endTimestamp);

      if (entryId) {
        // Close the time entry
        await dbService.updateTimeEntry(entryId, {
          endTime: new Date(endTimestamp).toISOString().slice(11, 19),
        });
      }

      // Update issue time spent and mark as not running
      if (issueId) {
        const issue = await dbService.getIssue(issueId);
        if (issue) {
          await dbService.updateIssue(issueId, {
            timeSpent: (issue.timeSpent || 0) + elapsedSeconds,
            isRunning: false,
            startTime: undefined,
          });
        }
      }

      const lastState = { ...timerState };
      timerState = {
        issueId: null,
        entryId: null,
        startTime: null,
        isRunning: false,
        isPaused: false,
        pausedElapsed: 0,
        pauseStart: null,
      };

      broadcastTimerState(getTimerWindow());
      logger.info(
        `Timer stopped for issue: ${issueId}, elapsed: ${elapsedSeconds}s`,
      );
      return {
        success: true,
        data: {
          elapsed: elapsedSeconds,
          issueId,
          entryId,
        },
      };
    } catch (error: any) {
      logger.error("Failed to stop timer:", error);
      return {
        success: false,
        error: error.message || "Failed to stop timer",
      };
    }
  });

  // Pause timer (stop accumulating time but keep state)
  ipcMain.handle("timer:pause", async () => {
    try {
      if (!timerState.isRunning) {
        return { success: false, error: "No timer is running." };
      }
      if (timerState.isPaused) {
        return { success: false, error: "Timer is already paused." };
      }

      timerState.isPaused = true;
      // Store how much time we've accumulated so far
      if (timerState.startTime) {
        timerState.pausedElapsed += Date.now() - timerState.startTime;
      }
      timerState.pauseStart = Date.now();
      timerState.startTime = null; // Will be reset on resume

      broadcastTimerState(getTimerWindow());
      logger.info("Timer paused");
      return { success: true, data: getTimerState() };
    } catch (error: any) {
      logger.error("Failed to pause timer:", error);
      return {
        success: false,
        error: error.message || "Failed to pause timer",
      };
    }
  });

  // Resume timer
  ipcMain.handle("timer:resume", async () => {
    try {
      if (!timerState.isRunning) {
        return { success: false, error: "No timer is running." };
      }
      if (!timerState.isPaused) {
        return { success: false, error: "Timer is not paused." };
      }

      timerState.isPaused = false;
      timerState.pauseStart = null;
      timerState.startTime = Date.now();

      broadcastTimerState(getTimerWindow());
      logger.info("Timer resumed");
      return { success: true, data: getTimerState() };
    } catch (error: any) {
      logger.error("Failed to resume timer:", error);
      return {
        success: false,
        error: error.message || "Failed to resume timer",
      };
    }
  });

  // Get current timer state
  ipcMain.handle("timer:get-state", async () => {
    return { success: true, data: getTimerState() };
  });

  // Get elapsed seconds (convenience)
  ipcMain.handle("timer:get-elapsed", async () => {
    return { success: true, data: getTimerStateElapsed() };
  });

  // ---- Time Entry CRUD ----

  ipcMain.handle("timer:get-entries", async (_, filters) => {
    try {
      const entries = await dbService.getTimeEntries(filters);
      return { success: true, data: entries };
    } catch (error: any) {
      logger.error("Failed to get time entries:", error);
      return {
        success: false,
        error: error.message || "Failed to get time entries",
      };
    }
  });

  ipcMain.handle("timer:create-entry", async (_, entry) => {
    try {
      const newEntry = {
        ...entry,
        id: entry.id || randomUUID(),
      };
      await dbService.createTimeEntry(newEntry);
      return { success: true, data: newEntry };
    } catch (error: any) {
      logger.error("Failed to create time entry:", error);
      return {
        success: false,
        error: error.message || "Failed to create time entry",
      };
    }
  });

  ipcMain.handle("timer:update-entry", async (_, { id, updates }) => {
    try {
      await dbService.updateTimeEntry(id, updates);
      return { success: true };
    } catch (error: any) {
      logger.error("Failed to update time entry:", error);
      return {
        success: false,
        error: error.message || "Failed to update time entry",
      };
    }
  });

  ipcMain.handle("timer:delete-entry", async (_, id: string) => {
    try {
      await dbService.deleteTimeEntry(id);
      return { success: true };
    } catch (error: any) {
      logger.error("Failed to delete time entry:", error);
      return {
        success: false,
        error: error.message || "Failed to delete time entry",
      };
    }
  });

  ipcMain.handle(
    "timer:split-entry",
    async (_, originalEntryId, splitTime, newIssueId) => {
      try {
        await dbService.splitTimeEntry(originalEntryId, splitTime, newIssueId);
        return { success: true };
      } catch (error: any) {
        logger.error("Failed to split time entry:", error);
        return {
          success: false,
          error: error.message || "Failed to split time entry",
        };
      }
    },
  );

  ipcMain.handle(
    "timer:merge-entries",
    async (_, entryIds, noteStrategy, customNote) => {
      try {
        await dbService.mergeTimeEntries(entryIds, noteStrategy, customNote);
        return { success: true };
      } catch (error: any) {
        logger.error("Failed to merge time entries:", error);
        return {
          success: false,
          error: error.message || "Failed to merge time entries",
        };
      }
    },
  );

  ipcMain.handle("timer:get-deleted-worklogs", async () => {
    try {
      const worklogs = await dbService.getDeletedJiraWorklogs();
      return { success: true, worklogs };
    } catch (error: any) {
      logger.error("Failed to get deleted worklogs:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("timer:clear-deleted-worklog", async (_, id: string) => {
    try {
      await dbService.deleteDeletedJiraWorklog(id);
      return { success: true };
    } catch (error: any) {
      logger.error("Failed to delete deleted worklog:", error);
      return { success: false, error: error.message };
    }
  });
}
