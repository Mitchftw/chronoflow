import { Component, ChangeDetectionStrategy, inject, signal, effect, computed } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { TitleBarComponent } from './components/title-bar/title-bar.component';
import { SideNavComponent } from './components/side-nav/side-nav.component';
import { SettingsService } from './services/settings.service';
import { IdleDetectionService } from './services/idle-detection.service';
import { TimerService } from './services/timer.service';
import { DatabaseService } from './services/database.service';
import { UpdateService } from './services/update.service';
import { IdlePromptComponent } from './components/common/idle-prompt.component';
import { DialogComponent } from './components/common/dialog.component';
import { SearchBarComponent, SearchResult } from './components/common/search-bar.component';

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
          (toggleCollapse)="sideNavCollapsed.set(!sideNavCollapsed())"
        />

        <main
          class="flex-1 overflow-y-auto px-6 pt-8 pb-6"
          [class.pl-6]="!sideNavCollapsed()"
          [class.pl-4]="sideNavCollapsed()"
        >
          <router-outlet />
        </main>
      </div>

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
export class AppComponent {
  private settings = inject(SettingsService);
  private idleDetection = inject(IdleDetectionService);
  private timerService = inject(TimerService);
  private db = inject(DatabaseService);
  private updateService = inject(UpdateService);

  sideNavCollapsed = signal(false);
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

  constructor() {
    if (!this.isMainWindow) {
      // Timer overlay window needs transparent body for always-on-top overlay
      document.documentElement.classList.add('timer-window-active');
      document.body.classList.add('timer-window-active');
      document.body.style.background = 'transparent';
    } else {
      // Load issues and sync state on main window startup
      this.db.loadAll();
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

      // 2. Create completed entry for assigned issue spanning the idle duration
      const dateStr = new Date(startTimeVal).toISOString().slice(0, 10);
      const startTimeStr = new Date(startTimeVal).toISOString().slice(11, 19);
      const endTimeStr = new Date().toISOString().slice(11, 19);

      await this.db.createTimeEntry({
        issueId: assignedIssueId,
        startTime: startTimeStr,
        endTime: endTimeStr,
        date: dateStr,
        note: 'Idle time assignment',
      });

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

  onCloseAssign(): void {
    // If they cancel out of assign dialog, return them to idle prompt
    this.showAssignDialog.set(false);
    this.showIdlePrompt.set(true);
  }
}
