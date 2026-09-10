export interface Issue {
  id: string;
  title: string;
  description: string;
  projectId: string;
  status: 'todo' | 'in_progress' | 'done';
  jiraIssueKey: string | null;
  jiraConnectionId: string | null;
  estimate: number;
  timeSpent: number;
  isRunning: boolean;
  startTime: number | null;
  createdAt: number;
  date: string;
  /** Optional explicit accent colour. When unset, one is derived from the id. */
  color?: string | null;
}

export interface IssueCreate {
  title: string;
  description?: string;
  projectId?: string;
  status?: string;
  jiraIssueKey?: string | null;
  estimate?: number;
  date?: string;
  color?: string | null;
}

export interface IssueUpdate {
  title?: string;
  description?: string;
  projectId?: string;
  status?: string;
  jiraIssueKey?: string | null;
  jiraConnectionId?: string | null;
  estimate?: number;
  timeSpent?: number;
  isRunning?: boolean;
  startTime?: number | null;
  date?: string;
  color?: string | null;
}
