import { Injectable, inject, signal } from '@angular/core';
import { IpcService } from './ipc.service';
import type { Project } from '../models/project';
import type { Issue } from '../models/issue';
import type { JiraIssue } from '../../types';
import type {
  TimeEntry,
  TimeEntryCreate,
  TimeEntryUpdate,
} from '../models/time-entry';
import type {
  JiraConnection,
  JiraConnectionCreate,
} from '../models/jira-connection';
import { format } from 'date-fns';

@Injectable({ providedIn: 'root' })
export class DatabaseService {
  private ipc = inject(IpcService);

  private readonly _projects = signal<Project[]>([]);
  private readonly _issues = signal<Issue[]>([]);
  private readonly _timeEntries = signal<TimeEntry[]>([]);
  private readonly _jiraConnections = signal<JiraConnection[]>([]);
  private readonly _loading = signal(false);

  readonly projects = this._projects.asReadonly();
  readonly issues = this._issues.asReadonly();
  readonly timeEntries = this._timeEntries.asReadonly();
  readonly jiraConnections = this._jiraConnections.asReadonly();
  readonly loading = this._loading.asReadonly();

  // ── Load ──

  async loadAll(): Promise<void> {
    this._loading.set(true);
    try {
      const [projects, issues, entries, connections] = await Promise.all([
        this.ipc.getProjects(),
        this.ipc.getIssues(),
        this.ipc.getTimeEntries(),
        this.ipc.jiraGetConnections(),
      ]);
      this._projects.set(projects);
      this._issues.set(issues);
      this._timeEntries.set(entries);
      this._jiraConnections.set(connections);
    } finally {
      this._loading.set(false);
    }
  }

  // ── Projects ──

  async reloadProjects(): Promise<void> {
    const projects = await this.ipc.getProjects();
    this._projects.set(projects);
  }

  async createProject(data: {
    name: string;
    description?: string;
    color?: string;
  }): Promise<Project> {
    const project = await this.ipc.createProject(data);
    this._projects.update((list) => [...list, project]);
    return project;
  }

  async updateProject(
    id: string,
    data: Partial<Project>,
  ): Promise<Project> {
    const project = await this.ipc.updateProject(id, data);
    this._projects.update((list) =>
      list.map((p) => (p.id === project.id ? project : p)),
    );
    return project;
  }

  async deleteProject(id: string): Promise<void> {
    await this.ipc.deleteProject(id);
    this._projects.update((list) => list.filter((p) => p.id !== id));
  }

  // ── Issues ──

  async reloadIssues(): Promise<void> {
    const issues = await this.ipc.getIssues();
    this._issues.set(issues);
  }

  async createIssue(data: { title: string; description?: string; projectId?: string; status?: string; jiraIssueKey?: string | null; estimate?: number }): Promise<Issue> {
    const issue = await this.ipc.createIssue(data);
    this._issues.update((list) => [...list, issue]);
    return issue;
  }

  async updateIssue(id: string, data: Partial<Issue>): Promise<Issue> {
    const issue = await this.ipc.updateIssue(id, data);
    this._issues.update((list) =>
      list.map((i) => (i.id === issue.id ? issue : i)),
    );
    return issue;
  }

  async deleteIssue(id: string): Promise<void> {
    await this.ipc.deleteIssue(id);
    this._issues.update((list) => list.filter((i) => i.id !== id));
  }

  // ── Time Entries ──

  async reloadTimeEntries(issueId?: string): Promise<void> {
    const entries = await this.ipc.getTimeEntries(issueId);
    this._timeEntries.set(entries);
  }

  async createTimeEntry(data: TimeEntryCreate): Promise<TimeEntry> {
    const entry = await this.ipc.createTimeEntry(data);
    this._timeEntries.update((list) => [...list, entry]);
    return entry;
  }

  async updateTimeEntry(
    id: string,
    data: TimeEntryUpdate,
  ): Promise<TimeEntry> {
    const entry = await this.ipc.updateTimeEntry(id, data);
    this._timeEntries.update((list) =>
      list.map((e) => (e.id === entry.id ? entry : e)),
    );
    return entry;
  }

  async deleteTimeEntry(id: string): Promise<void> {
    await this.ipc.deleteTimeEntry(id);
    this._timeEntries.update((list) => list.filter((e) => e.id !== id));
  }

  // ── Jira ──

  async reloadJiraConnections(): Promise<void> {
    const connections = await this.ipc.jiraGetConnections();
    this._jiraConnections.set(connections);
  }

  async syncLocalToJira(date: string): Promise<{ pushed: number; updated: number; deleted: number }> {
    this._loading.set(true);
    let pushed = 0;
    let updated = 0;
    let deleted = 0;

    try {
      const defaultConn = await this.ipc.jiraGetDefaultConnection();
      if (!defaultConn) throw new Error('No default Jira connection found');

      // 1. Process deletes
      const deletedWorklogs = await this.ipc.timerGetDeletedWorklogs();
      for (const dw of deletedWorklogs) {
        const res: any = await this.ipc.jiraDeleteWorklog({
          issueKey: dw.issueKey,
          worklogId: dw.jiraWorklogId,
        });
        if (res.success || (res.error && res.error.includes('404'))) {
          await this.ipc.timerClearDeletedWorklog(dw.id);
          deleted++;
        }
      }

      const localEntries = this.getTimeEntriesForDate(date);

      // 2. Process updates (where isDirty is true and jiraWorklogId is set)
      for (const entry of localEntries) {
        if (entry.jiraWorklogId && entry.isDirty && entry.endTime) {
          const issue = this.getIssueById(entry.issueId);
          if (issue?.jiraIssueKey) {
            const durationSeconds = Math.floor(this.getEntryDuration(entry) / 1000);
            if (durationSeconds > 0) {
              const res: any = await this.ipc.jiraUpdateWorklog({
                issueKey: issue.jiraIssueKey,
                worklogId: entry.jiraWorklogId,
                timeSpentSeconds: durationSeconds,
                started: `${entry.date}T${entry.startTime}.000+0000`,
                comment: entry.note,
              });

              if (res.success) {
                await this.updateTimeEntry(entry.id, {
                  isDirty: false,
                } as any);
                updated++;
              }
            }
          }
        }
      }

      // 3. Process adds (where jiraWorklogId is empty)
      for (const entry of localEntries) {
        if (!entry.jiraWorklogId && entry.endTime) {
          const issue = this.getIssueById(entry.issueId);
          if (issue?.jiraIssueKey) {
            const durationSeconds = Math.floor(this.getEntryDuration(entry) / 1000);
            if (durationSeconds > 0) {
              const res: any = await this.ipc.jiraSyncWorklog({
                issueKey: issue.jiraIssueKey,
                timeSpentSeconds: durationSeconds,
                started: `${entry.date}T${entry.startTime}.000+0000`,
                comment: entry.note,
              });

              if (res.success && res.worklog) {
                await this.updateTimeEntry(entry.id, {
                  jiraWorklogId: res.worklog.id,
                  isDirty: false,
                } as any);
                pushed++;
              }
            }
          }
        }
      }

      await this.loadAll();
      return { pushed, updated, deleted };
    } finally {
      this._loading.set(false);
    }
  }

  async loadFromJira(date: string): Promise<{ loadedIssues: number; loadedWorklogs: number }> {
    this._loading.set(true);
    let loadedIssues = 0;
    let loadedWorklogs = 0;

    try {
      const defaultConn = await this.ipc.jiraGetDefaultConnection();
      if (!defaultConn) throw new Error('No default Jira connection found');

      // 1. Load issues from Jira
      const jiraIssues = await this.ipc.jiraLoadIssues();
      for (const ji of jiraIssues) {
        let issue = this._issues().find((i) => i.jiraIssueKey === ji.key);
        if (!issue) {
          await this.createIssue({
            title: ji.summary,
            description: ji.description || '',
            jiraIssueKey: ji.key,
            estimate: ji.estimateMinutes,
          });
          loadedIssues++;
        } else {
          if (issue.title !== ji.summary || issue.estimate !== ji.estimateMinutes) {
            await this.updateIssue(issue.id, {
              title: ji.summary,
              estimate: ji.estimateMinutes,
            });
            loadedIssues++;
          }
        }
      }

      // 2. Load worklogs from Jira for this date
      const jiraWorklogs = await this.ipc.jiraGetWorklogsForDate(date);
      const localEntries = this.getTimeEntriesForDate(date);
      const jiraWorklogIds = new Set(jiraWorklogs.map((log) => log.id));

      // Delete local entries that were deleted on Jira (matching jiraWorklogId exists but is not in current Jira worklogs)
      for (const entry of localEntries) {
        if (entry.jiraWorklogId && !jiraWorklogIds.has(entry.jiraWorklogId)) {
          await this.deleteTimeEntry(entry.id);
        }
      }

      // Create or update local entries matching Jira worklogs
      for (const log of jiraWorklogs) {
        const localMatch = localEntries.find((e) => e.jiraWorklogId === log.id);
        let issue = this._issues().find((i) => i.jiraIssueKey === log.issueKey);
        if (!issue) {
          issue = await this.createIssue({
            title: log.issueSummary,
            jiraIssueKey: log.issueKey,
          });
        }

        const startTime = log.started.slice(11, 19);
        const durationMs = log.timeSpentSeconds * 1000;

        const [h, m, s] = startTime.split(':').map(Number);
        const startDate = new Date(2000, 0, 1, h, m, s);
        const endDate = new Date(startDate.getTime() + durationMs);
        const endTime = endDate.toTimeString().slice(0, 8);

        if (!localMatch) {
          const newEntry = await this.createTimeEntry({
            issueId: issue.id,
            startTime,
            date,
            note: log.comment || '',
          });
          if (newEntry) {
            await this.updateTimeEntry(newEntry.id, {
              jiraWorklogId: log.id,
              endTime,
              isDirty: false,
            } as any);
          }
          loadedWorklogs++;
        } else {
          const durationSeconds = Math.floor(this.getEntryDuration(localMatch) / 1000);
          if (
            localMatch.note !== (log.comment || '') ||
            durationSeconds !== log.timeSpentSeconds ||
            localMatch.startTime !== startTime ||
            localMatch.endTime !== endTime
          ) {
            await this.updateTimeEntry(localMatch.id, {
              note: log.comment || '',
              startTime,
              endTime,
              isDirty: false,
            } as any);
            loadedWorklogs++;
          }
        }
      }

      await this.loadAll();
      return { loadedIssues, loadedWorklogs };
    } finally {
      this._loading.set(false);
    }
  }

  async searchJira(query: string): Promise<JiraIssue[]> {
    return this.ipc.jiraSearch(query);
  }

  // ── Queries ──

  getTodaysTimeEntries(): TimeEntry[] {
    const today = format(new Date(), 'yyyy-MM-dd');
    return this._timeEntries().filter((e) => e.date === today);
  }

  getTimeEntriesForDate(date: string): TimeEntry[] {
    return this._timeEntries().filter((e) => e.date === date);
  }

  getIssuesForProject(projectId: string): Issue[] {
    return this._issues().filter((i) => i.projectId === projectId);
  }

  getIssueById(id: string): Issue | undefined {
    return this._issues().find((i) => i.id === id);
  }

  getProjectById(id: string): Project | undefined {
    return this._projects().find((p) => p.id === id);
  }

  getTotalTimeForDate(date: string): number {
    return this.getTimeEntriesForDate(date).reduce(
      (total, e) => total + this.getEntryDuration(e),
      0,
    );
  }

  getEntryDuration(entry: TimeEntry): number {
    if (!entry.endTime) return 0;
    const [startH, startM] = entry.startTime.split(':').map(Number);
    const [endH, endM] = entry.endTime.split(':').map(Number);
    return (endH * 60 + endM - (startH * 60 + startM)) * 60 * 1000;
  }
}
