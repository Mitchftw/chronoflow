import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  computed,
} from '@angular/core';
import { DatabaseService } from '../../services/database.service';
import { TimerService } from '../../services/timer.service';
import {
  StatsCardsComponent,
  type DashboardStats,
} from '../../components/dashboard/stats-cards.component';
import { ActiveTimerCardComponent } from '../../components/dashboard/active-timer-card.component';
import { TimeEntryListComponent } from '../../components/dashboard/time-entry-list.component';
import { TimeEntryEditDialogComponent } from '../../components/dashboard/time-entry-edit-dialog.component';
import type { Issue } from '../../models/issue';
import type { TimeEntry } from '../../models/time-entry';
import { type SearchResult } from '../../components/common/search-bar.component';
import { format, addDays, subDays, startOfDay, isSameDay } from 'date-fns';

@Component({
  selector: 'app-dashboard',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    StatsCardsComponent,
    ActiveTimerCardComponent,
    TimeEntryListComponent,
    TimeEntryEditDialogComponent,
  ],
  host: { class: 'block' },
  template: `
    <header class="mb-8 flex flex-col sm:flex-row sm:items-center justify-between gap-6 select-none">
      <div>
        <h1 class="text-3xl font-extrabold text-foreground tracking-tight">Dashboard</h1>
        <div class="mt-1.5 flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <span class="inline-block size-2 rounded-full bg-primary animate-pulse"></span>
          {{ displayDate() }}
        </div>
      </div>

      <!-- Date Navigator & Sync -->
      <div class="flex flex-wrap items-center gap-3">
        <!-- Load Button -->
        <button
          class="inline-flex items-center gap-2 rounded-xl border border-border/50 bg-card/50 px-4 py-2 text-xs font-bold uppercase tracking-wider text-foreground/80 transition-all hover:bg-secondary/80 hover:text-primary active:scale-95 cursor-pointer shadow-sm"
          (click)="loadJira()"
          [disabled]="db.loading()"
          title="Load issues and worklogs from Jira"
        >
          <svg class="size-3.5" [class.animate-spin]="db.loading()" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
            @if (db.loading()) {
              <path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
            } @else {
              <path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
            }
          </svg>
          Load
        </button>

        <!-- Sync Button -->
        <button
          class="inline-flex items-center gap-2 rounded-xl border border-border/50 bg-card/50 px-4 py-2 text-xs font-bold uppercase tracking-wider text-foreground/80 transition-all hover:bg-secondary/80 hover:text-primary active:scale-95 cursor-pointer shadow-sm"
          (click)="syncJira()"
          [disabled]="db.loading()"
          title="Sync local entries to Jira"
        >
          <svg class="size-3.5" [class.animate-spin]="db.loading()" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
          </svg>
          Sync
        </button>

        <div class="flex items-center gap-1 rounded-xl border border-border/40 bg-card/65 p-1 backdrop-blur-md shadow-sm">
          <button
            class="flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary/80 hover:text-foreground transition-all cursor-pointer"
            (click)="prevDay()"
            title="Previous Day"
          >
            <svg class="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3">
              <path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <button
            class="px-3.5 py-1.5 text-[10px] font-black uppercase tracking-widest transition-all rounded-lg cursor-pointer"
            [class]="isToday() ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground'"
            (click)="goToday()"
          >
            Today
          </button>
          <button
            class="flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary/80 hover:text-foreground transition-all cursor-pointer"
            (click)="nextDay()"
            title="Next Day"
          >
            <svg class="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3">
              <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>
    </header>

    @if (errorMessage()) {
      <div class="mb-6 flex items-center justify-between gap-4 rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive-foreground backdrop-blur-md shadow-sm transition-all animate-in fade-in slide-in-from-top-2 duration-200">
        <div class="flex items-center gap-2">
          <svg class="size-4 shrink-0 text-destructive" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
          </svg>
          <span>{{ errorMessage() }}</span>
        </div>
        <button
          class="text-destructive-foreground/60 hover:text-destructive-foreground transition-all cursor-pointer"
          (click)="errorMessage.set(null)"
        >
          <svg class="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    }

    <!-- Stats -->
    <app-stats-cards
      class="mb-8"
      [stats]="stats()"
    />

    <!-- Active Timer (Only show on Today or if running) -->
    @if (isToday() || timer.isRunning()) {
      <section class="mb-8 relative z-20">
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

    <!-- Time Entries for selected date -->
    <app-time-entry-list
      [entries]="selectedDateEntries()"
      [issues]="db.issues()"
      (deleteEntry)="deleteEntry($event)"
      (editEntry)="openEditEntryDialog($event)"
      (addManualEntry)="openCreateEntryDialog()"
    />

    <!-- Time Entry Edit/Manual Create Dialog -->
    <app-time-entry-edit-dialog
      [(isOpen)]="isTimeEntryDialogOpen"
      [entry]="selectedTimeEntry()"
      [date]="formattedDate()"
      [issues]="db.issues()"
      (saved)="onEntrySaved($event)"
      (dismissed)="onEntryDismissed()"
    />

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

  selectedDate = signal(startOfDay(new Date()));
  statusMessage = signal<string>('');
  errorMessage = signal<string | null>(null);

  isTimeEntryDialogOpen = signal(false);
  selectedTimeEntry = signal<TimeEntry | null>(null);
  formattedDate = computed(() => format(this.selectedDate(), 'yyyy-MM-dd'));
  
  displayDate = computed(() => {
    const date = this.selectedDate();
    if (isSameDay(date, new Date())) return `Today — ${format(date, 'EEEE, MMMM d, yyyy')}`;
    if (isSameDay(date, subDays(new Date(), 1))) return `Yesterday — ${format(date, 'EEEE, MMMM d, yyyy')}`;
    return format(date, 'EEEE, MMMM d, yyyy');
  });

  isToday = computed(() => isSameDay(this.selectedDate(), new Date()));

  selectedDateEntries = computed(() => {
    const formatted = format(this.selectedDate(), 'yyyy-MM-dd');
    return this.db.getTimeEntriesForDate(formatted);
  });

  stats = computed<DashboardStats>(() => {
    const formatted = format(this.selectedDate(), 'yyyy-MM-dd');
    const entries = this.db.getTimeEntriesForDate(formatted);
    const ms = entries.reduce((total, e) => total + this.db.getEntryDuration(e), 0);
    const issues = this.db.issues();
    
    return {
      todayTimeMs: ms,
      projectCount: this.db.projects().length,
      issueCount: issues.length,
      completedCount: issues.filter((i) => i.status === 'done').length,
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

  async syncJira() {
    this.errorMessage.set(null);
    this.statusMessage.set('Syncing local worklogs to Jira...');
    const formatted = format(this.selectedDate(), 'yyyy-MM-dd');
    try {
      const result = await this.db.syncLocalToJira(formatted);
      console.log(`Sync complete: ${result.pushed} pushed, ${result.updated} updated, ${result.deleted} deleted`);
    } catch (err: any) {
      console.error('Jira sync failed', err);
      this.errorMessage.set(err?.message || 'Jira sync failed. Check connection settings.');
    }
  }

  async loadJira() {
    this.errorMessage.set(null);
    this.statusMessage.set('Loading issues and worklogs from Jira...');
    const formatted = format(this.selectedDate(), 'yyyy-MM-dd');
    try {
      const result = await this.db.loadFromJira(formatted);
      console.log(`Load complete: ${result.loadedIssues} issues loaded/updated, ${result.loadedWorklogs} worklogs loaded`);
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

  async deleteEntry(entryId: string): Promise<void> {
    await this.db.deleteTimeEntry(entryId);
  }

  openEditEntryDialog(entry: TimeEntry): void {
    this.selectedTimeEntry.set(entry);
    this.isTimeEntryDialogOpen.set(true);
  }

  openCreateEntryDialog(): void {
    this.selectedTimeEntry.set(null);
    this.isTimeEntryDialogOpen.set(true);
  }

  onEntrySaved(_entry: TimeEntry): void {
    this.db.reloadTimeEntries();
  }

  onEntryDismissed(): void {
    this.db.reloadTimeEntries();
  }
}
