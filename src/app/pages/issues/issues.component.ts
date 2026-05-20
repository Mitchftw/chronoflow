import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  computed,
  linkedSignal,
  effect,
} from '@angular/core';
import { DatabaseService } from '../../services/database.service';
import { TimerService } from '../../services/timer.service';
import { JiraService } from '../../services/jira.service';
import { SearchBarComponent, type SearchResult } from '../../components/common/search-bar.component';
import { IssueCardComponent } from '../../components/common/issue-card.component';
import { IssueFormDialogComponent } from '../../components/common/issue-form-dialog.component';
import type { Issue } from '../../models/issue';
import type { Project } from '../../models/project';

type StatusFilter = 'all' | 'todo' | 'in_progress' | 'done';

@Component({
  selector: 'app-issues',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    SearchBarComponent,
    IssueCardComponent,
    IssueFormDialogComponent,
  ],
  host: { class: 'block' },
  template: `
    <header class="mb-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4 select-none">
      <div>
        <h1 class="text-2xl font-bold tracking-tight text-foreground/95">Issues</h1>
        <p class="mt-1.5 text-xs font-medium text-muted-foreground/80">
          Track your work items and time
        </p>
      </div>
      <button
        class="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-primary-foreground transition-all duration-300 hover:bg-primary/95 shadow-md shadow-primary/20 hover:scale-[1.02] active:scale-[0.98] cursor-pointer self-start sm:self-auto"
        (click)="showFormDialog.set(true)"
      >
        <svg class="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" />
        </svg>
        New Issue
      </button>
    </header>

    <!-- Search Bar -->
    <div class="mb-5 relative z-20">
      <app-search-bar
        [(query)]="searchQuery"
        [localIssues]="issues()"
        (resultSelected)="onResultSelected($event)"
      />
    </div>

    <!-- Filters -->
    <div class="mb-6 flex flex-wrap items-center gap-3 select-none">
      <!-- Status filter -->
      <div class="flex items-center gap-1 rounded-xl border border-border/40 bg-card/65 backdrop-blur-md p-1 shadow-sm">
        @for (option of statusOptions; track option.value) {
          <button
            class="rounded-lg px-3.5 py-1.5 text-xs font-bold transition-all duration-200 cursor-pointer"
            [class]="statusFilter() === option.value
              ? 'bg-primary text-primary-foreground shadow-sm'
              : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground'"
            (click)="statusFilter.set(option.value)"
          >
            {{ option.label }}
          </button>
        }
      </div>

      <!-- Project filter -->
      @if (projects().length > 0) {
        <div class="relative">
          <select
            [value]="projectFilter()"
            (change)="projectFilter.set($any($event.target).value)"
            class="appearance-none rounded-xl border border-border/40 bg-card/65 backdrop-blur-md pl-4 pr-10 py-2.5 text-xs font-bold text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 shadow-sm cursor-pointer"
          >
            <option value="">All Projects</option>
            @for (project of projects(); track project.id) {
              <option [value]="project.id">{{ project.name }}</option>
            }
          </select>
          <div class="absolute inset-y-0 right-3 flex items-center pointer-events-none text-muted-foreground/60">
            <svg class="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </div>
      }

      <!-- Result count -->
      <span class="ml-auto text-xs font-semibold text-muted-foreground/70">
        {{ filteredIssues().length }} issue{{ filteredIssues().length !== 1 ? 's' : '' }}
      </span>
    </div>

    <!-- Loading -->
    @if (loading()) {
      <div class="flex items-center justify-center py-16">
        <div class="size-8 animate-spin rounded-full border-3 border-primary border-t-transparent" role="status">
          <span class="sr-only">Loading issues...</span>
        </div>
      </div>
    }

    <!-- Empty state -->
    @if (!loading() && filteredIssues().length === 0) {
      <div class="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border/50 bg-card/25 py-16 text-center select-none">
        <div class="flex size-12 items-center justify-center rounded-full bg-muted/40 mb-4 text-muted-foreground/60">
          <svg class="size-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
        </div>
        <p class="text-sm font-semibold text-foreground/80">
          {{ searchQuery() || projectFilter() || statusFilter() !== 'all' ? 'No issues match your filters' : 'No issues tracked yet' }}
        </p>
        <p class="mt-1 text-xs text-muted-foreground/50 max-w-sm px-6">
          {{ searchQuery() || projectFilter() || statusFilter() !== 'all' ? 'Adjust your search queries or select a different filter category' : 'Start organizing your tasks and work items by creating your very first issue' }}
        </p>
        @if (!searchQuery() && projectFilter() === '' && statusFilter() === 'all') {
          <button
            class="mt-4 inline-flex items-center gap-2 rounded-xl bg-primary/10 px-4 py-2 text-xs font-bold text-primary hover:bg-primary/20 transition-all cursor-pointer"
            (click)="showFormDialog.set(true)"
          >
            Create first issue
          </button>
        }
      </div>
    }

    <!-- Issue list -->
    @if (!loading() && filteredIssues().length > 0) {
      <div class="space-y-3">
        @for (issue of filteredIssues(); track issue.id) {
          <app-issue-card
            [issue]="issue"
            [projectName]="getProjectName(issue.projectId)"
            [projectColor]="getProjectColor(issue.projectId)"
            (startTimer)="onStartTimer($event)"
            (delete)="onDeleteIssue($event)"
            (openInJira)="onOpenInJira($event)"
          />
        }
      </div>
    }

    <!-- Issue Form Dialog -->
    <app-issue-form-dialog
      [(isOpen)]="showFormDialog"
      [projects]="projects()"
      [editingIssue]="editingIssue()"
      (saved)="onIssueSaved($event)"
      (dismissed)="onFormDismissed()"
    />
  `,
})
export class IssuesComponent {
  private readonly db = inject(DatabaseService);
  readonly timerService = inject(TimerService);
  private readonly jiraService = inject(JiraService);

  // ── State ──

  loading = signal(true);
  issues = signal<Issue[]>([]);
  projects = signal<Project[]>([]);
  searchQuery = signal('');
  statusFilter = signal<StatusFilter>('all');
  projectFilter = signal('');

  /** Dialog visibility */
  showFormDialog = signal(false);
  editingIssue = signal<Issue | null>(null);

  /** Status filter options */
  readonly statusOptions: Array<{ value: StatusFilter; label: string }> = [
    { value: 'all', label: 'All' },
    { value: 'todo', label: 'Todo' },
    { value: 'in_progress', label: 'In Progress' },
    { value: 'done', label: 'Done' },
  ];

  // ── Filtered Issues ──

  readonly filteredIssues = computed(() => {
    let list = this.issues();

    // Status filter
    const status = this.statusFilter();
    if (status !== 'all') {
      list = list.filter((i) => i.status === status);
    }

    // Project filter
    const projId = this.projectFilter();
    if (projId) {
      list = list.filter((i) => i.projectId === projId);
    }

    // Search filter
    const q = this.searchQuery().toLowerCase().trim();
    if (q) {
      list = list.filter(
        (i) =>
          i.title.toLowerCase().includes(q) ||
          i.jiraIssueKey?.toLowerCase().includes(q),
      );
    }

    // Sort: newest first
    return list.sort((a, b) => b.createdAt - a.createdAt);
  });

  // ── Constructor ──

  constructor() {
    this.loadData();
  }

  // ── Data Loading ──

  private async loadData(): Promise<void> {
    this.loading.set(true);
    try {
      await Promise.all([
        this.db.reloadIssues(),
        this.db.reloadProjects(),
      ]);
      this.issues.set(this.db.issues());
      this.projects.set(this.db.projects());
    } catch (err) {
      console.error('Failed to load issues', err);
    } finally {
      this.loading.set(false);
    }
  }

  // ── Search ──

  onResultSelected(result: SearchResult): void {
    if (result.type === 'jira' && 'key' in result.issue) {
      // Create a local issue from Jira search result
      const jiraIssue = result.issue as { key: string; summary: string; description?: string; estimateMinutes?: number };
      const newIssue: Issue = {
        id: crypto.randomUUID(),
        title: jiraIssue.summary,
        description: '',
        projectId: '',
        status: 'todo',
        jiraIssueKey: jiraIssue.key,
        jiraConnectionId: null,
        estimate: jiraIssue.estimateMinutes ?? 0,
        timeSpent: 0,
        isRunning: false,
        startTime: null,
        createdAt: Date.now(),
        date: new Date().toISOString().slice(0, 10),
      };
      this.db.createIssue(newIssue);
      this.issues.update((list) => [...list, newIssue]);
    } else if ('id' in result.issue) {
      // Local issue - start timer on it
      this.onStartTimer((result.issue as Issue).id);
    }
  }

  // ── Actions ──

  async onStartTimer(issueId: string): Promise<void> {
    await this.timerService.start(issueId);
    this.issues.update((list) =>
      list.map((i) =>
        i.id === issueId ? { ...i, isRunning: true, startTime: Date.now(), timeSpent: 0 } : { ...i, isRunning: false },
      ),
    );
  }

  async onDeleteIssue(issueId: string): Promise<void> {
    await this.db.deleteIssue(issueId);
    this.issues.update((list) => list.filter((i) => i.id !== issueId));
  }

  onOpenInJira(issueId: string): void {
    const issue = this.issues().find((i) => i.id === issueId);
    if (issue?.jiraIssueKey) {
      // Try to find the active connection's domain
      const conn = this.jiraService.activeConnection();
      if (conn) {
        const url = `https://${conn.domain}/browse/${issue.jiraIssueKey}`;
        window.open(url, '_blank');
      }
    }
  }

  onIssueSaved(issue: Issue): void {
    this.issues.update((list) => {
      const idx = list.findIndex((i) => i.id === issue.id);
      if (idx >= 0) {
        const updated = [...list];
        updated[idx] = issue;
        return updated;
      }
      return [...list, issue];
    });
  }

  onFormDismissed(): void {
    this.editingIssue.set(null);
  }

  // ── Helpers ──

  getProjectName(projectId?: string): string {
    if (!projectId) return '';
    return this.projects().find((p) => p.id === projectId)?.name ?? '';
  }

  getProjectColor(projectId?: string): string {
    if (!projectId) return 'var(--color-primary)';
    return this.projects().find((p) => p.id === projectId)?.color ?? 'var(--color-primary)';
  }
}
