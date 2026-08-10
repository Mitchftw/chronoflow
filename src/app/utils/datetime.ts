/**
 * Format a `Date` as the ISO 8601 string accepted by Jira Cloud's worklog
 * `started` field: `yyyy-MM-dd'T'HH:mm:ss.SSS±HHMM` — e.g.
 * `2024-08-04T09:00:00.000+0200`.
 *
 * Jira Cloud's parser rejects the bare `Z` (UTC) form that
 * `Date.prototype.toISOString()` returns. RFC 822 explicit offset is the
 * only form the API accepts in this field, so we always emit the local
 * timezone offset and never `Z` directly.
 *
 * `Date.prototype.getTimezoneOffset()` returns minutes WEST of UTC
 * (negative for east of UTC). We flip the sign so the output matches the
 * RFC 822 / ISO convention (positive offset = east of UTC, `+` prefix).
 */
export function formatJiraLocalIso(d: Date): string {
  const pad = (n: number, len: number) => String(n).padStart(len, '0');
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1, 2);
  const dd = pad(d.getDate(), 2);
  const hh = pad(d.getHours(), 2);
  const mi = pad(d.getMinutes(), 2);
  const ss = pad(d.getSeconds(), 2);
  const ms = pad(d.getMilliseconds(), 3);

  const offsetMinutes = -d.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMinutes);
  const oh = pad(Math.floor(abs / 60), 2);
  const om = pad(abs % 60, 2);

  return `${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}.${ms}${sign}${oh}${om}`;
}

/**
 * Build a `Date` for a wall-clock time in the user's local timezone from
 * separately-stored date (YYYY-MM-DD) + time (HH:mm[:ss]) strings. The
 * call to the multi-arg `Date` constructor (year, monthIndex, day,
 * hours, ...) preserves local timezone, unlike `new Date(isoString)` which
 * parses ISO strings as UTC.
 */
export function parseLocalDateTime(
  dateISO: string,
  timeHHMMSS: string,
): Date {
  const [y, m, d] = dateISO.split('-').map(Number);
  const parts = timeHHMMSS.split(':').map(Number);
  const hh = parts[0] ?? 0;
  const mi = parts[1] ?? 0;
  const ss = parts[2] ?? 0;
  return new Date(y, m - 1, d, hh, mi, ss);
}
