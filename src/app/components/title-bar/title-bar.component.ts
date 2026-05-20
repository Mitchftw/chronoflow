import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { IpcService } from '../../services/ipc.service';
import { SettingsService } from '../../services/settings.service';
import { TimerService } from '../../services/timer.service';

@Component({
  selector: 'app-title-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex items-center justify-between h-10 bg-card/75 backdrop-blur-xl border-b border-border/40 select-none' },
  template: `
    <div class="flex-1 h-full flex items-center px-4 drag">
      <div class="flex items-center gap-2 text-muted-foreground/80">
        <svg class="size-3.5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span class="text-[10px] font-bold tracking-widest uppercase font-sans">ChronoFlow</span>
      </div>
    </div>
    <div class="flex items-center h-full no-drag">
      <button
        class="flex items-center justify-center w-10 h-full text-muted-foreground/70 hover:bg-secondary/80 hover:text-foreground transition-all duration-200"
        (click)="handleMinimize()"
        title="Minimize"
        aria-label="Minimize"
      >
        <svg class="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M20 12H4" />
        </svg>
      </button>
      <button
        class="flex items-center justify-center w-10 h-full text-muted-foreground/70 hover:bg-secondary/80 hover:text-foreground transition-all duration-200"
        (click)="ipc.maximize()"
        title="Maximize"
        aria-label="Maximize"
      >
        <svg class="size-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
          <rect x="4" y="4" width="16" height="16" rx="2" />
        </svg>
      </button>
      <button
        class="flex items-center justify-center w-12 h-full text-muted-foreground/70 hover:bg-red-500/20 hover:text-red-500 transition-all duration-200"
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
  private timer = inject(TimerService);

  async handleMinimize(): Promise<void> {
    // Create the always-on-top timer overlay
    await this.ipc.createTimerWindow(this.settings.settings().timerMode);
    this.ipc.minimize();
  }
}
