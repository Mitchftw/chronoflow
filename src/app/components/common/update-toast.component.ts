import { Component, ChangeDetectionStrategy, inject, signal, computed } from '@angular/core';
import { UpdateService } from '../../services/update.service';

interface ToastInfo {
  downloaded: boolean;
  version: string;
  releaseNotes: string | null;
}

@Component({
  selector: 'app-update-toast',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    @if (showToast(); as toast) {
      <div class="fixed bottom-5 right-5 z-50 w-[min(24rem,calc(100vw-2.5rem))]">
        <div
          class="relative overflow-hidden rounded-xl border border-border/40 bg-card/95 backdrop-blur-xl shadow-2xl animate-in fade-in zoom-in-95 duration-200"
          role="status"
        >
          <!-- Accent bar -->
          <div
            class="absolute inset-x-0 top-0 h-0.5"
            [class]="toast.downloaded ? 'bg-green-500' : 'bg-primary'"
          ></div>

          <div class="flex items-start gap-3 p-4 pt-5">
            <!-- Icon -->
            <div
              class="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full"
              [class]="
                toast.downloaded
                  ? 'bg-green-500/10 text-green-600 dark:text-green-400'
                  : 'bg-primary/10 text-primary'
              "
            >
              @if (toast.downloaded) {
                <svg class="size-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              } @else {
                <svg class="size-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                </svg>
              }
            </div>

            <!-- Body -->
            <div class="min-w-0 flex-1">
              <p class="text-sm font-bold text-foreground/95">
                @if (toast.downloaded) {
                  Update v{{ toast.version }} downloaded
                } @else {
                  Update available: v{{ toast.version }}
                }
              </p>
              @if (toast.releaseNotes) {
                <p class="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground/70">
                  {{ toast.releaseNotes }}
                </p>
              }
              @if (toast.downloaded) {
                <button
                  class="mt-2.5 inline-flex cursor-pointer items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-primary-foreground transition-colors hover:bg-primary/90"
                  (click)="updateService.quitAndInstall()"
                >
                  Restart &amp; Install
                </button>
              }
            </div>

            <!-- Dismiss -->
            <button
              class="shrink-0 cursor-pointer rounded-md p-1 text-muted-foreground/60 transition-colors hover:bg-secondary/60 hover:text-foreground"
              (click)="dismiss()"
              [attr.aria-label]="'Dismiss update notification'"
            >
              <svg class="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    }
  `,
})
export class UpdateToastComponent {
  protected readonly updateService = inject(UpdateService);

  /**
   * Versions the user dismissed, tracked per state (available vs.
   * downloaded). Dismissing the informational "available" toast never
   * suppresses the actionable "downloaded" one for the same version. The
   * toast reopens whenever a *different* version is announced, and every
   * app restart (these signals reset), so it always pops up again while an
   * update is pending.
   */
  private readonly dismissedAvailable = signal<string | null>(null);
  private readonly dismissedDownloaded = signal<string | null>(null);

  readonly showToast = computed<ToastInfo | null>(() => {
    const downloaded = this.updateService.updateDownloaded();
    if (downloaded && this.dismissedDownloaded() !== downloaded.version) {
      return {
        downloaded: true,
        version: downloaded.version,
        releaseNotes: downloaded.releaseNotes ?? null,
      };
    }
    const available = this.updateService.updateAvailable();
    if (available && this.dismissedAvailable() !== available.version) {
      return {
        downloaded: false,
        version: available.version,
        releaseNotes: available.releaseNotes ?? null,
      };
    }
    return null;
  });

  dismiss(): void {
    const toast = this.showToast();
    if (!toast) return;
    if (toast.downloaded) {
      this.dismissedDownloaded.set(toast.version);
    } else {
      this.dismissedAvailable.set(toast.version);
    }
  }
}
