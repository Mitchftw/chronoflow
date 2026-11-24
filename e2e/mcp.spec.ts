import { _electron as electron, expect, test as base } from "@playwright/test";
import type { ElectronApplication, Page } from "@playwright/test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { parse as parseJsonc } from "jsonc-parser";
import * as fs from "node:fs";
import * as path from "node:path";

interface Fixture {
  app: ElectronApplication;
  page: Page;
  profile: string;
  endpoint: URL;
  client: Client;
  tool(name: string, args?: Record<string, unknown>): Promise<any>;
  rejected(name: string, args?: Record<string, unknown>): Promise<string>;
}

const test = base.extend<{ mcp: Fixture }>({
  mcp: async ({}, use) => {
    const app = await electron.launch({
      args: ["dist/electron/main.js"],
      env: { ...process.env, NODE_ENV: "production", IS_TEST: "true", CHRONOFLOW_USE_INSTALLED_DATA: "true", CHRONOFLOW_MCP_PORT: "0" },
    });
    const client = new Client({ name: "chronoflow-e2e", version: "1" });
    try {
      const page = await app.firstWindow();
      await page.waitForSelector("app-root");
      const profile = await app.evaluate(({ app }) => app.getPath("userData"));
      expect(path.basename(profile)).toMatch(/^chronoflow-test-userdata-/);
      expect(fs.existsSync(path.join(profile, "databases", "todo-tracker.dev.db"))).toBe(true);
      const installed = await page.evaluate(() => window.electronAPI!.mcp.install("claude"));
      expect(installed.success).toBe(true);
      expect(installed.path).toBe(path.join(profile, "agents", ".claude.json"));
      const endpoint = new URL(JSON.parse(fs.readFileSync(installed.path!, "utf8")).mcpServers.chronoflow.url);
      await client.connect(new StreamableHTTPClientTransport(endpoint));
      const call = async (name: string, args: Record<string, unknown>, error: boolean) => {
        const result = await client.callTool({ name, arguments: args });
        const content = result.content as { type: string; text: string }[];
        expect(content[0].type).toBe("text");
        expect(Boolean(result.isError), name + " returned " + content[0].text).toBe(error);
        return content[0].text;
      };
      await use({ app, page, profile, endpoint, client,
        tool: async (name, args = {}) => JSON.parse(await call(name, args, false)),
        rejected: (name, args = {}) => call(name, args, true),
      });
    } finally {
      await client.close();
      await app.close();
    }
  },
});

test("SDK discovery and agent installers preserve existing configuration", async ({ mcp }) => {
  const { client, endpoint, page, profile } = mcp;
  expect(client.getServerVersion()?.name).toBe("chronoflow");
  const names = (await client.listTools()).tools.map(t => t.name);
  expect(names.sort()).toEqual([
    "create_project", "create_task", "create_time_entry", "delete_project", "delete_task", "delete_time_entry",
    "get_jira_issue", "get_running_timer", "import_jira_issue", "list_jira_connections", "list_projects", "list_tasks", "list_time_entries",
    "merge_time_entries", "move_time_entry", "pause_timer", "resume_time_entry", "resume_timer", "search_jira",
    "split_out_time_entry", "split_time_entry", "start_timer", "stop_timer", "update_project", "update_task", "update_time_entry",
  ].sort());
  await page.locator("app-side-nav").getByText("Settings").click();
  const agent = page.getByRole("combobox", { name: "Agent", exact: true });
  await expect(agent).toHaveValue("codex");
  for (const [name, relative] of Object.entries({
    codex: ".codex/config.toml", claude: ".claude.json", agy: ".gemini/config/mcp_config.json", opencode: ".config/opencode/opencode.jsonc",
  })) {
    const file = path.join(profile, "agents", relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const seed = name === "codex" ? '[mcp_servers.other]\nurl = "other"\n[mcp_servers.chronoflow]\nurl = "old"\n[profiles.work]\nmodel = "keep"\n'
       : name === "opencode" ? '{\n  // keep this comment\n  "mcp": { "chronoflow": { "url": "old" }, "servers": { "other": {} } },\n}\n'
      : JSON.stringify({ other: "keep", mcpServers: { other: {} } });
    fs.writeFileSync(file, seed);
    await agent.selectOption(name);
    await page.getByRole("button", { name: "Install MCP" }).click();
    await expect(page.getByRole("status").filter({ hasText: file })).toBeVisible();
    const config = fs.readFileSync(file, "utf8");
    expect(config).toContain("keep");
    expect(config).toContain("other");
    if (name === "opencode") {
      const parsed = parseJsonc(config);
      expect(parsed.mcp.servers.chronoflow).toEqual({ type: "remote", url: endpoint.href, oauth: false });
      expect(parsed.mcp.chronoflow).toBeUndefined();
    }
    expect(config.split(endpoint.href)).toHaveLength(2);
    expect(config).not.toContain('"old"');
    const again = await page.evaluate(agent => window.electronAPI!.mcp.install(agent), name);
    expect(again.success).toBe(true);
    expect(fs.readFileSync(file, "utf8")).toBe(config);
  }
  const claude = path.join(profile, "agents", ".claude.json");
  fs.writeFileSync(claude, "{broken");
  expect((await page.evaluate(() => window.electronAPI!.mcp.install("claude"))).success).toBe(false);
  expect(fs.readFileSync(claude, "utf8")).toBe("{broken");
  expect((await fetch(new URL("/mcp/wrong", endpoint), { method: "POST" })).status).toBe(403);
  expect((await fetch(endpoint, { method: "POST", headers: { Origin: "http://example.invalid" } })).status).toBe(403);
  expect((await fetch(endpoint)).status).toBe(405);
});

test("project and task edits reach the UI, preserve entries and honor filters", async ({ mcp: { page, tool, rejected } }) => {
  const project = await tool("create_project", { name: "Client work" });
  expect(await tool("update_project", { projectId: project.id, name: "Studio", color: "#abcdef" })).toMatchObject({ name: "Studio" });
  expect(await tool("list_projects")).toHaveLength(1);
  await page.locator("app-side-nav").getByText("Issues", { exact: true }).click();
  const task = await tool("create_task", { title: "Design review", projectId: project.id, date: "2024-02-29" });
  await expect(page.getByText("Design review", { exact: true }).first()).toBeVisible();
  const changed = await tool("update_task", { taskId: task.id, title: "Release review", status: "done", estimate: 30 });
  expect(changed).toMatchObject({ title: "Release review", status: "done", estimate: 30 });
  await expect(page.getByText("Release review", { exact: true }).first()).toBeVisible();
  expect(await tool("list_tasks", { date: "2024-02-29", projectId: project.id, status: "done" })).toHaveLength(1);
  await rejected("update_task", { taskId: task.id, date: "2025-02-29" });
  await rejected("update_task", { taskId: task.id, projectId: "missing" });
  await rejected("create_task", { title: "  " });
  expect(await tool("update_task", { taskId: task.id, projectId: "" })).toMatchObject({ projectId: null });
  await tool("update_task", { taskId: task.id, projectId: project.id });
  await tool("create_time_entry", { taskId: task.id, date: task.date, startTime: "9:00", endTime: "10:00" });
  await tool("delete_project", { projectId: project.id });
  expect(await tool("list_tasks")).toMatchObject([{ id: task.id, projectId: null }]);
  expect(await tool("list_time_entries")).toHaveLength(1);
  await tool("delete_task", { taskId: task.id });
  expect(await tool("list_time_entries")).toEqual([]);
  await rejected("delete_task", { taskId: task.id });
});

test("move, split, extract, merge and delete preserve dates, notes and tracked totals", async ({ mcp: { tool, rejected } }) => {
  const a = (await tool("create_task", { title: "Support" })).id;
  const b = (await tool("create_task", { title: "Incident" })).id;
  const original = await tool("create_time_entry", { taskId: a, date: "2024-02-28", startTime: "23:30", endTime: "01:30", note: "shift" });
  const parts = await tool("split_time_entry", { entryId: original.id, splitTime: "00:30", taskId: b, note: "handover" });
  const tail = (await tool("list_time_entries", { issueId: b }))[0];
  expect(tail).toMatchObject({ id: parts.lastId, date: "2024-02-29", startTime: "00:30:00", endTime: "01:30:00", note: "handover" });
  const moved = await tool("move_time_entry", { entryId: tail.id, taskId: a, date: "2024-03-01", startTime: "11:15:42" });
  expect(moved).toMatchObject({ startTime: "11:15:42", endTime: "12:15:42", date: "2024-03-01", issueId: a });
  await rejected("split_time_entry", { entryId: tail.id, splitTime: "11:15:42" });
  await rejected("split_out_time_entry", { entryId: tail.id, fromTime: "11:30", toTime: "12:16" });
  await rejected("split_out_time_entry", { entryId: tail.id, fromTime: "11:30", toTime: "11:45", taskId: "absent" });
  expect((await tool("list_time_entries", { date: moved.date }))).toEqual([moved]);
  await rejected("split_out_time_entry", { entryId: tail.id, fromTime: "11:30", toTime: "11:45", newTaskId: b });
  const block = await tool("split_out_time_entry", { entryId: tail.id, fromTime: "11:30", toTime: "11:45", taskId: b, note: "incident" });
  expect(block).toMatchObject({ firstId: tail.id, lastId: expect.any(String), movedId: expect.any(String) });
  await rejected("merge_time_entries", { entryIds: [block.firstId, block.movedId] });
  await rejected("merge_time_entries", { entryIds: [block.firstId, block.firstId] });
  await rejected("merge_time_entries", { entryIds: [block.firstId, original.id] });
  await tool("move_time_entry", { entryId: block.movedId, taskId: a });
  const merged = await tool("merge_time_entries", { entryIds: [block.lastId, block.movedId, block.firstId], noteStrategy: "custom", customNote: "complete" });
  expect(merged).toMatchObject({ id: tail.id, startTime: moved.startTime, endTime: moved.endTime, note: "complete" });
  const trimmed = await tool("split_out_time_entry", { entryId: tail.id, fromTime: moved.startTime, toTime: "11:30" });
  expect(trimmed).toEqual({ firstId: null, lastId: tail.id, movedId: null });
  await tool("split_out_time_entry", { entryId: tail.id, fromTime: "12:00", toTime: moved.endTime });
  expect(await tool("list_time_entries", { startDate: moved.date, endDate: moved.date, limit: 1 })).toMatchObject([{ startTime: "11:30:00", endTime: "12:00:00" }]);
  expect((await tool("list_tasks")).find((t: any) => t.id === a).timeSpent).toBe(5400);
  expect(await tool("split_out_time_entry", { entryId: tail.id, fromTime: "11:30", toTime: "12:00" })).toEqual({ firstId: null, lastId: null, movedId: null });
  await tool("delete_time_entry", { entryId: original.id });
  expect(await tool("list_time_entries")).toEqual([]);
});

test("timer concurrency, live edits and both split modes follow the open remainder", async ({ mcp: { app, client, tool, rejected } }) => {
  // A fixed local afternoon also exercises these assertions when CI runs around midnight.
  await app.evaluate(() => {
    const NativeDate = Date;
    const instant = new NativeDate(2025, 4, 15, 15, 0, 0).getTime();
    globalThis.Date = new Proxy(NativeDate, {
      construct(target, args) { return Reflect.construct(target, args.length ? args : [instant]); },
      get(target, key) { return key === "now" ? () => instant : Reflect.get(target, key); },
    });
  });
  const a = (await tool("create_task", { title: "First" })).id;
  const b = (await tool("create_task", { title: "Second" })).id;
  await rejected("start_timer", { taskId: a, startTime: "25:12" });
  await rejected("start_timer", { taskId: a, startTime: "16:00" });
  await rejected("start_timer", { taskId: a, issueKey: "TEST-1" });
  const starts = await Promise.all([1, 2].map(() => client.callTool({
    name: "start_timer", arguments: { taskId: a, startTime: "10:00" },
  })));
  expect(starts.filter(r => !r.isError)).toHaveLength(1);
  const running = await tool("get_running_timer");
  expect(running).toMatchObject({ issueId: a, elapsed: 18000 });
  await rejected("delete_time_entry", { entryId: running.entryId });
  await rejected("delete_task", { taskId: a });
  await rejected("update_time_entry", { entryId: running.entryId, endTime: "12:00" });
  expect((await tool("pause_timer")).timer.isPaused).toBe(true);
  await rejected("pause_timer");
  expect((await tool("resume_timer")).timer.isPaused).toBe(false);
  await rejected("resume_timer");
  const edited = await tool("update_time_entry", { entryId: running.entryId, startTime: "09:30" });
  expect(edited.timer.elapsed).toBe(19800);
  const cut = await tool("split_time_entry", { entryId: running.entryId, splitTime: "11:00", taskId: b });
  expect(await tool("get_running_timer")).toMatchObject({ entryId: cut.lastId, issueId: b, elapsed: 14400 });
  await tool("pause_timer");
  const lunch = await tool("split_out_time_entry", { entryId: cut.lastId, fromTime: "12:00", toTime: "12:30" });
  expect(await tool("get_running_timer")).toMatchObject({ entryId: lunch.lastId, isPaused: true, elapsed: 9000 });
  await tool("move_time_entry", { entryId: lunch.lastId, taskId: a });
  await tool("resume_timer");
  expect(await tool("stop_timer", { note: "finished" })).toMatchObject({ stopped: true, entryId: lunch.lastId, elapsedSeconds: 9000 });
  expect(await tool("get_running_timer")).toEqual({ isRunning: false });
  expect(await tool("list_tasks")).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: a, timeSpent: 14400, isRunning: false }),
    expect.objectContaining({ id: b, timeSpent: 3600, isRunning: false }),
  ]));
  const entry = (await tool("list_time_entries", { issueId: a }))[0];
  expect(entry).toMatchObject({ note: "finished", endTime: "15:00:00" });
  await tool("update_time_entry", { entryId: entry.id, endTime: "" });
  expect(await tool("resume_time_entry", { entryId: entry.id })).toMatchObject({ entryId: entry.id, elapsed: 9000 });
  await tool("stop_timer");
  await rejected("resume_time_entry", { entryId: entry.id });
});

test("Jira discovery, search, connection-specific mirrors and worklog ownership", async ({ mcp: { app, page, tool, rejected } }) => {
  expect(await tool("list_jira_connections")).toMatchObject({ connections: [] });
  expect(await rejected("search_jira", { query: "login" })).toContain("No Jira connection");
  await rejected("get_jira_issue", { issueKey: "CF-1", connectionId: "missing" });
  // Replace only outbound Jira HTTP. Authentication, mapping, SQLite and MCP stay real.
  await app.evaluate(({ app }) => {
    const load = process.getBuiltinModule("module").createRequire(app.getAppPath() + "/package.json");
    const axios = load("axios");
    axios.defaults.adapter = async (config: any) => {
      const domain = new URL(config.url).hostname;
      if (!domain.endsWith(".invalid") || !config.headers.Authorization?.startsWith("Basic ")) throw Error("Unexpected test request");
      const issue = { key: "CF-1", fields: {
        summary: domain, description: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Detail" }] }] },
        status: { name: "Open" }, project: { key: "CF", name: "Flow" }, timeoriginalestimate: 1800,
      } };
      return { status: 200, statusText: "OK", headers: {}, config, data: config.url.endsWith("/search/jql") ? { issues: [issue] } : issue };
    };
  });
  async function connect(domain: string, isDefault: boolean) {
    const result = await page.evaluate(({ domain, isDefault }) => window.electronAPI!.jira.createConnection({
      name: domain, authType: "api-key", domain, email: "test@example.invalid", apiToken: "mock-secret", isDefault,
    }), { domain, isDefault });
    expect(result.success).toBe(true);
    return result.connection!.id;
  }
  const alpha = await connect("alpha.invalid", true);
  const beta = await connect("beta.invalid", false);
  const connections = await tool("list_jira_connections");
  expect(connections.defaultConnectionId).toBe(alpha);
  expect(JSON.stringify(connections)).not.toContain("mock-secret");
  const found = await tool("search_jira", { query: "login error" });
  expect(found.issues[0]).toMatchObject({ key: "CF-1", description: "Detail", estimateMinutes: 30 });
  expect(found.jql).not.toContain("key =");
  expect((await tool("search_jira", { query: "CF-1" })).jql).toContain('key = "CF-1"');
  expect((await tool("search_jira", { jql: "project = CF" })).jql).toBe("project = CF");
  const first = await tool("start_timer", { issueKey: "cf-1" });
  expect(first).toMatchObject({ createdLocalTask: true, issue: { title: "alpha.invalid", jiraConnectionId: alpha } });
  await tool("stop_timer");
  expect((await tool("get_jira_issue", { issueKey: "CF-1", connectionId: beta })).local).toBeNull();
  expect((await tool("import_jira_issue", { issueKey: "CF-1", connectionId: beta })).created).toBe(true);
  expect((await tool("get_running_timer")).isRunning).toBe(false);
  const second = await tool("start_timer", { issueKey: "CF-1", connectionId: beta });
  expect(second.createdLocalTask).toBe(false);
  expect(second.issue.id).not.toBe(first.issue.id);
  await tool("stop_timer");
  expect((await tool("start_timer", { issueKey: "CF-1" })).createdLocalTask).toBe(false);
  await tool("stop_timer");
  const entry = await tool("create_time_entry", { taskId: first.issue.id, date: "2024-07-01", startTime: "10:00", endTime: "12:00" });
  await page.evaluate(id => window.electronAPI!.timer.updateEntry(id, { jiraWorklogId: "remote-1", isDirty: false }), entry.id);
  const parts = await tool("split_time_entry", { entryId: entry.id, splitTime: "10:30" });
  const entries = await tool("list_time_entries", { date: entry.date });
  expect(entries).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: parts.firstId, jiraWorklogId: "remote-1", isDirty: true }),
    expect.objectContaining({ id: parts.lastId, jiraWorklogId: null, isDirty: true }),
  ]));
  expect(await tool("move_time_entry", { entryId: entry.id, taskId: second.issue.id })).toMatchObject({ jiraWorklogId: null, isDirty: true });
  const queued = await page.evaluate(() => window.electronAPI!.timer.getDeletedWorklogs());
  expect(queued.worklogs).toMatchObject([{ jiraConnectionId: alpha, issueKey: "CF-1", jiraWorklogId: "remote-1" }]);
});

test("a failed database write rolls the entire split back", async ({ mcp: { app, tool, rejected } }) => {
  const task = await tool("create_task", { title: "Rollback" });
  const entry = await tool("create_time_entry", { taskId: task.id, date: "2024-07-01", startTime: "09:00", endTime: "12:00" });
  await app.evaluate(async ({ app }) => {
    const load = process.getBuiltinModule("module").createRequire(app.getAppPath() + "/package.json");
    const database = load("./database.js").getDatabase();
    await database.exec("CREATE TRIGGER fail_segment BEFORE INSERT ON time_entries BEGIN SELECT RAISE(ABORT, 'simulated storage failure'); END");
  });
  expect(await rejected("split_out_time_entry", { entryId: entry.id, fromTime: "10:00", toTime: "10:30", taskId: task.id })).toContain("simulated storage failure");
  expect(await tool("list_time_entries")).toEqual([entry]);
  expect((await tool("list_tasks"))[0].timeSpent).toBe(10800);
});

test("an overnight split can be merged back with second precision", async ({ mcp: { tool } }) => {
  const task = await tool("create_task", { title: "Night shift" });
  const entry = await tool("create_time_entry", { taskId: task.id, date: "2024-12-31", startTime: "23:59:42", endTime: "00:00:14", note: "night" });
  const cut = await tool("split_time_entry", { entryId: entry.id, splitTime: "00:00:01", note: "new year" });
  expect(await tool("list_time_entries", { taskId: task.id })).toMatchObject([
    { date: "2025-01-01", startTime: "00:00:01" }, { date: "2024-12-31", endTime: "00:00:01" },
  ]);
  expect(await tool("merge_time_entries", { entryIds: [cut.lastId, cut.firstId] })).toEqual({ ...entry, note: "night; new year" });
  expect((await tool("list_tasks"))[0].timeSpent).toBe(32);
});

test("desktop and MCP clients can create and edit different records concurrently", async ({ mcp: { page, tool } }) => {
  const [ui, agent] = await Promise.all([
    page.evaluate(async () => {
      const project = { id: crypto.randomUUID(), name: "Desktop project", description: "", color: "#abcdef", createdAt: Date.now() };
      await window.electronAPI!.store.createProject(project);
      return project;
    }),
    tool("create_project", { name: "Agent project" }),
  ]);
  await Promise.all([
    page.evaluate(id => window.electronAPI!.store.updateProject(id, { name: "Desktop edit" }), ui.id),
    tool("update_project", { projectId: agent.id, name: "Agent edit" }),
  ]);
  expect(await tool("list_projects")).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: agent.id, name: "Agent edit" }), expect.objectContaining({ id: ui.id, name: "Desktop edit" }),
  ]));
});
