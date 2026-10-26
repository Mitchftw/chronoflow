import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  computed,
} from '@angular/core';
import { DatabaseService } from '../../services/database.service';
import { TimerService } from '../../services/timer.service';
import { JiraService } from '../../services/jira.service';
import { SearchBarComponent, type SearchResult } from '../../components/common/search-bar.component';
import { IssueCardComponent } from '../../components/common/issue-card.component';
import { IssueFormDialogComponent } from '../../components/common/issue-form-dialog.component';
import { PageHeaderComponent } from '../../components/common/page-header.component';
import { DialogComponent } from '../../components/common/dialog.component';
import type { Issue } from '../../models/issue';
import type { Project } from '../../models/project';
import { issueColor as resolveIssueColor } from '../../utils/colors';

type StatusFilter = 'all' | 'todo' | 'in_progress' | 'done';

@Component({
  selector: 'app-issues',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    SearchBarComponent,
    IssueCardComponent,
    IssueFormDialogComponent,
    PageHeaderComponent,
    DialogComponent,
  ],
  host: { class: 'block' },
  template: `
    <app-page-header title="Issues" subtitle="Track your work items and time">
      <button class="btn btn-primary" (click)="openCreateDialog()">
        <svg class="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" />
        </svg>
        New Issue
      </button>
    </app-page-header>

    <!-- Search Bar -->
    <div class="mb-5 relative z-20">
      <app-search-bar
        [(query)]="searchQuery"
        [localIssues]="issues()"
        (resultSelected)="onResultSelected($event)"
      />
    </div>

    <!-- Action error -->
    @if (actionError()) {
      <div
        class="mb-5 flex items-start justify-between gap-4 rounded-xl border border-destructive/25 bg-destructive/10 px-4 py-3 text-xs font-semibold text-destructive shadow-sm"
        role="alert"
      >
        <span class="flex items-start gap-2">
          <svg class="mt-0.5 size-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
          </svg>
          <span>{{ actionError() }}</span>
        </span>
        <button
          class="shrink-0 rounded-lg p-1 text-destructive/80 transition-colors hover:bg-destructive/10 hover:text-destructive cursor-pointer"
          (click)="actionError.set(null)"
          aria-label="Dismiss error"
        >
          <svg class="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    }

    <!-- Filters -->
    <div class="mb-6 flex flex-wrap items-center gap-3 select-none">
      <!-- Status filter -->
 <div class="flex items-center gap-1 rounded-xl border border-border/40 bg-card/65 p-1 shadow-sm">
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
            class="appearance-none rounded-xl border border-border/40 bg-card/65 pl-4 pr-10 py-2.5 text-xs font-bold text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 shadow-sm cursor-pointer"
          >
            <option value="">All Projects</option>
            @for (project of projects(); track project.id) {
              <option [value]="project.id">{{ project.name }}</option>
            }
          </select>
          <div class="absolute inset-y-0 right-3 flex items-center pointer-events-none text-muted-foreground">
            <svg class="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </div>
      }

      <!-- Result count -->
      <span class="ml-auto text-xs font-semibold text-muted-foreground">
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
        <div class="flex size-12 items-center justify-center rounded-full bg-muted/40 mb-4 text-muted-foreground">
          <svg class="size-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
        </div>
        <p class="text-sm font-semibold text-foreground/80">
          {{ searchQuery() || projectFilter() || statusFilter() !== 'all' ? 'No issues match your filters' : 'No issues tracked yet' }}
        </p>
        <p class="mt-1 text-xs text-muted-foreground max-w-sm px-6">
          {{ searchQuery() || projectFilter() || statusFilter() !== 'all' ? 'Adjust your search queries or select a different filter category' : 'Start organizing your tasks and work items by creating your very first issue' }}
        </p>
        @if (!searchQuery() && projectFilter() === '' && statusFilter() === 'all') {
          <button
            class="mt-4 inline-flex items-center gap-2 rounded-xl bg-primary/10 px-4 py-2 text-xs font-bold text-primary hover:bg-primary/20 transition-all cursor-pointer"
            (click)="openCreateDialog()"
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
            [issueColor]="getIssueColor(issue)"
            (startTimer)="onStartTimer($event)"
            (edit)="onEditIssue($event)"
            (delete)="requestDeleteIssue($event)"
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

    <!-- Delete confirmation -->
    <app-dialog
      [(isOpen)]="showDeleteDialog"
      title="Delete Issue"
      [confirmLabel]="deletingIssue() ? 'Deleting…' : 'Delete'"
      [confirmDisabled]="deletingIssue() || !!deleteBlockedMessage()"
      (confirm)="confirmDeleteIssue()"
      (close)="cancelDeleteIssue()"
    >
      @if (pendingDeleteIssue(); as issue) {
        <div class="space-y-3">
          <p class="text-sm text-muted-foreground">
            Delete <strong class="font-bold text-foreground">{{ issue.title }}</strong>? This action cannot be undone.
          </p>

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

  /** Action feedback */
  actionError = signal<string | null>(null);

  /** Delete confirmation */
  showDeleteDialog = signal(false);
  pendingDeleteIssue = signal<Issue | null>(null);
  deleteError = signal<string | null>(null);
  deletingIssue = signal(false);

  /** The issue currently being timed cannot be deleted. */
  readonly deleteBlockedMessage = computed(() => {
    const issue = this.pendingDeleteIssue();
    if (!issue) return null;
    return this.timerService.isRunning() && this.timerService.issueId() === issue.id
      ? 'Stop the running timer before deleting this issue.'
      : null;
  });

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

    // Sort a copy: computed signals must never mutate their source arrays.
    return [...list].sort((a, b) => b.createdAt - a.createdAt);
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

  async onResultSelected(result: SearchResult): Promise<void> {
    this.actionError.set(null);

    try {
      if (result.type === 'jira') {
        // Reuse an existing local issue when this Jira key is already tracked.
        const existing = this.issues().find((i) => i.jiraIssueKey === result.key);
        if (existing) {
          this.searchQuery.set('');
          return;
        }

        // Let the database generate the canonical issue (real id/createdAt)
        // instead of pushing a hand-built object that does not exist in the DB.
        const created = await this.db.createIssue({
          title: result.summary,
          jiraIssueKey: result.key,
          estimate: result.issue.estimateMinutes ?? 0,
        });
        this.syncIssueList();
        this.upsertIssue(created);
      } else if (result.type === 'create') {
        const created = await this.db.createIssue({ title: result.issue.title });
        this.syncIssueList();
        this.upsertIssue(created);
      } else {
        // Local issue — start tracking it.
        await this.onStartTimer(result.issue.id);
      }

      this.searchQuery.set('');
    } catch (err) {
      console.error('Failed to handle search result', err);
      this.actionError.set(this.toErrorMessage(err, 'Could not save the issue.'));
    }
  }

  // ── Actions ──

  async onStartTimer(issueId: string): Promise<void> {
    this.actionError.set(null);

    try {
      // Clicking the already-running issue is a no-op.
      if (this.timerService.isRunning() && this.timerService.issueId() === issueId) {
        return;
      }

      const started = await this.timerService.start(issueId);
      if (!started) {
        this.actionError.set(
          this.timerService.isRunning()
            ? 'A timer is already running. Stop it first.'
            : 'Could not start the timer. Please try again.',
        );
        return;
      }

      // The main process updates the running flags/start time in SQLite.
      // Reload the canonical list so exactly one issue is marked running and
      // timeSpent is never overwritten by an optimistic local guess.
      await this.db.reloadIssues();
      this.syncIssueList();
    } catch (err) {
      console.error('Failed to start timer', err);
      this.actionError.set(this.toErrorMessage(err, 'Could not start the timer.'));
    }
  }

  openCreateDialog(): void {
    this.actionError.set(null);
    this.editingIssue.set(null);
    this.showFormDialog.set(true);
  }

  onEditIssue(issueId: string): void {
    const issue = this.issues().find((i) => i.id === issueId);
    if (!issue) return;
    this.actionError.set(null);
    this.editingIssue.set(issue);
    this.showFormDialog.set(true);
  }

  requestDeleteIssue(issueId: string): void {
    const issue = this.issues().find((i) => i.id === issueId);
    if (!issue) return;
    this.actionError.set(null);
    this.deleteError.set(null);
    this.pendingDeleteIssue.set(issue);
    this.showDeleteDialog.set(true);
  }

  /** Backwards-compatible entry point: opens the delete confirmation. */
  onDeleteIssue(issueId: string): void {
    this.requestDeleteIssue(issueId);
  }

  async confirmDeleteIssue(): Promise<void> {
    const issue = this.pendingDeleteIssue();
    if (!issue || this.deletingIssue()) return;

    const blocked = this.deleteBlockedMessage();
    if (blocked) {
      this.deleteError.set(blocked);
      return;
    }

    this.deletingIssue.set(true);
    this.deleteError.set(null);

    try {
      await this.db.deleteIssue(issue.id);
      this.syncIssueList();
      this.issues.update((list) => list.filter((i) => i.id !== issue.id));
      this.showDeleteDialog.set(false);
      this.pendingDeleteIssue.set(null);
    } catch (err) {
      console.error('Failed to delete issue', err);
      this.deleteError.set(this.toErrorMessage(err, 'Could not delete the issue.'));
    } finally {
      this.deletingIssue.set(false);
    }
  }

  cancelDeleteIssue(): void {
    this.pendingDeleteIssue.set(null);
    this.deleteError.set(null);
    this.showDeleteDialog.set(false);
  }

  async onOpenInJira(issueId: string): Promise<void> {
    const issue = this.issues().find((i) => i.id === issueId);
    if (!issue?.jiraIssueKey) return;

    const conn = this.jiraService.activeConnection();
    if (!conn) {
      this.actionError.set('No Jira connection configured.');
      return;
    }

    this.actionError.set(null);

    try {
      if ((conn.authType ?? 'api-key') === 'oauth') {
        // OAuth connections store the cloud id (not a hostname) in `domain`,
        // so the browsable site url has to be resolved from accessible
        // resources — same behaviour as the backlog page.
        const res = await this.jiraService.getAccessibleResources(conn.accessToken ?? '');
        const resources: any[] = res.resources ?? [];
        const cloudId = conn.cloudId ?? '';
        const domain = conn.domain ?? '';
        const site = resources.find((r: any) => {
          if (cloudId && r.id === cloudId) return true;
          if (domain && (r.id === domain || r.url === domain)) return true;
          if (domain && typeof r.url === 'string' && r.url.includes(domain)) return true;
          return false;
        });

        if (!site?.url) {
          this.actionError.set(
            res.error || 'Could not resolve the Jira site for this connection.',
          );
          return;
        }

        window.open(`${String(site.url).replace(/\/$/, '')}/browse/${issue.jiraIssueKey}`, '_blank');
        return;
      }

      const domain = String(conn.domain ?? '')
        .replace(/^https?:\/\//, '')
        .replace(/\/$/, '');
      window.open(`https://${domain}/browse/${issue.jiraIssueKey}`, '_blank');
    } catch (err) {
      console.error('Failed to open issue in Jira', err);
      this.actionError.set(this.toErrorMessage(err, 'Could not open the issue in Jira.'));
    }
  }

  onIssueSaved(issue: Issue): void {
    this.actionError.set(null);
    this.syncIssueList();
    this.upsertIssue(issue);
    // The dialog closes on success; forget the previous edit so the next
    // edit (even of the same issue) repopulates every field.
    this.editingIssue.set(null);
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

  getIssueColor(issue: Issue): string {
    return resolveIssueColor(issue);
  }

  /** Mirror the canonical list held by DatabaseService. */
  private syncIssueList(): void {
    this.issues.set(this.db.issues());
  }

  /** Ensure a canonical issue returned by DatabaseService is present locally. */
  private upsertIssue(issue: Issue): void {
    this.issues.update((list) => {
      const idx = list.findIndex((i) => i.id === issue.id);
      if (idx === -1) return [...list, issue];
      const next = [...list];
      next[idx] = issue;
      return next;
    });
  }

  private toErrorMessage(err: unknown, fallback: string): string {
    if (err instanceof Error && err.message.trim()) return err.message;
    if (typeof err === 'string' && err.trim()) return err;
    return fallback;
  }
}
