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
 * Week overview as a tinted heatmap: one cell per day, opacity encoding how
 * much of the daily goal was tracked, so a whole week's gaps read at a glance.
 * Clicking a cell navigates the dashboard to that day.
 */
@Component({
  selector: 'app-week-heatmap',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block select-none' },
  template: `
    <section class="app-card p-4">
      <div class="mb-3 flex items-center justify-between">
        <span class="text-[10px] font-semibold text-muted-foreground">This week</span>
        <span class="text-[10px] font-medium text-muted-foreground">
          <b class="font-mono font-semibold tabular-nums text-foreground">{{ formatDuration(weekTotal()) }}</b>
          · {{ activeDays() }}/7 days
        </span>
      </div>

      <div class="grid grid-cols-7 gap-1.5">
        @for (day of days(); track day.date) {
          <button
            type="button"
            class="group flex flex-col items-center gap-1.5 rounded-lg p-1 transition-all duration-200 cursor-pointer"
            (click)="daySelected.emit(day.date)"
            [title]="tooltip(day)"
            [attr.aria-label]="tooltip(day)"
            [attr.aria-current]="day.isSelected ? 'date' : undefined"
          >
            <span
              class="text-[10px] font-semibold"
              [class]="day.isToday || day.isSelected ? 'text-primary' : 'text-muted-foreground'"
            >{{ day.weekday }}</span>

            <span
              class="relative flex h-11 w-full items-center justify-center rounded-lg border transition-all duration-300"
              [class]="cellClass(day)"
              [style.background-color]="cellColor(day)"
            >
              <span
                class="font-mono text-[11px] font-semibold tabular-nums"
                [class]="day.minutes > 0 ? 'text-foreground' : 'text-muted-foreground'"
              >{{ day.dayNumber }}</span>
            </span>
          </button>
        }
      </div>

      <div class="mt-3 flex items-center justify-end gap-1.5 text-[10px] font-medium text-muted-foreground">
        <span>Less</span>
        <span class="size-2.5 rounded-[3px] bg-muted"></span>
        <span class="size-2.5 rounded-[3px]" [style.background-color]="intensityColor(goalMinutes() * 0.15)"></span>
        <span class="size-2.5 rounded-[3px]" [style.background-color]="intensityColor(goalMinutes() * 0.4)"></span>
        <span class="size-2.5 rounded-[3px]" [style.background-color]="intensityColor(goalMinutes() * 0.7)"></span>
        <span class="size-2.5 rounded-[3px]" [style.background-color]="intensityColor(goalMinutes())"></span>
        <span>More</span>
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

  cellColor(day: HeatmapDay): string | null {
    if (day.minutes <= 0) return null;
    return this.intensityColor(day.minutes);
  }

  cellClass(day: HeatmapDay): string {
    if (day.isSelected) return 'border-primary ring-2 ring-primary/30';
    if (day.isToday) return 'border-primary/50';
    return day.minutes > 0 ? 'border-transparent' : 'border-border/60 bg-muted/40';
  }

  intensityColor(minutes: number): string {
    if (minutes <= 0) return 'transparent';
    const ratio = minutes / Math.max(1, this.goalMinutes());
    if (ratio < 0.25) return 'hsl(var(--primary) / 0.22)';
    if (ratio < 0.5) return 'hsl(var(--primary) / 0.42)';
    if (ratio < 0.85) return 'hsl(var(--primary) / 0.68)';
    return 'hsl(var(--primary) / 0.9)';
  }

  tooltip(day: HeatmapDay): string {
    const tracked = day.minutes > 0 ? this.formatDuration(day.minutes) : 'nothing tracked';
    return `${day.weekday}, ${day.date}: ${tracked}`;
  }

  formatDuration(minutes: number): string {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
    return `${m}m`;
  }
}
