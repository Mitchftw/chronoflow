import { Component, ChangeDetectionStrategy, input, output, computed } from '@angular/core';

export interface HeatmapDay {
  /** ISO date (yyyy-MM-dd). */
  date: string;
  /** Short weekday label, e.g. "Mon". */
  weekday: string;
  /** Day-of-month number. */
  dayNumber: number;
  /** Tracked minutes for the day. */
  minutes: number;
  isToday: boolean;
  isSelected: boolean;
}

/**
 * Vertical week overview. Each row is a day with a bar showing how much of the
 * daily goal was tracked, so a whole week's gaps read at a glance. Clicking a
 * row navigates the dashboard to that day.
 */
@Component({
  selector: 'app-week-heatmap',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block select-none' },
  template: `
    <section class="app-card p-4">
      <div class="mb-3 flex items-center justify-between">
        <span class="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">This week</span>
        <span class="text-[10px] font-semibold text-muted-foreground/70">
          <b class="text-foreground">{{ formatDuration(weekTotal()) }}</b> · {{ activeDays() }}/7 days
        </span>
      </div>

      <div class="space-y-0.5">
        @for (day of days(); track day.date) {
          <button
            type="button"
            class="group flex w-full items-center gap-3 rounded-lg border px-2 py-1.5 transition-all duration-200 cursor-pointer"
            [class]="day.isSelected ? 'border-primary bg-primary/5' : 'border-transparent hover:bg-secondary/50'"
            (click)="daySelected.emit(day.date)"
            [title]="tooltip(day)"
            [attr.aria-label]="tooltip(day)"
            [attr.aria-current]="day.isSelected ? 'date' : undefined"
          >
            <span
              class="w-8 shrink-0 text-left text-[10px] font-bold uppercase tracking-wider"
              [class]="day.isToday || day.isSelected ? 'text-primary' : 'text-muted-foreground/60'"
            >{{ day.weekday }}</span>

            <span class="relative h-2 flex-1 overflow-hidden rounded-full bg-muted/50">
              <span
                class="absolute inset-y-0 left-0 rounded-full transition-all duration-500"
                [style.width.%]="pct(day.minutes)"
                [style.background-color]="intensityColor(day.minutes)"
              ></span>
            </span>

            <span
              class="w-11 shrink-0 text-right font-mono text-[10px] font-semibold tabular-nums"
              [class]="day.minutes > 0 ? 'text-foreground/80' : 'text-muted-foreground/35'"
            >
              {{ day.minutes > 0 ? shortDuration(day.minutes) : '—' }}
            </span>
          </button>
        }
      </div>
    </section>
  `,
})
export class WeekHeatmapComponent {
  readonly days = input.required<HeatmapDay[]>();
  readonly goalMinutes = input(480);

  readonly daySelected = output<string>();

  readonly weekTotal = computed(() => this.days().reduce((sum, day) => sum + day.minutes, 0));

  readonly activeDays = computed(() => this.days().filter((day) => day.minutes > 0).length);

  pct(minutes: number): number {
    return Math.min(100, (minutes / Math.max(1, this.goalMinutes())) * 100);
  }

  intensityColor(minutes: number): string {
    if (minutes <= 0) return 'transparent';
    const ratio = minutes / Math.max(1, this.goalMinutes());
    if (ratio < 0.25) return 'hsl(var(--primary) / 0.35)';
    if (ratio < 0.5) return 'hsl(var(--primary) / 0.55)';
    if (ratio < 0.85) return 'hsl(var(--primary) / 0.8)';
    return 'hsl(var(--primary))';
  }

  tooltip(day: HeatmapDay): string {
    const tracked = day.minutes > 0 ? this.formatDuration(day.minutes) : 'nothing tracked';
    return `${day.weekday} ${day.date} · ${tracked}`;
  }

  shortDuration(minutes: number): string {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (h > 0) return m > 0 ? `${h}h${m}` : `${h}h`;
    return `${m}m`;
  }

  formatDuration(minutes: number): string {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
    return `${m}m`;
  }
}
