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
}

export interface IssueCreate {
  title: string;
  description?: string;
  projectId?: string;
  status?: string;
  jiraIssueKey?: string | null;
  estimate?: number;
  date?: string;
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
}
