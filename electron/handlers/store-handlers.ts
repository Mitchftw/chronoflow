import { ipcMain } from "electron";
import * as dbService from "../db-service";
import { getTimerState } from "./timer-handlers";

let storeOperationQueue: Promise<void> = Promise.resolve();

/**
 * Enqueue store operations to prevent race conditions
 */
function enqueueStoreOperation<T>(
  operation: () => Promise<T>,
): Promise<T> {
  const run = storeOperationQueue.then(operation);
  storeOperationQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/**
 * Register all store-related IPC handlers (SQLite-backed)
 */
export function registerStoreHandlers() {
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
    return enqueueStoreOperation(async () => {
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
    return enqueueStoreOperation(async () => {
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
