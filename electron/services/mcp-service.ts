import { app, ipcMain } from "electron";
import { createServer, Server } from "http";
import { randomBytes, randomUUID } from "crypto";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { applyEdits, modify, parse, type ParseError } from "jsonc-parser";
import * as db from "../db-service";
import * as jira from "./jira-client";
import { getTimerState, timerApi } from "../handlers/timer-handlers";
import { registerEditTools } from "./mcp-edit-tools";
import { clock, color, fail, id, localDate, normalizeWallClock, ok, status, wrap, write } from "./mcp-tools";
import { formatTimeHms, pad2, parseLocalDate, parseLocalDateTime, toLocalDate } from "../utils/time";
import type { Issue } from "../../src/types";

const DEFAULT_PORT = 38473;
// Tests (and anyone running two instances side by side) can move the server
// off the default port. Everything else reads the resolved value.
const configuredPort = Number(process.env["CHRONOFLOW_MCP_PORT"] ?? DEFAULT_PORT);
let port = configuredPort;
let listener: Server | undefined;
let token = "";
let ready = false;
let startupError = "";

type ReadyTimerApi = {
  start: NonNullable<typeof timerApi.start>;
  stop: NonNullable<typeof timerApi.stop>;
  pause: NonNullable<typeof timerApi.pause>;
  resume: NonNullable<typeof timerApi.resume>;
  updateEntry: NonNullable<typeof timerApi.updateEntry>;
};

/** The timer entry points are installed when the IPC handlers register. */
function timer(): ReadyTimerApi {
  if (
    !timerApi.start ||
    !timerApi.stop ||
    !timerApi.pause ||
    !timerApi.resume ||
    !timerApi.updateEntry
  ) {
    throw new Error("The ChronoFlow timer is not ready yet. Try again in a moment.");
  }
  return timerApi as ReadyTimerApi;
}

/**
 * Accepts either a wall clock ("08:30", "08:30:00") on an optional date, or a
 * full ISO timestamp, and returns the stored `date` + `HH:MM:SS` pair.
 */
function normalizeStartAt(input: {
  startTime?: string;
  date?: string;
}):
  | { ok: true; date?: string; startTime?: string }
  | { ok: false; error: string } {
  const { startTime, date } = input;
  if (startTime === undefined && date === undefined) return { ok: true };
  if (date && !parseLocalDate(date)) {
    return { ok: false, error: `date "${date}" must be YYYY-MM-DD.` };
  }
  if (startTime === undefined) return { ok: true, date };

  const wallClock = normalizeWallClock(startTime);
  if (wallClock) return { ok: true, date, startTime: wallClock };

  const parsed = new Date(startTime);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(startTime) || !parseLocalDate(startTime.slice(0, 10)) || Number.isNaN(parsed.getTime())) {
    return {
      ok: false,
      error: `startTime "${startTime}" must be HH:MM, HH:MM:SS or an ISO timestamp.`,
    };
  }
  const parsedDate = `${parsed.getFullYear()}-${pad2(parsed.getMonth() + 1)}-${pad2(parsed.getDate())}`;
  if (date && date !== parsedDate) {
    return {
      ok: false,
      error: `startTime "${startTime}" falls on ${parsedDate}, which contradicts date "${date}".`,
    };
  }
  return {
    ok: true,
    date: parsedDate,
    startTime: `${pad2(parsed.getHours())}:${pad2(parsed.getMinutes())}:${pad2(parsed.getSeconds())}`,
  };
}

function normalizeKey(issueKey: string): string {
  return issueKey.trim().toUpperCase();
}

async function findLocalIssueByJiraKey(issueKey: string, connectionId?: string): Promise<Issue | null> {
  const key = normalizeKey(issueKey);
  const issues = await db.getIssues();
  const matches = issues.filter(issue => issue.jiraIssueKey?.toUpperCase() === key);
  const defaultId = (await db.getDefaultJiraConnection())?.id;
  const selected = connectionId ?? defaultId;
  if (selected) {
    return matches.find(issue => issue.jiraConnectionId === selected)
      ?? (selected === defaultId ? matches.find(issue => !issue.jiraConnectionId) : null) ?? null;
  }
  if (new Set(matches.map(issue => issue.jiraConnectionId)).size > 1) {
    throw new Error("Multiple Jira connections have this key. Supply connectionId.");
  }
  return matches[0] ?? null;
}

/**
 * Returns the local mirror of a Jira issue, creating it on first use so a
 * timer can be started straight from a ticket key.
 */
async function resolveOrCreateIssue(
  issueKey: string,
  connectionId?: string,
): Promise<{ issue: Issue; created: boolean; fromJira: boolean }> {
  const existing = await findLocalIssueByJiraKey(issueKey, connectionId);
  if (existing) return { issue: existing, created: false, fromJira: false };

  const { issue: remote, connectionId: resolvedConnection } = await jira.getIssue(
    issueKey,
    connectionId,
  );

  // Another call may have created it while we were talking to Jira.
  const raced = await findLocalIssueByJiraKey(remote.key, resolvedConnection);
  if (raced) return { issue: raced, created: false, fromJira: false };

  const created: Issue = {
    id: randomUUID(),
    title: remote.summary || remote.key,
    description: remote.description ?? "",
    projectId: "",
    status: "todo",
    jiraIssueKey: remote.key,
    jiraConnectionId: resolvedConnection,
    estimate: remote.estimateMinutes ?? 0,
    timeSpent: 0,
    isRunning: false,
    startTime: null,
    createdAt: Date.now(),
    date: toLocalDate(),
    color: null,
  };
  await db.createIssue(created);
  return { issue: created, created: true, fromJira: true };
}

function makeServer(): McpServer {
  const server = new McpServer({ name: "chronoflow", version: app.getVersion() });

  // ── Local data ──────────────────────────────────────────────────────────

  registerEditTools(server);

  server.registerTool(
    "list_projects",
    { description: "List ChronoFlow projects", annotations: { readOnlyHint: true }, inputSchema: z.strictObject({}) },
    wrap(async () => ok(await db.getAllProjects())),
  );

  server.registerTool(
    "list_tasks",
    {
      description:
        "List ChronoFlow tasks, optionally filtered by date, project or status. Jira-linked tasks include their jiraIssueKey.",
      annotations: { readOnlyHint: true }, inputSchema: z.strictObject({
        date: localDate.optional().describe("Local date, YYYY-MM-DD"),
        projectId: z.string().optional(),
        status: status.optional(),
      }),
    },
    wrap(async (args) => ok(await db.getIssues(args))),
  );

  server.registerTool(
    "list_time_entries",
    {
      description:
        "List tracked time, optionally filtered by date range or task",
      annotations: { readOnlyHint: true }, inputSchema: z.strictObject({
        date: localDate.optional(),
        startDate: localDate.optional(),
        endDate: localDate.optional(),
        taskId: id.optional(),
        issueId: id.optional().describe("Alias for taskId"),
        limit: z.number().int().positive().max(1000).optional(),
      }),
    },
    wrap(async (args) => {
      const { limit, taskId, issueId, ...filters } = args;
      if (taskId && issueId && taskId !== issueId) return fail("taskId and issueId must identify the same task.");
      if (filters.startDate && filters.endDate && filters.startDate > filters.endDate) return fail("startDate must be on or before endDate.");
      return ok(await db.getTimeEntries({ ...filters, issueId: taskId ?? issueId, limit }));
    }),
  );

  server.registerTool(
    "get_running_timer",
    {
      description:
        "Get the currently open time entry, including the issue it belongs to",
      annotations: { readOnlyHint: true }, inputSchema: z.strictObject({}),
    },
    wrap(async () => {
      const state = getTimerState();
      if (!state.isRunning) return ok({ isRunning: false });
      const issue = state.issueId ? await db.getIssue(state.issueId) : null;
      const entry = state.entryId ? await db.getTimeEntry(state.entryId) : null;
      return ok({ ...state, issue, entry });
    }),
  );

  server.registerTool(
    "create_task",
    {
      description:
        "Create a local ChronoFlow task (no Jira link). Use start_timer with an issueKey to work on an existing Jira ticket instead.",
      inputSchema: z.strictObject({
        title: id,
        date: localDate.optional(),
        status: status.optional(),
        color: color.optional(),
        description: z.string().optional(),
        projectId: z.string().optional(),
        estimate: z.number().nonnegative().optional().describe("Minutes"),
      }),
    },
    write(async (args) => {
      const project = args.projectId ? await db.getProject(args.projectId) : null;
      if (args.projectId && !project) {
        return fail(`Project "${args.projectId}" was not found.`);
      }
      const issue: Issue = {
        id: randomUUID(),
        title: args.title,
        description: args.description ?? "",
        projectId: args.projectId ?? "",
        status: args.status ?? "todo",
        jiraIssueKey: null,
        jiraConnectionId: null,
        estimate: args.estimate ?? 0,
        timeSpent: 0,
        isRunning: false,
        startTime: null,
        createdAt: Date.now(),
        date: args.date ?? toLocalDate(),
        color: args.color ?? null,
      };
      await db.createIssue(issue);
      return ok(await db.getIssue(issue.id));
    }),
  );

  // ── Jira ────────────────────────────────────────────────────────────────

  server.registerTool(
    "list_jira_connections",
    {
      description:
        "List the configured Jira connections. Tokens are never returned.",
      annotations: { readOnlyHint: true }, inputSchema: z.strictObject({}),
    },
    wrap(async () => {
      const connections = await jira.listConnections();
      return ok({
        connections,
        defaultConnectionId:
          connections.find((connection) => connection.isDefault)?.id ?? null,
      });
    }),
  );

  server.registerTool(
    "search_jira",
    {
      description:
        "Search the real Jira instance. Pass a free-text query (searches summary/description and matches the exact key) or a raw JQL string.",
      annotations: { readOnlyHint: true }, inputSchema: z.strictObject({
        query: z.string().optional().describe('Free text, e.g. "login error"'),
        jql: z
          .string()
          .optional()
          .describe('Raw JQL, e.g. project = ABC AND status != Done'),
        limit: z.number().int().positive().max(100).optional(),
        connectionId: z
          .string()
          .optional()
          .describe("Defaults to the default Jira connection"),
      }),
    },
    wrap(async (args) => {
      const result = await jira.searchIssues(args);
      return ok(result);
    }),
  );

  server.registerTool(
    "get_jira_issue",
    {
      description: "Fetch one Jira issue by key, plus its local mirror if any",
      annotations: { readOnlyHint: true }, inputSchema: z.strictObject({
        issueKey: z.string().min(1).describe('e.g. "ABC-123"'),
        connectionId: z.string().optional(),
      }),
    },
    wrap(async (args) => {
      const { issue, connectionId } = await jira.getIssue(args.issueKey, args.connectionId);
      const local = await findLocalIssueByJiraKey(issue.key, connectionId);
      return ok({ jira: issue, local });
    }),
  );

  // ── Timer (write) ───────────────────────────────────────────────────────

  server.registerTool("import_jira_issue", {
    description: "Find or create a local task from a Jira key without starting a timer. Use the returned issue.id as the destination for moves and splits.",
    inputSchema: z.strictObject({ issueKey: id, connectionId: id.optional() }),
  }, write(async ({ issueKey, connectionId }) => ok(await resolveOrCreateIssue(issueKey, connectionId))));

  server.registerTool(
    "start_timer",
    {
      description:
        'Start tracking time. Pass issueKey to work on a Jira ticket — the local task is created automatically on first use — or taskId for an existing local task. Pass startTime (and optionally date) to log work that began earlier, e.g. startTime "08:30".',
      inputSchema: z.strictObject({
        issueKey: id.optional().describe('Jira key, e.g. "ABC-123"'),
        taskId: id.optional().describe("Local ChronoFlow task id"),
        startTime: z
          .string()
          .optional()
          .describe(
            'When the work actually started: "08:30", "08:30:00" or an ISO timestamp. Defaults to now.',
          ),
        date: localDate
          .optional()
          .describe("Local date for startTime, YYYY-MM-DD. Defaults to today."),
        connectionId: z
          .string()
          .optional()
          .describe("Jira connection to use when creating the local task"),
      }),
    },
    write(async (args) => {
      if (!!args.taskId === !!args.issueKey) return fail("Pass exactly one of taskId and issueKey.");
      const startAt = normalizeStartAt({ startTime: args.startTime, date: args.date });
      if (!startAt.ok) return fail(startAt.error);

      if (startAt.startTime || startAt.date) {
        const now = new Date();
        const start = parseLocalDateTime(startAt.date ?? toLocalDate(now), startAt.startTime ?? formatTimeHms(now));
        if (!start || start.getTime() > now.getTime()) return fail("The timer start is in the future.");
      }
      const current = getTimerState();
      if (current.isRunning && !current.isPaused) return fail("A timer is already running. Stop it first.");
      if (current.isPaused && args.issueKey) {
        const local = await findLocalIssueByJiraKey(args.issueKey, args.connectionId);
        if (local?.id !== current.issueId) return fail("Stop the paused timer before starting another task.");
      }

      let issue: Issue | null = null;
      let created = false;
      let fromJira = false;

      if (args.taskId) {
        issue = await db.getIssue(args.taskId);
        if (!issue) return fail(`Task "${args.taskId}" was not found.`);
      } else if (args.issueKey) {
        const resolved = await resolveOrCreateIssue(args.issueKey, args.connectionId);
        issue = resolved.issue;
        created = resolved.created;
        fromJira = resolved.fromJira;
      } else {
        return fail("Pass either issueKey (Jira ticket) or taskId (local task).");
      }

      const result = await timer().start(issue.id, {
        date: startAt.date,
        startTime: startAt.startTime,
      });
      if (!result.success) return fail(result.error ?? "Could not start the timer.");

      const entry = result.data?.entryId
        ? await db.getTimeEntry(result.data.entryId)
        : null;

      return ok({
        started: true,
        createdLocalTask: created,
        fromJira,
        issue: await db.getIssue(issue.id),
        entry,
        timer: getTimerState(),
      });
    }),
  );

  server.registerTool(
    "stop_timer",
    {
      description:
        "Stop the running timer, optionally saving a note on the time entry",
      inputSchema: z.strictObject({
        note: z.string().optional(),
      }),
    },
    write(async (args) => {
      const before = getTimerState();
      const result = await timer().stop(args.note);
      if (!result.success) return fail(result.error ?? "Could not stop the timer.");
      const issue = before.issueId ? await db.getIssue(before.issueId) : null;
      return ok({
        stopped: true,
        elapsedSeconds: result.data?.elapsed ?? before.elapsed,
        issue,
        entryId: result.data?.entryId ?? before.entryId,
      });
    }),
  );

  server.registerTool(
    "pause_timer",
    { description: "Pause the running timer", inputSchema: z.strictObject({}) },
    write(async () => {
      const result = await timer().pause();
      if (!result.success) return fail(result.error ?? "Could not pause the timer.");
      return ok({ paused: true, timer: getTimerState() });
    }),
  );

  server.registerTool(
    "resume_timer",
    { description: "Resume a paused timer", inputSchema: z.strictObject({}) },
    write(async () => {
      const result = await timer().resume();
      if (!result.success) return fail(result.error ?? "Could not resume the timer.");
      return ok({ resumed: true, timer: getTimerState() });
    }),
  );

  server.registerTool(
    "update_time_entry",
    {
      description:
        "Correct an existing time entry: change its date, start time, end time or note. Works on the running entry too — elapsed time realigns to the new start. Find the entryId with get_running_timer or list_time_entries.",
      inputSchema: z.strictObject({
        entryId: z.string().min(1),
        date: localDate.optional().describe("Local date, YYYY-MM-DD"),
        startTime: clock.optional(),
        endTime: z.union([z.literal(""), clock])
          .optional()
          .describe('HH:MM or HH:MM:SS; pass "" to leave the entry open'),
        note: z.string().optional(),
      }),
    },
    write(async (args) => {
      const entry = await db.getTimeEntry(args.entryId);
      if (!entry) return fail(`Time entry "${args.entryId}" was not found.`);

      const { entryId, ...fields } = args;
      const updates = { ...fields, ...(fields.endTime === "" ? { endTime: null } : {}) };
      if (Object.keys(fields).length === 0) return fail("Supply date, startTime, endTime or note.");

      const result = await timer().updateEntry(args.entryId, updates);
      if (!result.success) {
        return fail(result.error ?? "Could not update the time entry.");
      }

      return ok({
        updated: true,
        entry: await db.getTimeEntry(args.entryId),
        timer: getTimerState(),
      });
    }),
  );

  return server;
}

export async function startMcpService(): Promise<void> {
  if (!Number.isInteger(configuredPort) || configuredPort < 0 || configuredPort > 65535) {
    startupError = "CHRONOFLOW_MCP_PORT must be an integer between 0 and 65535. Correct it and restart ChronoFlow.";
    return;
  }
  token = await db.getSetting("mcpToken");
  if (!token || typeof token !== "string") {
    token = randomBytes(32).toString("hex");
    await db.setSetting("mcpToken", token);
  }
  listener = createServer(async (req, res) => {
    if (req.headers.origin !== undefined || req.url !== `/mcp/${token}` || req.headers.host !== `127.0.0.1:${port}`) {
      res.writeHead(403).end(); return;
    }
    if (req.method !== "POST") { res.writeHead(405, { Allow: "POST" }).end(); return; }
    const server = makeServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => { void transport.close(); void server.close(); });
    try { await server.connect(transport); await transport.handleRequest(req, res); }
    catch { if (!res.headersSent) res.writeHead(500).end(); }
  });
  await new Promise<void>((resolve) => {
    listener!.once("error", error => {
      ready = false;
      startupError = `Could not listen on port ${configuredPort}: ${error.message}`;
      resolve();
    });
    listener!.listen(configuredPort, "127.0.0.1", () => {
      const address = listener!.address();
      if (address && typeof address === "object") { port = address.port; ready = true; }
      resolve();
    });
  });
}

export function stopMcpService(): void { listener?.close(); ready = false; }

function saveConfig(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const target = fs.existsSync(file) ? fs.realpathSync(file) : file;
  const temporary = target + "." + randomUUID() + ".tmp";
  try {
    const mode = fs.existsSync(target) ? fs.statSync(target).mode : 0o600;
    fs.writeFileSync(temporary, content, { mode, flag: "wx" });
    fs.renameSync(temporary, target);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

/** Replace only this server's URL, preserving other servers, options and comments. */
function installCodex(file: string, url: string): void {
  const content = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = content.split(/\r?\n/);
  const section = lines.findIndex(line => /^\s*\[\s*mcp_servers\s*\.\s*(?:chronoflow|"chronoflow"|'chronoflow')\s*\]\s*(?:#.*)?$/.test(line));
  const setting = "url = " + JSON.stringify(url);
  if (section === -1) {
    const prefix = content.trimEnd();
    saveConfig(file, (prefix ? prefix + newline + newline : "") + "[mcp_servers.chronoflow]" + newline + setting + newline);
    return;
  }
  let index = section + 1;
  while (index < lines.length && !/^\s*\[/.test(lines[index])) {
    if (/^\s*url\s*=/.test(lines[index])) {
      lines[index] = setting;
      saveConfig(file, lines.join(newline));
      return;
    }
    index++;
  }
  lines.splice(section + 1, 0, setting);
  saveConfig(file, lines.join(newline));
}

function writeJson(file: string, update: (config: any) => void): void {
  let config: any = {};
  if (fs.existsSync(file)) config = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error("Invalid agent configuration");
  update(config);
  saveConfig(file, JSON.stringify(config, null, 2) + "\n");
}

function installOpenCode(directory: string, url: string): string {
  const jsonc = path.join(directory, "opencode.jsonc");
  const file = fs.existsSync(jsonc) ? jsonc : path.join(directory, "opencode.json");
  let content = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "{}\n";
  const errors: ParseError[] = [];
  const config = parse(content, errors, { allowTrailingComma: true });
  if (errors.length || !config || typeof config !== "object" || Array.isArray(config)) {
    throw new Error("Invalid OpenCode configuration in " + file);
  }
  const options = { formattingOptions: { insertSpaces: true, tabSize: 2, eol: content.includes("\r\n") ? "\r\n" : "\n" } };
  if (config.mcp?.chronoflow !== undefined) {
    content = applyEdits(content, modify(content, ["mcp", "chronoflow"], undefined, options));
  }
  content = applyEdits(content, modify(content, ["mcp", "servers", "chronoflow"], { type: "remote", url, oauth: false }, options));
  saveConfig(file, content);
  return file;
}

export function registerMcpHandlers(): void {
  ipcMain.handle("mcp:install", async (_event, agent: string) => {
    try {
      if (!ready) throw new Error(startupError || "The MCP server is starting. Try again in a moment.");
      const url = `http://127.0.0.1:${port}/mcp/${token}`;
      const home = process.env["IS_TEST"] === "true" ? path.join(app.getPath("userData"), "agents") : os.homedir();
      let file: string;
      if (agent === "codex") {
        file = path.join(home, ".codex", "config.toml");
        installCodex(file, url);
      } else if (agent === "claude") {
        file = path.join(home, ".claude.json");
        writeJson(file, c => { c.mcpServers ??= {}; c.mcpServers.chronoflow = { type: "http", url }; });
      } else if (agent === "agy") {
        file = path.join(home, ".gemini", "config", "mcp_config.json");
        writeJson(file, c => { c.mcpServers ??= {}; c.mcpServers.chronoflow = { serverUrl: url }; });
      } else if (agent === "opencode") {
        const configHome = process.env["IS_TEST"] === "true" ? undefined : process.env["XDG_CONFIG_HOME"];
        file = installOpenCode(path.join(configHome || path.join(home, ".config"), "opencode"), url);
      } else throw new Error("Unsupported agent");
      return { success: true, path: file };
    } catch (error) { return { success: false, error: error instanceof Error ? error.message : String(error) }; }
  });
}
