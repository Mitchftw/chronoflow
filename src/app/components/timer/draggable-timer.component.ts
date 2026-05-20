import { Component, ChangeDetectionStrategy, input, output } from '@angular/core';
import { SearchBarComponent, type SearchResult } from '../common/search-bar.component';
import type { Issue } from '../../models/issue';

@Component({
  selector: 'app-draggable-timer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SearchBarComponent],
  host: {
    class: 'block',
  },
  template: `
    <div
      class="flex items-center gap-4 rounded-2xl border border-white/15 bg-zinc-950 p-4 drag select-none"
      style="width: 320px;"
    >
      @if (isRunning()) {
        <!-- Timer icon -->
        <div class="flex size-9.5 shrink-0 items-center justify-center rounded-xl bg-primary/15 border border-primary/30 relative">
          <span class="absolute inset-0 rounded-xl bg-primary/25 animate-pulse"></span>
          <svg class="size-4.5 text-primary relative z-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>

        <!-- Info -->
        <div class="flex-1 min-w-0">
          @if (issueName()) {
            <p class="truncate text-[10px] font-bold uppercase tracking-wider text-zinc-400">{{ issueName() }}</p>
          } @else {
            <p class="truncate text-[10px] font-bold uppercase tracking-wider text-zinc-400">Tracking</p>
          }
          <p class="font-mono text-lg font-black tracking-tight text-emerald-400 mt-0.5">
            {{ formattedTime() }}
          </p>
        </div>

        <!-- Controls -->
        <div class="flex items-center gap-1.5 no-drag">
          <button
            class="flex size-8.5 items-center justify-center rounded-xl bg-red-500/20 border border-red-500/35 text-red-500 transition-all duration-300 hover:bg-red-500 hover:text-white hover:scale-105 active:scale-95 cursor-pointer shadow-sm"
            (click)="stop.emit()"
            aria-label="Stop timer"
          >
            <svg class="size-3.5" fill="currentColor" viewBox="0 0 24 24">
              <rect x="6" y="6" width="12" height="12" rx="1.5" />
            </svg>
          </button>
          <button
            class="flex size-8.5 items-center justify-center rounded-xl text-zinc-400 transition-all duration-300 hover:bg-white/10 hover:text-white active:scale-95 cursor-pointer"
            (click)="close.emit()"
            aria-label="Close timer"
          >
            <svg class="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      } @else {
        <!-- Stopped: search to start a task -->
        <div class="flex-1 w-full flex items-center justify-between gap-2">
          <div class="flex-1 min-w-0">
            <app-search-bar
              [localIssues]="localIssues()"
              [placeholder]="'Search to start task...'"
              [variant]="'draggable'"
              (resultSelected)="resultSelected.emit($event)"
            />
          </div>
          <!-- Close button -->
          <div class="flex items-center gap-1.5 no-drag shrink-0">
            <button
              class="flex size-8.5 items-center justify-center rounded-xl text-zinc-400 transition-all duration-300 hover:bg-white/10 hover:text-white active:scale-95 cursor-pointer"
              (click)="close.emit()"
              aria-label="Close timer"
            >
              <svg class="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      }
    </div>
  `,
})
export class DraggableTimerComponent {
  isRunning = input(false);
  issueName = input<string | null>(null);
  formattedTime = input('00:00:00');
  localIssues = input<Issue[]>([]);

  start = output<void>();
  stop = output<void>();
  close = output<void>();
  resultSelected = output<SearchResult>();
}
