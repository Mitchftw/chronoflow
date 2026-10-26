import { describe, expect, it } from 'vitest';
import {
  entryDurationMs,
  formatDurationMinutes,
  formatDurationSeconds,
  formatTimeHm,
  parseTimeToSeconds,
  toLocalDate,
} from './time';

describe('time utilities', () => {
  it('parses HH:mm and HH:mm:ss', () => {
    expect(parseTimeToSeconds('09:15')).toBe(9 * 3600 + 15 * 60);
    expect(parseTimeToSeconds('09:15:30')).toBe(9 * 3600 + 15 * 60 + 30);
    expect(parseTimeToSeconds('')).toBe(0);
  });

  it('rounds seconds correctly for a same-day entry', () => {
    expect(
      entryDurationMs({
        date: '2026-10-26',
        startTime: '09:15:30',
        endTime: '10:30:15',
      }),
    ).toBe((75 * 60 - 15) * 1000);
  });

  it('handles entries crossing local midnight', () => {
    expect(
      entryDurationMs({
        date: '2026-10-26',
        startTime: '23:50:00',
        endTime: '00:10:00',
      }),
    ).toBe(20 * 60 * 1000);
  });

  it('counts an open entry for today up to now', () => {
    const now = new Date(2026, 9, 26, 12, 0, 0);
    expect(
      entryDurationMs(
        {
          date: toLocalDate(now),
          startTime: '11:30:00',
          endTime: null,
        },
        now,
      ),
    ).toBe(30 * 60 * 1000);
  });

  it('does not count a stale open entry from another day', () => {
    const now = new Date(2026, 9, 26, 12, 0, 0);
    expect(
      entryDurationMs(
        {
          date: '2026-10-25',
          startTime: '23:30:00',
          endTime: null,
        },
        now,
      ),
    ).toBe(0);
  });

  it('formats hours and minutes consistently', () => {
    expect(formatDurationSeconds(8 * 3600 + 30 * 60)).toBe('8h 30m');
    expect(formatDurationSeconds(8 * 3600)).toBe('8h');
    expect(formatDurationSeconds(30)).toBe('<1m');
    expect(formatDurationSeconds(0)).toBe('0m');
    expect(formatDurationMinutes(8 * 60 + 30)).toBe('8h 30m');
  });

  it('formats stored times as HH:mm', () => {
    expect(formatTimeHm('09:15:30')).toBe('09:15');
    expect(formatTimeHm('09:15')).toBe('09:15');
    expect(formatTimeHm('')).toBe('');
  });
});
