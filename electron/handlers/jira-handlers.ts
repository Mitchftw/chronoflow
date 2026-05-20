import { ipcMain } from "electron";
import axios, { AxiosError } from "axios";
import { logger } from "../utils/logger";
import * as dbService from "../db-service";
import { randomUUID } from "crypto";
import type { JiraConnection } from "../../src/types";

/**
 * Helper function to extract detailed error information from HTTP responses
 */
function handleHttpError(error: any, context: string): string {
  logger.error(`[${context}] HTTP Error:`, error);

  if (axios.isAxiosError(error)) {
    const axiosError = error as AxiosError;

    if (axiosError.response) {
      logger.error(
        `[${context}] Status: ${axiosError.response.status} ${axiosError.response.statusText}`,
      );
      logger.error(
        `[${context}] Response Headers:`,
        JSON.stringify(axiosError.response.headers, null, 2),
      );
      logger.error(
        `[${context}] Response Body:`,
        JSON.stringify(axiosError.response.data, null, 2),
      );

      const responseData = axiosError.response.data as any;

      if (
        responseData?.errorMessages &&
        Array.isArray(responseData.errorMessages) &&
        responseData.errorMessages.length > 0
      ) {
        return responseData.errorMessages.join("; ");
      }

      if (responseData?.errors && typeof responseData.errors === "object") {
        return Object.entries(responseData.errors)
          .map(([key, value]) => `${key}: ${value}`)
          .join("; ");
      }

      if (responseData?.message) {
        return responseData.message;
      }

      if (axiosError.response.status === 401) {
        return "Authentication failed. Please check your Jira credentials.";
      } else if (axiosError.response.status === 403) {
        return "Access forbidden. You may not have permission to perform this action.";
      } else if (axiosError.response.status === 404) {
        return "Resource not found. Please check the issue key or Jira domain.";
      } else if (axiosError.response.status >= 500) {
        return `Jira server error (${axiosError.response.status}). Please try again later.`;
      }

      return `HTTP Error ${axiosError.response.status}: ${axiosError.response.statusText}`;
    } else if (axiosError.request) {
      return "No response from Jira server. Please check your network connection and Jira domain.";
    }
  }

  return (
    error?.message || "An unexpected error occurred. Check logs for details."
  );
}

/**
 * Helper to extract plain text from ADF (Atlassian Document Format) comment
 */
function extractCommentText(comment: any): string | undefined {
  try {
    if (!comment) return undefined;
    if (typeof comment === "string") return comment;
    if (comment.type === "doc" && Array.isArray(comment.content)) {
      const texts: string[] = [];
      for (const node of comment.content) {
        if (node.type === "paragraph" && Array.isArray(node.content)) {
          const line = node.content
            .filter(
              (c: any) => c.type === "text" && typeof c.text === "string",
            )
            .map((c: any) => c.text)
            .join("");
          if (line) texts.push(line);
        }
      }
      return texts.join("\n") || undefined;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

const CLIENT_ID = process.env['JIRA_CLIENT_ID'] || "GRZHzt7wHTU4U8Za5U1ZR54TzyKhtYcU";
const CLIENT_SECRET = process.env['JIRA_CLIENT_SECRET'] || "ATOAizYTklZ2WKdhRW86WfQicnLLDrYeQKVucZz_muhmnYg2XV_l89C9jtIacGaMRu2903BC1E17";

/**
 * Helper to get the correct base URL and headers based on auth type
 */
function getJiraRequestConfig(params: {
  authType: "api-key" | "oauth";
  domain: string;
  cloudId?: string;
  email?: string;
  apiToken?: string;
  accessToken?: string;
}) {
  const { authType, domain, cloudId, email, apiToken, accessToken } = params;

  if (authType === "oauth") {
    // For OAuth (3LO), we MUST use the cloudId in the URL
    const target = cloudId || domain; 
    return {
      baseUrl: `https://api.atlassian.com/ex/jira/${target}`,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
    };
  } else {
    const auth = Buffer.from(`${email}:${apiToken}`).toString("base64");
    return {
      baseUrl: `https://${domain}`,
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
    };
  }
}

/**
 * Helper to ensure a valid access token is used (refreshes if needed and updates DB)
 */
async function getOrRefreshAccessToken(connectionId?: string, currentAccessToken?: string): Promise<string | undefined> {
  if (!connectionId) return currentAccessToken;

  try {
    const conn = await dbService.getJiraConnection(connectionId);
    if (!conn || conn.authType !== "oauth") {
      return currentAccessToken;
    }

    const expiresAt = conn.expiresAt;
    const now = Date.now();
    
    // Refresh token if it's expired or expiring in the next 5 minutes (300,000 ms)
    if (expiresAt && now >= expiresAt - 300000) {
      logger.info(`Jira OAuth token for connection ${connectionId} is expiring or expired. Refreshing...`);
      if (!conn.refreshToken) {
        logger.error(`No refresh token available for connection ${connectionId}`);
        return conn.accessToken;
      }

      const refreshParams: any = {
        grant_type: "refresh_token",
        client_id: conn.clientId || CLIENT_ID,
        refresh_token: conn.refreshToken,
      };

      const secret = conn.clientSecret || CLIENT_SECRET;
      if (secret) {
        refreshParams.client_secret = secret;
      }

      const response = await axios.post(
        "https://auth.atlassian.com/oauth/token",
        refreshParams
      );

      const data = response.data;
      const newAccessToken = data.access_token;
      const newRefreshToken = data.refresh_token || conn.refreshToken;
      const newExpiresAt = Date.now() + (data.expires_in * 1000);

      // Save the updated connection back to database
      await dbService.updateJiraConnection(connectionId, {
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
        expiresAt: newExpiresAt,
        updatedAt: Date.now()
      });

      logger.info(`Successfully refreshed Jira OAuth token for connection ${connectionId}`);
      return newAccessToken;
    }

    return conn.accessToken;
  } catch (error: any) {
    logger.error(`Failed to refresh token for connection ${connectionId}:`, error);
    return currentAccessToken;
  }
}

/**
 * Register all Jira-related IPC handlers
 */
export function registerJiraHandlers() {
  // Exchange OAuth code for token
  ipcMain.handle(
    "jira:exchange-code",
    async (_, { code, redirectUri, codeVerifier, clientId, clientSecret }) => {
      try {
        const exchangeParams: any = {
          grant_type: "authorization_code",
          client_id: clientId || CLIENT_ID,
          code,
          redirect_uri: redirectUri,
          code_verifier: codeVerifier, // PKCE parameter
        };

        const secret = clientSecret || CLIENT_SECRET;
        if (secret) {
          exchangeParams.client_secret = secret;
        }

        const response = await axios.post(
          "https://auth.atlassian.com/oauth/token",
          exchangeParams,
        );

        return { success: true, data: response.data };
      } catch (error: any) {
        const errorMessage = handleHttpError(error, "jira:exchange-code");
        return { success: false, error: errorMessage };
      }
    },
  );

  // Get Jira configuration (like Client ID)
  ipcMain.handle("jira:get-config", async () => {
    return {
      clientId: CLIENT_ID,
    };
  });

  // Get accessible Jira resources (cloudId and site names)
  ipcMain.handle(
    "jira:get-accessible-resources",
    async (_, accessToken) => {
      try {
        const response = await axios.get(
          "https://api.atlassian.com/oauth/token/accessible-resources",
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              Accept: "application/json",
            },
          },
        );

        return { success: true, resources: response.data };
      } catch (error: any) {
        const errorMessage = handleHttpError(
          error,
          "jira:get-accessible-resources",
        );
        return { success: false, error: errorMessage };
      }
    },
  );

  // Search for Jira issues
  ipcMain.handle("jira:search", async (_, params) => {
    try {
      const connId = params.connectionId || params.id;
      if (params.authType === "oauth" && connId) {
        params.accessToken = await getOrRefreshAccessToken(connId, params.accessToken);
      }
      const { baseUrl, headers } = getJiraRequestConfig(params);
      const { query } = params;

      const response = await axios.get(
        `${baseUrl}/rest/api/3/search/jql`,
        {
          params: {
            jql: `text ~ "${query}*" OR key = "${query}" ORDER BY updated DESC`,
            maxResults: 10,
            fields: "key,summary,description,timeoriginalestimate",
          },
          headers,
        },
      );

      const issues = response.data.issues.map((issue: any) => {
        const estimateSeconds = issue.fields.timeoriginalestimate;
        const estimateMinutes = estimateSeconds
          ? Math.round(estimateSeconds / 60)
          : undefined;

        return {
          key: issue.key,
          summary: issue.fields.summary,
          description: issue.fields.description,
          estimateMinutes,
        };
      });

      return { success: true, issues };
    } catch (error: any) {
      const errorMessage = handleHttpError(error, "jira:search");
      return { success: false, error: errorMessage };
    }
  });

  // Add worklog to Jira
  ipcMain.handle("jira:add-worklog", async (_, params) => {
    try {
      const connId = params.connectionId || params.id;
      if (params.authType === "oauth" && connId) {
        params.accessToken = await getOrRefreshAccessToken(connId, params.accessToken);
      }
      const { baseUrl, headers } = getJiraRequestConfig(params);
      const { issueKey, timeSpentSeconds, comment, started } = params;

      const adfComment = {
        type: "doc",
        version: 1,
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: comment || "",
              },
            ],
          },
        ],
      };

      const response = await axios.post(
        `${baseUrl}/rest/api/3/issue/${issueKey}/worklog`,
        {
          timeSpentSeconds,
          comment: adfComment,
          started,
        },
        { headers },
      );

      return { success: true, worklog: response.data };
    } catch (error: any) {
      const errorMessage = handleHttpError(error, "jira:add-worklog");
      return { success: false, error: errorMessage };
    }
  });

  // Get user's worklogs for a specific date
  ipcMain.handle("jira:get-worklogs-for-date", async (_, params) => {
    try {
      const connId = params.connectionId || params.id;
      if (params.authType === "oauth" && connId) {
        params.accessToken = await getOrRefreshAccessToken(connId, params.accessToken);
      }
      const { baseUrl, headers } = getJiraRequestConfig(params);
      const { date } = params;

      const myselfResponse = await axios.get(
        `${baseUrl}/rest/api/3/myself`,
        { headers },
      );
      const currentUserAccountId = myselfResponse.data.accountId;
      logger.debug(`Current user accountId: ${currentUserAccountId}`);

      const jql = `worklogAuthor = currentUser() AND worklogDate = "${date}" ORDER BY updated DESC`;

      const searchResponse = await axios.get(
        `${baseUrl}/rest/api/3/search/jql`,
        {
          params: { jql, maxResults: 100, fields: "key,summary" },
          headers,
        },
      );

      const issues = searchResponse.data.issues || [];
      logger.debug(
        `Found ${issues.length} issues with worklogs for ${date}`,
      );

      const worklogs: Array<{
        id: string;
        issueKey: string;
        issueSummary: string;
        started: string;
        timeSpentSeconds: number;
        comment?: string;
      }> = [];

      for (const issue of issues) {
        const issueKey = issue.key;
        const issueSummary = issue.fields?.summary || issueKey;

        try {
          const worklogResponse = await axios.get(
            `${baseUrl}/rest/api/3/issue/${issueKey}/worklog`,
            {
              params: {
                startedAfter: new Date(`${date}T00:00:00Z`).getTime(),
                startedBefore: new Date(`${date}T23:59:59Z`).getTime(),
              },
              headers,
            },
          );

          const logs = worklogResponse.data.worklogs || [];
          logger.debug(
            `Issue ${issueKey}: found ${logs.length} worklogs in date range`,
          );

          for (const log of logs) {
            const started = log.started;
            const startedDate = started?.slice(0, 10);
            if (startedDate !== date) continue;

            const logAuthorAccountId = log.author?.accountId;
            if (logAuthorAccountId !== currentUserAccountId) continue;

            worklogs.push({
              id: log.id,
              issueKey,
              issueSummary,
              started,
              timeSpentSeconds: log.timeSpentSeconds,
              comment: extractCommentText(log.comment),
            });
          }
        } catch (issueError: any) {
          logger.error(
            `Failed to fetch worklogs for issue ${issueKey}:`,
            issueError,
          );
        }
      }

      return { success: true, worklogs };
    } catch (error: any) {
      const errorMessage = handleHttpError(
        error,
        "jira:get-worklogs-for-date",
      );
      return { success: false, error: errorMessage };
    }
  });

  // ---- Jira Connections Management ----

  ipcMain.handle("jira:get-connections", async () => {
    try {
      const connections = await dbService.getAllJiraConnections();
      return { success: true, connections };
    } catch (error: any) {
      logger.error("Failed to get Jira connections:", error);
      return {
        success: false,
        error: error.message || "Failed to retrieve Jira connections",
      };
    }
  });

  ipcMain.handle("jira:get-default-connection", async () => {
    try {
      const connection = await dbService.getDefaultJiraConnection();
      return { success: true, connection };
    } catch (error: any) {
      logger.error("Failed to get default Jira connection:", error);
      return {
        success: false,
        error: error.message || "Failed to retrieve default Jira connection",
      };
    }
  });

  ipcMain.handle("jira:create-connection", async (_, connectionData) => {
    try {
      const connection: JiraConnection = {
        id: randomUUID(),
        name: connectionData.name,
        authType: connectionData.authType || "api-key",
        domain: connectionData.domain,
        email: connectionData.email,
        apiToken: connectionData.apiToken,
        accessToken: connectionData.accessToken,
        refreshToken: connectionData.refreshToken,
        expiresAt: connectionData.expiresAt,
        cloudId: connectionData.cloudId,
        isDefault: connectionData.isDefault || false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      await dbService.createJiraConnection(connection);
      return { success: true, connection };
    } catch (error: any) {
      logger.error("Failed to create Jira connection:", error);
      return {
        success: false,
        error: error.message || "Failed to create Jira connection",
      };
    }
  });

  ipcMain.handle(
    "jira:update-connection",
    async (_, { id, updates }) => {
      try {
        const updatedConnection = {
          ...updates,
          updatedAt: Date.now(),
        };

        await dbService.updateJiraConnection(id, updatedConnection);
        const connection = await dbService.getJiraConnection(id);
        return { success: true, connection };
      } catch (error: any) {
        logger.error("Failed to update Jira connection:", error);
        return {
          success: false,
          error: error.message || "Failed to update Jira connection",
        };
      }
    },
  );

  ipcMain.handle("jira:delete-connection", async (_, { id }) => {
    try {
      await dbService.deleteJiraConnection(id);
      return { success: true };
    } catch (error: any) {
      logger.error("Failed to delete Jira connection:", error);
      return {
        success: false,
        error: error.message || "Failed to delete Jira connection",
      };
    }
  });

  ipcMain.handle("jira:test-connection", async (_, params) => {
    try {
      const connId = params.connectionId || params.id;
      if (params.authType === "oauth" && connId) {
        params.accessToken = await getOrRefreshAccessToken(connId, params.accessToken);
      }
      const { baseUrl, headers } = getJiraRequestConfig(params);

      const response = await axios.get(`${baseUrl}/rest/api/3/myself`, {
        headers,
        timeout: 10000,
      });

      return {
        success: true,
        user: {
          displayName: response.data.displayName,
          emailAddress: response.data.emailAddress,
          accountId: response.data.accountId,
        },
      };
    } catch (error: any) {
      const errorMessage = handleHttpError(error, "jira:test-connection");
      return { success: false, error: errorMessage };
    }
  });

  // Update worklog in Jira
  ipcMain.handle("jira:update-worklog", async (_, params) => {
    try {
      const connId = params.connectionId || params.id;
      if (params.authType === "oauth" && connId) {
        params.accessToken = await getOrRefreshAccessToken(connId, params.accessToken);
      }
      const { baseUrl, headers } = getJiraRequestConfig(params);
      const { issueKey, worklogId, timeSpentSeconds, comment, started } = params;

      const adfComment = {
        type: "doc",
        version: 1,
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: comment || "",
              },
            ],
          },
        ],
      };

      const response = await axios.put(
        `${baseUrl}/rest/api/3/issue/${issueKey}/worklog/${worklogId}`,
        {
          timeSpentSeconds,
          comment: adfComment,
          started,
        },
        { headers },
      );

      return { success: true, worklog: response.data };
    } catch (error: any) {
      const errorMessage = handleHttpError(error, "jira:update-worklog");
      return { success: false, error: errorMessage };
    }
  });

  // Delete worklog from Jira
  ipcMain.handle("jira:delete-worklog", async (_, params) => {
    try {
      const connId = params.connectionId || params.id;
      if (params.authType === "oauth" && connId) {
        params.accessToken = await getOrRefreshAccessToken(connId, params.accessToken);
      }
      const { baseUrl, headers } = getJiraRequestConfig(params);
      const { issueKey, worklogId } = params;

      await axios.delete(
        `${baseUrl}/rest/api/3/issue/${issueKey}/worklog/${worklogId}`,
        { headers },
      );

      return { success: true };
    } catch (error: any) {
      const errorMessage = handleHttpError(error, "jira:delete-worklog");
      return { success: false, error: errorMessage };
    }
  });

  // Load issues from Jira
  ipcMain.handle("jira:load-issues", async (_, params) => {
    try {
      const connId = params.connectionId || params.id;
      if (params.authType === "oauth" && connId) {
        params.accessToken = await getOrRefreshAccessToken(connId, params.accessToken);
      }
      const { baseUrl, headers } = getJiraRequestConfig(params);

      // Search for issues assigned to currentUser() or updated recently
      const jql = `assignee = currentUser() OR updated >= -30d ORDER BY updated DESC`;
      const response = await axios.get(
        `${baseUrl}/rest/api/3/search`,
        {
          params: {
            jql,
            maxResults: 100,
            fields: "key,summary,description,timeoriginalestimate",
          },
          headers,
        },
      );

      const issues = (response.data.issues || []).map((issue: any) => {
        const estimateSeconds = issue.fields.timeoriginalestimate;
        const estimateMinutes = estimateSeconds
          ? Math.round(estimateSeconds / 60)
          : undefined;

        return {
          key: issue.key,
          summary: issue.fields.summary,
          description: issue.fields.description,
          estimateMinutes,
        };
      });

      return { success: true, issues };
    } catch (error: any) {
      const errorMessage = handleHttpError(error, "jira:load-issues");
      return { success: false, error: errorMessage };
    }
  });
}
