import { Injectable, inject, computed, signal } from '@angular/core';
import type { JiraConnection, JiraIssue, TimeEntry, IpcResponse } from '../../types';

@Injectable({ providedIn: 'root' })
export class JiraService {
  /** All saved Jira connections */
  private readonly _connections = signal<JiraConnection[]>([]);
  readonly connections = this._connections.asReadonly();

  /** Whether at least one valid connection exists */
  readonly isConnected = computed(() => this._connections().length > 0);

  /** Currently active Jira connection (first default, or first) */
  readonly activeConnection = computed<JiraConnection | null>(() => {
    const conns = this._connections();
    return conns.find((c) => c.isDefault) ?? conns[0] ?? null;
  });

  /** OAuth state for the in-progress flow */
  private oauthPromiseResolve: ((params: { code: string; redirectUri: string }) => void) | null = null;
  private oauthPromiseReject: ((err: Error) => void) | null = null;

  constructor() {
    this.loadConnections();
  }

  // ── Connection Management ──

  /** Load all saved Jira connections from the main process */
  async loadConnections(): Promise<JiraConnection[]> {
    const api = this.getJiraApi();
    if (!api) return [];

    try {
      const res = await api.getConnections();
      if (res.success && res.connections) {
        this._connections.set(res.connections as JiraConnection[]);
        return res.connections as JiraConnection[];
      }
    } catch {
      // Graceful fallback
    }
    return [];
  }

  /** Create a new Jira connection */
  async createConnection(data: {
    name?: string;
    domain: string;
    authType: string;
    email?: string;
    apiToken?: string;
    accessToken?: string;
    refreshToken?: string;
    expiresAt?: number | null;
    cloudId?: string;
    isDefault?: boolean;
    clientId?: string;
    clientSecret?: string;
  }): Promise<JiraConnection | null> {
    const api = this.getJiraApi();
    if (!api) return null;

    try {
      const res = await api.createConnection(data);
      if (res.success && res.connection) {
        await this.loadConnections();
        return res.connection as JiraConnection;
      }
    } catch {
      // Graceful fallback
    }
    return null;
  }

  /** Update an existing Jira connection */
  async updateConnection(id: string, updates: Partial<JiraConnection>): Promise<JiraConnection | null> {
    const api = this.getJiraApi();
    if (!api) return null;

    try {
      const res = await api.updateConnection({ id, updates });
      if (res.success && res.connection) {
        await this.loadConnections();
        return res.connection as JiraConnection;
      }
    } catch {
      // Graceful fallback
    }
    return null;
  }

  /** Delete a Jira connection */
  async deleteConnection(id: string): Promise<boolean> {
    const api = this.getJiraApi();
    if (!api) return false;

    try {
      const res = await api.deleteConnection({ id });
      if (res.success) {
        await this.loadConnections();
        return true;
      }
    } catch {
      // Graceful fallback
    }
    return false;
  }

  /** Get the default connection */
  async getDefaultConnection(): Promise<JiraConnection | null> {
    const api = this.getJiraApi();
    if (!api) return null;

    try {
      const conn = await api.getDefaultConnection();
      return conn ?? null;
    } catch {
      return null;
    }
  }

  // ── Issue Search ──

  /** Search Jira issues across all active connections */
  async searchIssues(query: string, connectionId?: string): Promise<JiraIssue[]> {
    const api = this.getJiraApi();
    if (!api || !query.trim()) return [];

    const allIssues: JiraIssue[] = [];
    const conns = connectionId
      ? this._connections().filter((c) => c.id === connectionId)
      : this._connections();

    for (const conn of conns) {
      try {
        const res = await api.search({
          authType: conn.authType ?? 'api-key',
          domain: conn.domain,
          email: conn.email,
          apiToken: conn.apiToken,
          accessToken: conn.accessToken,
          query: query.trim(),
        });
        if (res.success && res.issues) {
          allIssues.push(...(res.issues as JiraIssue[]));
        }
      } catch {
        // Skip connections that error
      }
    }

    return allIssues;
  }

  // ── Worklog Sync ──

  /** Sync a single time entry to Jira as a worklog */
  async syncWorklog(
    timeEntry: TimeEntry,
    connection: JiraConnection,
    comment?: string,
    issueKey?: string,
  ): Promise<{ success: boolean; worklogId?: string; error?: string }> {
    const api = this.getJiraApi();
    if (!api) {
      return { success: false, error: 'Jira API not available' };
    }

    const resolvedKey = issueKey || this.resolveIssueKey(timeEntry);
    if (!resolvedKey) {
      return { success: false, error: 'No Jira issue key associated with this time entry' };
    }

    const startTime = timeEntry.startTime;
    const endTime = timeEntry.endTime;
    if (!endTime) {
      return { success: false, error: 'Time entry is still running' };
    }

    const timeSpentSeconds = Math.max(
      1,
      Math.round((new Date(endTime).getTime() - new Date(startTime).getTime()) / 1000),
    );

    // If we already have a worklog id, update the existing worklog
    if (timeEntry.jiraWorklogId) {
      // Jira doesn't support PUT worklog via the simple API easily,
      // so we'll delete and re-add (or use the addWorklog with issue key approach)
    }

    try {
      const res = await api.addWorklog({
        authType: connection.authType ?? 'api-key',
        domain: connection.domain,
        email: connection.email,
        apiToken: connection.apiToken,
        accessToken: connection.accessToken,
        issueKey: resolvedKey,
        timeSpentSeconds,
        comment: comment ?? `Work tracked via ChronoFlow`,
        started: new Date(startTime).toISOString(),
      });

      if (res.success && res.worklog) {
        return {
          success: true,
          worklogId: (res.worklog as any).id ?? (res.worklog as any).worklogId,
        };
      }

      return { success: false, error: res.error ?? 'Unknown error syncing worklog' };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  }

  /** Sync all time entries for a given date that have issue keys */
  async syncAllForDate(
    date: string,
    entries: TimeEntry[],
  ): Promise<Array<{ entryId: string; success: boolean; worklogId?: string; error?: string }>> {
    const defaultConn = await this.getDefaultConnection();
    if (!defaultConn) {
      return entries.map((e) => ({ entryId: e.id, success: false, error: 'No Jira connection configured' }));
    }

    const results: Array<{ entryId: string; success: boolean; worklogId?: string; error?: string }> = [];

    for (const entry of entries) {
      const issueKey = this.resolveIssueKey(entry);
      if (!issueKey) continue;

      const result = await this.syncWorklog(entry, defaultConn);
      results.push({ entryId: entry.id, ...result });
    }

    return results;
  }

  // ── OAuth ──

  private generateCodeVerifier(): string {
    const array = new Uint8Array(32);
    window.crypto.getRandomValues(array);
    return this.base64UrlEncode(array);
  }

  private base64UrlEncode(array: Uint8Array): string {
    let binary = '';
    const len = array.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(array[i]);
    }
    const base64 = btoa(binary);
    return base64
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
  }

  private async generateCodeChallenge(verifier: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(verifier);
    const hash = await window.crypto.subtle.digest('SHA-256', data);
    return this.base64UrlEncode(new Uint8Array(hash));
  }

  /** Start the OAuth flow. Opens the Jira OAuth authorization URL in the browser. */
  async startOAuthFlow(clientId: string, redirectUri: string): Promise<{ code: string; redirectUri: string; codeVerifier: string }> {
    const verifier = this.generateCodeVerifier();
    const challenge = await this.generateCodeChallenge(verifier);

    return new Promise((resolve, reject) => {
      this.oauthPromiseResolve = ({ code, redirectUri }) => {
        resolve({ code, redirectUri, codeVerifier: verifier });
      };
      this.oauthPromiseReject = reject;

      // Register deep link handler
      const cleanup = this.listenForDeepLink((url: string) => {
        try {
          const parsed = new URL(url);
          const code = parsed.searchParams.get('code');
          if (code) {
            resolve({ code, redirectUri, codeVerifier: verifier });
            cleanup();
          }
        } catch {
          // Invalid callback URL
        }
      });

      // Open the OAuth URL in the default browser
      const oauthUrl = `https://auth.atlassian.com/authorize?audience=api.atlassian.com&client_id=${encodeURIComponent(clientId)}&scope=${encodeURIComponent('read:jira-work write:jira-work read:jira-user offline_access')}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&prompt=consent&code_challenge=${encodeURIComponent(challenge)}&code_challenge_method=S256`;

      window.open(oauthUrl, '_blank');

      // Timeout after 5 minutes
      setTimeout(() => {
        this.oauthPromiseResolve = null;
        this.oauthPromiseReject = null;
        reject(new Error('OAuth flow timed out after 5 minutes'));
      }, 5 * 60 * 1000);
    });
  }

  /** Exchange OAuth authorization code for tokens */
  async exchangeCode(
    code: string,
    redirectUri: string,
    codeVerifier: string,
    clientId?: string,
    clientSecret?: string,
  ): Promise<IpcResponse> {
    const api = this.getJiraApi();
    if (!api) {
      return { success: false, error: 'Jira API not available' };
    }

    try {
      return await api.exchangeCode({ code, redirectUri, codeVerifier, clientId, clientSecret });
    } catch (err) {
      return { success: false, error: String(err) };
    }
  }

  /** Get Jira configuration */
  async getConfig(): Promise<{ clientId: string }> {
    const api = this.getJiraApi();
    if (!api) {
      throw new Error('Jira API not available');
    }
    return await api.getConfig();
  }

  /** Get accessible Jira resources (sites) after OAuth */
  async getAccessibleResources(accessToken: string): Promise<IpcResponse & { resources?: any[] }> {
    const api = this.getJiraApi();
    if (!api) {
      return { success: false, error: 'Jira API not available' };
    }

    try {
      return await api.getAccessibleResources(accessToken);
    } catch (err) {
      return { success: false, error: String(err) };
    }
  }

  /** Test a connection */
  async testConnection(params: {
    connectionId?: string;
    authType: 'api-key' | 'oauth';
    domain: string;
    email?: string;
    apiToken?: string;
    accessToken?: string;
  }): Promise<IpcResponse & { user?: { displayName: string; emailAddress: string; accountId: string } }> {
    const api = this.getJiraApi();
    if (!api) {
      return { success: false, error: 'Jira API not available' };
    }

    try {
      return await api.testConnection(params);
    } catch (err) {
      return { success: false, error: String(err) };
    }
  }

  // ── Private Helpers ──

  private getJiraApi() {
    return (window as any).electronAPI?.jira ?? null;
  }

  private resolveIssueKey(entry: TimeEntry): string | null {
    // If entry has issueKey stored directly, use it
    if ((entry as any).issueKey) return (entry as any).issueKey;
    // Otherwise, the issueId might reference a Jira issue key
    return null;
  }

  private listenForDeepLink(handler: (url: string) => void): () => void {
    const api = (window as any).electronAPI;
    if (api?.onDeepLink) {
      return api.onDeepLink(handler);
    }

    // Fallback: listen for a custom event
    const eventHandler = ((event: CustomEvent<string>) => {
      if (event.detail) handler(event.detail);
    }) as EventListener;

    window.addEventListener('jira:deep-link', eventHandler);
    return () => window.removeEventListener('jira:deep-link', eventHandler);
  }
}
