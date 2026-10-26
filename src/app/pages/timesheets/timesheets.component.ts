import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  computed,
} from '@angular/core';
import { DatabaseService } from '../../services/database.service';
import { JiraService } from '../../services/jira.service';
import { TimerService } from '../../services/timer.service';
import { PageHeaderComponent } from '../../components/common/page-header.component';
import { DialogComponent } from '../../components/common/dialog.component';
import type { TimeEntry } from '../../models/time-entry';
import type { Issue } from '../../models/issue';
import type { JiraConnection } from '../../../types';
import { issueColor as resolveIssueColor } from '../../utils/colors';
import {
  entryDurationSeconds,
  formatDurationSeconds,
  formatTimeHm,
  toLocalDate,
} from '../../utils/time';

interface GroupedEntry {
  issueId: string;
  issueTitle: string;
  issueKey?: string;
  projectName: string;
  entries: TimeEntry[];
  totalSeconds: number;
}

@Component({
  selector: 'app-timesheets',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PageHeaderComponent, DialogComponent],
  host: { class: 'block' },
  template: `
    <app-page-header title="Timesheets" subtitle="View and manage your time entries" />

    <!-- Date picker + actions -->
    <div class="mb-6 flex flex-wrap items-center gap-3.5 select-none">
      <div class="relative">
        <input
          type="date"
          [value]="selectedDate()"
          (change)="onDateChange($event)"
          aria-label="Selected date"
          class="rounded-xl border border-border/40 bg-card/65 px-4 py-2 text-xs font-bold text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 shadow-sm cursor-pointer"
        />
      </div>

      <span class="rounded-lg bg-secondary/80 px-2.5 py-1 text-xs font-bold text-foreground border border-border/20">
        {{ totalTimeFormatted() }}
      </span>

      <div class="ml-auto flex items-center gap-2">
        @if (jiraService.isConnected()) {
          <button
            class="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-xs font-bold text-primary-foreground transition-all duration-300 hover:bg-primary/95 shadow-md shadow-primary/20 hover:scale-[1.02] active:scale-[0.98] cursor-pointer disabled:opacity-40 disabled:pointer-events-none"
            [disabled]="syncingAll() || !hasUnsyncedEntries()"
            (click)="syncAllToJira()"
          >
            @if (syncingAll()) {
              <div class="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" role="status"></div>
            } @else {
              <svg class="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                <path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            }
            Sync All
          </button>
        }
      </div>
    </div>

    <!-- Action / sync error -->
    @if (syncError()) {
      <div
        class="mb-5 flex items-start justify-between gap-4 rounded-xl border border-destructive/25 bg-destructive/10 px-4 py-3 text-xs font-semibold text-destructive shadow-sm"
        role="alert"
      >
        <span class="flex items-start gap-2">
          <svg class="mt-0.5 size-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
          </svg>
          <span>{{ syncError() }}</span>
        </span>
        <button
          class="shrink-0 rounded-lg p-1 text-destructive/80 transition-colors hover:bg-destructive/10 hover:text-destructive cursor-pointer"
          (click)="syncError.set(null)"
          aria-label="Dismiss error"
        >
          <svg class="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    }

    <!-- Loading -->
    @if (loading()) {
      <div class="flex items-center justify-center py-16 select-none">
        <div class="size-6 animate-spin rounded-full border-2 border-primary border-t-transparent" role="status">
          <span class="sr-only">Loading entries...</span>
        </div>
      </div>
    }

    <!-- Empty state -->
    @if (!loading() && groupedEntries().length === 0) {
 <div class="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border/45 py-16 text-center bg-card/25 select-none">
        <svg class="mb-4 size-12 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <p class="text-sm font-bold text-foreground/90">No time entries for this date</p>
        <p class="mt-1 text-xs text-muted-foreground">
          Start tracking time from the Issues page
        </p>
      </div>
    }

    <!-- Entries grouped by issue -->
    @if (!loading() && groupedEntries().length > 0) {
      <div class="space-y-4">
        @for (group of groupedEntries(); track group.issueId) {
          <div
            class="rounded-2xl border border-border/40 bg-card/65 overflow-hidden shadow-sm transition-all duration-300"
            [style.border-left]="'3px solid ' + getIssueColor(group.issueId)"
          >
            <!-- Group header -->
            <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-muted/20 px-5 py-4 border-b border-border/20 select-none">
              <div class="flex flex-wrap items-center gap-2">
                <span class="size-2.5 rounded-full shrink-0" [style.background-color]="getIssueColor(group.issueId)" aria-hidden="true"></span>
                <span class="text-sm font-bold text-foreground/95 tracking-tight">{{ group.issueTitle }}</span>
                @if (group.issueKey) {
                  <span class="rounded-md bg-primary/10 px-2 py-0.5 text-[9px] font-bold text-primary border border-primary/20">
                    {{ group.issueKey }}
                  </span>
                }
                @if (group.projectName) {
                  <span class="rounded-md bg-secondary/70 px-2 py-0.5 text-[9px] font-bold text-foreground/80 border border-border/25">{{ group.projectName }}</span>
                }
              </div>
              <div class="flex items-center gap-4">
                <span class="text-xs font-bold font-mono text-foreground/95">{{ formatDuration(group.totalSeconds) }}</span>
                @if (jiraService.isConnected() && group.issueKey && (allSynced(group) || groupNeedsSync(group))) {
                  <button
                    class="transition-all duration-200 cursor-pointer disabled:cursor-default"
                    [class]="allSynced(group)
                      ? 'inline-flex items-center justify-center gap-1.5 rounded-lg border border-green-500/25 bg-green-500/10 px-3 py-1.5 text-xs font-bold text-green-600 select-none'
                      : 'inline-flex items-center justify-center gap-1.5 rounded-lg border border-primary/45 bg-primary/10 px-3 py-1.5 text-xs font-bold text-primary hover:bg-primary hover:text-primary-foreground'"
                    [disabled]="allSynced(group)"
                    (click)="syncGroupToJira(group)"
                  >
                    @if (syncingGroupId() === group.issueId) {
                      <div class="size-3 animate-spin rounded-full border-2 border-current border-t-transparent" role="status"></div>
                    } @else {
                      <svg class="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                    }
                    {{ syncButtonLabel(group) }}
                  </button>
                }
              </div>
            </div>

            <!-- Entries -->
            <div class="divide-y divide-border/20">
              @for (entry of group.entries; track entry.id) {
                <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-5 py-4 text-xs transition-all duration-200 hover:bg-muted/10">
                  <div class="flex items-center gap-4 flex-1 min-w-0">
                    <!-- Time range -->
                    <div class="flex items-center gap-1.5 font-mono text-xs text-foreground/90 min-w-[125px] select-none">
                      <span>{{ formatTime(entry.startTime) }}</span>
                      <span class="text-muted-foreground">-</span>
                      <span>{{ entry.endTime ? formatTime(entry.endTime) : 'now' }}</span>
                    </div>

                    <!-- Duration -->
                    <span class="font-mono text-xs text-muted-foreground min-w-[65px] select-none">
                      {{ calcDuration(entry) }}
                    </span>

                    <!-- Note -->
                    @if (entry.note) {
                      <span class="flex-1 truncate text-xs text-muted-foreground">
                        {{ entry.note }}
                      </span>
                    } @else {
                      <span class="flex-1 text-xs text-muted-foreground italic select-none">No note</span>
                    }
                  </div>

                  <!-- Right actions -->
                  <div class="flex items-center gap-3 self-end sm:self-auto select-none">
                    <!-- Sync status -->
                    <div class="flex items-center">
                      @if (entry.jiraWorklogId && !entry.isDirty) {
                        <span class="flex items-center gap-1 text-[11px] font-bold text-green-600 bg-green-500/10 px-2.5 py-1 rounded-lg border border-green-500/20" title="Synced to Jira (ID: {{ entry.jiraWorklogId }})">
                          <svg class="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                          Synced
                        </span>
                      } @else if (entry.endTime && jiraService.isConnected() && group.issueKey) {
                        <button
                          class="inline-flex items-center gap-1 text-[11px] font-bold text-primary transition-colors hover:text-primary/80 cursor-pointer disabled:opacity-50"
                          (click)="syncEntry(entry, group.issueKey)"
                          [disabled]="syncingEntryId() === entry.id"
                          [attr.aria-label]="(entry.jiraWorklogId ? 'Update' : 'Sync') + ' time entry in Jira'"
                        >
                          @if (syncingEntryId() === entry.id) {
                            <div class="size-3 animate-spin rounded-full border-2 border-current border-t-transparent" role="status"></div>
                          } @else {
                            <svg class="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                              <path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                            </svg>
                          }
                          {{ entry.jiraWorklogId ? 'Update' : 'Sync' }}
                        </button>
                      }
                    </div>

                    <!-- Delete -->
                    <button
                      class="flex size-7.5 items-center justify-center rounded-xl text-muted-foreground transition-all duration-200 hover:bg-red-500/20 hover:text-red-500 active:scale-90 cursor-pointer"
                      title="Delete entry"
                      aria-label="Delete time entry"
                      (click)="requestDeleteEntry(entry)"
                    >
                      <svg class="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>
              }
            </div>
          </div>
        }
      </div>
    }

    <!-- Delete confirmation -->
    <app-dialog
      [(isOpen)]="showDeleteDialog"
      title="Delete Time Entry"
      [confirmLabel]="deleteConfirmLabel()"
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
  `,
})
export class TimesheetsComponent {
  private readonly db = inject(DatabaseService);
  readonly jiraService = inject(JiraService);
  readonly timerService = inject(TimerService);

  // ── State ──

  loading = signal(true);
  selectedDate = signal(toLocalDate());
  entries = signal<TimeEntry[]>([]);
  issues = signal<Issue[]>([]);

  syncingAll = signal(false);
  syncingGroupId = signal<string | null>(null);
  syncingEntryId = signal<string | null>(null);

  /** Inline page error (sync failures, blocked deletions, …). */
  syncError = signal<string | null>(null);

  /** Delete confirmation */
  showDeleteDialog = signal(false);
  pendingDeleteEntry = signal<TimeEntry | null>(null);
  deleteError = signal<string | null>(null);
  deletingEntry = signal(false);

  /** The entry owned by the running timer, if any. */
  readonly activeEntryId = computed(
    () => this.timerService.timerState()?.entryId ?? null,
  );

  readonly deleteBlockedMessage = computed(() => {
    const entry = this.pendingDeleteEntry();
    if (!entry) return null;
    return this.activeEntryId() === entry.id
      ? 'This entry is currently being timed. Stop the timer before deleting it.'
      : null;
  });

  readonly deleteConfirmLabel = computed(() =>
    this.deletingEntry() ? 'Deleting…' : 'Delete',
  );

  // ── Derived ──

  readonly groupedEntries = computed((): GroupedEntry[] => {
    const selectedDate = this.selectedDate();
    const entries = this.entries().filter((entry) => entry.date === selectedDate);
    const issues = this.issues();
    const issueMap = new Map(issues.map((i) => [i.id, i]));

    // Group entries by issueId
    const groups = new Map<string, TimeEntry[]>();
    for (const entry of entries) {
      const g = groups.get(entry.issueId) ?? [];
      g.push(entry);
      groups.set(entry.issueId, g);
    }

    const result: GroupedEntry[] = [];
    for (const [issueId, groupEntries] of groups) {
      const issue = issueMap.get(issueId);
      const totalSeconds = groupEntries.reduce(
        (sum, entry) => sum + entryDurationSeconds(entry),
        0,
      );
      const projectName = issue
        ? (this.db.getProjectById(issue.projectId)?.name ?? '')
        : '';

      result.push({
        issueId,
        issueTitle: issue?.title ?? 'Unknown Issue',
        issueKey: issue?.jiraIssueKey ?? undefined,
        projectName,
        entries: groupEntries,
        totalSeconds,
      });
    }

    // Sort by total time descending
    return result.sort((a, b) => b.totalSeconds - a.totalSeconds);
  });

  readonly totalTimeFormatted = computed(() => {
    const total = this.groupedEntries().reduce(
      (sum, group) => sum + group.totalSeconds,
      0,
    );
    return `Total: ${formatDurationSeconds(total)}`;
  });

  /** Whether the selected date has any closed, unsynced/dirty entries. */
  readonly hasUnsyncedEntries = computed(() =>
    this.groupedEntries().some(
      (group) =>
        !!group.issueKey && group.entries.some((entry) => this.needsSync(entry)),
    ),
  );

  /** HH:mm display, shared helper strips seconds. */
  readonly formatTime = formatTimeHm;

  /** Human duration, shared helper keeps sub-minute values visible. */
  readonly formatDuration = formatDurationSeconds;

  // ── Constructor ──

  constructor() {
    this.loadData();
  }

  // ── Data Loading ──

  async loadData(): Promise<void> {
    this.loading.set(true);
    try {
      await Promise.all([
        this.db.reloadTimeEntries(),
        this.db.reloadIssues(),
        this.db.reloadProjects(),
      ]);
      this.entries.set(this.db.timeEntries());
      this.issues.set(this.db.issues());
    } catch (err) {
      console.error('Failed to load timesheet data', err);
    } finally {
      this.loading.set(false);
    }
  }

  onDateChange(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    if (!value) return;
    this.selectedDate.set(value);
    this.syncError.set(null);
    void this.loadData();
  }

  // ── Actions ──

  requestDeleteEntry(entry: TimeEntry): void {
    this.syncError.set(null);
    this.deleteError.set(null);
    this.pendingDeleteEntry.set(entry);
    this.showDeleteDialog.set(true);
  }

  /** Backwards-compatible entry point: opens the delete confirmation. */
  deleteEntry(entryOrId: TimeEntry | string): void {
    const entry =
      typeof entryOrId === 'string'
        ? this.entries().find((e) => e.id === entryOrId)
        : entryOrId;
    if (entry) this.requestDeleteEntry(entry);
  }

  closeDeleteDialog(): void {
    this.showDeleteDialog.set(false);
    this.pendingDeleteEntry.set(null);
    this.deleteError.set(null);
  }

  async confirmDeleteEntry(): Promise<void> {
    const entry = this.pendingDeleteEntry();
    if (!entry || this.deletingEntry()) return;

    const blocked = this.deleteBlockedMessage();
    if (blocked) {
      this.deleteError.set(blocked);
      return;
    }

    this.deletingEntry.set(true);
    this.deleteError.set(null);

    try {
      await this.db.deleteTimeEntry(entry.id);
      this.entries.update((list) => list.filter((e) => e.id !== entry.id));
      this.closeDeleteDialog();
    } catch (err) {
      console.error('Failed to delete entry', err);
      this.deleteError.set(this.toErrorMessage(err, 'Could not delete the time entry.'));
    } finally {
      this.deletingEntry.set(false);
    }
  }

  async syncEntry(entry: TimeEntry, issueKey: string): Promise<void> {
    const conn = this.jiraService.activeConnection();
    if (!conn) {
      this.syncError.set('No Jira connection configured.');
      return;
    }

    this.syncingEntryId.set(entry.id);
    this.syncError.set(null);
    try {
      const error = await this.syncEntryToJira(entry, issueKey, conn);
      if (error) {
        this.syncError.set(`${issueKey}: ${error}`);
      }
    } finally {
      this.syncingEntryId.set(null);
    }
  }

  async syncGroupToJira(group: GroupedEntry): Promise<void> {
    const issueKey = group.issueKey;
    if (!issueKey) return;

    const conn = this.jiraService.activeConnection();
    if (!conn) {
      this.syncError.set('No Jira connection configured.');
      return;
    }

    this.syncingGroupId.set(group.issueId);
    this.syncError.set(null);
    const failures: string[] = [];

    try {
      for (const entry of group.entries) {
        if (!this.needsSync(entry)) continue;
        const error = await this.syncEntryToJira(entry, issueKey, conn);
        if (error) failures.push(`${issueKey}: ${error}`);
      }
    } finally {
      this.syncingGroupId.set(null);
    }

    if (failures.length > 0) {
      this.syncError.set(this.formatFailures(failures));
    }
  }

  async syncAllToJira(): Promise<void> {
    const conn = this.jiraService.activeConnection();
    if (!conn) {
      this.syncError.set('No Jira connection configured.');
      return;
    }

    this.syncingAll.set(true);
    this.syncError.set(null);
    const failures: string[] = [];

    try {
      for (const group of this.groupedEntries()) {
        const issueKey = group.issueKey;
        if (!issueKey) continue;
        for (const entry of group.entries) {
          if (!this.needsSync(entry)) continue;
          const error = await this.syncEntryToJira(entry, issueKey, conn);
          if (error) failures.push(`${issueKey}: ${error}`);
        }
      }
    } finally {
      this.syncingAll.set(false);
    }

    if (failures.length > 0) {
      this.syncError.set(this.formatFailures(failures));
    }
  }

  // ── Sync helpers ──

  /**
   * Sync one closed entry. Entries that already have a worklog id are sent
   * again so JiraService can update the existing worklog.
   */
  private async syncEntryToJira(
    entry: TimeEntry,
    issueKey: string,
    conn: JiraConnection,
  ): Promise<string | null> {
    try {
      const result = await this.jiraService.syncWorklog(entry, conn, undefined, issueKey);
      if (!result.success) {
        return result.error ?? 'Jira rejected the worklog.';
      }

      const worklogId = result.worklogId ?? entry.jiraWorklogId;
      if (!worklogId) {
        return 'Jira did not return a worklog id.';
      }

      const updated = await this.db.updateTimeEntry(entry.id, {
        jiraWorklogId: worklogId,
        isDirty: false,
      });
      const canonical: TimeEntry = updated ?? {
        ...entry,
        jiraWorklogId: worklogId,
        isDirty: false,
      };
      this.entries.update((list) =>
        list.map((e) => (e.id === canonical.id ? canonical : e)),
      );
      return null;
    } catch (err) {
      return this.toErrorMessage(err, 'Could not sync this entry.');
    }
  }

  /** Closed entries are the only ones Jira can accept. */
  private needsSync(entry: TimeEntry): boolean {
    return !!entry.endTime && (!entry.jiraWorklogId || !!entry.isDirty);
  }

  private formatFailures(failures: string[]): string {
    const [first] = failures;
    return failures.length === 1
      ? first
      : `${first} (${failures.length - 1} more failed)`;
  }

  // ── UI helpers ──

  allSynced(group: GroupedEntry): boolean {
    return (
      group.entries.length > 0 &&
      group.entries.every((entry) => !!entry.jiraWorklogId && !entry.isDirty)
    );
  }

  groupNeedsSync(group: GroupedEntry): boolean {
    return group.entries.some((entry) => this.needsSync(entry));
  }

  syncButtonLabel(group: GroupedEntry): string {
    if (this.allSynced(group)) return 'Synced';
    const hasDirty = group.entries.some(
      (entry) => !!entry.jiraWorklogId && !!entry.isDirty,
    );
    return hasDirty ? 'Update' : 'Sync';
  }

  getIssueColor(issueId: string): string {
    return resolveIssueColor(this.issues().find((i) => i.id === issueId));
  }

  issueTitle(issueId: string): string {
    return this.issues().find((i) => i.id === issueId)?.title ?? 'Unknown Issue';
  }

  calcDuration(entry: TimeEntry): string {
    if (!entry.endTime) return 'Running';
    return formatDurationSeconds(entryDurationSeconds(entry));
  }

  private toErrorMessage(err: unknown, fallback: string): string {
    if (err instanceof Error && err.message.trim()) return err.message;
    if (typeof err === 'string' && err.trim()) return err;
    return fallback;
  }
}
