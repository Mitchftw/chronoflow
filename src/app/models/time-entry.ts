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

export interface TimeEntryCreate {
  issueId: string;
  startTime?: string;
  endTime?: string | null;
  date?: string;
  note?: string;
  isDirty?: boolean;
}

export interface TimeEntryUpdate {
  startTime?: string;
  endTime?: string | null;
  note?: string;
  jiraWorklogId?: string | null;
  isDirty?: boolean;
}
