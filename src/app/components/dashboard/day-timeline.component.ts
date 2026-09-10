import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
  computed,
  signal,
  OnDestroy,
  OnInit,
} from '@angular/core';
import type { TimeEntry } from '../../models/time-entry';
import type { Issue } from '../../models/issue';
import { issueColor, withAlpha } from '../../utils/colors';

const DEFAULT_START = 7 * 60; // 07:00
const DEFAULT_END = 19 * 60; // 19:00
const MIN_SPAN = 4 * 60; // never render a window narrower than 4h
const LANE_H = 42; // px, height of one entry block
const LANE_GAP = 6; // px, vertical gap between lanes

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function toMinutes(value: string | null | undefined): number {
  if (!value) return 0;
  const [h, m] = value.split(':').map(Number);
  if (Number.isNaN(h)) return 0;
  return (h || 0) * 60 + (m || 0);
}

function formatHm(minutes: number): string {
  const clamped = clamp(Math.round(minutes), 0, 1440);
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

interface Interval {
  entry: TimeEntry;
  start: number;
  end: number;
}

interface TimelineBlock {
  entry: TimeEntry;
  start: number;
  end: number;
  left: number;
  width: number;
  top: number;
  color: string;
  bg: string;
  label: string;
  durationLabel: string;
  tooltip: string;
  active: boolean;
  wide: boolean;
}

interface TimelineGap {
  start: number;
  end: number;
  minutes: number;
  left: number;
  width: number;
  tooltip: string;
}

/**
 * Horizontal "day ribbon": every time entry becomes a coloured block
 * positioned by its start minute and sized by its duration. The untracked
 * stretches between blocks are rendered explicitly as clickable gaps, so
 * missing time is impossible to miss.
 */
@Component({
  selector: 'app-day-timeline',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block select-none' },
  template: `
    <section class="rounded-2xl border border-border/40 bg-card/65 backdrop-blur-md shadow-sm overflow-hidden">
      <!-- Header / summary -->
      <div class="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 border-b border-border/30">
        <div class="flex items-center gap-2.5">
          <span class="text-xs font-bold uppercase tracking-widest text-muted-foreground/70">Day Timeline</span>
          @if (isToday()) {
            <span class="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary">
              <span class="size-1.5 rounded-full bg-primary animate-pulse"></span>
              Live
            </span>
          }
        </div>

        <div class="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] font-semibold text-muted-foreground">
          <span class="flex items-center gap-1.5">
            <svg class="size-3.5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Tracked <b class="text-foreground">{{ trackedLabel() }}</b>
          </span>
          <span class="flex items-center gap-1.5">
            <svg class="size-3.5 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
            </svg>
            Gaps <b class="text-foreground">{{ gapLabel() }}</b>
          </span>
          @if (rangeLabel()) {
            <span class="font-mono text-muted-foreground/70">{{ rangeLabel() }}</span>
          }
        </div>
      </div>

      <!-- Ruler -->
      <div class="relative h-5 mt-3 mx-5">
        @for (hour of hours(); track hour.min) {
          @if (hour.showLabel) {
            <span
              class="absolute top-0 -translate-x-1/2 text-[10px] font-mono font-semibold text-muted-foreground/45"
              [style.left.%]="hour.pct"
            >{{ hour.label }}</span>
          }
        }
      </div>

      <!-- Track -->
      <div class="relative mx-5 mb-4 rounded-lg bg-muted/20" [style.height.px]="trackHeight()">
        <!-- Hour gridlines -->
        @for (hour of hours(); track hour.min) {
          <div class="absolute top-0 bottom-0 w-px bg-border/50" [style.left.%]="hour.pct"></div>
        }

        <!-- Gaps -->
        @for (gap of gaps(); track gap.start) {
          <button
            type="button"
            class="absolute top-0 bottom-0 group cursor-pointer z-0"
            [style.left.%]="gap.left"
            [style.width.%]="gap.width"
            (click)="gapSelected.emit({ start: formatHm(gap.start), end: formatHm(gap.end) })"
            [title]="gap.tooltip"
            [attr.aria-label]="gap.tooltip"
          >
            <span
              class="absolute inset-1 rounded-md border border-dashed border-amber-500/25 transition-colors group-hover:border-amber-500/50"
              [style.background-image]="hatch"
            ></span>
            <span
              class="pointer-events-none absolute left-1/2 top-1 z-40 hidden -translate-x-1/2 whitespace-nowrap rounded-lg border border-border/50 bg-card px-2.5 py-1 text-[10px] font-semibold text-foreground shadow-xl group-hover:block"
            >{{ gap.tooltip }}</span>
          </button>
        }

        <!-- Now marker -->
        @if (nowPct() !== null) {
          <div class="absolute top-0 bottom-0 z-20 pointer-events-none" [style.left.%]="nowPct()">
            <div class="absolute top-0 bottom-0 -ml-px w-0.5 bg-primary"></div>
            <div class="absolute -top-0.5 -ml-1 size-2 rounded-full bg-primary shadow-sm shadow-primary/40"></div>
          </div>
        }

        <!-- Entry blocks -->
        @for (block of blocks(); track block.entry.id) {
          <div class="absolute group z-10" [style.left.%]="block.left" [style.width.%]="block.width" [style.top.px]="block.top">
            <button
              type="button"
              class="relative flex h-full w-full items-center overflow-hidden rounded-md border text-left transition-all duration-200 hover:z-30 hover:shadow-lg hover:brightness-105 cursor-pointer"
              [style.height.px]="laneHeight"
              [style.background-color]="block.bg"
              [style.border-color]="block.color"
              (click)="entrySelected.emit(block.entry)"
              [title]="block.tooltip"
              [attr.aria-label]="block.tooltip"
            >
              <span class="absolute left-0 top-0 bottom-0 w-1" [style.background-color]="block.color" aria-hidden="true"></span>
              <span class="flex min-w-0 flex-col justify-center h-full pl-2.5 pr-2">
                <span class="truncate text-[11px] font-bold leading-tight text-foreground/95">{{ block.label }}</span>
                @if (block.wide) {
                  <span class="truncate text-[9px] font-mono font-semibold leading-tight text-foreground/55">{{ block.durationLabel }}</span>
                }
              </span>
              @if (block.active) {
                <span class="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-white animate-pulse"></span>
              }
            </button>
            <span
              class="pointer-events-none absolute left-1/2 bottom-full mb-1.5 z-50 hidden -translate-x-1/2 whitespace-nowrap rounded-lg border border-border/50 bg-card px-2.5 py-1.5 text-[10px] font-semibold text-foreground shadow-xl group-hover:block"
            >{{ block.tooltip }}</span>
          </div>
        }

        <!-- Empty state -->
        @if (blocks().length === 0) {
          <div class="absolute inset-0 flex items-center justify-center pointer-events-none">
            <p class="text-xs font-semibold text-muted-foreground/60">
              Nothing tracked — click a gap to add an entry
            </p>
          </div>
        }
      </div>

      <!-- Legend -->
      @if (legend().length > 0) {
        <div class="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 pb-4">
          @for (item of legend(); track item.id) {
            <span class="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground/80">
              <span class="size-2.5 rounded-full" [style.background-color]="item.color" aria-hidden="true"></span>
              <span class="max-w-[16rem] truncate">{{ item.label }}</span>
            </span>
          }
        </div>
      }
    </section>
  `,
})
export class DayTimelineComponent implements OnInit, OnDestroy {
  readonly entries = input.required<TimeEntry[]>();
  readonly issues = input<Issue[]>([]);
  readonly isToday = input(false);
  readonly activeEntryId = input<string | null>(null);

  readonly entrySelected = output<TimeEntry>();
  readonly gapSelected = output<{ start: string; end: string }>();

  // ── Layout constants exposed to the template ──
  readonly laneHeight = LANE_H;
  readonly hatch =
    'repeating-linear-gradient(45deg, hsl(var(--muted-foreground) / 0.10) 0 6px, transparent 6px 12px)';

  // ── Live clock ──
  private readonly nowMinutes = signal(this.readClock());
  private timer: ReturnType<typeof setInterval> | null = null;

  ngOnInit(): void {
    if (this.isToday()) {
      this.timer = setInterval(() => this.nowMinutes.set(this.readClock()), 30000);
    }
  }

  ngOnDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private readClock(): number {
    const now = new Date();
    return now.getHours() * 60 + now.getMinutes();
  }

  // ── Derived data ──

  private readonly intervals = computed<Interval[]>(() => {
    const today = this.isToday();
    const now = this.nowMinutes();
    return this.entries()
      .map((entry) => {
        const start = clamp(toMinutes(entry.startTime), 0, 1440);
        let end = entry.endTime ? toMinutes(entry.endTime) : today ? now : start;
        if (end < start) end = start;
        end = clamp(end, 0, 1440);
        return { entry, start, end };
      })
      .filter((interval) => interval.end >= interval.start);
  });

  readonly window = computed(() => {
    let minStart = DEFAULT_START;
    let maxEnd = DEFAULT_END;
    for (const interval of this.intervals()) {
      minStart = Math.min(minStart, interval.start);
      maxEnd = Math.max(maxEnd, interval.end);
    }
    let start = Math.floor(minStart / 60) * 60;
    let end = Math.ceil(maxEnd / 60) * 60;
    if (end - start < MIN_SPAN) end = start + MIN_SPAN;
    start = clamp(start, 0, 1440);
    end = clamp(end, 0, 1440);
    if (end <= start) end = Math.min(1440, start + MIN_SPAN);
    return { start, end, span: end - start };
  });

  readonly hours = computed(() => {
    const { start, end, span } = this.window();
    const labelStep = span > 14 * 60 ? 2 : 1;
    const result: Array<{ min: number; pct: number; label: string; showLabel: boolean }> = [];
    for (let minute = start; minute <= end; minute += 60) {
      const hour = minute / 60;
      result.push({
        min: minute,
        pct: ((minute - start) / span) * 100,
        label: `${String(hour).padStart(2, '0')}:00`,
        showLabel: hour % labelStep === 0,
      });
    }
    return result;
  });

  readonly nowPct = computed<number | null>(() => {
    if (!this.isToday()) return null;
    const { start, end, span } = this.window();
    const now = this.nowMinutes();
    if (now < start || now > end) return null;
    return ((now - start) / span) * 100;
  });

  readonly laneCount = computed(() => this.laneAssignment().lanes);
  readonly trackHeight = computed(() => this.laneCount() * (LANE_H + LANE_GAP) + LANE_GAP);

  private readonly laneAssignment = computed(() => {
    const ordered = [...this.intervals()].sort(
      (a, b) => a.start - b.start || a.end - b.end,
    );
    const laneEnds: number[] = [];
    const assigned = ordered.map((interval) => {
      let lane = laneEnds.findIndex((endMinute) => endMinute <= interval.start);
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(0);
      }
      laneEnds[lane] = interval.end;
      return { ...interval, lane };
    });
    return { assigned, lanes: Math.max(1, laneEnds.length) };
  });

  readonly blocks = computed<TimelineBlock[]>(() => {
    const { start: windowStart, span } = this.window();
    const issueMap = new Map(this.issues().map((issue) => [issue.id, issue]));
    const activeId = this.activeEntryId();

    return this.laneAssignment().assigned.map((interval) => {
      const issue = issueMap.get(interval.entry.issueId);
      const color = issueColor(issue);
      const duration = interval.end - interval.start;
      const width = ((duration / span) * 100);
      const label = issue
        ? issue.jiraIssueKey || issue.title
        : interval.entry.issueId.slice(0, 8);
      const range = `${formatHm(interval.start)} – ${formatHm(interval.end)}`;
      const tooltipBase = `${issue ? this.issueLabel(issue) : label} · ${range} · ${this.formatDuration(duration)}`;
      const tooltip = interval.entry.note
        ? `${tooltipBase} — ${interval.entry.note}`
        : tooltipBase;

      return {
        entry: interval.entry,
        start: interval.start,
        end: interval.end,
        left: ((interval.start - windowStart) / span) * 100,
        width: Math.max(width, 0.4),
        top: LANE_GAP + interval.lane * (LANE_H + LANE_GAP),
        color,
        bg: withAlpha(color, 0.16),
        label,
        durationLabel: this.formatDuration(duration),
        tooltip,
        active: activeId === interval.entry.id && !interval.entry.endTime,
        wide: width > 9,
      };
    });
  });

  readonly gaps = computed<TimelineGap[]>(() => {
    const { start: windowStart, end: windowEnd, span } = this.window();
    const ordered = [...this.intervals()].sort((a, b) => a.start - b.start);
    const result: TimelineGap[] = [];
    let cursor = windowStart;

    for (const interval of ordered) {
      if (interval.end <= cursor) continue;
      if (interval.start > cursor) {
        const gapEnd = Math.min(interval.start, windowEnd);
        if (gapEnd > cursor) {
          result.push(this.makeGap(cursor, gapEnd, windowStart, span));
        }
      }
      cursor = Math.max(cursor, interval.end);
      if (cursor >= windowEnd) break;
    }
    if (cursor < windowEnd) {
      result.push(this.makeGap(cursor, windowEnd, windowStart, span));
    }
    return result.filter((gap) => gap.minutes >= 1);
  });

  private makeGap(
    start: number,
    end: number,
    windowStart: number,
    span: number,
  ): TimelineGap {
    const minutes = end - start;
    return {
      start,
      end,
      minutes,
      left: ((start - windowStart) / span) * 100,
      width: ((minutes / span) * 100),
      tooltip: `Untracked ${formatHm(start)} – ${formatHm(end)} · ${this.formatDuration(minutes)} — click to add`,
    };
  }

  readonly trackedLabel = computed(() =>
    this.formatDuration(
      this.intervals().reduce((sum, interval) => sum + (interval.end - interval.start), 0),
    ),
  );

  readonly gapLabel = computed(() =>
    this.formatDuration(this.gaps().reduce((sum, gap) => sum + gap.minutes, 0)),
  );

  readonly rangeLabel = computed(() => {
    const iv = this.intervals();
    if (iv.length === 0) return '';
    const first = Math.min(...iv.map((i) => i.start));
    const last = Math.max(...iv.map((i) => i.end));
    return `First ${formatHm(first)} · Last ${formatHm(last)}`;
  });

  readonly legend = computed(() => {
    const issueMap = new Map(this.issues().map((issue) => [issue.id, issue]));
    const seen = new Map<string, { id: string; label: string; color: string }>();
    for (const interval of this.intervals()) {
      const id = interval.entry.issueId;
      if (seen.has(id)) continue;
      const issue = issueMap.get(id);
      seen.set(id, {
        id,
        label: issue ? this.issueLabel(issue) : id.slice(0, 8),
        color: issueColor(issue),
      });
    }
    return [...seen.values()];
  });

  // ── Helpers ──

  private issueLabel(issue: Issue): string {
    return issue.jiraIssueKey ? `${issue.jiraIssueKey} ${issue.title}` : issue.title;
  }

  protected readonly formatHm = formatHm;

  private formatDuration(minutes: number): string {
    if (minutes <= 0) return '<1m';
    const h = Math.floor(minutes / 60);
    const m = Math.round(minutes % 60);
    if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
    return `${m}m`;
  }
}
