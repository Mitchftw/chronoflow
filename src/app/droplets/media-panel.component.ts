import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { MediaService } from './media.service';

/** Expanded page of the Media droplet: cover, track info, progress and controls. */
@Component({
  selector: 'app-media-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block no-drag' },
  template: `
    @if (media.hasSession()) {
      <div class="flex items-center gap-3">
        <div class="size-16 shrink-0 overflow-hidden rounded-xl bg-white/5 border border-white/10 flex items-center justify-center">
          @if (media.coverUrl(); as cover) {
            <img [src]="cover" alt="" class="size-full object-cover" />
          } @else {
            <svg class="size-6 text-white/30" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8">
              <path stroke-linecap="round" stroke-linejoin="round" d="M9 19V6l12-3v13M9 19a3 3 0 11-6 0 3 3 0 016 0zm12-3a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          }
        </div>
        <div class="min-w-0 flex-1">
          <p class="truncate text-[12px] font-bold text-zinc-100">{{ media.title() }}</p>
          <p class="truncate text-[10px] text-zinc-400">{{ media.artist() }}</p>
          @if (media.appName()) {
            <p class="truncate text-[9px] font-semibold uppercase tracking-wide text-zinc-500 mt-0.5">{{ media.appName() }}</p>
          }
        </div>
        <div class="flex items-center gap-1 shrink-0">
          <button
            class="flex size-7 items-center justify-center rounded-full text-white/70 hover:bg-white/10 hover:text-white transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-default"
            [disabled]="!media.state().canPrev"
            (click)="media.prev()"
            aria-label="Previous track"
          >
            <svg class="size-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M6 6h2v12H6zM20 6v12L9.5 12z" /></svg>
          </button>
          <button
            class="flex size-8 items-center justify-center rounded-full bg-white text-zinc-900 hover:scale-105 active:scale-95 transition-transform cursor-pointer"
            (click)="media.toggle()"
            [attr.aria-label]="media.isPlaying() ? 'Pause' : 'Play'"
          >
            @if (media.isPlaying()) {
              <svg class="size-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M6 5h4v14H6zM14 5h4v14h-4z" /></svg>
            } @else {
              <svg class="size-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
            }
          </button>
          <button
            class="flex size-7 items-center justify-center rounded-full text-white/70 hover:bg-white/10 hover:text-white transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-default"
            [disabled]="!media.state().canNext"
            (click)="media.next()"
            aria-label="Next track"
          >
            <svg class="size-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M16 6h2v12h-2zM4 6v12l10.5-6z" /></svg>
          </button>
        </div>
      </div>
      @if (media.progress(); as p) {
        <div class="mt-3 h-1 w-full overflow-hidden rounded-full bg-white/10">
          <div class="h-full rounded-full bg-white/70" [style.width.%]="p * 100"></div>
        </div>
      }
    } @else {
      <p class="py-6 text-center text-[11px] text-zinc-500">Nothing playing</p>
    }
  `,
})
export class MediaPanelComponent {
  protected media = inject(MediaService);
}
