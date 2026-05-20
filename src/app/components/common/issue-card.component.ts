import { Component, ChangeDetectionStrategy, input, output, computed } from '@angular/core';
import type { Issue } from '../../models/issue';

@Component({
  selector: 'app-issue-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div
      class="flex items-center gap-4 rounded-2xl border border-border/40 bg-card/65 px-5 py-4 transition-all duration-300 hover:bg-secondary/45 hover:border-primary/20 hover:shadow-sm backdrop-blur-md select-none relative"
      [class]="issue().isRunning ? 'border-primary/30 bg-primary/[0.02]' : ''"
    >
      <!-- Timer start/running button -->
      <button
        class="flex size-9 shrink-0 items-center justify-center rounded-xl border border-border/50 text-muted-foreground/80 transition-all duration-300 hover:scale-105 active:scale-95 cursor-pointer"
        [class]="issue().isRunning 
          ? 'bg-primary text-primary-foreground border-primary shadow-lg shadow-primary/25' 
          : 'hover:border-primary hover:text-primary'"
        (click)="startTimer.emit(issue().id)"
        [attr.aria-label]="issue().isRunning ? 'Timer active' : 'Start timer for ' + issue().title"
        [title]="issue().isRunning ? 'Timer running' : 'Start timer'"
      >
        @if (issue().isRunning) {
          <span class="flex size-2 rounded-full bg-white animate-pulse"></span>
        } @else {
          <svg class="size-4 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
            <path d="M8 5v14l11-7z" />
          </svg>
        }
      </button>

      <!-- Issue info -->
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2 flex-wrap">
          <span class="truncate text-sm font-semibold text-foreground/95">
            @if (issue().jiraIssueKey) {
              <span class="text-primary mr-1.5">{{ issue().jiraIssueKey }}</span>
            }
            {{ issue().title }}
          </span>
        </div>

        <div class="mt-2.5 flex flex-wrap items-center gap-3 text-xs text-muted-foreground/80">
          <!-- Project badge -->
          @if (issue().projectId) {
            <span
              class="inline-flex items-center gap-1.5 rounded-lg bg-secondary/80 px-2.5 py-0.5 text-[10px] font-bold text-foreground/90 border border-border/20"
            >
              <span class="size-2 rounded-full" [style.background-color]="projectColor()"></span>
              {{ projectName() }}
            </span>
          }

          <!-- Status badge -->
          <span
            class="inline-flex rounded-lg px-2.5 py-0.5 text-[10px] font-bold border"
            [class]="statusClass()"
          >
            {{ statusLabel() }}
          </span>

          <!-- Estimate -->
          @if (issue().estimate > 0) {
            <span class="flex items-center gap-1 font-medium">
              <svg class="size-3.5 text-muted-foreground/60" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                <path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Est: {{ formatEstimate(issue().estimate) }}
            </span>
          }

          <!-- Time spent -->
          @if (issue().timeSpent > 0) {
            <span class="flex items-center gap-1 font-medium text-primary">
              <svg class="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                <path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Tracked: {{ formatTimeSpent(issue().timeSpent) }}
            </span>
          }

          <!-- Created date -->
          <span class="text-muted-foreground/60 font-medium ml-auto sm:ml-0">{{ formatDate(issue().createdAt) }}</span>
        </div>
      </div>

      <!-- Actions -->
      <div class="flex items-center gap-1.5 z-10">
        @if (issue().jiraIssueKey) {
          <button
            class="flex size-8 items-center justify-center rounded-xl text-muted-foreground/70 hover:bg-secondary/80 hover:text-foreground transition-all duration-200 cursor-pointer"
            title="Open in Jira"
            (click)="openInJira.emit(issue().id)"
          >
            <svg class="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </button>
        }
        <button
          class="flex size-8 items-center justify-center rounded-xl text-muted-foreground/70 hover:bg-red-500/20 hover:text-red-500 transition-all duration-200 cursor-pointer"
          title="Delete issue"
          (click)="delete.emit(issue().id)"
        >
          <svg class="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
      </div>
    </div>
  `,
})
export class IssueCardComponent {
  /** The issue to display */
  readonly issue = input.required<Issue>();

  /** Project name (passed from parent for efficiency) */
  readonly projectName = input<string>('');

  /** Project color (passed from parent) */
  readonly projectColor = input<string>('var(--color-primary)');

  /** Emitted when user clicks the start timer button */
  readonly startTimer = output<string>();

  /** Emitted when user clicks delete */
  readonly delete = output<string>();

  /** Emitted when user clicks open in Jira */
  readonly openInJira = output<string>();

  private readonly statusLabels: Record<string, string> = {
    todo: 'Todo',
    in_progress: 'In Progress',
    done: 'Done',
  };

  readonly statusLabel = computed(() => {
    return this.statusLabels[this.issue().status] ?? this.issue().status;
  });

  readonly statusClass = computed(() => {
    switch (this.issue().status) {
      case 'in_progress':
        return 'bg-primary/10 text-primary border-primary/20';
      case 'done':
        return 'bg-green-500/10 text-green-500 border-green-500/20';
      default: // todo
        return 'bg-muted/40 text-muted-foreground border-border/30';
    }
  });

  formatEstimate(minutes: number): string {
    if (minutes < 60) return `${minutes}m`;
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }

  formatTimeSpent(seconds: number): string {
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }

  formatDate(timestamp: number): string {
    const d = new Date(timestamp);
    const now = new Date();
    const diffDays = Math.floor(
      (now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24),
    );

    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
}
