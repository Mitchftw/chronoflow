import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  computed,
} from '@angular/core';
import { DatabaseService } from '../../services/database.service';
import { JiraService } from '../../services/jira.service';
import type { TimeEntry } from '../../models/time-entry';
import type { Issue } from '../../models/issue';
import { format } from 'date-fns';

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
  host: { class: 'block' },
  template: `
    <header class="mb-6 select-none">
      <h1 class="text-2xl font-bold tracking-tight text-foreground/95">Timesheets</h1>
      <p class="mt-1.5 text-xs font-medium text-muted-foreground/80">
        View and manage your time entries
      </p>
    </header>

    <!-- Date picker + actions -->
    <div class="mb-6 flex flex-wrap items-center gap-3.5 select-none">
      <div class="relative">
        <input
          type="date"
          [value]="selectedDate()"
          (change)="selectedDate.set($any($event.target).value); loadData()"
          class="rounded-xl border border-border/40 bg-card/65 backdrop-blur-md px-4 py-2 text-xs font-bold text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 shadow-sm cursor-pointer"
        />
      </div>

      <span class="rounded-lg bg-secondary/80 px-2.5 py-1 text-xs font-bold text-foreground border border-border/20">
        {{ totalTimeFormatted() }}
      </span>

      <div class="ml-auto flex items-center gap-2">
        @if (jiraService.isConnected()) {
          <button
            class="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-primary-foreground transition-all duration-300 hover:bg-primary/95 shadow-md shadow-primary/20 hover:scale-[1.02] active:scale-[0.98] cursor-pointer disabled:opacity-40 disabled:pointer-events-none"
            [disabled]="syncingAll()"
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
      <div class="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border/45 py-16 text-center bg-card/25 backdrop-blur-sm select-none">
        <svg class="mb-4 size-12 text-muted-foreground/30" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <p class="text-sm font-bold text-foreground/90">No time entries for this date</p>
        <p class="mt-1 text-xs text-muted-foreground/60">
          Start tracking time from the Issues page
        </p>
      </div>
    }

    <!-- Entries grouped by issue -->
    @if (!loading() && groupedEntries().length > 0) {
      <div class="space-y-4">
        @for (group of groupedEntries(); track group.issueId) {
          <div class="rounded-2xl border border-border/40 bg-card/65 backdrop-blur-md overflow-hidden shadow-sm transition-all duration-300">
            <!-- Group header -->
            <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-muted/20 px-5 py-4 border-b border-border/20 select-none">
              <div class="flex flex-wrap items-center gap-2">
                <span class="text-sm font-bold text-foreground/95 tracking-tight">{{ group.issueTitle }}</span>
                @if (group.issueKey) {
                  <span class="rounded-md bg-primary/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-primary border border-primary/20">
                    {{ group.issueKey }}
                  </span>
                }
                @if (group.projectName) {
                  <span class="rounded-md bg-secondary/70 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-foreground/80 border border-border/25">{{ group.projectName }}</span>
                }
              </div>
              <div class="flex items-center gap-4">
                <span class="text-xs font-bold font-mono text-foreground/95">{{ formatDuration(group.totalSeconds) }}</span>
                @if (jiraService.isConnected()) {
                  <button
                    class="transition-all duration-200 cursor-pointer"
                    [class]="allSynced(group) 
                      ? 'inline-flex items-center justify-center gap-1.5 rounded-lg border border-green-500/25 bg-green-500/10 px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-green-600 select-none' 
                      : 'inline-flex items-center justify-center gap-1.5 rounded-lg border border-primary/45 bg-primary/10 px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-primary hover:bg-primary hover:text-primary-foreground'"
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
                    {{ allSynced(group) ? 'Synced' : 'Sync' }}
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
                      <span class="text-muted-foreground/55">—</span>
                      <span>{{ entry.endTime ? formatTime(entry.endTime) : 'now' }}</span>
                    </div>

                    <!-- Duration -->
                    <span class="font-mono text-xs text-muted-foreground/75 min-w-[65px] select-none">
                      {{ calcDuration(entry) }}
                    </span>

                    <!-- Note -->
                    @if (entry.note) {
                      <span class="flex-1 truncate text-xs text-muted-foreground/85">
                        {{ entry.note }}
                      </span>
                    } @else {
                      <span class="flex-1 text-xs text-muted-foreground/45 italic select-none">No note</span>
                    }
                  </div>

                  <!-- Right actions -->
                  <div class="flex items-center gap-3 self-end sm:self-auto select-none">
                    <!-- Sync status -->
                    <div class="flex items-center">
                      @if (entry.jiraWorklogId) {
                        <span class="flex items-center gap-1 text-[11px] font-bold text-green-600 bg-green-500/10 px-2.5 py-1 rounded-lg border border-green-500/20" title="Synced to Jira (ID: {{ entry.jiraWorklogId }})">
                          <svg class="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                          Synced
                        </span>
                      } @else if (jiraService.isConnected() && group.issueKey) {
                        <button
                          class="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-primary transition-colors hover:text-primary/80 cursor-pointer"
                          (click)="syncEntry(entry, group.issueKey)"
                          [disabled]="syncingEntryId() === entry.id"
                        >
                          @if (syncingEntryId() === entry.id) {
                            <div class="size-3 animate-spin rounded-full border-2 border-current border-t-transparent" role="status"></div>
                          } @else {
                            <svg class="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                              <path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                            </svg>
                          }
                          Sync
                        </button>
                      }
                    </div>

                    <!-- Delete -->
                    <button
                      class="flex size-7.5 items-center justify-center rounded-xl text-muted-foreground/60 transition-all duration-200 hover:bg-red-500/20 hover:text-red-500 active:scale-90 cursor-pointer"
                      title="Delete entry"
                      (click)="deleteEntry(entry.id)"
                    >
                      <svg class="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
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
  `,
})
export class TimesheetsComponent {
  private readonly db = inject(DatabaseService);
  readonly jiraService = inject(JiraService);

  // ── State ──

  loading = signal(true);
  selectedDate = signal(new Date().toISOString().slice(0, 10));
  entries = signal<TimeEntry[]>([]);
  issues = signal<Issue[]>([]);

  syncingAll = signal(false);
  syncingGroupId = signal<string | null>(null);
  syncingEntryId = signal<string | null>(null);

  // ── Derived ──

  readonly groupedEntries = computed((): GroupedEntry[] => {
    const entries = this.entries();
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
      const totalSeconds = groupEntries.reduce((sum, e) => {
        if (!e.endTime) return sum;
        const [sh, sm] = e.startTime.split(':').map(Number);
        const [eh, em] = e.endTime.split(':').map(Number);
        return sum + Math.max(0, (eh * 3600 + em * 60) - (sh * 3600 + sm * 60));
      }, 0);

      result.push({
        issueId,
        issueTitle: issue?.title ?? 'Unknown Issue',
        issueKey: issue?.jiraIssueKey ?? undefined,
        projectName: '',
        entries: groupEntries,
        totalSeconds,
      });
    }

    // Sort by total time descending
    return result.sort((a, b) => b.totalSeconds - a.totalSeconds);
  });

  readonly totalTimeFormatted = computed(() => {
    const total = this.entries().reduce((sum, e) => {
      if (!e.endTime) return sum;
      const [sh, sm] = e.startTime.split(':').map(Number);
      const [eh, em] = e.endTime.split(':').map(Number);
      return sum + Math.max(0, (eh * 3600 + em * 60) - (sh * 3600 + sm * 60));
    }, 0);
    return `Total: ${this.formatDuration(total)}`;
  });

  // ── Constructor ──

  constructor() {
    this.loadData();
  }

  // ── Data Loading ──

  async loadData(): Promise<void> {
    this.loading.set(true);
    try {
      await this.db.reloadTimeEntries();
      await this.db.reloadIssues();
      this.entries.set(this.db.timeEntries());
      this.issues.set(this.db.issues());
    } catch (err) {
      console.error('Failed to load timesheet data', err);
    } finally {
      this.loading.set(false);
    }
  }

  // ── Actions ──

  async deleteEntry(id: string): Promise<void> {
    try {
      await this.db.deleteTimeEntry(id);
      this.entries.update((list) => list.filter((e) => e.id !== id));
    } catch (err) {
      console.error('Failed to delete entry', err);
    }
  }

  async syncEntry(entry: TimeEntry, issueKey: string): Promise<void> {
    const conn = this.jiraService.activeConnection();
    if (!conn) return;

    this.syncingEntryId.set(entry.id);
    try {
      const result = await this.jiraService.syncWorklog(entry, conn, undefined, issueKey);
      if (result.success && result.worklogId) {
        await this.db.updateTimeEntry(entry.id, { jiraWorklogId: result.worklogId ?? null });
        this.entries.update((list) =>
          list.map((e) =>
            e.id === entry.id ? { ...e, jiraWorklogId: result.worklogId ?? null } : e,
          ),
        );
      }
    } finally {
      this.syncingEntryId.set(null);
    }
  }

  async syncGroupToJira(group: GroupedEntry): Promise<void> {
    if (!group.issueKey) return;

    const conn = this.jiraService.activeConnection();
    if (!conn) return;

    this.syncingGroupId.set(group.issueId);
    try {
      for (const entry of group.entries) {
        if (entry.jiraWorklogId) continue;
        const result = await this.jiraService.syncWorklog(entry, conn, undefined, group.issueKey);
        if (result.success && result.worklogId) {
          await this.db.updateTimeEntry(entry.id, { jiraWorklogId: result.worklogId ?? null });
          this.entries.update((list) =>
            list.map((e) =>
              e.id === entry.id ? { ...e, jiraWorklogId: result.worklogId ?? null } : e,
            ),
          );
        }
      }
    } finally {
      this.syncingGroupId.set(null);
    }
  }

  async syncAllToJira(): Promise<void> {
    const conn = this.jiraService.activeConnection();
    if (!conn) return;

    this.syncingAll.set(true);
    try {
      for (const group of this.groupedEntries()) {
        if (!group.issueKey) continue;
        for (const entry of group.entries) {
          if (entry.jiraWorklogId) continue;
          const result = await this.jiraService.syncWorklog(entry, conn, undefined, group.issueKey);
          if (result.success && result.worklogId) {
            await this.db.updateTimeEntry(entry.id, { jiraWorklogId: result.worklogId ?? null });
          }
        }
      }
      await this.loadData();
    } finally {
      this.syncingAll.set(false);
    }
  }

  // ── Helpers ──

  allSynced(group: GroupedEntry): boolean {
    return group.entries.length > 0 && group.entries.every((e) => !!e.jiraWorklogId);
  }

  formatTime(hhmm: string): string {
    if (/^\d{2}:\d{2}$/.test(hhmm)) return hhmm;
    try {
      return format(new Date(hhmm), 'HH:mm');
    } catch {
      return hhmm;
    }
  }

  calcDuration(entry: TimeEntry): string {
    if (!entry.endTime) return 'Running';
    const [sh, sm] = entry.startTime.split(':').map(Number);
    const [eh, em] = entry.endTime.split(':').map(Number);
    const seconds = Math.max(0, (eh * 3600 + em * 60) - (sh * 3600 + sm * 60));
    return this.formatDuration(seconds);
  }

  formatDuration(seconds: number): string {
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
}
