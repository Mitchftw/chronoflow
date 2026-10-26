import { ipcMain, BrowserWindow } from "electron";
import { randomUUID } from "crypto";
import * as dbService from "../db-service";
import { logger } from "../utils/logger";
import type { TimeEntry } from "../../src/types";
import {
  addLocalDays,
  endOfLocalDay,
  formatTimeHms as formatLocalTime,
  localMidnight,
  nextLocalMidnight,
  parseLocalDate,
  parseLocalDateTime,
  toLocalDate as formatLocalDate,
} from "../utils/time";

/**
 * In-memory timer state — the main process is the authoritative timekeeper.
 * The renderer can query elapsed time without maintaining its own interval.
 */
let timerState: {
  issueId: string | null;
  entryId: string | null;
  startTime: number | null;
  initialStartTime: number | null;
  isRunning: boolean;
  isPaused: boolean;
  pausedElapsed: number; // ms accumulated before pause
  pauseStart: number | null; // timestamp when pause started
} = {
  issueId: null,
  entryId: null,
  startTime: null,
  initialStartTime: null,
  isRunning: false,
  isPaused: false,
  pausedElapsed: 0,
  pauseStart: null,
};

type WindowGetter = () => BrowserWindow | null;

// Registered by registerTimerHandlers. The rollover monitor can start before
// the windows exist (restore runs first), so these are optional.
let timerWindowGetter: WindowGetter | null = null;
let mainWindowGetter: WindowGetter | null = null;
let rolloverMonitor: ReturnType<typeof setInterval> | null = null;
let rolloverInFlight: Promise<boolean> | null = null;

/** Convert a "HH:MM[:SS]" wall-clock string to ms since local midnight. */
function parseWallClockToMs(time: string): number {
  const [h = 0, m = 0, s = 0] = time.split(":").map(Number);
  return h * 3600000 + m * 60000 + s * 1000;
}

/**
 * Realign the in-memory timer so its elapsed time matches a (possibly
 * edited) entry start time. Handles starts before local midnight by
 * wrapping at 24h. Used when the running entry's start time is edited.
 */
function realignRunningTimer(startTime: string): void {
  const now = new Date();
  const nowWallMs =
    now.getHours() * 3600000 +
    now.getMinutes() * 60000 +
    now.getSeconds() * 1000 +
    now.getMilliseconds();
  let elapsedMs = nowWallMs - parseWallClockToMs(startTime);
  if (elapsedMs < 0) elapsedMs += 24 * 3600000; // started before midnight

  const startTimestamp = Date.now() - elapsedMs;
  if (timerState.isPaused) {
    timerState.pausedElapsed = elapsedMs;
  } else {
    timerState.startTime = startTimestamp;
  }
  timerState.initialStartTime = startTimestamp;
}

/**
 * Recover an interrupted timer session on startup. If the most recent entry
 * never got an end time (the app quit or crashed while the timer was
 * running), adopt it as the running timer and keep counting from its
 * original start time.
 */
export async function restoreRunningTimerFromDb(): Promise<void> {
  try {
    if (timerState.isRunning) return;
    const entry = await dbService.getLatestOpenEntry();
    if (!entry) return;

    const result = await resumeOpenEntry(entry.id);
    if (result.success) {
      logger.info(
        `Restored running timer: entry ${entry.id} started ${entry.startTime}`,
      );
    }
  } catch (error: any) {
    logger.error("Failed to restore running timer:", error);
  } finally {
    // Start the midnight monitor even when no timer was restored — it is a
    // no-op until a timer is running and covers timers started later.
    startTimerRolloverMonitor();
  }
}

/**
 * Adopt an open (endless) entry as the running timer, continuing from its
 * original start time. Shared by the startup restore and timer:resume-entry.
 */
export async function resumeOpenEntry(
  entryId: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const entry = await dbService.getTimeEntry(entryId);
    if (!entry) return { success: false, error: "Time entry not found" };
    if (entry.endTime) {
      return { success: false, error: "This entry already has an end time." };
    }
    if (timerState.isRunning && !timerState.isPaused) {
      return {
        success: false,
        error: "A timer is already running. Stop it first.",
      };
    }

    timerState = {
      issueId: entry.issueId,
      entryId: entry.id,
      startTime: null,
      initialStartTime: null,
      isRunning: true,
      isPaused: false,
      pausedElapsed: 0,
      pauseStart: null,
    };

    // Prefer the entry's real date + start time over wall-clock realignment.
    // A timer left open for more than 24h must keep its full elapsed time so
    // the rollover/split entries and issue.timeSpent still agree.
    const actualStart = parseLocalDateTime(entry.date, entry.startTime);
    if (actualStart && actualStart.getTime() <= Date.now()) {
      timerState.startTime = actualStart.getTime();
      timerState.initialStartTime = actualStart.getTime();
    } else {
      realignRunningTimer(entry.startTime);
    }

    const issue = await dbService.getIssue(entry.issueId);
    if (issue) {
      await dbService.updateIssue(entry.issueId, {
        isRunning: true,
        startTime: timerState.startTime ?? Date.now(),
      });
    }

    // A restored/endless entry may belong to a previous local day. Split it
    // immediately rather than waiting for the 30 s monitor's first tick.
    await checkRunningTimerDayRollover();

    return { success: true };
  } catch (error: any) {
    logger.error("Failed to resume time entry:", error);
    return {
      success: false,
      error: error.message || "Failed to resume time entry",
    };
  }
}

/**
 * Notify all windows of current timer state via webContents.send
 */
export function broadcastTimerState(timerWindow: BrowserWindow | null, mainWindow: BrowserWindow | null) {
  const state = getTimerState();
  if (timerWindow && !timerWindow.isDestroyed()) {
    timerWindow.webContents.send("timer:state-update", state);
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("timer:state-update", state);
  }
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

export function getTimerState() {
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
 * Split a stopped wall-clock range into one segment per local calendar day.
 * `start` is inclusive and `end` is exclusive-ish (23:59:59 is used as the
 * last stored second of an intermediate day). Zero-length segments are
 * omitted.
 */
function buildDailySegments(
  start: Date,
  end: Date,
): Array<{ date: string; startTime: string; endTime: string }> {
  const segments: Array<{ date: string; startTime: string; endTime: string }> =
    [];
  let day = localMidnight(start);
  const lastDay = localMidnight(end);

  while (day.getTime() <= lastDay.getTime()) {
    const segmentStart = start.getTime() > day.getTime() ? start : day;
    const dayEnd = endOfLocalDay(day);
    const segmentEnd = dayEnd.getTime() > end.getTime() ? end : dayEnd;

    const startTime = formatLocalTime(segmentStart);
    const endTime = formatLocalTime(segmentEnd);
    // Compare the stored (second-precision) values too: a sub-second segment
    // at midnight would otherwise be written as 00:00:00 → 00:00:00.
    if (
      segmentEnd.getTime() > segmentStart.getTime() &&
      startTime !== endTime
    ) {
      segments.push({
        date: formatLocalDate(segmentStart),
        startTime,
        endTime,
      });
    }

    day = nextLocalMidnight(day);
  }

  return segments;
}

/**
 * Close an entry whose open range crosses local midnight. The existing row
 * keeps the first day (and any Jira worklog id), new rows are created for the
 * remaining days. Only the first row keeps a worklog id; every new row is
 * dirty so it becomes its own worklog on the next sync.
 */
async function closeEntryAcrossDays(
  entry: TimeEntry,
  start: Date,
  end: Date,
  note?: string,
): Promise<void> {
  if (end.getTime() <= start.getTime()) {
    await dbService.updateTimeEntry(entry.id, {
      endTime: formatLocalTime(end),
      ...(note !== undefined ? { note } : {}),
      isDirty: true,
    });
    return;
  }

  const segments = buildDailySegments(start, end);
  if (segments.length === 0) {
    await dbService.updateTimeEntry(entry.id, {
      endTime: formatLocalTime(end),
      ...(note !== undefined ? { note } : {}),
      isDirty: true,
    });
    return;
  }

  const first = segments[0];
  await dbService.updateTimeEntry(entry.id, {
    date: first.date,
    startTime: first.startTime,
    endTime: first.endTime,
    isDirty: true,
    ...(note !== undefined && segments.length === 1 ? { note } : {}),
  });

  for (let index = 1; index < segments.length; index++) {
    const segment = segments[index];
    await dbService.createTimeEntry({
      id: randomUUID(),
      issueId: entry.issueId,
      date: segment.date,
      startTime: segment.startTime,
      endTime: segment.endTime,
      note:
        note !== undefined && index === segments.length - 1 ? note : "",
      jiraWorklogId: null,
      isDirty: true,
    });
  }
}

/**
 * If the running entry belongs to a previous local day, close it at 23:59:59
 * and create a new open entry for each following day. The final created entry
 * is today's open entry, so the timer keeps running with a date that matches
 * the wall clock. Returns true when a rollover happened.
 */
async function performDayRollover(
  getTimerWindow: WindowGetter | null,
  getMainWindow: WindowGetter | null,
): Promise<boolean> {
  if (!timerState.isRunning || !timerState.entryId) return false;

  const entry = await dbService.getTimeEntry(timerState.entryId);
  if (!entry || entry.endTime) return false;

  const now = new Date();
  const today = formatLocalDate(now);
  if (entry.date >= today) return false;

  const startDate = parseLocalDate(entry.date);
  if (!startDate) {
    logger.warn(
      `Cannot roll over timer entry ${entry.id}: invalid date "${entry.date}"`,
    );
    return false;
  }

  // Close the entry that still belongs to the previous day.
  await dbService.updateTimeEntry(entry.id, {
    endTime: "23:59:59",
    isDirty: true,
  });

  // Create full-day entries for every missed day between the old entry and
  // today. The loop is deliberately bounded by today's local midnight; a
  // clock jump far into the future therefore cannot loop forever.
  const todayMidnight = localMidnight(now);
  let cursor = addLocalDays(startDate, 1);
  while (cursor.getTime() < todayMidnight.getTime()) {
    await dbService.createTimeEntry({
      id: randomUUID(),
      issueId: entry.issueId,
      date: formatLocalDate(cursor),
      startTime: "00:00:00",
      endTime: "23:59:59",
      note: "",
      jiraWorklogId: null,
      isDirty: true,
    });
    cursor = addLocalDays(cursor, 1);
  }

  // Today's entry starts at local midnight and stays open.
  const newEntryId = randomUUID();
  await dbService.createTimeEntry({
    id: newEntryId,
    issueId: entry.issueId,
    date: today,
    startTime: "00:00:00",
    endTime: null,
    note: entry.note || "",
    jiraWorklogId: null,
    isDirty: true,
  });

  timerState.entryId = newEntryId;
  timerState.issueId = entry.issueId;
  timerState.initialStartTime = Math.max(
    timerState.initialStartTime ?? todayMidnight.getTime(),
    todayMidnight.getTime(),
  );
  if (!timerState.isPaused && timerState.startTime === null) {
    timerState.startTime = Date.now();
  }

  broadcastTimerState(
    getTimerWindow?.() ?? null,
    getMainWindow?.() ?? null,
  );
  logger.info(
    `Timer rolled over from ${entry.date} to ${today} (new entry ${newEntryId})`,
  );
  return true;
}

/**
 * Main-process midnight rollover check. Safe to call from the 30 s monitor
 * and from timer:stop; concurrent calls share a single in-flight run so a
 * rollover cannot create duplicate entries.
 */
export function checkRunningTimerDayRollover(
  getTimerWindow?: WindowGetter,
  getMainWindow?: WindowGetter,
): Promise<boolean> {
  if (rolloverInFlight) return rolloverInFlight;

  rolloverInFlight = performDayRollover(
    getTimerWindow ?? timerWindowGetter,
    getMainWindow ?? mainWindowGetter,
  )
    .catch((error: unknown) => {
      logger.error("Failed to check timer day rollover:", error);
      return false;
    })
    .finally(() => {
      rolloverInFlight = null;
    });

  return rolloverInFlight;
}

/** Start the periodic rollover check. Idempotent. */
export function startTimerRolloverMonitor(): void {
  if (rolloverMonitor) return;
  rolloverMonitor = setInterval(() => {
    void checkRunningTimerDayRollover();
  }, 30_000);
  rolloverMonitor.unref();
}

/**
 * Register all timer-related IPC handlers.
 * Pass in getters for the timer and main windows so we can push state updates.
 */
export function registerTimerHandlers(
  getTimerWindow: () => BrowserWindow | null,
  getMainWindow: () => BrowserWindow | null,
) {
  timerWindowGetter = getTimerWindow;
  mainWindowGetter = getMainWindow;
  startTimerRolloverMonitor();

  // Start tracking time for an issue
  ipcMain.handle("timer:start", async (_, issueId: string) => {
    try {
      if (timerState.isRunning && !timerState.isPaused) {
        return {
          success: false,
          error: "A timer is already running. Stop it first.",
        };
      }

      // If paused, resume the existing timer. Starting an issue while a
      // paused timer belongs to a different issue must not silently steal
      // the timer from the paused issue.
      if (timerState.isRunning && timerState.isPaused) {
        if (issueId && issueId !== timerState.issueId) {
          return {
            success: false,
            error:
              "A paused timer is already running for another issue. Stop it first.",
          };
        }

        timerState.isPaused = false;
        timerState.pauseStart = null;
        // pausedElapsed holds the time accumulated before the pause. The
        // clock has to restart now, otherwise elapsed stays frozen forever.
        timerState.startTime = Date.now();

        broadcastTimerState(getTimerWindow(), getMainWindow());
        return { success: true, data: getTimerState() };
      }

      const now = Date.now();
      const today = formatLocalDate(new Date());

      // Create a new time entry
      const entryId = randomUUID();
      await dbService.createTimeEntry({
        id: entryId,
        issueId,
        startTime: formatLocalTime(new Date(now)),
        endTime: null,
        date: today,
        note: '',
        jiraWorklogId: null,
      });

      timerState = {
        issueId,
        entryId,
        startTime: now,
        initialStartTime: now,
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

      broadcastTimerState(getTimerWindow(), getMainWindow());
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
  ipcMain.handle("timer:stop", async (_, note?: string, stopTime?: number) => {
    try {
      if (!timerState.isRunning) {
        return { success: false, error: "No timer is running." };
      }

      // Catch a midnight crossing before stopping, even if the 30 s monitor
      // has not ticked yet. This updates timerState.entryId to today's entry.
      const wasRolledOver = await checkRunningTimerDayRollover(
        getTimerWindow,
        getMainWindow,
      );

      const entryId = timerState.entryId;
      const issueId = timerState.issueId;
      const endTimestamp = stopTime || Date.now();
      let elapsedSeconds = getTimerStateElapsed(endTimestamp);

      // Check settings for 15-min rounding. Rounding a multi-day range would
      // move already-closed rollover entries, so only apply it to a timer
      // whose current entry still belongs to the stop day.
      const appSettings = await dbService.getSetting("app");
      const roundTo15Min =
        appSettings?.roundTo15Min === true && !wasRolledOver;

      let roundedStart = timerState.initialStartTime || timerState.startTime || Date.now();
      let roundedEnd = endTimestamp;

      if (roundTo15Min) {
        const fifteenMinInMs = 15 * 60 * 1000;
        roundedStart = Math.round(roundedStart / fifteenMinInMs) * fifteenMinInMs;
        roundedEnd = Math.round(endTimestamp / fifteenMinInMs) * fifteenMinInMs;

        const actualPausedMs = Math.max(0, (endTimestamp - (timerState.initialStartTime || timerState.startTime || endTimestamp)) - (elapsedSeconds * 1000));
        const roundedDurationMs = roundedEnd - roundedStart - actualPausedMs;
        let roundedElapsedSeconds = Math.round(roundedDurationMs / fifteenMinInMs) * (15 * 60);

        if (roundedElapsedSeconds <= 0 && elapsedSeconds > 0) {
          roundedElapsedSeconds = 15 * 60; // minimum 15 mins
        }
        elapsedSeconds = roundedElapsedSeconds;

        roundedEnd = roundedStart + (elapsedSeconds * 1000) + actualPausedMs;
      }

      if (entryId) {
        const currentEntry = await dbService.getTimeEntry(entryId);
        const stopDate = formatLocalDate(new Date(roundedEnd));

        // Fallback split: if the open entry belongs to an earlier local day,
        // close it per day so every stored row's date matches its segment.
        // The first segment keeps the existing row (and worklog id).
        if (currentEntry && currentEntry.date < stopDate) {
          const entryStart = parseLocalDateTime(
            currentEntry.date,
            currentEntry.startTime,
          );
          const splitStart = entryStart
            ? Math.min(roundedStart, entryStart.getTime())
            : roundedStart;
          await closeEntryAcrossDays(
            currentEntry,
            new Date(splitStart),
            new Date(roundedEnd),
            note,
          );
        } else {
          // Close the time entry and set note if provided
          await dbService.updateTimeEntry(entryId, {
            startTime: roundTo15Min ? formatLocalTime(new Date(roundedStart)) : undefined,
            endTime: formatLocalTime(new Date(roundedEnd)),
            date: roundTo15Min ? formatLocalDate(new Date(roundedStart)) : undefined,
            ...(note !== undefined ? { note } : {}),
          });
        }
      }

      // Update issue time spent and mark as not running
      if (issueId) {
        const issue = await dbService.getIssue(issueId);
        if (issue) {
          await dbService.updateIssue(issueId, {
            timeSpent: (issue.timeSpent || 0) + elapsedSeconds,
            isRunning: false,
            startTime: null,
          });
        }
      }

      timerState = {
        issueId: null,
        entryId: null,
        startTime: null,
        initialStartTime: null,
        isRunning: false,
        isPaused: false,
        pausedElapsed: 0,
        pauseStart: null,
      };

      broadcastTimerState(getTimerWindow(), getMainWindow());
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

      broadcastTimerState(getTimerWindow(), getMainWindow());
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

      broadcastTimerState(getTimerWindow(), getMainWindow());
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

  // Resume timing on an existing open (endless) entry — e.g. an entry that
  // was left running when the app quit, or a manual entry without an end
  // time. The timer keeps counting from the entry's original start time.
  ipcMain.handle("timer:resume-entry", async (_, entryId: string) => {
    const result = await resumeOpenEntry(entryId);
    if (result.success) {
      broadcastTimerState(getTimerWindow(), getMainWindow());
      logger.info(`Timer resumed on entry: ${entryId}`);
      return { success: true, data: getTimerState() };
    }
    return result;
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
      // If the running timer's entry start time is edited, realign the
      // in-memory timer so elapsed and the stored start time stay in sync.
      if (
        timerState.isRunning &&
        timerState.entryId === id &&
        typeof updates.startTime === "string"
      ) {
        realignRunningTimer(updates.startTime);
        broadcastTimerState(getTimerWindow(), getMainWindow());
      }
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
      if (timerState.isRunning && timerState.entryId === id) {
        return {
          success: false,
          error: "Stop the timer before deleting this entry.",
        };
      }
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
    async (_, originalEntryId, splitTime, newIssueId, newNote) => {
      try {
        await dbService.splitTimeEntry(originalEntryId, splitTime, newIssueId, newNote);
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
    "timer:split-out-entry",
    async (_, originalEntryId, fromTime, toTime, newIssueId, newNote) => {
      try {
        const result = await dbService.splitOutRange(
          originalEntryId,
          fromTime,
          toTime,
          newIssueId,
          newNote,
        );
        // If the running timer's entry was split, its remainder keeps
        // running from the end of the split-out block.
        if (
          timerState.isRunning &&
          timerState.entryId === originalEntryId &&
          result.lastId
        ) {
          timerState.entryId = result.lastId;
          realignRunningTimer(toTime);
          broadcastTimerState(getTimerWindow(), getMainWindow());
        }
        return { success: true, data: result };
      } catch (error: any) {
        logger.error("Failed to split out time entry:", error);
        return {
          success: false,
          error: error.message || "Failed to split out time entry",
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
