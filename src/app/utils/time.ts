/**
 * Shared wall-clock/time-entry helpers.
 *
 * Time entries are stored as a local date (`yyyy-MM-dd`) plus wall-clock
 * strings (`HH:mm` or `HH:mm:ss`). An entry can legitimately cross midnight
 * (end time earlier than start time); all duration math must account for that.
 */

export interface TimeEntryLike {
  date: string;
  startTime: string;
  endTime: string | null;
}

export function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** Parse `HH:mm` / `HH:mm:ss` to seconds since local midnight. */
export function parseTimeToSeconds(time: string | null | undefined): number {
  if (!time) return 0;
  const [h = 0, m = 0, s = 0] = time.split(':').map(Number);
  if (![h, m, s].every(Number.isFinite)) return 0;
  return h * 3600 + m * 60 + s;
}

/** Local `yyyy-MM-dd` for a Date. */
export function toLocalDate(date: Date = new Date()): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/** Parse a local `yyyy-MM-dd` string without the UTC pitfalls of `new Date(iso)`. */
export function parseLocalDate(iso: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(year, month, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month ||
    date.getDate() !== day
  ) {
    return null;
  }
  return date;
}

/** Render a stored wall-clock time as `HH:mm` (seconds are not useful in the UI). */
export function formatTimeHm(time: string | null | undefined): string {
  if (!time) return '';
  const seconds = parseTimeToSeconds(time);
  const h = Math.floor(seconds / 3600) % 24;
  const m = Math.floor((seconds % 3600) / 60);
  return `${pad2(h)}:${pad2(m)}`;
}

/**
 * Duration of a stored entry in milliseconds.
 *
 * - Uses seconds when present, so 09:15:30 → 10:30:15 is not silently rounded
 *   to whole minutes.
 * - Treats `end < start` as an overnight entry.
 * - For an open entry, counts up to `now` only when it belongs to today.
 *   A stale open entry from a previous day contributes 0 until the timer
 *   rollover/stop logic has split it into dated entries.
 */
export function entryDurationMs(
  entry: TimeEntryLike,
  now: Date = new Date(),
): number {
  const start = parseTimeToSeconds(entry.startTime);
  let end: number;
  if (entry.endTime) {
    end = parseTimeToSeconds(entry.endTime);
    if (end < start) end += 24 * 3600;
  } else if (entry.date === toLocalDate(now)) {
    end = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
    if (end < start) end += 24 * 3600;
  } else {
    return 0;
  }
  return Math.max(0, Math.round((end - start) * 1000));
}

export function entryDurationSeconds(
  entry: TimeEntryLike,
  now: Date = new Date(),
): number {
  return Math.round(entryDurationMs(entry, now) / 1000);
}

/**
 * Human duration from seconds. Keeps sub-minute entries visible as `<1m`
 * instead of pretending they are zero.
 */
export function formatDurationSeconds(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  if (seconds === 0) return '0m';
  if (seconds < 60) return '<1m';
  const totalMinutes = Math.floor(seconds / 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  return `${m}m`;
}

/** Human duration from milliseconds. */
export function formatDurationMs(totalMs: number): string {
  return formatDurationSeconds(totalMs / 1000);
}

/** Human duration from minutes (for Jira estimates and daily goals). */
export function formatDurationMinutes(totalMinutes: number): string {
  const minutes = Math.max(0, Math.round(totalMinutes));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  return `${m}m`;
}

/** Compact duration used in the week overview, e.g. `8h 30m`. */
export function formatDurationCompact(totalMinutes: number): string {
  return formatDurationMinutes(totalMinutes);
}

/** `yyyy-MM-dd` for a local Date, using its own calendar day. */
export function localDateOf(date: Date): string {
  return toLocalDate(date);
}

/** Whether two dates fall on the same local calendar day. */
export function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
