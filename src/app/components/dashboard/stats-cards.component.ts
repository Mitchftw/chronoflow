import { Component, ChangeDetectionStrategy, input } from '@angular/core';

export interface DashboardStats {
  todayTimeMs: number;
  projectCount: number;
  issueCount: number;
  completedCount: number;
}

@Component({
  selector: 'app-stats-cards',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4 select-none' },
  template: `
    <div class="group relative rounded-2xl border border-border/40 bg-card/65 p-5 shadow-sm transition-all duration-300 hover:shadow-md hover:border-primary/20 backdrop-blur-md">
      <div class="flex items-center justify-between mb-2">
        <p class="text-xs font-bold uppercase tracking-wider text-muted-foreground/80">Today Tracked</p>
        <span class="text-primary group-hover:scale-110 transition-transform duration-300">
          <svg class="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </span>
      </div>
      <p class="text-2xl font-extrabold tracking-tight text-foreground">{{ formatDuration(stats().todayTimeMs) }}</p>
    </div>

    <div class="group relative rounded-2xl border border-border/40 bg-card/65 p-5 shadow-sm transition-all duration-300 hover:shadow-md hover:border-primary/20 backdrop-blur-md">
      <div class="flex items-center justify-between mb-2">
        <p class="text-xs font-bold uppercase tracking-wider text-muted-foreground/80">Projects</p>
        <span class="text-primary group-hover:scale-110 transition-transform duration-300">
          <svg class="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
          </svg>
        </span>
      </div>
      <p class="text-2xl font-extrabold tracking-tight text-foreground">{{ stats().projectCount }}</p>
    </div>

    <div class="group relative rounded-2xl border border-border/40 bg-card/65 p-5 shadow-sm transition-all duration-300 hover:shadow-md hover:border-primary/20 backdrop-blur-md">
      <div class="flex items-center justify-between mb-2">
        <p class="text-xs font-bold uppercase tracking-wider text-muted-foreground/80">Total Issues</p>
        <span class="text-primary group-hover:scale-110 transition-transform duration-300">
          <svg class="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
        </span>
      </div>
      <p class="text-2xl font-extrabold tracking-tight text-foreground">{{ stats().issueCount }}</p>
    </div>

    <div class="group relative rounded-2xl border border-border/40 bg-card/65 p-5 shadow-sm transition-all duration-300 hover:shadow-md hover:border-primary/20 backdrop-blur-md">
      <div class="flex items-center justify-between mb-2">
        <p class="text-xs font-bold uppercase tracking-wider text-muted-foreground/80">Efficiency</p>
        <span class="text-primary group-hover:scale-110 transition-transform duration-300">
          <svg class="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </span>
      </div>
      <p class="text-2xl font-extrabold tracking-tight text-foreground">{{ efficiency }}</p>
    </div>
  `,
})
export class StatsCardsComponent {
  stats = input.required<DashboardStats>();

  get efficiency(): string {
    const s = this.stats();
    if (s.issueCount === 0) return '0%';
    const pct = Math.round((s.completedCount / s.issueCount) * 100);
    return `${pct}%`;
  }

  formatDuration(ms: number): string {
    const hours = Math.floor(ms / 3600000);
    const minutes = Math.floor((ms % 3600000) / 60000);
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  }
}
