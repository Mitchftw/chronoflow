import { Injectable, OnDestroy, computed, effect, inject, signal, untracked } from '@angular/core';
import type { AgentsState, UsageWindow } from '../../types';
import { DropletRegistryService } from './droplet-registry.service';

export interface UsageRing {
  label: string;
  /** 0..100, already 0 when the window has reset since the last reading. */
  percent: number;
  resetsInMs: number | null;
}

/** Renderer side of the Agents droplet (currently Codex plan limits). */
@Injectable({ providedIn: 'root' })
export class AgentsService implements OnDestroy {
  private registry = inject(DropletRegistryService);

  private readonly _state = signal<AgentsState>({ codex: { available: false }, claude: { available: false, scriptPath: '' }, sessions: [] });
  private readonly now = signal(Date.now());
  private unsubscribe: (() => void) | null = null;
  private ticker: ReturnType<typeof setInterval> | null = null;

  readonly enabled = computed(() => this.registry.isEnabled('agents'));
  readonly codexAvailable = computed(() => this._state().codex.available);
  readonly codexWorking = computed(() => !!this._state().codex.working);
  readonly sessions = computed(() => this._state().sessions ?? []);
  /** Any live Claude Code / Codex session mid-turn. */
  readonly anyWorking = computed(() => this.sessions().some((s) => s.working) || this.codexWorking());

  private rings(primary?: UsageWindow, secondary?: UsageWindow): UsageRing[] {
    const now = this.now();
    const ring = (label: string, w?: UsageWindow): UsageRing | null => {
      if (!w) return null;
      const resetsInMs = w.resetsAt * 1000 - now;
      // The reading is from the agent's last event; if the window has reset
      // since then, the real usage is back to 0.
      return { label, percent: resetsInMs <= 0 ? 0 : Math.min(100, w.usedPercent), resetsInMs: resetsInMs > 0 ? resetsInMs : null };
    };
    return [ring('5h', primary), ring('Week', secondary)].filter((r): r is UsageRing => r !== null);
  }

  readonly codexRings = computed<UsageRing[]>(() => this.rings(this._state().codex.primary, this._state().codex.secondary));
  readonly claudeRings = computed<UsageRing[]>(() => this.rings(this._state().claude.primary, this._state().claude.secondary));
  readonly claudeAvailable = computed(() => this._state().claude.available);
  readonly claudeScriptPath = computed(() => this._state().claude.scriptPath);

  /** Highest of all known windows, for the compact chip. */
  readonly peak = computed(() => Math.max(0, ...this.codexRings().map((r) => r.percent), ...this.claudeRings().map((r) => r.percent)));
  readonly hasData = computed(() => this.codexRings().length > 0 || this.claudeRings().length > 0 || this.sessions().length > 0);

  constructor() {
    effect(() => {
      const on = this.enabled();
      untracked(() => (on ? this.connect() : this.disconnect()));
    });
  }

  ngOnDestroy(): void {
    this.disconnect();
  }

  private async connect(): Promise<void> {
    const api = window.electronAPI?.agents;
    if (!api || this.unsubscribe) return;
    this.unsubscribe = api.onState((s) => this._state.set(s));
    const res = await api.setEnabled(true);
    if (res?.state) this._state.set(res.state);
    this.ticker = setInterval(() => this.now.set(Date.now()), 30_000);
  }

  private disconnect(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.ticker) clearInterval(this.ticker);
    this.ticker = null;
    void window.electronAPI?.agents?.setEnabled(false);
  }
}
