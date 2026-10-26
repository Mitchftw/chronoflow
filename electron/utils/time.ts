/**
 * Local wall-clock helpers for the main process.
 *
 * Time entries are stored as a local date (`yyyy-MM-dd`) plus wall-clock
 * strings (`HH:mm` or `HH:mm:ss`). Keeping the math here mirrors the shared
 * renderer helpers in `src/app/utils/time.ts` so both processes agree on how
 * cross-midnight and second-precision entries are interpreted.
 */

export interface TimeEntryLike {
  date: string;
  startTime: string;
  endTime: string | null;
}

export function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** Parse `HH:mm` / `HH:mm:ss` to seconds since local midnight. */
export function parseTimeToSeconds(time: string | null | undefined): number {
  if (!time) return 0;
  const [h = 0, m = 0, s = 0] = time.split(":").map(Number);
  if (![h, m, s].every(Number.isFinite)) return 0;
  return h * 3600 + m * 60 + s;
}

/** Local `yyyy-MM-dd` for a Date. */
export function toLocalDate(date: Date = new Date()): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(
    date.getDate(),
  )}`;
}

/** Format a Date as local wall-clock `HH:mm:ss` (the DB convention). */
export function formatTimeHms(date: Date): string {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(
    date.getSeconds(),
  )}`;
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

/** Build a local Date from stored date + wall-clock time strings. */
export function parseLocalDateTime(
  dateISO: string,
  timeHms: string,
): Date | null {
  const date = parseLocalDate(dateISO);
  if (!date) return null;
  const [h = 0, m = 0, s = 0] = timeHms.split(":").map(Number);
  if (![h, m, s].every(Number.isFinite)) return null;
  date.setHours(h, m, s, 0);
  return date;
}

/** Add whole local calendar days without DST/UTC drift. */
export function addLocalDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

/** Local midnight at the start of the Date's calendar day. */
export function localMidnight(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** Local midnight at the start of the following calendar day. */
export function nextLocalMidnight(date: Date): Date {
  return addLocalDays(localMidnight(date), 1);
}

/** Last representable wall-clock second of the Date's calendar day. */
export function endOfLocalDay(date: Date): Date {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    23,
    59,
    59,
  );
}

/** Duration of a stored entry in milliseconds. */
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
