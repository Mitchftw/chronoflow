import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  effect,
  computed,
  HostListener,
  OnDestroy,
} from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { TitleBarComponent } from './components/title-bar/title-bar.component';
import { SideNavComponent } from './components/side-nav/side-nav.component';
import { SettingsService } from './services/settings.service';
import { IpcService } from './services/ipc.service';
import { IdleDetectionService } from './services/idle-detection.service';
import { TimerService } from './services/timer.service';
import { DatabaseService } from './services/database.service';
import { UpdateService } from './services/update.service';
import { IdlePromptComponent } from './components/common/idle-prompt.component';
import { DialogComponent } from './components/common/dialog.component';
import { SearchBarComponent, SearchResult } from './components/common/search-bar.component';
import { UpdateToastComponent } from './components/common/update-toast.component';
import { pad2, toLocalDate } from './utils/time';

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterOutlet,
    TitleBarComponent,
    SideNavComponent,
    IdlePromptComponent,
    DialogComponent,
    SearchBarComponent,
    UpdateToastComponent,
  ],
  host: {
    class: 'flex h-screen flex-col text-foreground',
    '[class.bg-background]': 'isMainWindow',
    '[style.background]': 'isMainWindow ? null : "transparent"',
    '[class.dark]': 'isDark()',
  },
  template: `
    @if (isMainWindow) {
      <app-title-bar />

      <div class="flex flex-1 overflow-hidden">
        <app-side-nav
          [collapsed]="sideNavCollapsed()"
          (toggleCollapse)="toggleSideNav()"
        />

        <main class="flex-1 overflow-y-auto select-text">
          <div class="mx-auto w-full max-w-[1560px] px-6 pt-8 pb-12">
            <router-outlet />
          </div>
        </main>
      </div>

      <!-- Update notification toast -->
      <app-update-toast />

      <!-- Idle prompt -->
      <app-idle-prompt
        [visible]="showIdlePrompt()"
        [idleSeconds]="idleSeconds()"
        (keep)="onIdleKeep()"
        (discard)="onIdleDiscard()"
        (assign)="onIdleAssignPrompt()"
      />

      <!-- Assign Idle Time Dialog -->
      <app-dialog
        [(isOpen)]="showAssignDialog"
        title="Assign Idle Time"
        confirmLabel="Assign & Resume"
        [confirmDisabled]="!selectedAssignedIssueId()"
        (confirm)="onConfirmAssign()"
        (close)="onCloseAssign()"
      >
        <div class="space-y-4">
          <p class="text-sm text-muted-foreground">
            Select the issue to book your idle time (<strong>{{ formattedIdleTime() }}</strong>) to.
            The current active timer will be split and resumed on your original issue.
          </p>
          <div class="relative z-30 mt-2 min-h-[220px]">
            <app-search-bar
              [(query)]="selectedAssignedIssueQuery"
              [localIssues]="issues()"
              (resultSelected)="handleAssignIssueSelection($event)"
              placeholder="Search or create issue..."
            />
          </div>
        </div>
      </app-dialog>
    } @else {
      <!-- Timer overlay in separate BrowserWindow - render outlet full screen -->
      <router-outlet />
    }
  `,
})
export class AppComponent implements OnDestroy {
  private settings = inject(SettingsService);
  private ipc = inject(IpcService);
  private idleDetection = inject(IdleDetectionService);
  private timerService = inject(TimerService);
  private db = inject(DatabaseService);
  private updateService = inject(UpdateService);

  /** Manual sidebar preference toggled by the user. */
  private readonly manualSideNavCollapsed = signal(false);
  /** Auto-collapsed while the window is too narrow for a comfortable layout. */
  private readonly autoSideNavCollapsed = signal(isNarrowViewport());
  /** Effective collapsed state: manual choice wins only when it is collapsed. */
  readonly sideNavCollapsed = computed(
    () => this.manualSideNavCollapsed() || this.autoSideNavCollapsed(),
  );
  private lastNarrowViewport = isNarrowViewport();

  isDark = signal(false);

  readonly showIdlePrompt = signal(false);
  readonly idleSeconds = signal(0);
  readonly idleStartTime = signal<number | null>(null);

  readonly showAssignDialog = signal(false);
  readonly selectedAssignedIssueId = signal('');
  readonly selectedAssignedIssueQuery = signal('');

  readonly issues = this.db.issues;

  readonly formattedIdleTime = computed(() => {
    const totalSeconds = this.idleSeconds();
    if (totalSeconds < 60) return `${totalSeconds} seconds`;
    const minutes = Math.floor(totalSeconds / 60);
    if (minutes < 60) {
      const secs = totalSeconds % 60;
      return secs > 0 ? `${minutes}m ${secs}s` : `${minutes} minutes`;
    }
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins > 0 ? `${hours}h ${mins}m` : `${hours} hours`;
  });

  /** The timer-overlay route is loaded in a separate BrowserWindow — skip shell there */
  readonly isMainWindow =
    !window.location.href.includes('timer-overlay') &&
    !window.location.href.includes('windowType=timer');

  private timerStateCleanup: (() => void) | null = null;
  private modalKeyGuardCleanup: (() => void) | null = null;
  private lastTimerEntryId: string | null = null;

  /**
   * Capture-phase guard for modal overlays. Keyboard shortcuts are registered
   * on window/document by pages (e.g. the dashboard day navigation), so a
   * modal must stop them before they reach those handlers. Keys typed inside
   * the modal itself are never blocked, and Escape/Tab/Enter/Space (plus
   * modifier combos) remain available for normal dialog interaction.
   */
  private readonly guardModalKeydown = (event: KeyboardEvent): void => {
    if (event.defaultPrevented || event.isComposing) return;

    const overlays = Array.from(
      document.querySelectorAll<HTMLElement>(
        'app-idle-prompt [role="dialog"], app-dialog [role="dialog"]',
      ),
    );
    if (overlays.length === 0) return;

    const target = event.target instanceof Node ? event.target : null;
    if (target && overlays.some((overlay) => overlay.contains(target))) {
      return;
    }

    const key = event.key;
    if (
      key === 'Escape' ||
      key === 'Tab' ||
      key === 'Enter' ||
      key === ' ' ||
      key === 'Spacebar' ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey
    ) {
      return;
    }

    event.stopPropagation();
    event.stopImmediatePropagation();
  };

  constructor() {
    if (!this.isMainWindow) {
      // Timer overlay window needs transparent body for always-on-top overlay
      document.documentElement.classList.add('timer-window-active');
      document.body.classList.add('timer-window-active');
      document.body.style.background = 'transparent';
    } else {
      // Load issues and sync state on main window startup
      this.db.loadAll();

      // Block page-level shortcuts behind modal overlays. Capture phase runs
      // before any bubble-phase HostListener on window/document.
      window.addEventListener('keydown', this.guardModalKeydown, true);
      this.modalKeyGuardCleanup = () =>
        window.removeEventListener('keydown', this.guardModalKeydown, true);

      // Listen for timer state updates from the main process. Reload time
      // entries when the timer stops (dashboard needs the new entry) and when
      // midnight rollover swaps the running entry under us.
      this.lastTimerEntryId = this.timerService.timerState()?.entryId ?? null;
      this.timerStateCleanup = this.ipc.onTimerWindowStateUpdate((state) => {
        const entryChanged = state.entryId !== this.lastTimerEntryId;
        this.lastTimerEntryId = state.entryId;
        const stopped = !state.isRunning && !state.isPaused;
        if (stopped || entryChanged) {
          void this.db.reloadTimeEntries();
        }
      });
    }

    effect(() => {
      const theme = this.settings.resolvedTheme();
      this.isDark.set(theme === 'dark');
      this.settings.applyTheme(theme);
    });

    effect(() => {
      // Track idle state and decision to prompt
      const state = this.idleDetection.idleState();
      const decision = this.idleDetection.shouldPromptForIdle();
      if (decision && !this.showIdlePrompt() && !this.showAssignDialog()) {
        this.idleSeconds.set(decision.idleSeconds);
        this.idleStartTime.set(decision.startTime);
        this.showIdlePrompt.set(true);
        this.idleDetection.setPromptOpen(true);
      }
    });
  }

  @HostListener('window:resize')
  onWindowResize(): void {
    const narrow = isNarrowViewport();
    const crossedThreshold = narrow !== this.lastNarrowViewport;
    if (!crossedThreshold) return;
    this.lastNarrowViewport = narrow;
    this.autoSideNavCollapsed.set(narrow);
  }

  /**
   * The user can override the automatic state: expanding while narrow keeps
   * the sidebar open until the window crosses the breakpoint again.
   */
  toggleSideNav(): void {
    if (this.autoSideNavCollapsed()) {
      this.autoSideNavCollapsed.set(false);
      this.manualSideNavCollapsed.set(false);
      return;
    }
    this.manualSideNavCollapsed.update((collapsed) => !collapsed);
  }

  ngOnDestroy(): void {
    this.timerStateCleanup?.();
    this.modalKeyGuardCleanup?.();
  }

  onIdleKeep(): void {
    this.idleDetection.setPromptOpen(false);
    this.idleDetection.resetIdle();
    this.showIdlePrompt.set(false);
  }

  async onIdleDiscard(): Promise<void> {
    const originalIssueId = this.timerService.issueId();
    const startTimeVal = this.idleStartTime();
    if (originalIssueId && startTimeVal) {
      // 1. Stop current timer at idle start time
      await this.timerService.stop('', startTimeVal);
      // 2. Start new timer on same issue now
      await this.timerService.start(originalIssueId);
    }
    this.idleDetection.setPromptOpen(false);
    this.idleDetection.resetIdle();
    this.showIdlePrompt.set(false);
  }

  onIdleAssignPrompt(): void {
    // Hide idle prompt and show assign dialog
    this.showIdlePrompt.set(false);
    this.showAssignDialog.set(true);
  }

  async handleAssignIssueSelection(result: SearchResult): Promise<void> {
    let targetIssueId: string | undefined;

    if (result.type === 'create') {
      const issue = await this.db.createIssue({ title: result.issue.title });
      targetIssueId = issue.id;
      await this.db.reloadIssues();
    } else if (result.type === 'jira') {
      const existing = this.issues().find((i) => i.jiraIssueKey === result.key);
      if (existing) {
        targetIssueId = existing.id;
      } else {
        const issue = await this.db.createIssue({
          title: result.summary,
          jiraIssueKey: result.key,
        });
        targetIssueId = issue.id;
        await this.db.reloadIssues();
      }
    } else if (result.type === 'local') {
      targetIssueId = result.id;
    }

    if (targetIssueId) {
      this.selectedAssignedIssueId.set(targetIssueId);
      const issue = this.issues().find((i) => i.id === targetIssueId);
      if (issue) {
        this.selectedAssignedIssueQuery.set(issue.jiraIssueKey ? `[${issue.jiraIssueKey}] ${issue.title}` : issue.title);
      }
    }
  }

  async onConfirmAssign(): Promise<void> {
    const assignedIssueId = this.selectedAssignedIssueId();
    const originalIssueId = this.timerService.issueId();
    const startTimeVal = this.idleStartTime();

    if (assignedIssueId && originalIssueId && startTimeVal) {
      // 1. Stop current timer at idle start time
      await this.timerService.stop('', startTimeVal);

      // 2. Create completed entry for the assigned issue spanning the idle
      //    duration. If the idle period crossed midnight (e.g. user walked
      //    away at 23:50 and came back at 00:10), splitting it into one
      //    entry per local date keeps per-day stats honest — otherwise the
      //    entry lands on the start date but its end timestamp is on the
      //    next day.
      const segments = this.splitRangeByLocalDay(startTimeVal, Date.now());
      for (const seg of segments) {
        await this.db.createTimeEntry({
          issueId: assignedIssueId,
          startTime: seg.startTime,
          endTime: seg.endTime,
          date: seg.date,
          note: 'Idle time assignment',
        });
      }

      // 3. Start a new timer on the original issue now
      await this.timerService.start(originalIssueId);
    }

    // Reset and close
    this.idleDetection.setPromptOpen(false);
    this.idleDetection.resetIdle();
    this.showAssignDialog.set(false);
    this.selectedAssignedIssueId.set('');
    this.selectedAssignedIssueQuery.set('');
  }

  /** Split [startMs, endMs) into one segment per local calendar date so
   *  each TimeEntry's `date` matches the day it actually occupies. The app
   *  stores wall-clock (local) times, so segments are split on local
   *  midnight. Zero-length slices (e.g. when endMs lands exactly on
   *  midnight) are skipped — they would produce an entry with start ===
   *  end, which corrupts daily totals and confuses Jira worklog sync. */
  private splitRangeByLocalDay(
    startMs: number,
    endMs: number,
  ): Array<{ date: string; startTime: string; endTime: string }> {
    const segments: Array<{ date: string; startTime: string; endTime: string }> = [];
    if (endMs <= startMs) return segments;
    const toLocalTime = (d: Date) =>
      `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
    let cursor = new Date(startMs);
    while (cursor.getTime() < endMs) {
      const nextMidnight = new Date(cursor);
      nextMidnight.setHours(24, 0, 0, 0);
      const segmentEnd = Math.min(endMs, nextMidnight.getTime());
      if (segmentEnd <= cursor.getTime()) break; // would be a zero-length entry
      segments.push({
        date: toLocalDate(cursor),
        startTime: toLocalTime(cursor),
        endTime: toLocalTime(new Date(segmentEnd)),
      });
      cursor = new Date(segmentEnd);
    }
    return segments;
  }

  onCloseAssign(): void {
    // If they cancel out of assign dialog, return them to idle prompt
    this.showAssignDialog.set(false);
    this.showIdlePrompt.set(true);
  }
}

/** Below this width the full sidebar crowds the page content. */
function isNarrowViewport(): boolean {
  return window.innerWidth < 1100;
}
