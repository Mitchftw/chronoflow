import { Injectable, signal } from '@angular/core';
import type { Project } from '../models/project';
import type { Issue } from '../models/issue';
import type { TimeEntry } from '../models/time-entry';
import type { JiraConnection } from '../models/jira-connection';
import type { TimerState, IpcResponse, JiraIssue } from '../../types';
import type { IssueCreate } from '../models/issue';

@Injectable({ providedIn: 'root' })
export class IpcService {
  readonly isElectron = signal(!!window.electronAPI);

  // ── Namespace accessors ──

  private get store() {
    return window.electronAPI?.store;
  }

  private get jira() {
    return window.electronAPI?.jira;
  }

  private get timer() {
    return window.electronAPI?.timer;
  }

  private get idle() {
    return window.electronAPI?.idle;
  }

  private get win() {
    return window.electronAPI?.window;
  }

  private get timerWindow() {
    return window.electronAPI?.timerWindow;
  }

  // ── Settings (store namespace) ──

  async getSettings(): Promise<Record<string, unknown>> {
    const val = await this.store?.get('app');
    if (val && typeof val === 'object') return val as Record<string, unknown>;
    const legacy = await this.store?.get('settings');
    return (legacy && typeof legacy === 'object') ? legacy as Record<string, unknown> : {};
  }

  async setSettings(key: string, value: unknown): Promise<void> {
    await this.store?.set(key, value);
  }

  // ── Projects (store namespace) ──

  async getProjects(): Promise<Project[]> {
    return (await this.store?.get('projects')) ?? [];
  }

  async createProject(data: { name: string; description?: string; color?: string }): Promise<Project> {
    const projects = await this.getProjects();
    const project: Project = {
      id: crypto.randomUUID(),
      name: data.name,
      description: data.description ?? '',
      color: data.color ?? '#3b82f6',
      createdAt: Date.now(),
    };
    await this.store?.set('projects', [...projects, project]);
    return project;
  }

  async updateProject(id: string, data: Partial<Project>): Promise<Project> {
    const projects = await this.getProjects();
    const updated = projects.map((p) => (p.id === id ? { ...p, ...data } : p));
    await this.store?.set('projects', updated);
    return updated.find((p) => p.id === id)!;
  }

  async deleteProject(id: string): Promise<void> {
    const projects = await this.getProjects();
    await this.store?.set('projects', projects.filter((p) => p.id !== id));
  }

  // ── Issues (store namespace) ──

  async getIssues(): Promise<Issue[]> {
    return (await this.store?.get('issues')) ?? [];
  }

  async createIssue(data: { title: string; description?: string; projectId?: string; status?: string; jiraIssueKey?: string | null; estimate?: number }): Promise<Issue> {
    const issues = await this.getIssues();
    const issue: Issue = {
      id: crypto.randomUUID(),
      title: data.title,
      description: data.description ?? '',
      projectId: data.projectId ?? '',
      status: (data.status as Issue['status']) ?? 'todo',
      jiraIssueKey: data.jiraIssueKey ?? null,
      jiraConnectionId: null,
      estimate: data.estimate ?? 0,
      timeSpent: 0,
      isRunning: false,
      startTime: null,
      createdAt: Date.now(),
      date: new Date().toISOString().slice(0, 10),
    };
    await this.store?.set('issues', [...issues, issue]);
    return issue;
  }

  async updateIssue(id: string, data: Partial<Issue>): Promise<Issue> {
    const issues = await this.getIssues();
    const updated = issues.map((i) => (i.id === id ? { ...i, ...data } : i));
    await this.store?.set('issues', updated);
    return updated.find((i) => i.id === id)!;
  }

  async deleteIssue(id: string): Promise<void> {
    const issues = await this.getIssues();
    await this.store?.set('issues', issues.filter((i) => i.id !== id));
  }

  // ── Time Entries (database-backed) ──

  async getTimeEntries(issueId?: string): Promise<TimeEntry[]> {
    const res: any = await this.timer?.getEntries(issueId ? { issueId } : undefined);
    return res?.success ? (res.data ?? []) : [];
  }

  async createTimeEntry(data: { issueId: string; startTime?: string; endTime?: string | null; date?: string; note?: string }): Promise<TimeEntry> {
    const entry: TimeEntry = {
      id: crypto.randomUUID(),
      issueId: data.issueId,
      startTime: data.startTime ?? new Date().toISOString().slice(11, 19),
      endTime: data.endTime ?? null,
      date: data.date ?? new Date().toISOString().slice(0, 10),
      note: data.note ?? '',
      jiraWorklogId: null,
      isDirty: true,
    };
    const res: any = await this.timer?.createEntry(entry);
    if (!res?.success) throw new Error(res?.error ?? 'Failed to create time entry');
    return res.data || entry;
  }

  async updateTimeEntry(id: string, data: Partial<TimeEntry>): Promise<TimeEntry> {
    const res: any = await this.timer?.updateEntry(id, data);
    if (!res?.success) throw new Error(res?.error ?? 'Failed to update time entry');
    const entries = await this.getTimeEntries();
    return entries.find((e) => e.id === id)!;
  }

  async deleteTimeEntry(id: string): Promise<void> {
    const res: any = await this.timer?.deleteEntry(id);
    if (!res?.success) throw new Error(res?.error ?? 'Failed to delete time entry');
  }

  // ── Jira ──

  async jiraSearch(query: string): Promise<JiraIssue[]> {
    const res: any = await this.jira?.search({ query });
    return res?.success ? (res.issues ?? []) : [];
  }

  async jiraSyncWorklog(params: {
    issueKey: string;
    timeSpentSeconds: number;
    started: string;
    comment?: string;
  }): Promise<IpcResponse> {
    const defaultConn = await this.jiraGetDefaultConnection();
    if (!defaultConn) return { success: false, error: 'No default Jira connection' };
    return (await this.jira?.addWorklog({
      ...defaultConn,
      ...params,
    })) ?? { success: false, error: 'Jira API not available' };
  }

  async jiraUpdateWorklog(params: {
    issueKey: string;
    worklogId: string;
    timeSpentSeconds: number;
    started: string;
    comment?: string;
  }): Promise<IpcResponse> {
    const defaultConn = await this.jiraGetDefaultConnection();
    if (!defaultConn) return { success: false, error: 'No default Jira connection' };
    return (await this.jira?.updateWorklog({
      ...defaultConn,
      ...params,
    })) ?? { success: false, error: 'Jira API not available' };
  }

  async jiraDeleteWorklog(params: {
    issueKey: string;
    worklogId: string;
  }): Promise<IpcResponse> {
    const defaultConn = await this.jiraGetDefaultConnection();
    if (!defaultConn) return { success: false, error: 'No default Jira connection' };
    return (await this.jira?.deleteWorklog({
      ...defaultConn,
      ...params,
    })) ?? { success: false, error: 'Jira API not available' };
  }

  async jiraLoadIssues(): Promise<any[]> {
    const defaultConn = await this.jiraGetDefaultConnection();
    if (!defaultConn) return [];
    const res: any = await this.jira?.loadIssues(defaultConn);
    return res?.success ? (res.issues ?? []) : [];
  }

  async timerGetDeletedWorklogs(): Promise<any[]> {
    const res: any = await this.timer?.getDeletedWorklogs();
    return res?.success ? (res.worklogs ?? []) : [];
  }

  async timerClearDeletedWorklog(id: string): Promise<boolean> {
    const res: any = await this.timer?.clearDeletedWorklog(id);
    return res?.success ?? false;
  }

  async jiraGetConnections(): Promise<JiraConnection[]> {
    const res: any = await this.jira?.getConnections();
    return res?.success ? (res.connections ?? []) : [];
  }

  async jiraGetDefaultConnection(): Promise<JiraConnection | null> {
    const res: any = await this.jira?.getDefaultConnection();
    return res ?? null;
  }

  async jiraGetWorklogsForDate(date: string): Promise<any[]> {
    const defaultConn = await this.jiraGetDefaultConnection();
    if (!defaultConn) return [];
    
    const res: any = await this.jira?.getWorklogsForDate({
      ...defaultConn,
      date
    });
    return res?.success ? (res.worklogs ?? []) : [];
  }

  async jiraCreateConnection(data: any): Promise<JiraConnection> {
    const res: any = await this.jira?.createConnection(data);
    if (!res?.success) throw new Error(res?.error ?? 'Failed to create connection');
    return res.connection;
  }

  // ── Timer ──

  async startTimer(issueId: string): Promise<IpcResponse> {
    return (await this.timer?.start(issueId)) ?? { success: false, error: 'Timer API not available' };
  }

  async stopTimer(stopTime?: number): Promise<IpcResponse> {
    return (await this.timer?.stop(stopTime)) ?? { success: false, error: 'Timer API not available' };
  }

  async pauseTimer(): Promise<IpcResponse> {
    return (await this.timer?.pause()) ?? { success: false, error: 'Timer API not available' };
  }

  async resumeTimer(): Promise<IpcResponse> {
    return (await this.timer?.resume()) ?? { success: false, error: 'Timer API not available' };
  }

  async getTimerState(): Promise<TimerState | null> {
    const res = await this.timer?.getState();
    return res?.success ? (res.data ?? null) : null;
  }

  async getTimerElapsed(): Promise<number> {
    const res = await this.timer?.getElapsed();
    return res?.success ? (res.data ?? 0) : 0;
  }

  // ── Idle / Power ──

  async getIdleTime(): Promise<number> {
    return (await this.idle?.getTime()) ?? 0;
  }

  onPowerSuspend(callback: () => void): () => void {
    return this.idle?.onPowerSuspend(callback) ?? (() => {});
  }

  onPowerResume(callback: () => void): () => void {
    return this.idle?.onPowerResume(callback) ?? (() => {});
  }

  onPowerLock(callback: () => void): () => void {
    return this.idle?.onPowerLock(callback) ?? (() => {});
  }

  onPowerUnlock(callback: () => void): () => void {
    return this.idle?.onPowerUnlock(callback) ?? (() => {});
  }

  // ── Timer Window ──

  async createTimerWindow(mode: 'draggable' | 'notch'): Promise<IpcResponse> {
    return (await this.timerWindow?.create(mode)) ?? { success: false, error: 'Timer window API not available' };
  }

  async hideTimerWindow(): Promise<void> {
    await this.timerWindow?.hide();
  }

  restoreMainWindow(): void {
    this.timerWindow?.expand();
  }

  onTimerWindowStateUpdate(callback: (state: TimerState) => void): () => void {
    return this.timerWindow?.onStateUpdate(callback) ?? (() => {});
  }

  setIgnoreMouse(ignore: boolean): void {
    this.timerWindow?.setIgnoreMouse(ignore);
  }

  async resizeTimerWindow(width: number, height: number): Promise<void> {
    await this.timerWindow?.resize(width, height);
  }

  // ── Window Controls ──

  minimize(): void {
    this.win?.minimize();
  }

  maximize(): void {
    this.win?.maximize();
  }

  close(): void {
    this.win?.close();
  }

  // ── Deep Links ──

  onDeepLink(callback: (url: string) => void): () => void {
    return window.electronAPI?.onDeepLink(callback) ?? (() => {});
  }
}
