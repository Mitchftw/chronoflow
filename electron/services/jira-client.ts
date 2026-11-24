import axios from "axios";
import * as dbService from "../db-service";
import {
  getJiraRequestConfig,
  getOrRefreshAccessToken,
  handleHttpError,
} from "../handlers/jira-handlers";
import type { JiraConnection } from "../../src/types";

/**
 * Thrown when the requested Jira operation cannot be served at all (no
 * connection configured / unknown connection). Callers surface the message as
 * user-facing guidance instead of an HTTP error.
 */
export class JiraUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JiraUnavailableError";
  }
}

export interface JiraConnectionSummary {
  id: string;
  name: string;
  domain: string;
  authType: string;
  email: string;
  isDefault: boolean;
}

export interface JiraIssueSummary {
  key: string;
  summary: string;
  description: string;
  status: string;
  projectKey: string;
  projectName: string;
  estimateMinutes?: number;
  updated?: number;
}

/** Lists configured Jira connections without exposing tokens. */
export async function listConnections(): Promise<JiraConnectionSummary[]> {
  const connections = await dbService.getAllJiraConnections();
  return connections.map((connection) => ({
    id: connection.id,
    name: connection.name,
    domain: connection.domain,
    authType: connection.authType,
    email: connection.email,
    isDefault: connection.isDefault,
  }));
}

/**
 * Picks the requested connection or the default one and returns everything
 * needed to sign a request (including a freshly refreshed OAuth token).
 */
async function resolveRequestContext(connectionId?: string): Promise<{
  connection: JiraConnection;
  baseUrl: string;
  headers: Record<string, string>;
}> {
  const connection = connectionId
    ? await dbService.getJiraConnection(connectionId)
    : await dbService.getDefaultJiraConnection();

  if (!connection) {
    throw new JiraUnavailableError(
      connectionId
        ? `Jira connection "${connectionId}" was not found. Use list_jira_connections to see the configured connections.`
        : "No Jira connection is configured. Add one in ChronoFlow → Settings → Jira, then try again.",
    );
  }

  const accessToken =
    connection.authType === "oauth"
      ? await getOrRefreshAccessToken(connection.id, connection.accessToken)
      : undefined;

  const { baseUrl, headers } = getJiraRequestConfig({
    authType: connection.authType === "oauth" ? "oauth" : "api-key",
    domain: connection.domain,
    cloudId: connection.cloudId,
    email: connection.email,
    apiToken: connection.apiToken,
    accessToken: accessToken ?? connection.accessToken,
  });

  return { connection, baseUrl, headers };
}

/** Flattens Atlassian Document Format (or a plain string) into readable text. */
function adfToText(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value !== "object") return "";
  const node = value as { type?: string; text?: string; content?: unknown[] };
  if (node.type === "text") return node.text ?? "";
  if (node.type === "hardBreak") return "\n";
  const children = Array.isArray(node.content) ? node.content : [];
  const joined = children.map((child) => adfToText(child)).join("");
  return node.type === "paragraph" ? `${joined}\n` : joined;
}

/** Escapes a free-text query so it can be embedded in a JQL string literal. */
function jqlString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

const ISSUE_FIELDS =
  "key,summary,description,status,timeoriginalestimate,project,updated";

function toIssueSummary(issue: any): JiraIssueSummary {
  const fields = issue?.fields ?? {};
  const estimateSeconds = fields.timeoriginalestimate;
  return {
    key: issue?.key ?? "",
    summary: fields.summary ?? "",
    description: adfToText(fields.description).trim(),
    status: fields.status?.name ?? "",
    projectKey: fields.project?.key ?? "",
    projectName: fields.project?.name ?? "",
    estimateMinutes:
      typeof estimateSeconds === "number" && estimateSeconds > 0
        ? Math.round(estimateSeconds / 60)
        : undefined,
    updated: fields.updated ? Date.parse(fields.updated) : undefined,
  };
}

/**
 * Searches Jira. Pass `jql` for full control, or `query` for a free-text
 * search across summary/description plus an exact key match.
 *
 * Uses the current `/rest/api/3/search/jql` endpoint (the legacy `/search`
 * endpoint is being retired by Atlassian).
 */
export async function searchIssues(options: {
  query?: string;
  jql?: string;
  limit?: number;
  connectionId?: string;
}): Promise<{ issues: JiraIssueSummary[]; jql: string; limit: number }> {
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
  const query = options.query?.trim();
  let jql = options.jql?.trim();
  if (!jql && query) {
    const literal = jqlString(query);
    const exactKey = /^[a-z][a-z0-9_]*-\d+$/i.test(query) ? ` OR key = "${literal}"` : "";
    jql = `text ~ "${literal}"${exactKey} ORDER BY updated DESC`;
  }
  jql ||= "assignee = currentUser() ORDER BY updated DESC";

  const { baseUrl, headers } = await resolveRequestContext(options.connectionId);

  try {
    const response = await axios.get(`${baseUrl}/rest/api/3/search/jql`, {
      params: { jql, maxResults: limit, fields: ISSUE_FIELDS },
      headers, timeout: 15000,
    });
    const issues = (response.data?.issues ?? []).map(toIssueSummary);
    return { issues, jql, limit };
  } catch (error: any) {
    throw new JiraUnavailableError(handleHttpError(error, "search_jira"));
  }
}

/** Fetches a single Jira issue by key (e.g. "ABC-123"). */
export async function getIssue(
  issueKey: string,
  connectionId?: string,
): Promise<{ issue: JiraIssueSummary; connectionId: string }> {
  const key = issueKey.trim().toUpperCase();
  if (!key) throw new JiraUnavailableError("An issue key is required (e.g. ABC-123).");

  const { connection, baseUrl, headers } = await resolveRequestContext(connectionId);

  try {
    const response = await axios.get(
      `${baseUrl}/rest/api/3/issue/${encodeURIComponent(key)}`,
      { params: { fields: ISSUE_FIELDS }, headers, timeout: 15000 },
    );
    return { issue: toIssueSummary(response.data), connectionId: connection.id };
  } catch (error: any) {
    throw new JiraUnavailableError(handleHttpError(error, "get_jira_issue"));
  }
}
