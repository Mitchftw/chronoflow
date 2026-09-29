import { Component, ChangeDetectionStrategy, input, computed } from '@angular/core';

export interface DashboardStats {
  todayTimeMs: number;
  projectCount: number;
  issueCount: number;
  completedCount: number;
  /** Daily target in minutes (used for the progress bar + remaining card). */
  goalMinutes: number;
}

@Component({
  selector: 'app-stats-cards',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex flex-col gap-3 select-none' },
  template: `
    <!-- Tracked vs daily goal (remaining lives here too: same number, one card) -->
    <div class="app-card app-card-interactive p-4">
      <div class="flex items-center justify-between">
        <p class="text-[10px] font-semibold text-muted-foreground">Tracked today</p>
        <span class="text-primary">
          <svg class="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </span>
      </div>
      <div class="mt-1.5 flex items-end justify-between gap-3">
        <p class="font-mono text-2xl font-bold tracking-tight tabular-nums text-foreground">{{ formatMs(stats().todayTimeMs) }}</p>
        <span class="mb-0.5 font-mono text-[11px] font-semibold tabular-nums text-muted-foreground">{{ goalPct() }}%</span>
      </div>
      <div class="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-muted/60">
        <div
          class="h-full rounded-full transition-all duration-500"
          [class]="overGoal() ? 'bg-green-500' : 'bg-primary'"
          [style.width.%]="barPct()"
        ></div>
      </div>
      <p class="mt-2 text-[11px] font-medium" [class]="overGoal() ? 'text-green-600' : 'text-muted-foreground'">
        @if (overGoal()) {
          {{ remainingLabel() }} past your {{ goalLabel() }} goal
        } @else {
          {{ remainingLabel() }} left of your {{ goalLabel() }} goal
        }
      </p>
    </div>

    <!-- Projects + Issues row -->
    <div class="grid grid-cols-2 gap-3">
      <div class="app-card app-card-interactive p-4">
        <div class="flex items-center justify-between">
          <p class="text-[10px] font-semibold text-muted-foreground">Projects</p>
          <span class="text-primary">
            <svg class="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            </svg>
          </span>
        </div>
        <p class="mt-1.5 font-mono text-2xl font-bold tracking-tight tabular-nums text-foreground">{{ stats().projectCount }}</p>
      </div>

      <div class="app-card app-card-interactive p-4">
        <div class="flex items-center justify-between">
          <p class="text-[10px] font-semibold text-muted-foreground">Issues</p>
          <span class="text-primary">
            <svg class="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
          </span>
        </div>
        <p class="mt-1.5 font-mono text-2xl font-bold tracking-tight tabular-nums text-foreground">{{ stats().issueCount }}</p>
        <p class="mt-0.5 text-[11px] font-medium text-muted-foreground">
          <span class="font-semibold text-green-600">{{ stats().completedCount }}</span> done
        </p>
      </div>
    </div>
  `,
})
export class StatsCardsComponent {
  stats = input.required<DashboardStats>();

  private readonly goalMs = computed(() => Math.max(1, this.stats().goalMinutes) * 60000);

  readonly goalPct = computed(() =>
    Math.min(999, Math.round((this.stats().todayTimeMs / this.goalMs()) * 100)),
  );

  readonly barPct = computed(() =>
    Math.min(100, (this.stats().todayTimeMs / this.goalMs()) * 100),
  );

  readonly overGoal = computed(() => this.stats().todayTimeMs >= this.goalMs());

  readonly goalLabel = computed(() => this.formatMs(this.goalMs()));

  readonly remainingLabel = computed(() =>
    this.formatMs(Math.abs(this.goalMs() - this.stats().todayTimeMs)),
  );

  formatMs(ms: number): string {
    const minutes = Math.floor(ms / 60000);
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (hours > 0) return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
    return `${mins}m`;
  }
}
