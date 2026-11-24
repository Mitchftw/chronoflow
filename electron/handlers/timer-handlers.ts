import { ipcMain, BrowserWindow } from "electron";
import { enqueueWrite } from "../services/write-queue";
import { withTransaction } from "../database";
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

/**
 * Result shape shared by the IPC handlers and the direct entry points below.
 */
export interface TimerActionResult {
  success: boolean;
  error?: string;
  data?: any;
}

/**
 * Direct (non-IPC) entry points to the timer, installed by
 * registerTimerHandlers. The MCP server uses these so it drives the very same
 * state machine as the UI — midnight rollover, 15-minute rounding, issue
 * bookkeeping and window broadcasts all stay in one place.
 */
export const timerApi: {
  start: ((
    issueId: string,
    options?: { date?: string; startTime?: string },
  ) => Promise<TimerActionResult>) | null;
  stop: ((note?: string, stopTime?: number) => Promise<TimerActionResult>) | null;
  pause: (() => Promise<TimerActionResult>) | null;
  resume: (() => Promise<TimerActionResult>) | null;
  updateEntry: ((
    id: string,
    updates: Record<string, unknown>,
  ) => Promise<TimerActionResult>) | null;
} = {
  start: null,
  stop: null,
  pause: null,
  resume: null,
  updateEntry: null,
};


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

  const newEntryId = randomUUID();
  const todayMidnight = localMidnight(now);
  await withTransaction(async () => {
    // Close the entry that still belongs to the previous day.
    await dbService.updateTimeEntry(entry.id, {
      endTime: "23:59:59",
      isDirty: true,
    });

    // Create full-day entries for every missed day between the old entry and
    // today. The loop is deliberately bounded by today's local midnight; a
    // clock jump far into the future therefore cannot loop forever.
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
    void enqueueWrite(() => checkRunningTimerDayRollover());
  }, 30_000);
  rolloverMonitor.unref();
}

export async function resumeTrackedEntry(entryId: string): Promise<TimerActionResult> {
  if (timerState.isRunning) return { success: false, error: "Stop the current timer before resuming an entry." };
  const result = await resumeOpenEntry(entryId);
  if (!result.success) return result;
  broadcastTimerState(timerWindowGetter?.() ?? null, mainWindowGetter?.() ?? null);
  return { success: true, data: getTimerState() };
}

async function entryAction<T>(action: () => Promise<T>): Promise<TimerActionResult> {
  try {
    return { success: true, data: await action() };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

// Keep the timer on the open remainder, including when a point split assigns it to another task.
async function splitTracked<T extends { lastId: string | null }>(entryId: string, targetId: string | undefined, split: () => Promise<T>): Promise<T> {
  const active = timerState.entryId === entryId;
  const { parts, tail } = await withTransaction(async () => {
    const entry = await dbService.getTimeEntry(entryId);
    if (!entry) throw new Error("Time entry not found");
    const parts = await dbService.accountForEntryEdit([entry.issueId, targetId ?? entry.issueId], split);
    const tail = active && parts.lastId ? await dbService.getTimeEntry(parts.lastId) : null;
    if (tail) {
      if (timerState.issueId && timerState.issueId !== tail.issueId) {
        await dbService.updateIssue(timerState.issueId, { isRunning: false, startTime: null });
      }
      await dbService.updateIssue(tail.issueId, {
        isRunning: true, startTime: parseLocalDateTime(tail.date, tail.startTime)!.getTime(),
      });
    }
    return { parts, tail };
  });
  if (tail) {
    timerState.entryId = tail.id;
    timerState.issueId = tail.issueId;
    alignEditedTimer(tail.date, tail.startTime, true);
    broadcastTimerState(timerWindowGetter?.() ?? null, mainWindowGetter?.() ?? null);
  }
  return parts;
}

export function splitTrackedEntry(...args: Parameters<typeof dbService.splitTimeEntry>) {
  return splitTracked(args[0], args[2], () => dbService.splitTimeEntry(...args));
}

export function splitTrackedRange(...args: Parameters<typeof dbService.splitOutRange>) {
  return splitTracked(args[0], args[3], () => dbService.splitOutRange(...args));
}

function alignEditedTimer(date: string, time: string, newSegment = false): void {
  const start = parseLocalDateTime(date, time)!.getTime();
  const now = Date.now();
  const activeEnd = timerState.pauseStart ?? now;
  const previousSpan = activeEnd - (timerState.initialStartTime ?? activeEnd);
  const pausedMs = newSegment ? 0 : Math.max(0, previousSpan - getTimerStateElapsed(activeEnd) * 1000);
  const elapsed = Math.max(0, activeEnd - start - pausedMs);
  timerState.initialStartTime = start;
  timerState.pausedElapsed = timerState.isPaused ? elapsed : 0;
  timerState.startTime = timerState.isPaused ? null : now - elapsed;
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

  const handleEdit = <Args extends any[], Result>(channel: string, action: (...args: Args) => Promise<Result>) =>
    ipcMain.handle(channel, (_event, ...args) => enqueueWrite(() => action(...args as Args)));

  // Start tracking time for an issue
  const startTimer = async (
    issueId: string,
    options: { date?: string; startTime?: string } = {},
  ): Promise<TimerActionResult> => {
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
        if (options.date || options.startTime) {
          return {
            success: false,
            error:
              "A paused timer already exists. Resume or stop it before starting with a custom start time.",
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
      const startDate = options.date ?? today;
      const startWallClock = options.startTime ?? formatLocalTime(new Date(now));

      // Backdating: an agent (or the UI) can log work that started earlier in
      // the day. The entry keeps the real start, so elapsed time and the
      // 15-minute rounding both count from it.
      const startAt = parseLocalDateTime(startDate, startWallClock);
      if (!startAt) {
        return {
          success: false,
          error: `Invalid start "${startDate} ${startWallClock}". Use date YYYY-MM-DD and time HH:MM[:SS].`,
        };
      }
      // Allow a minute of clock skew, reject anything genuinely ahead of now.
      if (startAt.getTime() > now + 60_000) {
        return {
          success: false,
          error: `Start time ${startDate} ${startWallClock} is in the future.`,
        };
      }
      const startMs = startAt.getTime();

      // Create a new time entry
      const entryId = randomUUID();
      await withTransaction(async () => {
        await dbService.createTimeEntry({
          id: entryId,
          issueId,
          startTime: startWallClock,
          endTime: null,
          date: startDate,
          note: '',
          jiraWorklogId: null,
        });
        await dbService.updateIssue(issueId, { isRunning: true, startTime: startMs });
      });

      timerState = {
        issueId,
        entryId,
        startTime: startMs,
        initialStartTime: startMs,
        isRunning: true,
        isPaused: false,
        pausedElapsed: 0,
        pauseStart: null,
      };

      broadcastTimerState(getTimerWindow(), getMainWindow());
      logger.info(`Timer started for issue: ${issueId} at ${startDate} ${startWallClock}`);
      return { success: true, data: getTimerState() };
    } catch (error: any) {
      logger.error("Failed to start timer:", error);
      return {
        success: false,
        error: error.message || "Failed to start timer",
      };
    }
  };
  timerApi.start = startTimer;
  handleEdit("timer:start", async (issueId: string) =>
    startTimer(issueId),
  );

  // Stop tracking time
  const stopTimer = async (
    note?: string,
    stopTime?: number,
  ): Promise<TimerActionResult> => {
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

      await withTransaction(async () => {
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
      });

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
  };
  timerApi.stop = stopTimer;
  handleEdit(
    "timer:stop",
    async (note?: string, stopTime?: number) =>
      stopTimer(note, stopTime),
  );

  // Pause timer (stop accumulating time but keep state)
  const pauseTimer = async (): Promise<TimerActionResult> => {
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
  };
  timerApi.pause = pauseTimer;
  handleEdit("timer:pause", async () => pauseTimer());

  // Resume timer
  const resumeTimer = async (): Promise<TimerActionResult> => {
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
  };
  timerApi.resume = resumeTimer;
  handleEdit("timer:resume", async () => resumeTimer());

  // Resume timing on an existing open (endless) entry — e.g. an entry that
  // was left running when the app quit, or a manual entry without an end
  // time. The timer keeps counting from the entry's original start time.
  handleEdit("timer:resume-entry", resumeTrackedEntry);

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

  handleEdit("timer:create-entry", async (entry: TimeEntry) => {
    try {
      const newEntry = {
        ...entry,
        id: entry.id || randomUUID(),
      };
      await dbService.accountForEntryEdit([newEntry.issueId], () => dbService.createTimeEntry(newEntry));
      return { success: true, data: newEntry };
    } catch (error: any) {
      logger.error("Failed to create time entry:", error);
      return {
        success: false,
        error: error.message || "Failed to create time entry",
      };
    }
  });

  const updateEntry = async (
    id: string,
    updates: Record<string, unknown>,
  ): Promise<TimerActionResult> => {
    try {
      const active = timerState.entryId === id;
      const entry = await dbService.getTimeEntry(id);
      if (!entry) throw new Error("Time entry not found");
      if (active && updates["endTime"]) throw new Error("Stop the timer before setting an end time on its entry.");
      const date = String(updates["date"] ?? entry.date);
      const start = String(updates["startTime"] ?? entry.startTime);
      const timingChanged = updates["startTime"] !== undefined || updates["date"] !== undefined;
      if (active && timingChanged) {
        const timestamp = parseLocalDateTime(date, start);
        if (!timestamp || timestamp.getTime() > Date.now()) throw new Error("The running entry cannot start in the future.");
      }
      const issueId = String(updates["issueId"] ?? entry.issueId);
      await withTransaction(async () => {
        await dbService.accountForEntryEdit([entry.issueId, issueId], () => dbService.moveTimeEntry(id, updates));
        if (active && (timingChanged || issueId !== entry.issueId)) {
          if (issueId !== entry.issueId) await dbService.updateIssue(entry.issueId, { isRunning: false, startTime: null });
          await dbService.updateIssue(issueId, { isRunning: true, startTime: parseLocalDateTime(date, start)!.getTime() });
        }
      });
      if (active) {
        timerState.issueId = issueId;
        if (timingChanged) alignEditedTimer(date, start);
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
  };
  timerApi.updateEntry = updateEntry;
  handleEdit("timer:update-entry", async ({ id, updates }: { id: string; updates: Record<string, unknown> }) =>
    updateEntry(id, updates),
  );

  handleEdit("timer:delete-entry", async (id: string) => {
    try {
      if (timerState.isRunning && timerState.entryId === id) {
        return {
          success: false,
          error: "Stop the timer before deleting this entry.",
        };
      }
      const entry = await dbService.getTimeEntry(id);
      if (entry) await dbService.accountForEntryEdit([entry.issueId], () => dbService.deleteTimeEntry(id));
      return { success: true };
    } catch (error: any) {
      logger.error("Failed to delete time entry:", error);
      return {
        success: false,
        error: error.message || "Failed to delete time entry",
      };
    }
  });

  handleEdit("timer:split-entry", (...args: Parameters<typeof splitTrackedEntry>) =>
    entryAction(() => splitTrackedEntry(...args)));
  handleEdit("timer:split-out-entry", (...args: Parameters<typeof splitTrackedRange>) =>
    entryAction(() => splitTrackedRange(...args)));
  handleEdit("timer:merge-entries", (...args: Parameters<typeof dbService.mergeTimeEntries>) =>
    entryAction(() => dbService.mergeTimeEntries(...args)));

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
