import { Injectable, inject, signal, computed } from '@angular/core';
import { IpcService } from './ipc.service';
import { SettingsService } from './settings.service';
import type { Issue } from '../models/issue';
import type { TimeEntry } from '../models/time-entry';
import type { TimerState } from '../../types';

@Injectable({ providedIn: 'root' })
export class TimerService {
  private ipc = inject(IpcService);
  private settings = inject(SettingsService);

  private readonly _timerState = signal<TimerState | null>(null);
  private readonly _activeIssue = signal<Issue | null>(null);
  private readonly _elapsedMs = signal(0);
  private readonly _loading = signal(false);
  private tickInterval: ReturnType<typeof setInterval> | null = null;

  readonly timerState = this._timerState.asReadonly();
  readonly activeIssue = this._activeIssue.asReadonly();
  readonly loading = this._loading.asReadonly();

  readonly isRunning = computed(() => this._timerState()?.isRunning ?? false);
  readonly issueId = computed(() => this._timerState()?.issueId ?? null);

  readonly formattedElapsed = computed(() => {
    const ms = this._elapsedMs();
    const hours = Math.floor(ms / 3600000);
    const minutes = Math.floor((ms % 3600000) / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  });

  readonly elapsedHuman = computed(() => {
    const ms = this._elapsedMs();
    const hours = Math.floor(ms / 3600000);
    const minutes = Math.floor((ms % 3600000) / 60000);
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  });

  constructor() {
    this.restoreState();
    this.ipc.onTimerWindowStateUpdate((state) => {
      this.handleStateUpdate(state);
    });
  }

  private async handleStateUpdate(state: TimerState): Promise<void> {
    this._timerState.set(state);
    if (state && state.isRunning) {
      if (state.isPaused) {
        this.stopTick();
        this._elapsedMs.set(state.elapsed * 1000);
      } else {
        const startMs = state.startTime ?? Date.now();
        this.startTick(Date.now() - startMs);
      }
      if (state.issueId) {
        const active = this._activeIssue();
        if (!active || active.id !== state.issueId) {
          const issues = await this.ipc.getIssues();
          const issue = issues.find((i) => i.id === state.issueId);
          if (issue) this._activeIssue.set(issue);
        }
      }
    } else {
      this.stopTick();
      this._activeIssue.set(null);
      this._elapsedMs.set(state ? state.elapsed * 1000 : 0);
    }
  }

  private async restoreState(): Promise<void> {
    try {
      const state = await this.ipc.getTimerState();
      if (state) {
        await this.handleStateUpdate(state);
      }
    } catch (err) {
      console.error('Failed to restore timer state', err);
    }
  }

  private startTick(initialMs: number): void {
    this._elapsedMs.set(Math.max(0, initialMs));
    this.stopTick();
    this.tickInterval = setInterval(() => {
      this._elapsedMs.update((ms) => ms + 1000);
    }, 1000);
  }

  private stopTick(): void {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
  }

  async start(issueId: string): Promise<boolean> {
    this._loading.set(true);
    try {
      const res = await this.ipc.startTimer(issueId);
      if (res.success && res.data) {
        const state = res.data as TimerState;
        this._timerState.set(state);
        this.startTick(0);
        const issues = await this.ipc.getIssues();
        const issue = issues.find((i) => i.id === issueId);
        if (issue) this._activeIssue.set(issue);
        return true;
      }
      return false;
    } catch (err) {
      console.error('Failed to start timer', err);
      return false;
    } finally {
      this._loading.set(false);
    }
  }

  async stop(note: string = '', stopTime?: number): Promise<boolean> {
    this._loading.set(true);
    try {
      const res = await this.ipc.stopTimer(note, stopTime);
      this.stopTick();
      this._timerState.set(null);
      this._activeIssue.set(null);
      this._elapsedMs.set(0);
      return res.success;
    } catch (err) {
      console.error('Failed to stop timer', err);
      return false;
    } finally {
      this._loading.set(false);
    }
  }

  setIssue(issue: Issue): void {
    this._activeIssue.set(issue);
  }
}
