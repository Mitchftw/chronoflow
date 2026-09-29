import { Component, ChangeDetectionStrategy, input, output, inject, signal, effect, untracked, DestroyRef, ElementRef, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DecimalPipe, NgTemplateOutlet } from '@angular/common';
import { IpcService } from '../../services/ipc.service';
import { SearchBarComponent, type SearchResult } from '../common/search-bar.component';
import type { Issue } from '../../models/issue';
import { SettingsService } from '../../services/settings.service';
import { MediaService } from '../../droplets/media.service';
import { MediaPanelComponent } from '../../droplets/media-panel.component';
import { AgentsService } from '../../droplets/agents.service';
import { AgentsPanelComponent } from '../../droplets/agents-panel.component';

@Component({
  selector: 'app-notch-timer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SearchBarComponent, FormsModule, NgTemplateOutlet, DecimalPipe, MediaPanelComponent, AgentsPanelComponent],
  host: {
    class: 'block transition-[width,height] duration-300 ease-out',
    '[style.width.px]': 'width()',
    '[style.height.px]': 'height()',
  },
  template: `
    <div
      class="flex flex-col h-full w-full rounded-b-2xl border-x border-b border-white/15 bg-zinc-900/95 backdrop-blur-xl px-4 select-none relative group/notch shadow-2xl shadow-black/40"
      (mouseenter)="onMouseEnter()"
      (mouseleave)="onMouseLeave()"
    >
      <!-- Resize Handle (Left) -->
      <div
        class="absolute left-0 top-0 bottom-0 w-1.5 cursor-ew-resize hover:bg-primary/20 transition-colors z-50 no-drag"
        (mousedown)="onResizeStart($event, 'left')"
      ></div>

      <!-- Resize Handle (Right) -->
      <div
        class="absolute right-0 top-0 bottom-0 w-1.5 cursor-ew-resize hover:bg-primary/20 transition-colors z-50 no-drag"
        (mousedown)="onResizeStart($event, 'right')"
      ></div>

      <!-- Droplet chips (shared by the running and idle rows) -->
      <ng-template #dropletChips>
        @if (media.enabled() && media.hasSession()) {
          <button
            class="relative flex size-5.5 items-center justify-center overflow-hidden rounded-full border transition-all duration-200 hover:scale-105 active:scale-95 cursor-pointer"
            [class]="panel() === 'media' ? 'border-primary/60 bg-primary/20' : 'border-white/15 bg-white/5'"
            (click)="togglePanel('media')"
            [title]="media.title()"
            aria-label="Toggle now playing"
          >
            @if (media.coverUrl(); as cover) {
              <img [src]="cover" alt="" class="size-full object-cover" [class.opacity-60]="!media.isPlaying()" />
            } @else {
              <svg class="size-3 text-white/70" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                <path stroke-linecap="round" stroke-linejoin="round" d="M9 19V6l12-3v13M9 19a3 3 0 11-6 0 3 3 0 016 0zm12-3a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            }
          </button>
        }
        @if (agents.enabled() && agents.hasData()) {
          <button
            class="flex h-5.5 min-w-5.5 items-center justify-center rounded-full border px-1.5 text-[9px] font-bold tabular-nums transition-all duration-200 hover:scale-105 active:scale-95 cursor-pointer"
            [class]="panel() === 'agents' ? 'border-primary/60 bg-primary/20 text-white' : 'border-white/15 bg-white/5 text-white/80'"
            (click)="togglePanel('agents')"
            title="Agent usage (Codex / Claude)"
            aria-label="Toggle agent usage"
          >
            @if (agents.anyWorking()) {
              <span class="mr-1 size-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
            }
            @if (agents.peak() > 0 || !agents.anyWorking()) {
              {{ agents.peak() | number: '1.0-0' }}%
            }
          </button>
        }
      </ng-template>

      <!-- Top Row: Active Timer or Search Bar -->
      <div class="flex h-[38px] w-full items-center justify-between gap-3 shrink-0">
        @if (isRunning()) {
          <!-- Left: Indicator / Issue key -->
          <div class="flex items-center gap-2 min-w-0">
            <div class="flex size-5.5 shrink-0 items-center justify-center rounded-full bg-primary/15 border border-primary/30 relative">
              <span class="absolute inset-0 rounded-full bg-primary/35 animate-ping"></span>
              <svg 
                class="size-3 text-primary relative z-10 animate-pulse" 
                fill="none" 
                viewBox="0 0 24 24" 
                stroke="currentColor" 
                stroke-width="3"
              >
                <path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            @if (issueName()) {
              <span class="max-w-28 truncate text-[10px] font-bold text-zinc-300">{{ issueName() }}</span>
            } @else {
              <span class="text-[10px] font-bold text-zinc-400">Tracking</span>
            }
          </div>

          <!-- Center: Time -->
          <div class="font-mono text-[13px] font-bold text-emerald-400 drop-shadow-[0_0_8px_rgba(52,211,153,0.45)]">
            {{ formattedTime() }}
          </div>

          <!-- Right: Action Controls -->
          <div class="flex items-center gap-1.5 no-drag">
            <ng-container *ngTemplateOutlet="dropletChips" />
            <button
              class="flex size-5.5 items-center justify-center rounded-full bg-red-500/90 text-white transition-all duration-200 hover:scale-105 active:scale-95 shadow-md shadow-red-500/20 hover:bg-red-500 cursor-pointer"
              (click)="handleStop()"
              [disabled]="isStopping()"
              [class.opacity-50]="isStopping()"
              title="Stop timer"
              aria-label="Stop timer"
            >
              <svg class="size-2" fill="currentColor" viewBox="0 0 24 24">
                <rect x="6" y="6" width="12" height="12" rx="1.5" />
              </svg>
            </button>
            <button
              class="flex size-5.5 items-center justify-center rounded-full bg-white/5 text-white/70 transition-all duration-200 hover:scale-105 active:scale-95 hover:bg-white/15 hover:text-white cursor-pointer"
              (click)="expand.emit()"
              title="Open Main Window"
              aria-label="Expand"
            >
              <svg class="size-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3">
                <path stroke-linecap="round" stroke-linejoin="round" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
              </svg>
            </button>
            <button
              class="flex size-5.5 items-center justify-center rounded-full bg-white/5 text-white/70 transition-all duration-200 hover:scale-105 active:scale-95 hover:bg-red-500/20 hover:text-red-400 cursor-pointer"
              (click)="close.emit()"
              title="Stop & Close"
              aria-label="Close timer"
            >
              <svg class="size-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3">
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
                [placeholder]="'Search to start...'"
                [variant]="'notch'"
                (resultSelected)="resultSelected.emit($event)"
                (dropdownVisible)="onDropdownVisible($event)"
              />
            </div>
            <!-- Action Controls -->
            <div class="flex items-center gap-1.5 no-drag shrink-0">
            <ng-container *ngTemplateOutlet="dropletChips" />
              <button
                class="flex size-5.5 items-center justify-center rounded-full bg-white/5 text-white/70 transition-all duration-200 hover:scale-105 active:scale-95 hover:bg-white/15 hover:text-white cursor-pointer"
                (click)="expand.emit()"
                title="Open Main Window"
                aria-label="Expand"
              >
                <svg class="size-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                </svg>
              </button>
              <button
                class="flex size-5.5 items-center justify-center rounded-full bg-white/5 text-white/70 transition-all duration-200 hover:scale-105 active:scale-95 hover:bg-red-500/20 hover:text-red-400 cursor-pointer"
                (click)="close.emit()"
                title="Close"
                aria-label="Close timer"
              >
                <svg class="size-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        }
      </div>

      <!-- Droplet panels -->
      @if (panel() && !isStopping() && !dropdownOpen()) {
        <div class="mt-1 w-full border-t border-white/5 pt-3">
          @switch (panel()) {
            @case ('media') { <app-media-panel /> }
            @case ('agents') { <app-agents-panel /> }
          }
        </div>
      }

      <!-- Bottom Row: Note Entry Section (Expanded) -->
      @if (isStopping()) {
        <div class="mt-1 flex-1 w-full flex flex-col gap-2 py-1 no-drag border-t border-white/5 pt-2">
          <textarea
            #noteArea
            [(ngModel)]="stopNote"
            placeholder="Add a note about what you did..."
            class="w-full bg-zinc-900/50 border border-white/10 rounded-lg p-2 text-[11px] text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-primary/50 resize-none h-20"
            (keydown.enter)="$event.preventDefault(); confirmStop()"
            (keydown.escape)="cancelStop()"
          ></textarea>
          <div class="flex items-center justify-between pb-1">
             <span class="text-[9px] text-zinc-500 font-bold px-1">Timesheet Note</span>
             <div class="flex items-center gap-1.5">
               <button
                  class="text-[9px] font-bold text-zinc-400 hover:text-white transition-colors cursor-pointer px-2"
                  (click)="cancelStop()"
                >
                  Cancel
                </button>
                <button
                  class="rounded-lg bg-primary px-3 py-1 text-[9px] font-bold text-primary-foreground shadow-md shadow-primary/20 hover:scale-105 active:scale-95 transition-all cursor-pointer"
                  (click)="confirmStop()"
                >
                  Save & Stop
                </button>
             </div>
          </div>
        </div>
      }
    </div>
  `,
})
export class NotchTimerComponent {
  private ipc = inject(IpcService);
  protected media = inject(MediaService);
  protected agents = inject(AgentsService);
  private settings = inject(SettingsService);
  private lastSettingsSync = 0;

  constructor() {
    // The main window installs/removes droplets; pick that up without needing a hover.
    const poll = setInterval(() => void this.settings.load(), 3000);
    inject(DestroyRef).onDestroy(() => clearInterval(poll));

    // The agents page grows/shrinks with the number of live sessions.
    effect(() => {
      this.agents.sessions().length;
      if (untracked(() => this.panel()) === 'agents') untracked(() => this.syncWindow());
    });
  }

  private noteArea = viewChild<ElementRef<HTMLTextAreaElement>>('noteArea');

  isRunning = input(false);
  issueName = input<string | null>(null);
  formattedTime = input('00:00:00');
  localIssues = input<Issue[]>([]);

  start = output<void>();
  stop = output<string>();
  expand = output<void>();
  close = output<void>();
  resultSelected = output<SearchResult>();

  width = signal(324);
  height = signal(38);
  isStopping = signal(false);
  /** Droplet page (media) expanded under the top row. */
  panel = signal<'media' | 'agents' | null>(null);
  dropdownOpen = signal(false);
  stopNote = '';

  private isResizing = false;
  private startX = 0;
  private startWidth = 0;
  private resizeSide: 'left' | 'right' = 'right';

  onMouseEnter() {
    // The main window may have changed settings (e.g. a droplet toggle) since
    // this window loaded; refresh cheaply, at most every 5s.
    if (Date.now() - this.lastSettingsSync > 5000) {
      this.lastSettingsSync = Date.now();
      void this.settings.load();
    }
    this.ipc.setIgnoreMouse(false);
  }

  onMouseLeave() {
    if (!this.isResizing) {
      this.ipc.setIgnoreMouse(true);
    }
  }

  onResizeStart(event: MouseEvent, side: 'left' | 'right') {
    event.preventDefault();
    event.stopPropagation();
    
    this.isResizing = true;
    this.resizeSide = side;
    this.startX = event.screenX;
    this.startWidth = this.width();
    
    document.addEventListener('mousemove', this.onResizing);
    document.addEventListener('mouseup', this.onResizeEnd);
    
    // Ensure window doesn't ignore mouse during resize
    this.ipc.setIgnoreMouse(false);
  }

  private onResizing = (event: MouseEvent) => {
    if (!this.isResizing) return;
    
    const deltaX = event.screenX - this.startX;
    let newWidth = this.startWidth;

    if (this.resizeSide === 'right') {
      newWidth = this.startWidth + (deltaX * 2); // Double for center alignment
    } else {
      newWidth = this.startWidth - (deltaX * 2); // Double for center alignment
    }

    // Constraints
    newWidth = Math.max(200, Math.min(800, newWidth));
    
    if (newWidth !== this.width()) {
      this.width.set(newWidth);
      this.ipc.resizeTimerWindow(newWidth, this.height());
    }
  };

  private onResizeEnd = () => {
    this.isResizing = false;
    document.removeEventListener('mousemove', this.onResizing);
    document.removeEventListener('mouseup', this.onResizeEnd);
    this.ipc.setIgnoreMouse(true);
  };

  private static readonly BASE_HEIGHT = 38;
  private static readonly PANEL_HEIGHT = 150;
  private static readonly DROPDOWN_HEIGHT = 350;
  private static readonly STOP_HEIGHT = 200;

  // Last height requested from the main process. Growing happens immediately;
  // shrinking waits for the CSS transition so the window doesn't clip it.
  private windowHeight = NotchTimerComponent.BASE_HEIGHT;

  private targetHeight(): number {
    if (this.isStopping()) return NotchTimerComponent.STOP_HEIGHT;
    if (this.dropdownOpen()) return NotchTimerComponent.DROPDOWN_HEIGHT;
    if (this.panel() === 'agents') {
      // top row + limit cards (~80) + one row per live session (~34) + bottom breathing room
      const rows = this.agents.sessions().length;
      return 176 + (rows ? rows * 34 : 14);
    }
    if (this.panel()) return NotchTimerComponent.PANEL_HEIGHT;
    return NotchTimerComponent.BASE_HEIGHT;
  }

  /**
   * Single place that reconciles the visible state (search dropdown, stop note,
   * droplet panel) with the notch height and the auto-hide pin.
   */
  private syncWindow(): void {
    const target = this.targetHeight();
    this.height.set(target);

    // Cancel any pending shrink from a previous state change, otherwise a
    // stale timeout could resize the window after the user re-opened something.
    if (this.shrinkTimeout !== null) {
      clearTimeout(this.shrinkTimeout);
      this.shrinkTimeout = null;
    }

    // Pin open while anything interactive is showing so auto-hide never tucks
    // the notch away mid-interaction. Released immediately when all closed so
    // the parent's stop/hide handlers see the final pin state.
    this.ipc.setTimerWindowPinned(this.isStopping() || this.dropdownOpen() || this.panel() !== null);

    if (target >= this.windowHeight) {
      this.windowHeight = target;
      this.ipc.resizeTimerWindow(this.width(), target);
    } else {
      this.shrinkTimeout = setTimeout(() => {
        this.shrinkTimeout = null;
        const latest = this.targetHeight();
        this.windowHeight = latest;
        this.ipc.resizeTimerWindow(this.width(), latest);
      }, 300);
    }
  }

  private shrinkTimeout: ReturnType<typeof setTimeout> | null = null;

  togglePanel(which: 'media' | 'agents') {
    this.panel.update((cur) => (cur === which ? null : which));
    this.syncWindow();
  }

  onDropdownVisible(visible: boolean) {
    this.dropdownOpen.set(visible);
    // The search dropdown and the droplet panel share the space under the row.
    if (visible) this.panel.set(null);
    this.syncWindow();
  }

  handleStop() {
    this.stopNote = '';
    this.isStopping.set(true);
    this.syncWindow();

    // Use timeout to allow angular to render the textarea before focusing
    setTimeout(() => {
      this.noteArea()?.nativeElement.focus();
    }, 100);
  }

  cancelStop() {
    this.isStopping.set(false);
    this.syncWindow();
  }

  async confirmStop() {
    // Release the pin BEFORE emitting the parent stop, so by the time the
    // parent's handler runs (which may call `hideTimerWindow`), the main
    // process already sees the pin released.
    this.isStopping.set(false);
    this.syncWindow();
    this.stop.emit(this.stopNote); // Pass the stop note to parent
  }
}
