import { Injectable, OnDestroy, computed, effect, inject, signal, untracked } from '@angular/core';
import type { MediaState } from '../../types';
import { DropletRegistryService } from './droplet-registry.service';

/**
 * Renderer side of the Media droplet. The main process pushes a state update
 * whenever the track/status changes (and every ~5s as a resync); between
 * updates the progress is interpolated locally so the bar moves smoothly.
 */
@Injectable({ providedIn: 'root' })
export class MediaService implements OnDestroy {
  private registry = inject(DropletRegistryService);

  private readonly _state = signal<MediaState>({ active: false });
  private readonly now = signal(Date.now());
  private receivedAt = Date.now();
  private unsubscribe: (() => void) | null = null;
  private ticker: ReturnType<typeof setInterval> | null = null;

  readonly state = this._state.asReadonly();
  readonly enabled = computed(() => this.registry.isEnabled('media'));
  readonly isPlaying = computed(() => this._state().active && this._state().status === 'playing');
  /** Something worth showing: an active session with a title or a known app. */
  readonly hasSession = computed(() => this._state().active && this._state().status !== 'stopped');

  readonly title = computed(() => this._state().title || this.appName() || 'Unknown');
  readonly artist = computed(() => this._state().artist || this._state().album || '');
  readonly appName = computed(() => {
    const id = this._state().app ?? '';
    if (/spotify/i.test(id)) return 'Spotify';
    if (/chrome/i.test(id)) return 'Chrome';
    if (/msedge/i.test(id)) return 'Edge';
    if (/firefox/i.test(id)) return 'Firefox';
    if (/applemusic|itunes/i.test(id)) return 'Apple Music';
    if (/photos/i.test(id)) return 'Photos';
    return '';
  });
  readonly coverUrl = computed(() => {
    const s = this._state();
    return s.cover ? `data:${s.coverMime || 'image/jpeg'};base64,${s.cover}` : null;
  });

  /** Progress 0..1, or null when the source doesn't report a duration. */
  readonly progress = computed(() => {
    const s = this._state();
    if (!s.durationMs || s.durationMs <= 0 || s.positionMs === undefined) return null;
    const drift = s.status === 'playing' ? this.now() - this.receivedAt : 0;
    return Math.min(1, Math.max(0, (s.positionMs + drift) / s.durationMs));
  });

  constructor() {
    effect(() => {
      const on = this.enabled();
      untracked(() => (on ? this.connect() : this.disconnect()));
    });
  }

  ngOnDestroy(): void {
    this.disconnect();
  }

  toggle(): void {
    window.electronAPI?.media?.command('toggle');
  }
  next(): void {
    window.electronAPI?.media?.command('next');
  }
  prev(): void {
    window.electronAPI?.media?.command('prev');
  }

  private async connect(): Promise<void> {
    const api = window.electronAPI?.media;
    if (!api || this.unsubscribe) return;
    this.unsubscribe = api.onState((s) => this.apply(s));
    const res = await api.setEnabled(true);
    if (res?.state) this.apply(res.state);
    this.ticker = setInterval(() => {
      if (this.isPlaying()) this.now.set(Date.now());
    }, 500);
  }

  private disconnect(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.ticker) clearInterval(this.ticker);
    this.ticker = null;
    this._state.set({ active: false });
    void window.electronAPI?.media?.setEnabled(false);
  }

  private apply(s: MediaState): void {
    this.receivedAt = Date.now();
    this.now.set(this.receivedAt);
    // The bridge only sends the cover when it changes/loads; keep the previous
    // one for the same track so a status-only update doesn't blank the art.
    const prev = this._state();
    const sameTrack = prev.title === s.title && prev.artist === s.artist && prev.app === s.app;
    this._state.set(!s.cover && sameTrack && prev.cover ? { ...s, cover: prev.cover, coverMime: prev.coverMime } : s);
  }
}
