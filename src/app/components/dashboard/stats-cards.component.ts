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
    <!-- Tracked vs daily goal -->
    <div class="app-card app-card-interactive p-4">
      <div class="flex items-center justify-between">
        <p class="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">Tracked today</p>
        <span class="text-primary">
          <svg class="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </span>
      </div>
      <div class="mt-1.5 flex items-end justify-between gap-3">
        <p class="text-2xl font-extrabold tracking-tight text-foreground">{{ formatMs(stats().todayTimeMs) }}</p>
        <span class="mb-0.5 text-[10px] font-bold text-muted-foreground/60">{{ goalPct() }}%</span>
      </div>
      <div class="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-muted/60">
        <div
          class="h-full rounded-full transition-all duration-500"
          [class]="overGoal() ? 'bg-green-500' : 'bg-primary'"
          [style.width.%]="barPct()"
        ></div>
      </div>
      <p class="mt-2 text-[10px] font-semibold text-muted-foreground/60">of {{ goalLabel() }} goal</p>
    </div>

    <!-- Remaining / overtime -->
    <div class="app-card app-card-interactive p-4">
      <div class="flex items-center justify-between">
        <p class="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">{{ overGoal() ? 'Overtime' : 'Remaining' }}</p>
        <span [class]="overGoal() ? 'text-green-500' : 'text-primary'">
          @if (overGoal()) {
            <svg class="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
          } @else {
            <svg class="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
        </span>
      </div>
      <p class="mt-1.5 text-2xl font-extrabold tracking-tight" [class]="overGoal() ? 'text-green-500' : 'text-foreground'">
        {{ remainingLabel() }}
      </p>
      <p class="mt-2 text-[10px] font-semibold text-muted-foreground/60">
        {{ overGoal() ? 'past your daily goal' : 'to reach your daily goal' }}
      </p>
    </div>

    <!-- Projects + Issues row -->
    <div class="grid grid-cols-2 gap-3">
      <div class="app-card app-card-interactive p-4">
        <div class="flex items-center justify-between">
          <p class="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">Projects</p>
          <span class="text-primary">
            <svg class="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            </svg>
          </span>
        </div>
        <p class="mt-1.5 text-2xl font-extrabold tracking-tight text-foreground">{{ stats().projectCount }}</p>
      </div>

      <div class="app-card app-card-interactive p-4">
        <div class="flex items-center justify-between">
          <p class="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">Issues</p>
          <span class="text-primary">
            <svg class="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
          </span>
        </div>
        <p class="mt-1.5 text-2xl font-extrabold tracking-tight text-foreground">{{ stats().issueCount }}</p>
        <p class="mt-0.5 text-[10px] font-semibold text-muted-foreground/60">
          <span class="font-bold text-green-500">{{ stats().completedCount }}</span> done
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
