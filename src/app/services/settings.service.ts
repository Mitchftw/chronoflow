import { Injectable, inject, signal, computed } from '@angular/core';
import { IpcService } from './ipc.service';

export type ThemePreference = 'light' | 'dark' | 'system';
export type TimerMode = 'draggable' | 'notch';

export interface AppSettings {
  themePreference: ThemePreference;
  autoStartTimer: boolean;
  roundTo15Min: boolean;
  idleThresholdMinutes: number;
  timerMode: TimerMode;
  autoUpdate: boolean;
}

@Injectable({ providedIn: 'root' })
export class SettingsService {
  private ipc = inject(IpcService);

  private readonly _settings = signal<AppSettings>({
    themePreference: 'system',
    autoStartTimer: true,
    roundTo15Min: false,
    idleThresholdMinutes: 5,
    timerMode: 'draggable',
    autoUpdate: true,
  });

  readonly settings = this._settings.asReadonly();

  readonly resolvedTheme = computed<'light' | 'dark'>(() => {
    const pref = this._settings().themePreference;
    if (pref === 'light' || pref === 'dark') return pref;
    return window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
  });

  constructor() {
    this.load();
  }

  async load(): Promise<void> {
    try {
      const stored = await this.ipc.getSettings();
      if (stored && Object.keys(stored).length > 0) {
        this._settings.set({
          ...this._settings(),
          ...(stored as Partial<AppSettings>),
        });
      }
    } catch (err) {
      console.error('Failed to load settings', err);
    }
  }

  async update(partial: Partial<AppSettings>): Promise<void> {
    this._settings.update((s) => ({ ...s, ...partial }));
    try {
      await this.ipc.setSettings('app', { ...this._settings() });
    } catch (err) {
      console.error('Failed to save settings', err);
    }
  }

  toggleDarkMode(): void {
    const current = this._settings().themePreference;
    const next: ThemePreference =
      current === 'dark' ? 'light' : current === 'light' ? 'system' : 'dark';
    this.update({ themePreference: next });
  }

  toggleAutoStart(): void {
    this.update({ autoStartTimer: !this._settings().autoStartTimer });
  }

  applyTheme(theme: 'light' | 'dark'): void {
    document.documentElement.classList.remove('light', 'dark');
    document.documentElement.classList.add(theme);
  }
}
