import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  computed,
  OnInit,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { DatabaseService } from '../../services/database.service';
import { TimerService } from '../../services/timer.service';
import { JiraService } from '../../services/jira.service';
import { PageHeaderComponent } from '../../components/common/page-header.component';
import type { BacklogIssue, BacklogProject, BacklogSprint } from '../../../types';

/**
 * Jira backlog for the signed-in user: every unresolved issue assigned to
 * them, filtered by project and sprint (current sprint by default).
 */
@Component({
  selector: 'app-backlog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PageHeaderComponent, RouterLink],
  host: { class: 'block' },
  template: `
    <app-page-header title="Backlog" subtitle="Open Jira issues assigned to you">
      <button
        class="btn-icon"
        (click)="refresh()"
        [disabled]="loading() || !ready()"
        title="Refresh backlog"
        aria-label="Refresh backlog"
      >
        <svg
          class="size-4"
          [class.animate-spin]="loading()"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          stroke-width="2.5"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99"
          />
        </svg>
      </button>
    </app-page-header>

    <!-- Initial load: connections are still resolving -->
    @if (!ready()) {
      <div class="space-y-3" aria-hidden="true">
        @for (row of [0, 1, 2, 3]; track row) {
          <div class="flex items-center gap-4 rounded-2xl border border-border/40 bg-card/65 px-5 py-4 animate-pulse">
            <div class="size-9 shrink-0 rounded-xl bg-muted/60"></div>
            <div class="flex-1 space-y-2">
              <div class="h-3.5 w-1/3 rounded bg-muted/60"></div>
              <div class="h-3 w-1/2 rounded bg-muted/40"></div>
            </div>
          </div>
        }
      </div>
    } @else if (!jira.isConnected()) {
      <!-- Not connected to Jira -->
      <div class="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border/50 bg-card/25 py-16 text-center select-none">
        <div class="flex size-12 items-center justify-center rounded-full bg-muted/40 mb-4 text-muted-foreground">
          <svg class="size-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 010 3.75H5.625a1.875 1.875 0 010-3.75Z" />
          </svg>
        </div>
        <p class="text-sm font-semibold text-foreground/80">Jira isn't connected</p>
        <p class="mt-1 max-w-sm px-6 text-xs text-muted-foreground mb-4">
          Connect Jira in Settings to see the issues assigned to you.
        </p>
        <a routerLink="/settings" class="btn btn-primary">Open settings</a>
      </div>
    } @else {
      <!-- Filters -->
      <div class="mb-6 flex flex-wrap items-center gap-3 select-none">
        @if (projects().length > 0) {
          <div class="relative">
            <select
              class="appearance-none rounded-xl border border-border/40 bg-card/65 pl-4 pr-10 py-2.5 text-xs font-bold text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 shadow-sm cursor-pointer"
              aria-label="Filter by project"
              [value]="projectFilter()"
              (change)="onProjectChange($any($event.target).value)"
            >
              <option value="">All projects</option>
              @for (project of projects(); track project.key) {
                <option [value]="project.key">{{ project.name }} ({{ project.key }})</option>
              }
            </select>
            <div class="absolute inset-y-0 right-3 flex items-center pointer-events-none text-muted-foreground">
              <svg class="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </div>
          </div>
        }

        <div class="relative">
          <select
            class="appearance-none rounded-xl border border-border/40 bg-card/65 pl-4 pr-10 py-2.5 text-xs font-bold text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 shadow-sm cursor-pointer"
            aria-label="Filter by sprint"
            [value]="sprintFilter()"
            (change)="onSprintChange($any($event.target).value)"
          >
            <option value="current">Current sprint</option>
            <option value="all">All sprints</option>
            @if (sprints().length > 0) {
              <optgroup label="Sprints">
                @for (sprint of sprints(); track sprint.id) {
                  <option [value]="sprint.id">{{ sprint.name }} ({{ sprint.state }})</option>
                }
              </optgroup>
            }
          </select>
          <div class="absolute inset-y-0 right-3 flex items-center pointer-events-none text-muted-foreground">
            <svg class="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </div>

        @if (statuses().length > 0) {
          <div class="relative">
            <select
              class="appearance-none rounded-xl border border-border/40 bg-card/65 pl-4 pr-10 py-2.5 text-xs font-bold text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 shadow-sm cursor-pointer"
              aria-label="Filter by status"
              [value]="statusFilter()"
              (change)="statusFilter.set($any($event.target).value)"
            >
              <option value="">All statuses</option>
              @for (s of statuses(); track s.name) {
                <option [value]="s.name">{{ s.name }} ({{ s.count }})</option>
              }
            </select>
            <div class="absolute inset-y-0 right-3 flex items-center pointer-events-none text-muted-foreground">
              <svg class="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </div>
          </div>
        }

        <span class="ml-auto text-xs font-semibold text-muted-foreground">
          {{ filteredIssues().length }} {{ filteredIssues().length === 1 ? 'issue' : 'issues' }}{{ truncated() ? ' (first 100)' : '' }}
        </span>
      </div>

      <!-- Error -->
      @if (errorMessage()) {
        <div class="mb-6 flex items-center justify-between gap-4 rounded-xl border border-destructive/25 bg-destructive/10 px-4 py-3 text-sm font-medium text-red-700 dark:text-red-300 shadow-sm select-none">
          <span>{{ errorMessage() }}</span>
          <button
            class="shrink-0 font-semibold text-red-700 dark:text-red-300 hover:underline cursor-pointer"
            (click)="refresh()"
          >
            Retry
          </button>
        </div>
      }

      @if (notice()) {
        <p class="mb-5 text-xs text-muted-foreground select-none">{{ notice() }}</p>
      }

      <!-- Loading: skeleton rows matching the issue layout -->
      @if (loading()) {
        <div class="space-y-3" aria-hidden="true">
          @for (row of [0, 1, 2, 3]; track row) {
            <div class="flex items-center gap-4 rounded-2xl border border-border/40 bg-card/65 px-5 py-4 animate-pulse">
              <div class="size-9 shrink-0 rounded-xl bg-muted/60"></div>
              <div class="flex-1 space-y-2">
                <div class="h-3.5 w-1/3 rounded bg-muted/60"></div>
                <div class="h-3 w-1/2 rounded bg-muted/40"></div>
              </div>
            </div>
          }
        </div>
      } @else if (!errorMessage() && filteredIssues().length === 0) {
        <!-- Empty -->
        <div class="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border/50 bg-card/25 py-16 text-center select-none">
          <div class="flex size-12 items-center justify-center rounded-full bg-muted/40 mb-4 text-muted-foreground">
            <svg class="size-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
          </div>
          <p class="text-sm font-semibold text-foreground/80">
            @if (hasActiveFilters()) {
              No issues match these filters
            } @else {
              No open issues assigned to you
            }
          </p>
          <p class="mt-1 max-w-sm px-6 text-xs text-muted-foreground mb-4">
            @if (hasActiveFilters()) {
              Try another project, sprint or status.
            } @else {
              Issues assigned to you in Jira will show up here.
            }
          </p>
          @if (hasActiveFilters()) {
            <button class="btn btn-secondary" (click)="clearFilters()">Clear filters</button>
          }
        </div>
      } @else if (filteredIssues().length > 0) {
        <!-- Issue list -->
        <div class="space-y-3">
          @for (issue of filteredIssues(); track issue.key) {
            <div
              class="flex items-center gap-4 rounded-2xl border border-border/40 bg-card/65 px-5 py-4 transition-all duration-300 hover:bg-secondary/45 hover:border-primary/20 hover:shadow-sm select-none"
              [class]="isRunning(issue) ? 'border-primary/30 bg-primary/[0.02]' : ''"
            >
              <!-- Start timer -->
              <button
                class="flex size-9 shrink-0 items-center justify-center rounded-xl border border-border/50 text-muted-foreground transition-all duration-300 hover:scale-105 active:scale-95 cursor-pointer"
                [class]="isRunning(issue)
                  ? 'bg-primary text-primary-foreground border-primary shadow-lg shadow-primary/25'
                  : 'hover:border-primary hover:text-primary'"
                (click)="startTimer(issue)"
                [attr.aria-label]="isRunning(issue) ? 'Timer running' : 'Start timer for ' + issue.summary"
                [title]="isRunning(issue) ? 'Timer running' : 'Start timer'"
              >
                @if (isRunning(issue)) {
                  <span class="flex size-2 rounded-full bg-white animate-pulse"></span>
                } @else {
                  <svg class="size-4 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                }
              </button>

              <!-- Info -->
              <div class="flex-1 min-w-0">
                <span class="block truncate text-sm font-semibold text-foreground/95">
                  <span class="font-mono text-primary mr-1.5">{{ issue.key }}</span>{{ issue.summary }}
                </span>

                <div class="mt-2.5 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  <span
                    class="inline-flex rounded-lg px-2.5 py-0.5 text-[10px] font-bold border"
                    [class]="statusClass(issue.statusCategory)"
                  >
                    {{ issue.status }}
                  </span>
                  @if (issue.issueType) {
                    <span class="font-medium">{{ issue.issueType }}</span>
                  }
                  @if (issue.priority) {
                    <span class="font-medium">{{ issue.priority }}</span>
                  }
                  @if (issue.projectName) {
                    <span class="font-medium">{{ issue.projectName }}</span>
                  }
                  @if (issue.estimateMinutes !== undefined || issue.remainingMinutes !== undefined) {
                    <span class="flex items-center gap-1 font-medium" title="Original estimate / remaining">
                      <svg class="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <span>Original {{ issue.estimateMinutes !== undefined ? formatMinutes(issue.estimateMinutes) : '–' }}</span>
                      <span class="text-border">·</span>
                      <span [class]="remainingClass(issue)">Remaining {{ issue.remainingMinutes !== undefined ? formatMinutes(issue.remainingMinutes) : '–' }}</span>
                    </span>
                  }
                  @if (issue.duedate) {
                    <span
                      class="font-medium"
                      [class]="isOverdue(issue) ? 'text-red-600 dark:text-red-400 font-semibold' : ''"
                    >
                      {{ isOverdue(issue) ? 'Overdue' : 'Due' }} {{ formatShortDate(issue.duedate) }}
                    </span>
                  }
                  @if (issue.updated) {
                    <span class="font-medium sm:ml-auto">{{ formatDate(issue.updated) }}</span>
                  }
                </div>
              </div>

              <!-- Open in Jira -->
              <button
                class="flex size-8 shrink-0 items-center justify-center rounded-xl text-muted-foreground hover:bg-secondary/80 hover:text-foreground transition-all duration-200 cursor-pointer"
                title="Open in Jira"
                aria-label="Open issue in Jira"
                (click)="openInJira(issue)"
              >
                <svg class="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </button>
            </div>
          }
        </div>
      }
    }
  `,
})
export class BacklogComponent implements OnInit {
  protected readonly jira = inject(JiraService);
  private readonly db = inject(DatabaseService);
  protected readonly timer = inject(TimerService);

  readonly ready = signal(false);
  readonly loading = signal(false);
  readonly issues = signal<BacklogIssue[]>([]);
  readonly projects = signal<BacklogProject[]>([]);
  readonly sprints = signal<BacklogSprint[]>([]);
  readonly projectFilter = signal('');
  readonly sprintFilter = signal('current');
  /** Status name to show; '' = all. Applied client-side to the loaded issues. */
  readonly statusFilter = signal('');
  readonly errorMessage = signal<string | null>(null);
  readonly notice = signal<string | null>(null);
  readonly truncated = signal(false);

  /** Guards against out-of-order responses when filters change quickly. */
  private requestSeq = 0;

  readonly hasActiveFilters = computed(
    () =>
      this.projectFilter() !== '' ||
      this.sprintFilter() !== 'current' ||
      this.statusFilter() !== '',
  );

  /** Distinct statuses in the loaded issues, to-do first and done last. */
  readonly statuses = computed(() => {
    const order: Record<string, number> = { new: 0, indeterminate: 1, done: 2 };
    const byName = new Map<string, { name: string; category: string; count: number }>();
    for (const issue of this.issues()) {
      const entry = byName.get(issue.status);
      if (entry) entry.count++;
      else byName.set(issue.status, { name: issue.status, category: issue.statusCategory, count: 1 });
    }
    return [...byName.values()].sort(
      (a, b) => (order[a.category] ?? 1) - (order[b.category] ?? 1) || a.name.localeCompare(b.name),
    );
  });

  readonly filteredIssues = computed(() => {
    const status = this.statusFilter();
    return status ? this.issues().filter((i) => i.status === status) : this.issues();
  });

  readonly runningKey = computed(() =>
    this.timer.isRunning() ? (this.timer.activeIssue()?.jiraIssueKey ?? '') : '',
  );

  async ngOnInit(): Promise<void> {
    await this.jira.loadConnections();
    this.ready.set(true);
    if (this.jira.isConnected()) {
      await Promise.all([this.loadFilters(), this.loadIssues()]);
    }
  }

  async refresh(): Promise<void> {
    if (!this.jira.isConnected()) return;
    await Promise.all([this.loadFilters(), this.loadIssues()]);
  }

  async onProjectChange(projectKey: string): Promise<void> {
    this.projectFilter.set(projectKey);
    await this.loadFilters();

    // The sprint list is scoped to the project; drop a specific sprint that
    // no longer exists rather than silently querying nothing.
    const sprint = this.sprintFilter();
    if (sprint !== 'current' && sprint !== 'all') {
      const stillExists = this.sprints().some((s) => String(s.id) === sprint);
      if (!stillExists) this.sprintFilter.set('current');
    }
    await this.loadIssues();
  }

  async onSprintChange(sprint: string): Promise<void> {
    this.sprintFilter.set(sprint);
    await this.loadIssues();
  }

  async clearFilters(): Promise<void> {
    this.projectFilter.set('');
    this.sprintFilter.set('current');
    this.statusFilter.set('');
    await Promise.all([this.loadFilters(), this.loadIssues()]);
  }

  async startTimer(issue: BacklogIssue): Promise<void> {
    if (this.isRunning(issue)) return;
    if (this.timer.isRunning()) {
      this.errorMessage.set('A timer is already running. Stop it first.');
      return;
    }

    this.errorMessage.set(null);
    try {
      let local = this.db.issues().find((i) => i.jiraIssueKey === issue.key);
      if (!local) {
        local = await this.db.createIssue({
          title: issue.summary,
          jiraIssueKey: issue.key,
          estimate: issue.estimateMinutes ?? 0,
          status: 'todo',
        });
      }
      const started = await this.timer.start(local.id);
      if (started) {
        await this.db.reloadTimeEntries();
      } else {
        this.errorMessage.set('Could not start the timer. Stop the running timer first.');
      }
    } catch (err) {
      console.error('Failed to start timer from backlog', err);
      this.errorMessage.set('Could not start the timer.');
    }
  }

  isRunning(issue: BacklogIssue): boolean {
    return this.runningKey() !== '' && this.runningKey() === issue.key;
  }

  async openInJira(issue: BacklogIssue): Promise<void> {
    const conn = this.jira.activeConnection();
    if (!conn) return;

    if ((conn.authType ?? 'api-key') === 'oauth') {
      // OAuth connections store the cloud id in `domain`, not a hostname, so
      // the browsable site url has to be resolved from accessible resources.
      const res = await this.jira.getAccessibleResources(conn.accessToken);
      const site = (res.resources ?? []).find(
        (r: any) => r.id === (conn.cloudId || conn.domain),
      );
      if (site?.url) {
        window.open(`${site.url.replace(/\/$/, '')}/browse/${issue.key}`, '_blank');
      }
      return;
    }

    window.open(`https://${conn.domain}/browse/${issue.key}`, '_blank');
  }

  statusClass(statusCategory: string): string {
    switch (statusCategory) {
      case 'indeterminate':
        return 'bg-primary/10 text-primary border-primary/20';
      case 'done':
        return 'bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20';
      default:
        return 'bg-muted/50 text-muted-foreground border-border/40';
    }
  }

  /** Remaining time turns amber when it is used up or above the original estimate. */
  remainingClass(issue: BacklogIssue): string {
    const remaining = issue.remainingMinutes;
    if (remaining === undefined) return '';
    const original = issue.estimateMinutes;
    if (remaining === 0 || (original !== undefined && remaining > original)) {
      return 'text-amber-600 dark:text-amber-400 font-semibold';
    }
    return '';
  }

  formatMinutes(minutes: number): string {
    if (minutes === 0) return '0m';
    if (minutes < 60) return `${minutes}m`;
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }

  formatShortDate(isoDate: string): string {
    const d = new Date(isoDate + 'T00:00:00');
    if (Number.isNaN(d.getTime())) return isoDate;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  isOverdue(issue: BacklogIssue): boolean {
    if (!issue.duedate) return false;
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    return issue.duedate < today;
  }

  formatDate(timestamp: number): string {
    const d = new Date(timestamp);
    const now = new Date();
    const diffDays = Math.floor(
      (now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24),
    );

    if (diffDays <= 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  private async loadFilters(): Promise<void> {
    try {
      const res = await this.jira.getBacklogFilters({
        projectKey: this.projectFilter() || undefined,
      });
      if (res.success) {
        this.projects.set(res.projects ?? []);
        this.sprints.set(res.sprints ?? []);
      }
    } catch (err) {
      // Filters are optional; the list still works with Current/All sprints.
      console.warn('Failed to load backlog filters', err);
    }
  }

  private async loadIssues(): Promise<void> {
    const seq = ++this.requestSeq;
    this.loading.set(true);
    this.errorMessage.set(null);

    try {
      const res = await this.jira.getBacklog({
        projectKey: this.projectFilter() || undefined,
        sprint: this.sprintFilter(),
      });
      if (seq !== this.requestSeq) return;

      if (!res.success) {
        this.issues.set([]);
        this.truncated.set(false);
        this.errorMessage.set(res.error ?? 'Failed to load the backlog.');
        return;
      }

      this.issues.set(res.issues ?? []);
      // A status that no longer exists in the reloaded list would hide everything.
      if (this.statusFilter() && !this.issues().some((i) => i.status === this.statusFilter())) {
        this.statusFilter.set('');
      }
      this.truncated.set(!!res.truncated);
      this.notice.set(
        res.sprintFallback
          ? "Sprint filtering isn't available on this Jira site. Showing all issues assigned to you."
          : null,
      );
    } catch (err) {
      if (seq !== this.requestSeq) return;
      console.error('Failed to load backlog', err);
      this.issues.set([]);
      this.errorMessage.set('Failed to load the backlog.');
    } finally {
      if (seq === this.requestSeq) this.loading.set(false);
    }
  }
}
