export interface Project {
  id: string;
  name: string;
  description: string;
  color: string;
  createdAt: number;
}

export interface Issue {
  id: string;
  title: string;
  description: string;
  projectId: string;
  status: "todo" | "in_progress" | "done";
  jiraIssueKey: string | null;
  jiraConnectionId: string | null;
  estimate: number;
  timeSpent: number;
  isRunning: boolean;
  startTime: number | null;
  createdAt: number;
  date: string;
}

export interface TimeEntry {
  id: string;
  issueId: string;
  startTime: string;
  endTime: string | null;
  date: string;
  note: string;
  jiraWorklogId: string | null;
  isDirty?: boolean;
}

export interface JiraConnection {
  id: string;
  name: string;
  authType: string;
  domain: string;
  email: string;
  apiToken: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number | null;
  cloudId: string;
  isDefault: boolean;
  clientId?: string;
  clientSecret?: string;
  createdAt: number;
  updatedAt: number;
}

export interface JiraIssue {
  key: string;
  summary: string;
  description?: string;
  estimateMinutes?: number;
}

export interface JiraWorklog {
  issueKey: string;
  issueSummary: string;
  started: string;
  timeSpentSeconds: number;
  comment?: string;
}

export interface TimerState {
  isRunning: boolean;
  isPaused: boolean;
  issueId: string | null;
  entryId: string | null;
  startTime: number | null;
  elapsed: number;
}

export interface IpcResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
}

declare global {
  interface Window {
    electronAPI?: {
      window: {
        minimize: () => Promise<void>;
        maximize: () => Promise<void>;
        close: () => Promise<void>;
      };
      store: {
        get: (key: string) => Promise<any>;
        set: (key: string, value: any) => Promise<void>;
        delete: (key: string) => Promise<void>;
      };
      jira: {
        exchangeCode: (params: { code: string; redirectUri: string; codeVerifier?: string; clientId?: string; clientSecret?: string }) => Promise<IpcResponse & { data?: any }>;
        getConfig: () => Promise<{ clientId: string }>;
        getAccessibleResources: (accessToken: string) => Promise<IpcResponse & { resources?: JiraResource[] }>;

        search: (params: any) => Promise<IpcResponse>;
        addWorklog: (params: any) => Promise<IpcResponse>;
        updateWorklog: (params: any) => Promise<IpcResponse>;
        deleteWorklog: (params: any) => Promise<IpcResponse>;
        loadIssues: (params: any) => Promise<IpcResponse & { issues?: any[] }>;
        getWorklogsForDate: (params: any) => Promise<IpcResponse>;
        getConnections: () => Promise<IpcResponse>;
        getDefaultConnection: () => Promise<any>;
        createConnection: (data: any) => Promise<IpcResponse>;
        updateConnection: (params: { id: string; updates: any }) => Promise<IpcResponse>;
        deleteConnection: (params: { id: string }) => Promise<IpcResponse>;
        testConnection: (params: any) => Promise<IpcResponse & { user?: { displayName: string; emailAddress: string; accountId: string } }>;
      };
      timer: {
        start: (issueId: string) => Promise<IpcResponse>;
        stop: (stopTime?: number) => Promise<IpcResponse>;
        pause: () => Promise<IpcResponse>;
        resume: () => Promise<IpcResponse>;
        getState: () => Promise<IpcResponse>;
        getElapsed: () => Promise<IpcResponse<number>>;
        getEntries: (filters?: any) => Promise<IpcResponse>;
        createEntry: (entry: any) => Promise<IpcResponse>;
        updateEntry: (id: string, updates: any) => Promise<IpcResponse>;
        deleteEntry: (id: string) => Promise<IpcResponse>;
        splitEntry: (id: string, splitTime: string, newIssueId?: string) => Promise<IpcResponse>;
        mergeEntries: (ids: string[], strategy: string, note?: string) => Promise<IpcResponse>;
        getDeletedWorklogs: () => Promise<IpcResponse & { worklogs?: any[] }>;
        clearDeletedWorklog: (id: string) => Promise<IpcResponse>;
      };
      timerWindow: {
        create: (mode: 'draggable' | 'notch') => Promise<IpcResponse>;
        hide: () => Promise<void>;
        expand: () => Promise<void>;
        onStateUpdate: (callback: (state: any) => void) => () => void;
        setIgnoreMouse: (ignore: boolean) => void;
        resize: (width: number, height: number) => Promise<void>;
      };
      idle: {
        getTime: () => Promise<number>;
        onPowerSuspend: (callback: () => void) => () => void;
        onPowerResume: (callback: () => void) => () => void;
        onPowerLock: (callback: () => void) => () => void;
        onPowerUnlock: (callback: () => void) => () => void;
      };
      updater: {
        checkForUpdates: () => Promise<IpcResponse>;
        quitAndInstall: () => Promise<IpcResponse>;
      };
      onDeepLink: (callback: (url: string) => void) => () => void;
    };
  }
}
