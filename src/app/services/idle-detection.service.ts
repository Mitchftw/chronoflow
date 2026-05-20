import { Injectable, inject, signal, computed, DestroyRef, effect } from '@angular/core';
import { TimerService } from './timer.service';
import { SettingsService } from './settings.service';

export interface IdleState {
  isIdle: boolean;
  idleSeconds: number;
  startTime: number | null;
  thresholdSeconds: number;
}

export interface IdlePromptDecision {
  shouldPrompt: boolean;
  idleSeconds: number;
  startTime: number;
}

@Injectable({ providedIn: 'root' })
export class IdleDetectionService {
  private readonly timerService = inject(TimerService);
  private readonly settingsService = inject(SettingsService);
  private readonly destroyRef = inject(DestroyRef);

  /** Current idle state */
  private readonly _idleState = signal<IdleState>({
    isIdle: false,
    idleSeconds: 0,
    startTime: null,
    thresholdSeconds: this.parseThreshold(0),
  });
  readonly idleState = this._idleState.asReadonly();

  /** Derived: whether the user is idle and a timer is running (candidate for prompt) */
  readonly hasIdleTimer = computed(() => {
    const state = this._idleState();
    return state.isIdle && this.timerService.isRunning();
  });

  /** Poll interval handle */
  private pollInterval: ReturnType<typeof setInterval> | null = null;

  /** Threshold in seconds from settings (default: 5 minutes = 300s) */
  private thresholdSeconds = 300;

  /** Power event cleanup functions */
  private powerCleanups: Array<() => void> = [];

  /** Track prompt open state externally */
  private _isPromptOpen = false;

  /** Timestamp stored when idle starts for power/suspend tracking */
  private idleStartTimestamp: number | null = null;

  constructor() {
    this.startPolling();
    this.setupPowerEventListeners();

    // Sync threshold with settings
    effect(() => {
      const minutes = this.settingsService.settings().idleThresholdMinutes;
      this.updateThreshold(minutes);
    });

    this.destroyRef.onDestroy(() => {
      this.stopPolling();
      this.cleanupPowerListeners();
    });
  }

  /** Set the prompt open state */
  setPromptOpen(open: boolean): void {
    this._isPromptOpen = open;
  }

  /** Get the prompt open state */
  get isPromptOpen(): boolean {
    return this._isPromptOpen;
  }

  /** Check whether we should show the idle prompt */
  shouldPromptForIdle(): IdlePromptDecision | null {
    const state = this._idleState();
    if (!this.timerService.isRunning() || this._isPromptOpen) return null;
    if (state.idleSeconds < state.thresholdSeconds) return null;

    return {
      shouldPrompt: true,
      idleSeconds: state.idleSeconds,
      startTime: state.startTime ?? Date.now() - state.idleSeconds * 1000,
    };
  }

  /**
   * Check if we should prompt from a stored timestamp
   * (e.g., after returning from suspend/lock)
   */
  shouldPromptFromStoredTimestamp(): IdlePromptDecision | null {
    if (!this.idleStartTimestamp) return null;
    if (!this.timerService.isRunning() || this._isPromptOpen) return null;

    const now = Date.now();
    const awaySeconds = Math.floor((now - this.idleStartTimestamp) / 1000);
    if (awaySeconds < this.thresholdSeconds) return null;

    return {
      shouldPrompt: true,
      idleSeconds: awaySeconds,
      startTime: this.idleStartTimestamp,
    };
  }

  /** Update threshold from settings (pass 0 to disable) */
  updateThreshold(minutes: number): void {
    this.thresholdSeconds = this.parseThreshold(minutes);
    this._idleState.update((s) => ({ ...s, thresholdSeconds: this.thresholdSeconds }));
  }

  /** Reset idle state (e.g., after user interaction detected) */
  resetIdle(): void {
    this._idleState.update((s) => ({
      ...s,
      isIdle: false,
      idleSeconds: 0,
      startTime: null,
    }));
    this.idleStartTimestamp = null;
  }

  // ── Internal ──

  private startPolling(): void {
    this.stopPolling();
    this.poll();

    // Poll every 30 seconds when timer is running
    this.pollInterval = setInterval(() => this.poll(), 30_000);
  }

  private stopPolling(): void {
    if (this.pollInterval !== null) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  private async poll(): Promise<void> {
    const timerRunning = this.timerService.isRunning();
    if (!timerRunning) return;

    const api = this.getIdleApi();
    if (!api) {
      // Fallback: if idle API not available, mark as not idle
      this.resetIdle();
      return;
    }

    try {
      const idleSeconds = await api.getTime();
      this._idleState.update((s) => ({
        ...s,
        isIdle: idleSeconds >= this.thresholdSeconds && this.thresholdSeconds > 0,
        idleSeconds,
        startTime: idleSeconds >= this.thresholdSeconds
          ? Date.now() - idleSeconds * 1000
          : s.startTime,
        thresholdSeconds: this.thresholdSeconds,
      }));
    } catch {
      // Graceful fallback
    }
  }

  private setupPowerEventListeners(): void {
    const api = this.getIdleApi();
    if (!api) return;

    // Suspend: store timestamp for later comparison
    const cleanupSuspend = api.onPowerSuspend(() => {
      this.idleStartTimestamp = Date.now();
    });
    this.powerCleanups.push(cleanupSuspend);

    // Resume: check if we were away long enough to prompt
    const cleanupResume = api.onPowerResume(() => {
      const decision = this.shouldPromptFromStoredTimestamp();
      if (decision) {
        this._idleState.update((s) => ({
          ...s,
          isIdle: true,
          idleSeconds: decision.idleSeconds,
          startTime: decision.startTime,
        }));
      }
    });
    this.powerCleanups.push(cleanupResume);

    // Lock: like suspend, store the timestamp
    const cleanupLock = api.onPowerLock(() => {
      this.idleStartTimestamp = Date.now();
    });
    this.powerCleanups.push(cleanupLock);

    // Unlock: check if we were away long enough
    const cleanupUnlock = api.onPowerUnlock(() => {
      const decision = this.shouldPromptFromStoredTimestamp();
      if (decision) {
        this._idleState.update((s) => ({
          ...s,
          isIdle: true,
          idleSeconds: decision.idleSeconds,
          startTime: decision.startTime,
        }));
      }
    });
    this.powerCleanups.push(cleanupUnlock);
  }

  private cleanupPowerListeners(): void {
    for (const cleanup of this.powerCleanups) {
      try {
        cleanup();
      } catch {
        // Ignore cleanup errors
      }
    }
    this.powerCleanups = [];
  }

  private getIdleApi() {
    return (window as any).electronAPI?.idle ?? null;
  }

  private parseThreshold(minutes: number): number {
    if (minutes <= 0) return 0; // Disabled
    return minutes * 60;
  }
}
