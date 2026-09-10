/**
 * Shared colour system for projects and issues.
 *
 * Projects store a colour explicitly. Issues may store one too, but when they
 * don't we derive a stable colour from the issue id so every issue still gets
 * its own accent in the dashboard, timeline and timesheets — without any user
 * effort. The same palette is exposed to the colour pickers so everything
 * stays consistent.
 */

export const COLOR_PRESETS = [
  '#3b82f6', // blue
  '#22c55e', // green
  '#a855f7', // purple
  '#f97316', // orange
  '#ef4444', // red
  '#14b8a6', // teal
  '#eab308', // yellow
  '#ec4899', // pink
  '#6366f1', // indigo
  '#06b6d4', // cyan
  '#84cc16', // lime
  '#f43f5e', // rose
] as const;

export type ColorPreset = (typeof COLOR_PRESETS)[number];

export const DEFAULT_COLOR = COLOR_PRESETS[0];

const HEX_RE = /^#?[0-9a-fA-F]{3,8}$/;

/**
 * Deterministic palette colour for an id. The same id always maps to the same
 * colour, so derived accents are stable across sessions and reloads.
 */
export function colorFromId(id: string | null | undefined): string {
  if (!id) return DEFAULT_COLOR;
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  return COLOR_PRESETS[Math.abs(hash) % COLOR_PRESETS.length];
}

/**
 * Resolve the colour for an issue: an explicitly stored colour wins, otherwise
 * fall back to the deterministic id-based colour.
 */
export function issueColor(
  issue: { id: string; color?: string | null } | null | undefined,
  fallback: string = DEFAULT_COLOR,
): string {
  if (!issue) return fallback;
  return issue.color || colorFromId(issue.id);
}

/**
 * Convert a hex colour to an `rgba()` string with the given alpha. Non-hex
 * values (e.g. `var(--color-primary)`) are returned untouched so callers can
 * still use them as a solid fallback.
 */
export function withAlpha(color: string, alpha: number): string {
  if (!color) return color;
  const raw = color.trim();
  if (!HEX_RE.test(raw)) return raw;
  const hex = raw.replace('#', '');
  const full =
    hex.length === 3
      ? hex
          .split('')
          .map((c) => c + c)
          .join('')
      : hex;
  const int = parseInt(full.slice(0, 6), 16);
  if (Number.isNaN(int)) return color;
  const r = (int >> 16) & 255;
  const g = (int >> 8) & 255;
  const b = int & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
