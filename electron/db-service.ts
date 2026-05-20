import { getDatabase } from "./database";
import type { Project, Issue, TimeEntry, JiraConnection } from "../src/types";
import { randomUUID } from "crypto";

function normalizeTime(time: string | null | undefined): string | null {
  if (!time) return null;
  const trimmed = time.trim();
  if (!trimmed) return null;

  const parts = trimmed.split(":");
  if (parts.length === 2) {
    return `${trimmed}:00`;
  }
  if (parts.length === 1) {
    return `${trimmed}:00:00`;
  }
  return trimmed;
}

// ---- Projects ----

export async function getAllProjects(): Promise<Project[]> {
  const db = getDatabase();
  const rows = await db.all("SELECT * FROM projects ORDER BY created_at DESC");

  return (rows as any[]).map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    color: row.color,
    createdAt: row.created_at,
  }));
}

export async function getProject(id: string): Promise<Project | null> {
  const db = getDatabase();
  const row = await db.get("SELECT * FROM projects WHERE id = ?", id);
  if (!row) return null;
  const r = row as any;
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    color: r.color,
    createdAt: r.created_at,
  };
}

export async function createProject(project: Project): Promise<void> {
  const db = getDatabase();
  await db.run(
    `INSERT INTO projects (id, name, description, color, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    project.id,
    project.name,
    project.description || null,
    project.color || null,
    project.createdAt,
  );
}

export async function updateProject(
  id: string,
  updates: Partial<Project>,
): Promise<void> {
  const db = getDatabase();
  const fields: string[] = [];
  const values: any[] = [];

  if (updates.name !== undefined) {
    fields.push("name = ?");
    values.push(updates.name);
  }
  if (updates.description !== undefined) {
    fields.push("description = ?");
    values.push(updates.description);
  }
  if (updates.color !== undefined) {
    fields.push("color = ?");
    values.push(updates.color);
  }

  if (fields.length === 0) return;
  values.push(id);
  await db.run(
    `UPDATE projects SET ${fields.join(", ")} WHERE id = ?`,
    ...values,
  );
}

export async function deleteProject(id: string): Promise<void> {
  const db = getDatabase();
  await db.run("DELETE FROM projects WHERE id = ?", id);
}

// ---- Issues ----

export async function getIssues(filters?: {
  date?: string;
  projectId?: string;
  status?: string;
  startDate?: string;
  endDate?: string;
}): Promise<Issue[]> {
  const db = getDatabase();
  let query = "SELECT * FROM issues";
  const conditions: string[] = [];
  const params: any[] = [];

  if (filters?.date) {
    conditions.push("date = ?");
    params.push(filters.date);
  }
  if (filters?.projectId) {
    conditions.push("project_id = ?");
    params.push(filters.projectId);
  }
  if (filters?.status) {
    conditions.push("status = ?");
    params.push(filters.status);
  }
  if (filters?.startDate) {
    conditions.push("date >= ?");
    params.push(filters.startDate);
  }
  if (filters?.endDate) {
    conditions.push("date <= ?");
    params.push(filters.endDate);
  }

  if (conditions.length > 0) {
    query += ` WHERE ${conditions.join(" AND ")}`;
  }

  query += " ORDER BY created_at DESC";

  const rows = await db.all(query, ...params);
  return (rows as any[]).map((row) => ({
    id: row.id,
    title: row.title,
    description: row.description,
    projectId: row.project_id,
    status: row.status as "todo" | "in_progress" | "done",
    jiraIssueKey: row.jira_issue_key,
    jiraConnectionId: row.jira_connection_id,
    estimate: row.estimate ?? 0,
    timeSpent: row.time_spent ?? 0,
    isRunning: row.is_running === 1,
    startTime: row.start_time,
    createdAt: row.created_at,
    date: row.date,
  }));
}

export async function getIssue(id: string): Promise<Issue | null> {
  const db = getDatabase();
  const row = await db.get("SELECT * FROM issues WHERE id = ?", id);
  if (!row) return null;
  const r = row as any;
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    projectId: r.project_id,
    status: r.status as "todo" | "in_progress" | "done",
    jiraIssueKey: r.jira_issue_key,
    jiraConnectionId: r.jira_connection_id,
    estimate: r.estimate ?? 0,
    timeSpent: r.time_spent ?? 0,
    isRunning: r.is_running === 1,
    startTime: r.start_time,
    createdAt: r.created_at,
    date: r.date,
  };
}

export async function createIssue(issue: Issue): Promise<void> {
  const db = getDatabase();
  await db.run(
    `INSERT INTO issues (
      id, title, description, project_id, status,
      jira_issue_key, jira_connection_id, estimate, time_spent,
      is_running, start_time, created_at, date
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    issue.id,
    issue.title,
    issue.description || null,
    issue.projectId || null,
    issue.status || "todo",
    issue.jiraIssueKey || null,
    issue.jiraConnectionId || null,
    issue.estimate ?? 0,
    issue.timeSpent ?? 0,
    issue.isRunning ? 1 : 0,
    issue.startTime || null,
    issue.createdAt,
    issue.date,
  );
}

export async function updateIssue(
  id: string,
  updates: Partial<Issue>,
): Promise<void> {
  const db = getDatabase();
  const fields: string[] = [];
  const values: any[] = [];

  if (updates.title !== undefined) {
    fields.push("title = ?");
    values.push(updates.title);
  }
  if (updates.description !== undefined) {
    fields.push("description = ?");
    values.push(updates.description);
  }
  if (updates.projectId !== undefined) {
    fields.push("project_id = ?");
    values.push(updates.projectId);
  }
  if (updates.status !== undefined) {
    fields.push("status = ?");
    values.push(updates.status);
  }
  if (updates.jiraIssueKey !== undefined) {
    fields.push("jira_issue_key = ?");
    values.push(updates.jiraIssueKey);
  }
  if (updates.jiraConnectionId !== undefined) {
    fields.push("jira_connection_id = ?");
    values.push(updates.jiraConnectionId);
  }
  if (updates.estimate !== undefined) {
    fields.push("estimate = ?");
    values.push(updates.estimate);
  }
  if (updates.timeSpent !== undefined) {
    fields.push("time_spent = ?");
    values.push(updates.timeSpent);
  }
  if (updates.isRunning !== undefined) {
    fields.push("is_running = ?");
    values.push(updates.isRunning ? 1 : 0);
  }
  if (updates.startTime !== undefined) {
    fields.push("start_time = ?");
    values.push(updates.startTime);
  }
  if (updates.date !== undefined) {
    fields.push("date = ?");
    values.push(updates.date);
  }

  if (fields.length === 0) return;
  values.push(id);
  await db.run(
    `UPDATE issues SET ${fields.join(", ")} WHERE id = ?`,
    ...values,
  );
}

export async function deleteIssue(id: string): Promise<void> {
  const db = getDatabase();
  await db.run("DELETE FROM issues WHERE id = ?", id);
}

// ---- Time Entries ----

export async function getTimeEntries(filters?: {
  date?: string;
  issueId?: string;
  startDate?: string;
  endDate?: string;
}): Promise<TimeEntry[]> {
  const db = getDatabase();
  let query = "SELECT * FROM time_entries";
  const conditions: string[] = [];
  const params: any[] = [];

  if (filters?.date) {
    conditions.push("date = ?");
    params.push(filters.date);
  }
  if (filters?.issueId) {
    conditions.push("issue_id = ?");
    params.push(filters.issueId);
  }
  if (filters?.startDate) {
    conditions.push("date >= ?");
    params.push(filters.startDate);
  }
  if (filters?.endDate) {
    conditions.push("date <= ?");
    params.push(filters.endDate);
  }

  if (conditions.length > 0) {
    query += ` WHERE ${conditions.join(" AND ")}`;
  }

  query += " ORDER BY date DESC, start_time DESC";

  const rows = await db.all(query, ...params);
  return (rows as any[]).map((row) => ({
    id: row.id,
    issueId: row.issue_id,
    startTime: row.start_time,
    endTime: row.end_time,
    date: row.date,
    note: row.note,
    jiraWorklogId: row.jira_worklog_id,
    isDirty: row.is_dirty === 1,
  }));
}

export async function createTimeEntry(entry: TimeEntry): Promise<void> {
  const db = getDatabase();
  const isDirty = entry.isDirty !== undefined ? entry.isDirty : (entry.jiraWorklogId ? false : true);
  await db.run(
    `INSERT INTO time_entries (id, issue_id, start_time, end_time, date, note, jira_worklog_id, is_dirty)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    entry.id,
    entry.issueId,
    normalizeTime(entry.startTime) || "00:00:00",
    normalizeTime(entry.endTime),
    entry.date,
    entry.note || null,
    entry.jiraWorklogId || null,
    isDirty ? 1 : 0,
  );
}

export async function updateTimeEntry(
  id: string,
  updates: Partial<TimeEntry>,
): Promise<void> {
  const db = getDatabase();
  const fields: string[] = [];
  const values: any[] = [];
  let shouldSetDirty = false;

  if (updates.startTime !== undefined) {
    fields.push("start_time = ?");
    values.push(normalizeTime(updates.startTime) || "00:00:00");
    shouldSetDirty = true;
  }
  if (updates.endTime !== undefined) {
    fields.push("end_time = ?");
    values.push(normalizeTime(updates.endTime));
    shouldSetDirty = true;
  }
  if (updates.date !== undefined) {
    fields.push("date = ?");
    values.push(updates.date);
    shouldSetDirty = true;
  }
  if (updates.note !== undefined) {
    fields.push("note = ?");
    values.push(updates.note);
    shouldSetDirty = true;
  }
  if (updates.issueId !== undefined) {
    fields.push("issue_id = ?");
    values.push(updates.issueId);
    shouldSetDirty = true;
  }
  if (updates.jiraWorklogId !== undefined) {
    fields.push("jira_worklog_id = ?");
    values.push(updates.jiraWorklogId);
  }
  if (updates.isDirty !== undefined) {
    fields.push("is_dirty = ?");
    values.push(updates.isDirty ? 1 : 0);
  } else if (shouldSetDirty) {
    fields.push("is_dirty = ?");
    values.push(1);
  }

  if (fields.length === 0) return;
  values.push(id);
  await db.run(
    `UPDATE time_entries SET ${fields.join(", ")} WHERE id = ?`,
    ...values,
  );
}

export async function deleteTimeEntry(id: string): Promise<void> {
  const db = getDatabase();
  const entry = await db.get("SELECT * FROM time_entries WHERE id = ?", id);
  if (entry && entry.jira_worklog_id) {
    const issue = await db.get("SELECT jira_issue_key, jira_connection_id FROM issues WHERE id = ?", entry.issue_id);
    if (issue && issue.jira_issue_key) {
      await db.run(
        `INSERT INTO deleted_jira_worklogs (id, jira_worklog_id, jira_connection_id, issue_key, deleted_at)
         VALUES (?, ?, ?, ?, ?)`,
        randomUUID(),
        entry.jira_worklog_id,
        issue.jira_connection_id || null,
        issue.jira_issue_key,
        Date.now(),
      );
    }
  }
  await db.run("DELETE FROM time_entries WHERE id = ?", id);
}

export async function splitTimeEntry(
  originalEntryId: string,
  splitTime: string,
  newIssueId?: string,
): Promise<void> {
  const db = getDatabase();

  const original = (await db.get(
    "SELECT * FROM time_entries WHERE id = ?",
    originalEntryId,
  )) as any;
  if (!original) throw new Error("Time entry not found");

  const normalizedSplit = normalizeTime(splitTime) || splitTime;

  if (
    normalizedSplit <= original.start_time ||
    (original.end_time && normalizedSplit >= original.end_time)
  ) {
    throw new Error("Invalid split time");
  }

  const newEntryId = crypto.randomUUID();

  await db.run(
    "UPDATE time_entries SET end_time = ? WHERE id = ?",
    normalizedSplit,
    originalEntryId,
  );

  await db.run(
    `INSERT INTO time_entries (id, issue_id, start_time, end_time, date, note, jira_worklog_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    newEntryId,
    newIssueId || original.issue_id,
    normalizedSplit,
    original.end_time,
    original.date,
    original.note,
    original.jira_worklog_id,
  );
}

export async function mergeTimeEntries(
  entryIds: string[],
  noteStrategy: "concat" | "keep-first" | "keep-last" | "custom",
  customNote?: string,
): Promise<void> {
  if (entryIds.length < 2) return;

  const db = getDatabase();

  const placeholders = entryIds.map(() => "?").join(",");
  const rows = (await db.all(
    `SELECT * FROM time_entries WHERE id IN (${placeholders}) ORDER BY start_time ASC`,
    ...entryIds,
  )) as any[];

  if (rows.length !== entryIds.length)
    throw new Error("Some time entries not found");

  const firstEntry = rows[0];
  const lastEntry = rows[rows.length - 1];
  const newStartTime = firstEntry.start_time;
  const newEndTime = lastEntry.end_time;

  let newNote = "";
  if (noteStrategy === "custom") {
    newNote = customNote || "";
  } else if (noteStrategy === "keep-first") {
    newNote = firstEntry.note || "";
  } else if (noteStrategy === "keep-last") {
    newNote = lastEntry.note || "";
  } else {
    newNote = rows.map((r) => r.note).filter(Boolean).join("; ");
  }

  await db.run(
    "UPDATE time_entries SET end_time = ?, note = ? WHERE id = ?",
    newEndTime,
    newNote,
    firstEntry.id,
  );

  const idsToDelete = rows.slice(1).map((r) => r.id);
  const deletePlaceholders = idsToDelete.map(() => "?").join(",");
  await db.run(
    `DELETE FROM time_entries WHERE id IN (${deletePlaceholders})`,
    ...idsToDelete,
  );
}

// ---- Jira Connections ----

export async function getAllJiraConnections(): Promise<JiraConnection[]> {
  const db = getDatabase();
  const rows = await db.all(
    "SELECT * FROM jira_connections ORDER BY is_default DESC, name ASC",
  );

  return (rows as any[]).map((row) => ({
    id: row.id,
    name: row.name,
    authType: row.auth_type || "api-key",
    domain: row.domain,
    email: row.email,
    apiToken: row.api_token,
    accessToken: row.access_token,
    refreshToken: row.refresh_token,
    expiresAt: row.expires_at,
    cloudId: row.cloud_id,
    isDefault: Boolean(row.is_default),
    clientId: row.client_id,
    clientSecret: row.client_secret,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export async function getJiraConnection(
  id: string,
): Promise<JiraConnection | null> {
  const db = getDatabase();
  const row = await db.get(
    "SELECT * FROM jira_connections WHERE id = ?",
    id,
  );
  if (!row) return null;
  const r = row as any;
  return {
    id: r.id,
    name: r.name,
    authType: r.auth_type || "api-key",
    domain: r.domain,
    email: r.email,
    apiToken: r.api_token,
    accessToken: r.access_token,
    refreshToken: r.refresh_token,
    expiresAt: r.expires_at,
    cloudId: r.cloud_id,
    isDefault: Boolean(r.is_default),
    clientId: r.client_id,
    clientSecret: r.client_secret,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function getDefaultJiraConnection(): Promise<JiraConnection | null> {
  const db = getDatabase();
  const row = await db.get(
    "SELECT * FROM jira_connections WHERE is_default = 1 LIMIT 1",
  );
  if (!row) return null;
  const r = row as any;
  return {
    id: r.id,
    name: r.name,
    authType: r.auth_type || "api-key",
    domain: r.domain,
    email: r.email,
    apiToken: r.api_token,
    accessToken: r.access_token,
    refreshToken: r.refresh_token,
    expiresAt: r.expires_at,
    cloudId: r.cloud_id,
    isDefault: Boolean(r.is_default),
    clientId: r.client_id,
    clientSecret: r.client_secret,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function createJiraConnection(
  connection: JiraConnection,
): Promise<void> {
  const db = getDatabase();

  if (connection.isDefault) {
    await db.run("UPDATE jira_connections SET is_default = 0");
  }

  await db.run(
    `INSERT INTO jira_connections (
      id, name, auth_type, domain, email, api_token,
      access_token, refresh_token, expires_at, cloud_id,
      is_default, client_id, client_secret, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    connection.id,
    connection.name || null,
    connection.authType || "api-key",
    connection.domain,
    connection.email || null,
    connection.apiToken || null,
    connection.accessToken || null,
    connection.refreshToken || null,
    connection.expiresAt || null,
    connection.cloudId || null,
    connection.isDefault ? 1 : 0,
    connection.clientId || null,
    connection.clientSecret || null,
    connection.createdAt,
    connection.updatedAt,
  );
}

export async function updateJiraConnection(
  id: string,
  updates: Partial<JiraConnection>,
): Promise<void> {
  const db = getDatabase();

  if (updates.isDefault) {
    await db.run("UPDATE jira_connections SET is_default = 0");
  }

  const fields: string[] = [];
  const values: any[] = [];

  if (updates.name !== undefined) {
    fields.push("name = ?");
    values.push(updates.name);
  }
  if (updates.authType !== undefined) {
    fields.push("auth_type = ?");
    values.push(updates.authType);
  }
  if (updates.domain !== undefined) {
    fields.push("domain = ?");
    values.push(updates.domain);
  }
  if (updates.email !== undefined) {
    fields.push("email = ?");
    values.push(updates.email);
  }
  if (updates.apiToken !== undefined) {
    fields.push("api_token = ?");
    values.push(updates.apiToken);
  }
  if (updates.accessToken !== undefined) {
    fields.push("access_token = ?");
    values.push(updates.accessToken);
  }
  if (updates.refreshToken !== undefined) {
    fields.push("refresh_token = ?");
    values.push(updates.refreshToken);
  }
  if (updates.expiresAt !== undefined) {
    fields.push("expires_at = ?");
    values.push(updates.expiresAt);
  }
  if (updates.cloudId !== undefined) {
    fields.push("cloud_id = ?");
    values.push(updates.cloudId);
  }
  if (updates.isDefault !== undefined) {
    fields.push("is_default = ?");
    values.push(updates.isDefault ? 1 : 0);
  }
  if (updates.clientId !== undefined) {
    fields.push("client_id = ?");
    values.push(updates.clientId);
  }
  if (updates.clientSecret !== undefined) {
    fields.push("client_secret = ?");
    values.push(updates.clientSecret);
  }
  if (updates.updatedAt !== undefined) {
    fields.push("updated_at = ?");
    values.push(updates.updatedAt);
  }

  if (fields.length === 0) return;
  values.push(id);
  await db.run(
    `UPDATE jira_connections SET ${fields.join(", ")} WHERE id = ?`,
    ...values,
  );
}

export async function deleteJiraConnection(id: string): Promise<void> {
  const db = getDatabase();
  await db.run("DELETE FROM jira_connections WHERE id = ?", id);
}

export async function deleteAllJiraConnections(): Promise<void> {
  const db = getDatabase();
  await db.run("DELETE FROM jira_connections");
}

// ---- Settings ----

export async function getSetting(key: string): Promise<any> {
  const db = getDatabase();
  const row = await db.get("SELECT value FROM settings WHERE key = ?", key);
  if (!row) return null;
  try {
    return JSON.parse((row as any).value);
  } catch {
    return (row as any).value;
  }
}

export async function setSetting(key: string, value: any): Promise<void> {
  const db = getDatabase();
  const valueStr =
    typeof value === "string" ? value : JSON.stringify(value);
  await db.run(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    key,
    valueStr,
  );
}

export async function deleteSetting(key: string): Promise<void> {
  const db = getDatabase();
  await db.run("DELETE FROM settings WHERE key = ?", key);
}

// ---- Bulk Operations ----

export async function bulkInsertProjects(
  projects: Project[],
): Promise<void> {
  const db = getDatabase();
  for (const project of projects) {
    await db.run(
      `INSERT OR REPLACE INTO projects (id, name, description, color, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      project.id,
      project.name,
      project.description || null,
      project.color || null,
      project.createdAt,
    );
  }
}

export async function bulkInsertIssues(issues: Issue[]): Promise<void> {
  const db = getDatabase();
  for (const issue of issues) {
    await db.run(
      `INSERT OR REPLACE INTO issues (
        id, title, description, project_id, status,
        jira_issue_key, jira_connection_id, estimate, time_spent,
        is_running, start_time, created_at, date
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      issue.id,
      issue.title,
      issue.description || null,
      issue.projectId || null,
      issue.status || "todo",
      issue.jiraIssueKey || null,
      issue.jiraConnectionId || null,
      issue.estimate ?? 0,
      issue.timeSpent ?? 0,
      issue.isRunning ? 1 : 0,
      issue.startTime || null,
      issue.createdAt,
      issue.date,
    );
  }
}

export async function bulkInsertTimeEntries(
  entries: TimeEntry[],
): Promise<void> {
  const db = getDatabase();
  for (const entry of entries) {
    const isDirty = entry.isDirty !== undefined ? entry.isDirty : (entry.jiraWorklogId ? false : true);
    await db.run(
      `INSERT OR REPLACE INTO time_entries (id, issue_id, start_time, end_time, date, note, jira_worklog_id, is_dirty)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      entry.id,
      entry.issueId,
      entry.startTime,
      entry.endTime || null,
      entry.date,
      entry.note || null,
      entry.jiraWorklogId || null,
      isDirty ? 1 : 0,
    );
  }
}

export async function getDeletedJiraWorklogs(): Promise<any[]> {
  const db = getDatabase();
  const rows = await db.all("SELECT * FROM deleted_jira_worklogs");
  return (rows as any[]).map((row) => ({
    id: row.id,
    jiraWorklogId: row.jira_worklog_id,
    jiraConnectionId: row.jira_connection_id,
    issueKey: row.issue_key,
    deletedAt: row.deleted_at,
  }));
}

export async function deleteDeletedJiraWorklog(id: string): Promise<void> {
  const db = getDatabase();
  await db.run("DELETE FROM deleted_jira_worklogs WHERE id = ?", id);
}

// ---- Clear Operations ----

export async function deleteAllIssues(): Promise<void> {
  const db = getDatabase();
  await db.run("DELETE FROM issues");
}

export async function deleteAllTimeEntries(): Promise<void> {
  const db = getDatabase();
  await db.run("DELETE FROM time_entries");
}

export async function deleteAllProjects(): Promise<void> {
  const db = getDatabase();
  await db.run("DELETE FROM projects");
}

export async function syncProjects(projects: Project[]): Promise<void> {
  const db = getDatabase();
  const incomingIds = projects.map(p => p.id);
  if (incomingIds.length > 0) {
    const placeholders = incomingIds.map(() => "?").join(",");
    await db.run(
      `DELETE FROM projects WHERE id NOT IN (${placeholders})`,
      ...incomingIds
    );
  } else {
    await db.run("DELETE FROM projects");
  }
  await bulkInsertProjects(projects);
}

export async function syncIssues(issues: Issue[]): Promise<void> {
  const db = getDatabase();
  const incomingIds = issues.map(i => i.id);
  if (incomingIds.length > 0) {
    const placeholders = incomingIds.map(() => "?").join(",");
    await db.run(
      `DELETE FROM issues WHERE id NOT IN (${placeholders})`,
      ...incomingIds
    );
  } else {
    await db.run("DELETE FROM issues");
  }
  await bulkInsertIssues(issues);
}

