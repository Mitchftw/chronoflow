import type { TimeEntry } from "../../src/types";
import { randomUUID } from "crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as db from "../db-service";
import { getTimerState, resumeTrackedEntry, splitTrackedEntry, splitTrackedRange, timerApi } from "../handlers/timer-handlers";
import { entryDurationSeconds, pad2, parseTimeToSeconds } from "../utils/time";
import { clock, color, id, localDate, ok, status, write } from "./mcp-tools";

async function requireProject(projectId: string) {
  const project = await db.getProject(projectId);
  if (!project) throw new Error(`Project "${projectId}" was not found.`);
  return project;
}

async function requireTask(taskId: string) {
  const task = await db.getIssue(taskId);
  if (!task) throw new Error(`Task "${taskId}" was not found.`);
  return task;
}

async function requireEntry(entryId: string) {
  const entry = await db.getTimeEntry(entryId);
  if (!entry) throw new Error(`Time entry "${entryId}" was not found.`);
  return entry;
}

function requireChanges(fields: object) {
  if (!Object.keys(fields).length) throw new Error("Supply at least one field to change.");
}

export function registerEditTools(server: McpServer): void {
  const projectFields = { name: id, description: z.string().optional(), color: color.optional() };
  server.registerTool("create_project", {
    description: "Create a local project and return its ID.",
    inputSchema: z.strictObject(projectFields),
  }, write(async args => {
    const projectId = randomUUID();
    await db.createProject({ id: projectId, name: args.name, description: args.description ?? "",
      color: args.color ?? "#3b82f6", createdAt: Date.now() });
    return ok(await db.getProject(projectId));
  }));
  server.registerTool("update_project", {
    description: "Rename a project or edit its description or color.",
    inputSchema: z.strictObject({ ...projectFields, name: id.optional(), projectId: id }),
  }, write(async ({ projectId, ...fields }) => {
    requireChanges(fields);
    await requireProject(projectId);
    await db.updateProject(projectId, fields);
    return ok(await db.getProject(projectId));
  }));
  server.registerTool("delete_project", {
    description: "Delete a project. Its tasks and time entries are retained.",
    inputSchema: z.strictObject({ projectId: id }),
  }, write(async ({ projectId }) => {
    await requireProject(projectId);
    await db.deleteProject(projectId);
    return ok({ deleted: true, projectId });
  }));
  server.registerTool("update_task", {
    description: "Edit a task, change its status or scheduled date, or move it to a project. An empty projectId unassigns it.",
    inputSchema: z.strictObject({ taskId: id, title: id.optional(), description: z.string().optional(),
      status: status.optional(), projectId: z.string().optional(), date: localDate.optional(),
      estimate: z.number().nonnegative().optional().describe("Minutes"), color: color.nullable().optional() }),
  }, write(async ({ taskId, ...fields }) => {
    requireChanges(fields);
    await requireTask(taskId);
    if (fields.projectId) await requireProject(fields.projectId);
    await db.updateIssue(taskId, fields);
    return ok(await db.getIssue(taskId));
  }));
  server.registerTool("delete_task", {
    description: "Delete a task and all of its local time entries. Linked worklog deletions are queued for Jira sync.",
    inputSchema: z.strictObject({ taskId: id }),
  }, write(async ({ taskId }) => {
    await requireTask(taskId);
    if (getTimerState().issueId === taskId) throw new Error("Stop the timer before deleting its task.");
    await db.deleteIssue(taskId);
    return ok({ deleted: true, taskId });
  }));

  server.registerTool("create_time_entry", {
    description: "Log completed work for a task. Date is the local start date. An earlier end time means the following day.",
    inputSchema: z.strictObject({ taskId: id, date: localDate, startTime: clock, endTime: clock, note: z.string().optional() }),
  }, write(async ({ taskId, date, startTime, endTime, note }) => {
    await requireTask(taskId);
    if (startTime === endTime) throw new Error("Start and end times must differ.");
    const entryId = randomUUID();
    await db.accountForEntryEdit([taskId], () => db.createTimeEntry({
      id: entryId, issueId: taskId, date, startTime, endTime, note: note ?? "", jiraWorklogId: null,
    }));
    return ok(await db.getTimeEntry(entryId));
  }));

  server.registerTool("move_time_entry", {
    description: "Reassign a whole entry to another task or shift it to a new local date or start time. Closed entries keep their duration. A running entry stays active.",
    inputSchema: z.strictObject({ entryId: id, taskId: id.optional(), date: localDate.optional(), startTime: clock.optional() }),
  }, write(async ({ entryId, taskId, date, startTime }) => {
    if (!taskId && !date && !startTime) throw new Error("Supply a destination taskId, date or startTime.");
    const entry = await requireEntry(entryId);
    if (taskId) await requireTask(taskId);
    const updates: Partial<TimeEntry> = {};
    if (taskId) updates.issueId = taskId;
    if (date) updates.date = date;
    if (startTime) {
      updates.startTime = startTime;
      if (entry.endTime) {
        const end = (parseTimeToSeconds(startTime) + entryDurationSeconds(entry)) % 86400;
        updates.endTime = [Math.floor(end / 3600), Math.floor(end / 60) % 60, end % 60].map(pad2).join(":");
      }
    }
    const result = await timerApi.updateEntry!(entryId, updates);
    if (!result.success) throw new Error(result.error);
    return ok(await db.getTimeEntry(entryId));
  }));

  server.registerTool("resume_time_entry", {
    description: "Continue tracking an existing open entry by ID. Use resume_timer for a paused timer.",
    inputSchema: z.strictObject({ entryId: id }),
  }, write(async ({ entryId }) => {
    const result = await resumeTrackedEntry(entryId);
    if (!result.success) throw new Error(result.error);
    return ok(result.data);
  }));

  server.registerTool("split_time_entry", {
    description: "Cut an entry at a local time. The second part can move to another task and keeps running if the source was active. Returns both entry IDs.",
    inputSchema: z.strictObject({ entryId: id, splitTime: clock, taskId: id.optional(), note: z.string().optional() }),
  }, write(async ({ entryId, splitTime, taskId, note }) => {
    if (taskId) await requireTask(taskId);
    return ok(await splitTrackedEntry(entryId, splitTime, taskId, note));
  }));

  server.registerTool("split_out_time_entry", {
    description: "Cut out the block from fromTime up to toTime. Supply taskId to move the block, or omit it to remove the time (e.g. lunch). Returns surviving part IDs.",
    inputSchema: z.strictObject({ entryId: id, fromTime: clock, toTime: clock, taskId: id.optional(), note: z.string().optional() }),
  }, write(async ({ entryId, fromTime, toTime, taskId, note }) => {
    if (taskId) await requireTask(taskId);
    return ok(await splitTrackedRange(entryId, fromTime, toTime, taskId, note));
  }));

  server.registerTool("merge_time_entries", {
    description: "Merge closed entries for one task into one continuous span under 24 hours, including any gaps. Choose how to combine notes.",
    inputSchema: z.strictObject({ entryIds: z.array(id).min(2).max(1000),
      noteStrategy: z.enum(["concat", "keep-first", "keep-last", "custom"]).default("concat"), customNote: z.string().optional() }),
  }, write(async ({ entryIds, noteStrategy, customNote }) => {
    if (new Set(entryIds).size !== entryIds.length) throw new Error("Supply distinct entry IDs.");
    if (noteStrategy === "custom" && customNote === undefined) throw new Error("Supply customNote for the custom note strategy.");
    const first = await requireEntry(entryIds[0]);
    const retained = await db.accountForEntryEdit([first.issueId], () => db.mergeTimeEntries(entryIds, noteStrategy, customNote));
    return ok(await db.getTimeEntry(retained));
  }));

  server.registerTool("delete_time_entry", {
    description: "Delete one time entry and queue its linked worklog for deletion on the next Jira sync.",
    inputSchema: z.strictObject({ entryId: id }),
  }, write(async ({ entryId }) => {
    const entry = await requireEntry(entryId);
    if (getTimerState().entryId === entryId) throw new Error("Stop the timer before deleting this entry.");
    await db.accountForEntryEdit([entry.issueId], () => db.deleteTimeEntry(entryId));
    return ok({ deleted: true, entryId });
  }));
}
