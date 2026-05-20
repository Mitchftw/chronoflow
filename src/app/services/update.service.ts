import { Injectable, inject, signal, computed, DestroyRef } from '@angular/core';

export interface UpdateInfo {
  version: string;
  releaseDate?: string;
  releaseNotes?: string;
}

@Injectable({ providedIn: 'root' })
export class UpdateService {
  private readonly destroyRef = inject(DestroyRef);

  /** Whether an update is available for download */
  private readonly _updateAvailable = signal<UpdateInfo | null>(null);
  readonly updateAvailable = this._updateAvailable.asReadonly();

  /** Whether an update has been downloaded and is ready to install */
  private readonly _updateDownloaded = signal<UpdateInfo | null>(null);
  readonly updateDownloaded = this._updateDownloaded.asReadonly();

  /** Derived: whether any update is pending (downloaded or available) */
  readonly hasUpdate = computed(() => this._updateAvailable() !== null || this._updateDownloaded() !== null);

  constructor() {
    this.listenForUpdates();

    this.destroyRef.onDestroy(() => {
      this.cleanupListeners();
    });
  }

  /** Quit the app and install the downloaded update */
  async quitAndInstall(): Promise<void> {
    const api = this.getUpdaterApi();
    if (!api) return;

    try {
      await api.quitAndInstall();
    } catch {
      // Fallback: if no API available, do nothing
      console.warn('Update service: quitAndInstall not available');
    }
  }

  /** Check for updates manually */
  async checkForUpdates(): Promise<void> {
    const api = this.getUpdaterApi();
    if (!api) return;

    try {
      await api.checkForUpdates();
    } catch {
      // Fallback silently
    }
  }

  // ── Internal ──

  private cleanupFns: Array<() => void> = [];

  private listenForUpdates(): void {
    // Listen for update events dispatched from the preload/main process
    const handleAvailable = ((event: CustomEvent<UpdateInfo>) => {
      if (event.detail) {
        this._updateAvailable.set(event.detail);
      }
    }) as EventListener;

    const handleDownloaded = ((event: CustomEvent<UpdateInfo>) => {
      if (event.detail) {
        this._updateDownloaded.set(event.detail);
        this._updateAvailable.set(null); // No longer just "available"
      }
    }) as EventListener;

    window.addEventListener('app:update-available', handleAvailable);
    window.addEventListener('app:update-downloaded', handleDownloaded);

    this.cleanupFns.push(() => window.removeEventListener('app:update-available', handleAvailable));
    this.cleanupFns.push(() => window.removeEventListener('app:update-downloaded', handleDownloaded));
  }

  private cleanupListeners(): void {
    for (const fn of this.cleanupFns) {
      try {
        fn();
      } catch {
        // Ignore cleanup errors
      }
    }
    this.cleanupFns = [];
  }

  private getUpdaterApi() {
    return (window as any).electronAPI?.updater ?? null;
  }
}
