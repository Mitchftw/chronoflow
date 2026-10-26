import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  computed,
  HostListener,
} from '@angular/core';
import { DatabaseService } from '../../services/database.service';
import { TimerService } from '../../services/timer.service';
import { DashboardStateService } from '../../services/dashboard-state.service';
import { SettingsService } from '../../services/settings.service';
import {
  StatsCardsComponent,
  type DashboardStats,
} from '../../components/dashboard/stats-cards.component';
import { ActiveTimerCardComponent } from '../../components/dashboard/active-timer-card.component';
import { DayTimelineComponent } from '../../components/dashboard/day-timeline.component';
import {
  WeekHeatmapComponent,
  type HeatmapDay,
} from '../../components/dashboard/week-heatmap.component';
import { TimeEntryListComponent } from '../../components/dashboard/time-entry-list.component';
import { TimeEntryEditDialogComponent } from '../../components/dashboard/time-entry-edit-dialog.component';
import { TimeEntrySplitDialogComponent } from '../../components/dashboard/time-entry-split-dialog.component';
import { DialogComponent } from '../../components/common/dialog.component';
import type { Issue } from '../../models/issue';
import type { TimeEntry } from '../../models/time-entry';
import { type SearchResult } from '../../components/common/search-bar.component';
import { format, addDays, subDays, startOfDay, startOfWeek, isSameDay } from 'date-fns';
import { formatTimeHm, toLocalDate } from '../../utils/time';

@Component({
  selector: 'app-dashboard',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    StatsCardsComponent,
    WeekHeatmapComponent,
    ActiveTimerCardComponent,
    DayTimelineComponent,
    TimeEntryListComponent,
    TimeEntryEditDialogComponent,
    TimeEntrySplitDialogComponent,
    DialogComponent,
  ],
  host: { class: 'block' },
  template: `
    <header class="mb-8 flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between select-none">
      <div class="min-w-0">
        <h1 class="text-2xl font-bold tracking-tight text-foreground">Dashboard</h1>
        <div class="mt-1.5 flex items-center gap-2 text-xs font-medium text-muted-foreground">
          {{ displayDate() }}
        </div>
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <!-- Jira actions -->
        <button class="btn-icon" (click)="loadJira()" [disabled]="db.loading()" title="Load issues and worklogs from Jira" aria-label="Load from Jira">
          <svg class="size-4" [class.animate-spin]="db.loading()" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
            @if (db.loading()) {
              <path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
            } @else {
              <path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
            }
          </svg>
        </button>
        <button class="btn-icon" (click)="syncJira()" [disabled]="db.loading()" title="Sync local entries to Jira" aria-label="Sync to Jira">
          <svg class="size-4" [class.animate-spin]="db.loading()" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
          </svg>
        </button>

        <span class="mx-0.5 hidden h-6 w-px bg-border/60 sm:block"></span>

        <!-- Date navigator -->
 <div class="flex items-center gap-1 rounded-xl border border-border/50 bg-card/60 p-1 shadow-sm">
          <button
            class="flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary/80 hover:text-foreground transition-all cursor-pointer"
            (click)="prevDay()"
            title="Previous day"
            aria-label="Previous day"
          >
            <svg class="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3">
              <path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <button
            class="px-3.5 py-1.5 text-[10px] font-black transition-all rounded-lg cursor-pointer"
            [class]="isToday() ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground'"
            (click)="goToday()"
          >
            Today
          </button>
          <button
            class="flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary/80 hover:text-foreground transition-all cursor-pointer"
            (click)="nextDay()"
            title="Next day"
            aria-label="Next day"
          >
            <svg class="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3">
              <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>
    </header>

    @if (errorMessage()) {
 <div class="mb-6 flex items-center justify-between gap-4 rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive shadow-sm transition-all animate-in fade-in slide-in-from-top-2 duration-200">
        <div class="flex items-center gap-2">
          <svg class="size-4 shrink-0 text-destructive" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
          </svg>
          <span>{{ errorMessage() }}</span>
        </div>
        <button
          class="text-destructive/60 hover:text-destructive transition-all cursor-pointer"
          (click)="errorMessage.set(null)"
          aria-label="Dismiss error"
        >
          <svg class="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    }

    @if (successMessage()) {
      <div class="mb-6 flex items-center justify-between gap-4 rounded-xl border border-green-500/25 bg-green-500/10 px-4 py-3 text-sm text-green-700 shadow-sm transition-all animate-in fade-in slide-in-from-top-2 duration-200 dark:text-green-300">
        <div class="flex items-center gap-2">
          <svg class="size-4 shrink-0 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>{{ successMessage() }}</span>
        </div>
        <button
          class="text-green-700/60 hover:text-green-700 dark:text-green-300/60 dark:hover:text-green-300 transition-all cursor-pointer"
          (click)="successMessage.set(null)"
          aria-label="Dismiss status message"
        >
          <svg class="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    }

    <!-- Workspace: primary timeline column + side rail -->
    <div class="grid grid-cols-1 gap-6 xl:grid-cols-3 xl:items-start">
      <!-- Primary column -->
      <div class="min-w-0 space-y-6 xl:col-span-2">
        <!-- Active Timer (Only show on Today or if running) -->
        @if (isToday() || timer.isRunning()) {
          <section class="relative z-20">
            <app-active-timer-card
              [isRunning]="timer.isRunning()"
              [issueName]="timer.activeIssue()?.title ?? timer.activeIssue()?.jiraIssueKey ?? null"
              [formattedTime]="timer.formattedElapsed()"
              [localIssues]="db.issues()"
              (resultSelected)="handleSearchSelection($event)"
              (stop)="stopTimer()"
            />
          </section>
        }

        <!-- Day timeline with visible gaps -->
        <app-day-timeline
          [entries]="selectedDateEntries()"
          [issues]="db.issues()"
          [isToday]="isToday()"
          [activeEntryId]="timer.timerState()?.entryId ?? null"
          (entrySelected)="openEditEntryDialog($event)"
          (gapSelected)="openCreateEntryDialogForRange($event)"
        />

        <!-- Time Entries for selected date -->
        <app-time-entry-list
          [entries]="selectedDateEntries()"
          [issues]="db.issues()"
          [dateLabel]="dateLabel()"
          [activeEntryId]="timer.timerState()?.entryId ?? null"
          [activeElapsedMs]="activeEntryElapsedMs()"
          (deleteEntry)="requestDeleteEntry($event)"
          (editEntry)="openEditEntryDialog($event)"
          (splitEntry)="openSplitEntryDialog($event)"
          (resumeEntry)="resumeEntry($event)"
          (addManualEntry)="openCreateEntryDialog()"
        />
      </div>

      <!-- Side rail -->
      <aside class="space-y-6 xl:col-span-1">
        <app-stats-cards [stats]="stats()" [label]="trackedLabel()" />
        <app-week-heatmap
          [days]="weekDays()"
          [title]="weekTitle()"
          [goalMinutes]="dailyGoalMinutes()"
          (daySelected)="selectDate($event)"
        />
      </aside>
    </div>

    <!-- Time Entry Edit/Manual Create Dialog -->
    <app-time-entry-edit-dialog
      [(isOpen)]="isTimeEntryDialogOpen"
      [entry]="selectedTimeEntry()"
      [date]="formattedDate()"
      [prefill]="entryPrefill()"
      [issues]="db.issues()"
      (saved)="onEntrySaved($event)"
      (dismissed)="onEntryDismissed()"
    />

    <!-- Time Entry Split Dialog -->
    <app-time-entry-split-dialog
      [(isOpen)]="isSplitDialogOpen"
      [entry]="selectedSplitEntry()"
      [issues]="db.issues()"
      (saved)="onSplitSaved()"
    />

    <!-- Delete confirmation -->
    <app-dialog
      [(isOpen)]="showDeleteDialog"
      title="Delete Time Entry"
      [confirmLabel]="deletingEntry() ? 'Deleting…' : 'Delete'"
      [confirmDisabled]="deletingEntry() || !!deleteBlockedMessage()"
      (confirm)="confirmDeleteEntry()"
      (close)="closeDeleteDialog()"
    >
      @if (pendingDeleteEntry(); as entry) {
        <div class="space-y-3">
          <p class="text-sm text-muted-foreground">
            Delete this time entry? This action cannot be undone.
          </p>
          <div class="rounded-xl border border-border/40 bg-muted/20 px-4 py-3">
            <p class="font-mono text-sm font-semibold text-foreground/90">
              {{ formatTime(entry.startTime) }} – {{ entry.endTime ? formatTime(entry.endTime) : 'Running' }}
            </p>
            <p class="mt-1 text-xs text-muted-foreground">{{ issueTitle(entry.issueId) }}</p>
            @if (entry.note) {
              <p class="mt-1 truncate text-xs italic text-muted-foreground">{{ entry.note }}</p>
            }
          </div>
          @if (deleteBlockedMessage()) {
            <div class="rounded-xl border border-destructive/25 bg-destructive/10 px-4 py-3 text-xs font-medium text-destructive" role="alert">
              {{ deleteBlockedMessage() }}
            </div>
          }
          @if (deleteError()) {
            <div class="rounded-xl border border-destructive/25 bg-destructive/10 px-4 py-3 text-xs font-medium text-destructive" role="alert">
              {{ deleteError() }}
            </div>
          }
        </div>
      }
    </app-dialog>

    <!-- Loading overlay -->
    @if (db.loading()) {
      <div class="fixed inset-0 z-50 flex items-center justify-center bg-background/50 backdrop-blur-xs select-none">
        <div class="flex flex-col items-center gap-3">
          <div class="size-8 animate-spin rounded-full border-3 border-primary border-t-transparent" role="status">
            <span class="sr-only">Loading...</span>
          </div>
          <span class="text-xs font-semibold text-muted-foreground">{{ statusMessage() || 'Updating local database...' }}</span>
        </div>
      </div>
    }
  `,
})
export class DashboardComponent {
  protected db = inject(DatabaseService);
  protected timer = inject(TimerService);
  protected dashboardState = inject(DashboardStateService);
  protected settings = inject(SettingsService);

  /**
   * The selected calendar day, shared via DashboardStateService so it survives
   * leaving/returning to this route instead of always resetting to today.
   */
  readonly selectedDate = this.dashboardState.selectedDate;
  statusMessage = signal<string>('');
  errorMessage = signal<string | null>(null);
  successMessage = signal<string | null>(null);

  isTimeEntryDialogOpen = signal(false);
  selectedTimeEntry = signal<TimeEntry | null>(null);
  entryPrefill = signal<{ startTime?: string; endTime?: string; issueId?: string } | null>(null);
  isSplitDialogOpen = signal(false);
  selectedSplitEntry = signal<TimeEntry | null>(null);

  showDeleteDialog = signal(false);
  pendingDeleteEntry = signal<TimeEntry | null>(null);
  deleteError = signal<string | null>(null);
  deletingEntry = signal(false);

  readonly deleteBlockedMessage = computed(() => {
    const entry = this.pendingDeleteEntry();
    if (!entry) return null;
    return this.timer.timerState()?.entryId === entry.id
      ? 'This entry is currently being timed. Stop the timer before deleting it.'
      : null;
  });

  readonly formatTime = formatTimeHm;

  formattedDate = computed(() => toLocalDate(this.selectedDate()));
  
  displayDate = computed(() => {
    const date = this.selectedDate();
    if (isSameDay(date, new Date())) return `Today: ${format(date, 'EEEE, MMMM d, yyyy')}`;
    if (isSameDay(date, subDays(new Date(), 1))) return `Yesterday: ${format(date, 'EEEE, MMMM d, yyyy')}`;
    return format(date, 'EEEE, MMMM d, yyyy');
  });

  dateLabel = computed(() => {
    const date = this.selectedDate();
    if (isSameDay(date, new Date())) return 'Today';
    if (isSameDay(date, subDays(new Date(), 1))) return 'Yesterday';
    return format(date, 'MMM d, yyyy');
  });

  isToday = computed(() => isSameDay(this.selectedDate(), new Date()));

  /** Caption for the tracked-time card: the total always belongs to the selected day. */
  trackedLabel = computed(() =>
    this.isToday() ? 'Tracked today' : `Tracked on ${format(this.selectedDate(), 'MMM d')}`,
  );

  /** Daily goal comes from the workday setting, never from the vacation default. */
  dailyGoalMinutes = computed(() => (this.settings.settings().dailyGoalHours ?? 8) * 60);

  /** Heading for the week strip: "This week" or "Week of Oct 20". */
  weekTitle = computed(() => {
    const selectedWeekStart = startOfWeek(this.selectedDate(), { weekStartsOn: 1 });
    const currentWeekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
    return isSameDay(selectedWeekStart, currentWeekStart)
      ? 'This week'
      : `Week of ${format(selectedWeekStart, 'MMM d')}`;
  });

  /** Monday–Sunday strip for the week containing the selected day. */
  weekDays = computed<HeatmapDay[]>(() => {
    // The tick is only here to invalidate the computed every second while a
    // timer runs; getEntryDuration() already returns the live duration for an
    // open entry dated today.
    this.timer.elapsedMs();
    const weekStart = startOfWeek(this.selectedDate(), { weekStartsOn: 1 });
    const entries = this.db.timeEntries();
    const today = new Date();
    const selected = this.selectedDate();
    const days: HeatmapDay[] = [];
    for (let i = 0; i < 7; i++) {
      const day = addDays(weekStart, i);
      const iso = toLocalDate(day);
      const minutes = entries
        .filter((e) => e.date === iso)
        .reduce((sum, e) => {
          // Keep fractional minutes so the bar reflects a running timer
          // before the first full minute has elapsed.
          return sum + this.db.getEntryDuration(e) / 60000;
        }, 0);
      days.push({
        date: iso,
        weekday: format(day, 'EEE'),
        dayNumber: day.getDate(),
        minutes,
        isToday: isSameDay(day, today),
        isSelected: isSameDay(day, selected),
      });
    }
    return days;
  });

  selectedDateEntries = computed(() => {
    const formatted = toLocalDate(this.selectedDate());
    return this.db.getTimeEntriesForDate(formatted);
  });

  /**
   * The live duration of the current timer segment, matching the entry's own
   * date/start time. This is deliberately derived from the entry rather than
   * TimerService.elapsedMs (which is the total timer duration and may include
   * previous days after a midnight rollover).
   */
  readonly activeEntryElapsedMs = computed(() => {
    this.timer.elapsedMs();
    const runningId = this.timer.timerState()?.entryId;
    if (!runningId) return 0;
    const entry = this.selectedDateEntries().find(
      (candidate) => candidate.id === runningId && !candidate.endTime,
    );
    return entry ? this.db.getEntryDuration(entry) : 0;
  });

  stats = computed<DashboardStats>(() => {
    this.timer.elapsedMs();
    const formatted = toLocalDate(this.selectedDate());
    const entries = this.db.getTimeEntriesForDate(formatted);
    const ms = entries.reduce(
      (total, entry) => total + this.db.getEntryDuration(entry),
      0,
    );
    const issues = this.db.issues();

    return {
      todayTimeMs: ms,
      projectCount: this.db.projects().length,
      issueCount: issues.length,
      completedCount: issues.filter((i) => i.status === 'done').length,
      goalMinutes: this.dailyGoalMinutes(),
    };
  });

  constructor() {
    this.db.loadAll();
  }

  prevDay() {
    this.selectedDate.update(d => subDays(d, 1));
  }

  nextDay() {
    this.selectedDate.update(d => addDays(d, 1));
  }

  goToday() {
    this.selectedDate.set(startOfDay(new Date()));
  }

  selectDate(iso: string) {
    const [y, m, d] = iso.split('-').map(Number);
    if (y && m && d) {
      this.selectedDate.set(startOfDay(new Date(y, m - 1, d)));
    }
  }

  /** Lightweight shortcuts: ←/→ change day, T = today, S = stop running timer. */
  @HostListener('window:keydown', ['$event'])
  handleShortcut(event: KeyboardEvent): void {
    if (this.isTimeEntryDialogOpen() || this.isSplitDialogOpen()) return;
    // app-dialog is used by the edit/split forms and the idle prompt; while
    // either is open, day navigation and "stop timer" shortcuts must not fire
    // behind the modal.
    if (
      document.querySelector(
        'app-dialog [role="dialog"], app-idle-prompt [role="dialog"]',
      )
    ) {
      return;
    }
    const target = event.target as HTMLElement | null;
    if (
      target &&
      (target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable)
    ) {
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey) return;

    switch (event.key) {
      case 'ArrowLeft':
        this.prevDay();
        event.preventDefault();
        break;
      case 'ArrowRight':
        this.nextDay();
        event.preventDefault();
        break;
      case 't':
      case 'T':
        this.goToday();
        event.preventDefault();
        break;
      case 's':
      case 'S':
        if (this.timer.isRunning()) {
          this.stopTimer();
          event.preventDefault();
        }
        break;
    }
  }

  async syncJira() {
    this.errorMessage.set(null);
    this.successMessage.set(null);
    this.statusMessage.set('Syncing local worklogs to Jira...');
    const formatted = toLocalDate(this.selectedDate());
    try {
      const result = await this.db.syncLocalToJira(formatted);
      this.successMessage.set(
        `Jira sync complete: ${result.pushed} pushed, ${result.updated} updated, ${result.deleted} deleted.`,
      );
    } catch (err: any) {
      console.error('Jira sync failed', err);
      this.errorMessage.set(err?.message || 'Jira sync failed. Check connection settings.');
    }
  }

  async loadJira() {
    this.errorMessage.set(null);
    this.successMessage.set(null);
    this.statusMessage.set('Loading issues and worklogs from Jira...');
    const formatted = toLocalDate(this.selectedDate());
    try {
      const result = await this.db.loadFromJira(formatted);
      this.successMessage.set(
        `Jira load complete: ${result.loadedIssues} issues loaded/updated, ${result.loadedWorklogs} worklogs loaded.`,
      );
    } catch (err: any) {
      console.error('Jira load failed', err);
      this.errorMessage.set(err?.message || 'Failed to load from Jira. Check connection settings.');
    }
  }

  async handleSearchSelection(result: SearchResult): Promise<void> {
    let targetIssueId: string | undefined;

    if (result.type === 'create') {
      const issue = await this.db.createIssue({ title: result.issue.title });
      targetIssueId = issue.id;
    } else if (result.type === 'jira') {
      const existing = this.db.issues().find((i) => i.jiraIssueKey === result.key);
      if (existing) {
        targetIssueId = existing.id;
      } else {
        const issue = await this.db.createIssue({
          title: result.summary,
          jiraIssueKey: result.key,
        });
        targetIssueId = issue.id;
      }
    } else if (result.type === 'local') {
      targetIssueId = result.id;
    }

    if (targetIssueId) {
      await this.timer.start(targetIssueId);
      await this.db.reloadTimeEntries();
    }
  }

  async stopTimer(): Promise<void> {
    await this.timer.stop();
    await this.db.reloadTimeEntries();
  }

  requestDeleteEntry(entryId: string): void {
    const entry = this.db.timeEntries().find((candidate) => candidate.id === entryId);
    if (!entry) return;
    this.deleteError.set(null);
    this.pendingDeleteEntry.set(entry);
    this.showDeleteDialog.set(true);
  }

  closeDeleteDialog(): void {
    this.showDeleteDialog.set(false);
    this.pendingDeleteEntry.set(null);
    this.deleteError.set(null);
  }

  async confirmDeleteEntry(): Promise<void> {
    const entry = this.pendingDeleteEntry();
    if (!entry || this.deletingEntry()) return;
    if (this.deleteBlockedMessage()) {
      this.deleteError.set(this.deleteBlockedMessage());
      return;
    }

    this.deletingEntry.set(true);
    this.deleteError.set(null);
    try {
      await this.db.deleteTimeEntry(entry.id);
      this.closeDeleteDialog();
    } catch (err) {
      this.deleteError.set(
        err instanceof Error && err.message
          ? err.message
          : 'Could not delete the time entry.',
      );
    } finally {
      this.deletingEntry.set(false);
    }
  }

  issueTitle(issueId: string): string {
    return this.db.getIssueById(issueId)?.title ?? 'Unknown Issue';
  }

  openEditEntryDialog(entry: TimeEntry): void {
    this.entryPrefill.set(null);
    this.selectedTimeEntry.set(entry);
    this.isTimeEntryDialogOpen.set(true);
  }

  openCreateEntryDialog(): void {
    this.entryPrefill.set(null);
    this.selectedTimeEntry.set(null);
    this.isTimeEntryDialogOpen.set(true);
  }

  /** Open the create dialog pre-filled with a gap's time range. */
  openCreateEntryDialogForRange(range: { start: string; end: string }): void {
    this.entryPrefill.set({ startTime: range.start, endTime: range.end });
    this.selectedTimeEntry.set(null);
    this.isTimeEntryDialogOpen.set(true);
  }

  openSplitEntryDialog(entry: TimeEntry): void {
    this.selectedSplitEntry.set(entry);
    this.isSplitDialogOpen.set(true);
  }

  onSplitSaved(): void {
    this.db.reloadTimeEntries();
  }

  async resumeEntry(entry: TimeEntry): Promise<void> {
    // Same flow as the issue cards: while a timer is active, the play buttons
    // are just indicators — clicking does nothing (the active entry shows a
    // pulsing dot instead).
    const state = this.timer.timerState();
    if (state?.isRunning) return;

    this.errorMessage.set(null);
    try {
      if (!entry.endTime) {
        // Open (endless) entry → continue timing from its original start.
        await this.db.resumeTimeEntry(entry.id);
      } else {
        // Ended entry → start a fresh timer on the same issue.
        await this.timer.start(entry.issueId);
      }
      await this.db.reloadTimeEntries();
    } catch (err: any) {
      this.errorMessage.set(err?.message ?? 'Failed to resume the entry');
    }
  }

  onEntrySaved(entry: TimeEntry): void {
    if (entry?.date) {
      const [y, m, d] = entry.date.split('-').map(Number);
      if (y && m && d) {
        this.selectedDate.set(startOfDay(new Date(y, m - 1, d)));
      }
    }
    this.db.reloadTimeEntries();
  }

  onEntryDismissed(): void {
    this.db.reloadTimeEntries();
  }
}
