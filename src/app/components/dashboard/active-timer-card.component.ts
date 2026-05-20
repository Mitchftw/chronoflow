import { Component, ChangeDetectionStrategy, input, output, inject } from '@angular/core';
import { SearchBarComponent, type SearchResult } from '../common/search-bar.component';
import { TimerService } from '../../services/timer.service';
import type { Issue } from '../../models/issue';

@Component({
  selector: 'app-active-timer-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SearchBarComponent],
  host: {
    class: 'rounded-2xl border border-border/40 bg-card/65 p-6 md:p-8 min-h-[140px] flex flex-col justify-center backdrop-blur-md shadow-sm relative z-10 select-none',
  },
  template: `
    @if (isRunning()) {
      <div class="absolute -right-24 -top-24 size-48 rounded-full bg-primary/10 blur-3xl pointer-events-none"></div>
      
      <div class="flex items-center justify-between z-10 w-full">
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2">
            <span class="size-2 rounded-full bg-green-500 animate-pulse"></span>
            <p class="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/80">
              Currently Tracking
            </p>
          </div>

          @if (issueName()) {
            <p class="mt-2.5 truncate text-xs font-semibold text-foreground/90 bg-secondary/60 rounded-lg px-2.5 py-1 w-fit border border-border/20">
              @if (timer.activeIssue()?.jiraIssueKey) {
                <span class="text-primary mr-1.5">{{ timer.activeIssue()?.jiraIssueKey }}</span>
              }
              {{ issueName() }}
            </p>
          }

          <p class="mt-3.5 font-mono text-4xl font-extrabold tracking-tight text-primary drop-shadow-[0_0_12px_rgba(59,130,246,0.35)] transition-all duration-300">
            {{ formattedTime() }}
          </p>
        </div>

        <div class="flex items-center gap-3">
          <button
            class="inline-flex items-center gap-2 rounded-xl bg-destructive px-4.5 py-2.5 text-sm font-semibold text-destructive-foreground transition-all duration-300 hover:scale-105 active:scale-95 shadow-md shadow-destructive/20 hover:bg-destructive/95 cursor-pointer"
            (click)="stop.emit()"
          >
            <svg class="size-4" fill="currentColor" viewBox="0 0 24 24">
              <rect x="6" y="6" width="12" height="12" rx="1.5" />
            </svg>
            Stop
          </button>
        </div>
      </div>
    } @else {
      <div class="flex flex-col gap-5 z-10 w-full">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <span class="size-2 rounded-full bg-muted-foreground/40"></span>
            <p class="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/80">
              Timer Inactive
            </p>
          </div>
          <p class="font-mono text-2xl font-extrabold tracking-tight text-muted-foreground/60">
            00:00:00
          </p>
        </div>

        <!-- Inline autocomplete search bar -->
        <div class="w-full max-w-xl">
          <app-search-bar
            [localIssues]="localIssues()"
            [placeholder]="'Search Jira/local issues, or type to start a new task...'"
            (resultSelected)="resultSelected.emit($event)"
          />
        </div>
      </div>
    }
  `,
})
export class ActiveTimerCardComponent {
  protected timer = inject(TimerService);
  isRunning = input(false);
  issueName = input<string | null>(null);
  formattedTime = input('00:00:00');
  localIssues = input<Issue[]>([]);

  stop = output<void>();
  resultSelected = output<SearchResult>();
}
