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
  color?: string | null;
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

/** One row of the Backlog page (Jira issue assigned to the current user). */
export interface BacklogIssue {
  key: string;
  summary: string;
  /** Status name, e.g. "In Progress". */
  status: string;
  /** Jira status category: "new" | "indeterminate" | "done". */
  statusCategory: string;
  priority: string;
  issueType: string;
  projectKey: string;
  projectName: string;
  labels: string[];
  estimateMinutes?: number;
  /** Epoch ms of the last update; 0 when Jira did not return one. */
  updated: number;
  duedate?: string | null;
}

export interface BacklogProject {
  key: string;
  name: string;
}

export interface BacklogSprint {
  id: number;
  name: string;
  state: string;
  startDate: string | null;
  boardName: string;
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

export interface DisplayInfo {
  id: number;
  label: string;
  isPrimary: boolean;
  bounds: { x: number; y: number; width: number; height: number };
  workArea: { x: number; y: number; width: number; height: number };
}

declare global {
  interface Window {
    electronAPI?: {
      app: {
        getVersion: () => Promise<string>;
        isDev: () => Promise<boolean>;
      };
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
        backlog: (params: {
          projectKey?: string;
          sprint?: string;
        }) => Promise<
          IpcResponse & {
            issues?: BacklogIssue[];
            sprintFallback?: boolean;
            truncated?: boolean;
          }
        >;
        backlogFilters: (params?: { projectKey?: string }) => Promise<
          IpcResponse & {
            projects?: BacklogProject[];
            sprints?: BacklogSprint[];
          }
        >;
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
        stop: (note?: string, stopTime?: number) => Promise<IpcResponse>;
        pause: () => Promise<IpcResponse>;
        resume: () => Promise<IpcResponse>;
        resumeEntry: (entryId: string) => Promise<IpcResponse>;
        getState: () => Promise<IpcResponse>;
        getElapsed: () => Promise<IpcResponse<number>>;
        getEntries: (filters?: any) => Promise<IpcResponse>;
        createEntry: (entry: any) => Promise<IpcResponse>;
        updateEntry: (id: string, updates: any) => Promise<IpcResponse>;
        deleteEntry: (id: string) => Promise<IpcResponse>;
        splitEntry: (id: string, splitTime: string, newIssueId?: string, newNote?: string) => Promise<IpcResponse>;
        splitOutEntry: (id: string, fromTime: string, toTime: string, newIssueId?: string, newNote?: string) => Promise<IpcResponse>;
        mergeEntries: (ids: string[], strategy: string, note?: string) => Promise<IpcResponse>;
        getDeletedWorklogs: () => Promise<IpcResponse & { worklogs?: any[] }>;
        clearDeletedWorklog: (id: string) => Promise<IpcResponse>;
      };
      display: {
        getDisplays: () => Promise<IpcResponse<{ displays: DisplayInfo[] }>>;
      };
      timerWindow: {
        create: (mode: 'draggable' | 'notch') => Promise<IpcResponse>;
        applyMode: (mode: 'draggable' | 'notch') => Promise<IpcResponse>;
        applyNotchAutoHide: (enabled: boolean) => Promise<IpcResponse>;
        applyNotchDisplay: (displayId: number | null) => Promise<IpcResponse>;
        setPinned: (pinned: boolean) => void;
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
      media: {
        setEnabled: (enabled: boolean) => Promise<{ success: boolean; state?: MediaState }>;
        getState: () => Promise<{ success: boolean; state?: MediaState }>;
        command: (cmd: 'toggle' | 'next' | 'prev') => void;
        onState: (callback: (state: MediaState) => void) => () => void;
      };
      agents: {
        setEnabled: (enabled: boolean) => Promise<{ success: boolean; state?: AgentsState }>;
        onState: (callback: (state: AgentsState) => void) => () => void;
      };
      updater: {
        checkForUpdates: () => Promise<IpcResponse>;
        quitAndInstall: () => Promise<IpcResponse>;
      };
      onDeepLink: (callback: (url: string) => void) => () => void;
    };
  }
}

export interface MediaState {
  active: boolean;
  status?: 'playing' | 'paused' | 'stopped';
  title?: string;
  artist?: string;
  album?: string;
  app?: string;
  cover?: string;
  coverMime?: string;
  positionMs?: number;
  durationMs?: number;
  canNext?: boolean;
  canPrev?: boolean;
}

export interface UsageWindow {
  usedPercent: number;
  windowMinutes: number;
  /** Unix seconds. */
  resetsAt: number;
}

export interface CodexState {
  available: boolean;
  primary?: UsageWindow;
  secondary?: UsageWindow;
  working?: boolean;
  updatedAt?: number;
}

export interface ClaudeState {
  available: boolean;
  primary?: UsageWindow;
  secondary?: UsageWindow;
  updatedAt?: number;
  scriptPath: string;
}

export interface AgentSession {
  id: string;
  agent: 'claude' | 'codex';
  project: string;
  working: boolean;
  activity: string;
  detail?: string;
  added: number;
  removed: number;
  toolCalls: number;
  updatedAt: number;
}

export interface AgentsState {
  codex: CodexState;
  claude: ClaudeState;
  sessions: AgentSession[];
}
