import type { Project, Issue } from "../../src/types";
import { ipcMain } from "electron";
import * as dbService from "../db-service";
import { getTimerState } from "./timer-handlers";

import { enqueueWrite } from "../services/write-queue";

/**
 * Register all store-related IPC handlers (SQLite-backed)
 */
export function registerStoreHandlers() {
  // Interactive edits target one row. A renderer snapshot may already be stale
  // when an agent creates a task or starts a timer in another request.
  ipcMain.handle("store:create-project", (_, project: Project) => enqueueWrite(() => dbService.createProject(project)));
  ipcMain.handle("store:update-project", (_, id: string, fields: Partial<Project>) => enqueueWrite(async () => {
    await dbService.updateProject(id, fields);
    return dbService.getProject(id);
  }));
  ipcMain.handle("store:delete-project", (_, id: string) => enqueueWrite(() => dbService.deleteProject(id)));
  ipcMain.handle("store:create-issue", (_, issue: Issue) => enqueueWrite(() => dbService.createIssue(issue)));
  ipcMain.handle("store:update-issue", (_, id: string, fields: Partial<Issue>) => enqueueWrite(async () => {
    await dbService.updateIssue(id, fields);
    return dbService.getIssue(id);
  }));
  ipcMain.handle("store:delete-issue", (_, id: string) => enqueueWrite(async () => {
    if (getTimerState().issueId === id) throw new Error("Stop the timer before deleting its task.");
    await dbService.deleteIssue(id);
  }));

  // Get data from store
  ipcMain.handle("store:get", async (_, key: string) => {
    switch (key) {
      case "projects":
        return await dbService.getAllProjects();
      case "issues":
        return await dbService.getIssues();
      case "timeEntries":
        return await dbService.getTimeEntries();
      case "jiraConnections":
        return await dbService.getAllJiraConnections();
      default:
        return await dbService.getSetting(key);
    }
  });

  // Set data in store
  ipcMain.handle("store:set", async (_, key: string, value: any) => {
    return enqueueWrite(async () => {
      switch (key) {
        case "projects": {
          if (value && Array.isArray(value)) {
            await dbService.syncProjects(value);
          } else {
            await dbService.deleteAllProjects();
          }
          break;
        }
        case "issues": {
          if (value && Array.isArray(value)) {
            // The renderer performs full-list syncs. Never let a stale list
            // (or a bulk delete) remove the issue that is currently being
            // timed: the FK cascade would delete the open time entry and
            // leave the timer pointing at a row that no longer exists.
            const runningIssueId = getTimerState().issueId;
            let safeValue = value;
            if (
              runningIssueId &&
              !value.some((issue: any) => issue?.id === runningIssueId)
            ) {
              const runningIssue = await dbService.getIssue(runningIssueId);
              if (runningIssue) safeValue = [...value, runningIssue];
            }
            await dbService.syncIssues(safeValue);
          } else if (getTimerState().issueId) {
            // Refuse a bulk wipe while a timer is running. Re-creating the
            // issue afterwards would not bring back its cascaded time entry.
            console.warn(
              "[store] Refusing to delete all issues while a timer is running",
            );
          } else {
            await dbService.deleteAllIssues();
          }
          break;
        }
        case "timeEntries":
          if (value && Array.isArray(value)) {
            await dbService.deleteAllTimeEntries();
            for (const entry of value) {
              await dbService.createTimeEntry(entry);
            }
          }
          break;
        default:
          await dbService.setSetting(key, value);
      }
    });
  });

  // Delete data from store
  ipcMain.handle("store:delete", async (_, key: string) => {
    return enqueueWrite(async () => {
      switch (key) {
        case "projects":
          await dbService.deleteAllProjects();
          break;
        case "issues":
          await dbService.deleteAllIssues();
          break;
        case "timeEntries":
          await dbService.deleteAllTimeEntries();
          break;
        case "jiraConnections":
          await dbService.deleteAllJiraConnections();
          break;
        default:
          await dbService.deleteSetting(key);
      }
    });
  });
}
