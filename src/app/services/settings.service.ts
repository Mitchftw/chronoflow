import { Injectable, inject, signal, computed, DestroyRef } from '@angular/core';
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
  /** Auto-hide the notch window so it only shows when the mouse approaches
   *  the top of the screen (remote-desktop-taskbar style). Notch mode only. */
  autoHideNotch: boolean;
  /** Display the notch should appear on when multiple monitors are in use.
   *  null = auto: follow the main window's display (fallback: primary). */
  notchDisplayId: number | null;
  /** Default hours logged per workday when filling a vacation range on a
   *  Jira "verlof" ticket from /vacation. */
  defaultVacationHours: number;
  /** Target tracked hours per workday, used for the dashboard daily goal and
   *  the week overview bars. */
  dailyGoalHours: number;
  /** Optional remembered Jira key (e.g. `VERL-12`) that prefills the issue
   *  picker on /vacation. Null = no remembered ticket (user picks each time). */
  defaultVacationIssueKey: string | null;
  /** Which island droplets are switched on (id → enabled). Missing = default. */
  droplets: Record<string, boolean>;
}

@Injectable({ providedIn: 'root' })
export class SettingsService {
  private ipc = inject(IpcService);
  private readonly destroyRef = inject(DestroyRef);

  private readonly systemThemeQuery =
    typeof window !== 'undefined'
      ? window.matchMedia('(prefers-color-scheme: dark)')
      : null;

  private readonly _systemDark = signal(this.systemThemeQuery?.matches ?? false);
  /** Live OS dark-mode preference; updates when the user changes it. */
  readonly systemDark = this._systemDark.asReadonly();

  private readonly _settings = signal<AppSettings>({
    themePreference: 'system',
    autoStartTimer: true,
    roundTo15Min: false,
    idleThresholdMinutes: 5,
    timerMode: 'draggable',
    autoUpdate: true,
    autoHideNotch: false,
    notchDisplayId: null,
    defaultVacationHours: 8,
    dailyGoalHours: 8,
    defaultVacationIssueKey: null,
    droplets: {},
  });

  readonly settings = this._settings.asReadonly();

  /** Set when an optimistic settings save failed and was rolled back. */
  readonly saveError = signal<string | null>(null);

  readonly resolvedTheme = computed<'light' | 'dark'>(() => {
    const pref = this._settings().themePreference;
    if (pref === 'light' || pref === 'dark') return pref;
    return this._systemDark() ? 'dark' : 'light';
  });

  constructor() {
    const query = this.systemThemeQuery;
    if (query) {
      const onChange = (event: MediaQueryListEvent): void => {
        this._systemDark.set(event.matches);
      };
      query.addEventListener('change', onChange);
      this.destroyRef.onDestroy(() => query.removeEventListener('change', onChange));
    }
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
    const previous = this._settings();
    const previousMode = previous.timerMode;
    this.saveError.set(null);
    this._settings.update((s) => ({ ...s, ...partial }));
    try {
      await this.ipc.setSettings('app', { ...this._settings() });
    } catch (err) {
      console.error('Failed to save settings', err);
      // Optimistic updates must not lie about persisted state: roll back the
      // in-memory object and let the settings page surface a small error.
      this._settings.set(previous);
      this.saveError.set('Could not save settings. Your change was reverted.');
      return;
    }
    // If the timerMode setting changed, propagate it to the currently-open
    // timer window. No-op in the main process if window is closed, so
    // toggling the setting alone won't pop the overlay. We isolate this in
    // its own try/catch so a window-sync failure doesn't masquerade as a
    // settings-save failure in the user's logs.
    if (
      partial.timerMode !== undefined &&
      partial.timerMode !== previousMode
    ) {
      try {
        await this.ipc.applyTimerMode(this._settings().timerMode);
      } catch (err) {
        console.error('Failed to apply timer mode to open window', err);
      }
    }
    // Propagate the auto-hide preference to the main process. Safe to call
    // even if the notch window isn't open — main process just stores the flag.
    if (partial.autoHideNotch !== undefined) {
      try {
        await this.ipc.applyNotchAutoHide(this._settings().autoHideNotch);
      } catch (err) {
        console.error('Failed to apply notch auto-hide to main process', err);
      }
    }
    // Propagate the chosen display to the main process (moves the live notch
    // window if one is open; otherwise stored for the next creation).
    if (partial.notchDisplayId !== undefined) {
      try {
        await this.ipc.applyNotchDisplay(this._settings().notchDisplayId);
      } catch (err) {
        console.error('Failed to apply notch display to main process', err);
      }
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
