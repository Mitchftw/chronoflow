import { Component, ChangeDetectionStrategy, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { IpcService } from '../../services/ipc.service';
import { SettingsService } from '../../services/settings.service';
import { TimerService } from '../../services/timer.service';

@Component({
  selector: 'app-title-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
 host: { class: 'flex items-center justify-between h-10 bg-card/75 border-b border-border/40 select-none' },
  template: `
    <div class="flex-1 h-full flex items-center gap-3 px-4 drag min-w-0">
      <!-- Brand -->
      <div class="flex items-center gap-2 text-muted-foreground shrink-0">
        <svg class="size-3.5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span class="text-[10px] font-bold tracking-widest uppercase font-sans">ChronoFlow</span>
        @if (isDev()) {
          <span
            class="ml-1 rounded-md border border-amber-500/40 bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest text-amber-500"
            title="Dev build: uses an isolated database (ChronoFlow-Dev)"
          >
            DEV
          </span>
        }
      </div>

      <!-- Live timer pill (visible on every page) -->
      @if (timer.isRunning()) {
        <button
          type="button"
          class="no-drag flex min-w-0 items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-2.5 py-1 text-primary transition-all duration-200 hover:bg-primary/20 active:scale-[0.98] cursor-pointer"
          (click)="goToDashboard()"
          title="Timer running: open the dashboard"
          aria-label="Timer running, open dashboard"
        >
          <span class="size-1.5 shrink-0 rounded-full bg-green-500 animate-pulse"></span>
          <span class="font-mono text-[11px] font-bold tabular-nums">{{ timer.formattedElapsed() }}</span>
          @if (timer.activeIssue()?.jiraIssueKey) {
            <span class="max-w-[9rem] truncate text-[10px] font-bold text-foreground/70">{{ timer.activeIssue()?.jiraIssueKey }}</span>
          }
        </button>
      }
    </div>

    <!-- Window controls -->
    <div class="flex items-center h-full no-drag shrink-0">
      <button
        class="flex items-center justify-center w-10 h-full text-muted-foreground hover:bg-secondary/80 hover:text-foreground transition-all duration-200"
        (click)="handleMinimize()"
        title="Minimize"
        aria-label="Minimize"
      >
        <svg class="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M20 12H4" />
        </svg>
      </button>
      <button
        class="flex items-center justify-center w-10 h-full text-muted-foreground hover:bg-secondary/80 hover:text-foreground transition-all duration-200"
        (click)="ipc.maximize()"
        title="Maximize"
        aria-label="Maximize"
      >
        <svg class="size-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
          <rect x="4" y="4" width="16" height="16" rx="2" />
        </svg>
      </button>
      <button
        class="flex items-center justify-center w-12 h-full text-muted-foreground hover:bg-red-500/20 hover:text-red-500 transition-all duration-200"
        (click)="ipc.close()"
        title="Close"
        aria-label="Close"
      >
        <svg class="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  `,
})
export class TitleBarComponent {
  readonly ipc = inject(IpcService);
  private settings = inject(SettingsService);
  protected timer = inject(TimerService);
  private router = inject(Router);
  readonly isDev = signal(false);

  constructor() {
    this.ipc.getIsDev().then((dev) => this.isDev.set(dev));
  }

  goToDashboard(): void {
    this.router.navigate(['/dashboard']);
  }

  async handleMinimize(): Promise<void> {
    // Create the always-on-top timer overlay
    await this.ipc.createTimerWindow(this.settings.settings().timerMode);
    this.ipc.minimize();
  }
}
