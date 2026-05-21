import { Component, ChangeDetectionStrategy, input, output, inject, signal, ElementRef, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IpcService } from '../../services/ipc.service';
import { SearchBarComponent, type SearchResult } from '../common/search-bar.component';
import type { Issue } from '../../models/issue';

@Component({
  selector: 'app-notch-timer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SearchBarComponent, FormsModule],
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
              <span class="max-w-28 truncate text-[10px] font-bold uppercase tracking-wider text-zinc-300">{{ issueName() }}</span>
            } @else {
              <span class="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Tracking</span>
            }
          </div>

          <!-- Center: Time -->
          <div class="font-mono text-[13px] font-bold tracking-widest text-emerald-400 drop-shadow-[0_0_8px_rgba(52,211,153,0.45)]">
            {{ formattedTime() }}
          </div>

          <!-- Right: Action Controls -->
          <div class="flex items-center gap-1.5 no-drag">
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
             <span class="text-[9px] text-zinc-500 font-bold uppercase tracking-widest px-1">Timesheet Note</span>
             <div class="flex items-center gap-1.5">
               <button
                  class="text-[9px] font-bold uppercase tracking-wider text-zinc-400 hover:text-white transition-colors cursor-pointer px-2"
                  (click)="cancelStop()"
                >
                  Cancel
                </button>
                <button
                  class="rounded-lg bg-primary px-3 py-1 text-[9px] font-bold uppercase tracking-wider text-primary-foreground shadow-md shadow-primary/20 hover:scale-105 active:scale-95 transition-all cursor-pointer"
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
  stopNote = '';

  private isResizing = false;
  private startX = 0;
  private startWidth = 0;
  private resizeSide: 'left' | 'right' = 'right';

  onMouseEnter() {
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

  onDropdownVisible(visible: boolean) {
    const targetHeight = visible ? 350 : 38;
    this.height.set(targetHeight);
    
    if (visible) {
      // Expand immediately so animation is visible
      this.ipc.resizeTimerWindow(this.width(), targetHeight);
    } else {
      // Delay window shrink until CSS transition finishes
      setTimeout(() => {
        if (!this.isStopping() && !visible) {
          this.ipc.resizeTimerWindow(this.width(), 38);
        }
      }, 300);
    }
  }

  handleStop() {
    this.stopNote = '';
    this.isStopping.set(true);
    
    // Total height for timer row (38) + spacing (4) + note section (~150)
    const expandedHeight = 200;
    this.height.set(expandedHeight);
    this.ipc.resizeTimerWindow(this.width(), expandedHeight);

    // Use timeout to allow angular to render the textarea before focusing
    setTimeout(() => {
      this.noteArea()?.nativeElement.focus();
    }, 100);
  }

  cancelStop() {
    this.isStopping.set(false);
    this.height.set(38);
    // Delay window shrink
    setTimeout(() => {
      if (!this.isStopping()) {
        this.ipc.resizeTimerWindow(this.width(), 38);
      }
    }, 300);
  }

  async confirmStop() {
    this.stop.emit(this.stopNote); // Pass the stop note to parent
    this.isStopping.set(false);
    this.height.set(38);
    // Delay window shrink
    setTimeout(() => {
      if (!this.isStopping()) {
        this.ipc.resizeTimerWindow(this.width(), 38);
      }
    }, 300);
  }
}
