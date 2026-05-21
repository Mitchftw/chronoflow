import { contextBridge, ipcRenderer } from "electron";

declare const window: any;

contextBridge.exposeInMainWorld("electronAPI", {
  window: {
    minimize: () => ipcRenderer.invoke("window:minimize"),
    maximize: () => ipcRenderer.invoke("window:maximize"),
    close: () => ipcRenderer.invoke("window:close"),
  },

  store: {
    get: (key: string) => ipcRenderer.invoke("store:get", key),
    set: (key: string, value: any) =>
      ipcRenderer.invoke("store:set", key, value),
    delete: (key: string) => ipcRenderer.invoke("store:delete", key),
  },

  jira: {
    exchangeCode: (params: { code: string; redirectUri: string; codeVerifier?: string; clientId?: string; clientSecret?: string }) =>
      ipcRenderer.invoke("jira:exchange-code", params),
    getConfig: () => ipcRenderer.invoke("jira:get-config"),
    getAccessibleResources: (accessToken: string) =>
      ipcRenderer.invoke("jira:get-accessible-resources", accessToken),
    search: (params: any) => ipcRenderer.invoke("jira:search", params),
    addWorklog: (params: any) => ipcRenderer.invoke("jira:add-worklog", params),
    updateWorklog: (params: any) => ipcRenderer.invoke("jira:update-worklog", params),
    deleteWorklog: (params: any) => ipcRenderer.invoke("jira:delete-worklog", params),
    loadIssues: (params: any) => ipcRenderer.invoke("jira:load-issues", params),
    getWorklogsForDate: (params: any) =>
      ipcRenderer.invoke("jira:get-worklogs-for-date", params),
    // Connection management
    getConnections: () => ipcRenderer.invoke("jira:get-connections"),
    getDefaultConnection: async () => {
      const result = await ipcRenderer.invoke("jira:get-default-connection");
      return result?.success ? result.connection : null;
    },
    createConnection: (connectionData: any) =>
      ipcRenderer.invoke("jira:create-connection", connectionData),
    updateConnection: (params: { id: string; updates: any }) =>
      ipcRenderer.invoke("jira:update-connection", params),
    deleteConnection: (params: { id: string }) =>
      ipcRenderer.invoke("jira:delete-connection", params),
    testConnection: (params: any) =>
      ipcRenderer.invoke("jira:test-connection", params),
  },

  timer: {
    start: (issueId: string) =>
      ipcRenderer.invoke("timer:start", issueId),
    stop: (note?: string, stopTime?: number) =>
      ipcRenderer.invoke("timer:stop", note, stopTime),
    pause: () => ipcRenderer.invoke("timer:pause"),
    resume: () => ipcRenderer.invoke("timer:resume"),
    getState: () => ipcRenderer.invoke("timer:get-state"),
    getElapsed: () => ipcRenderer.invoke("timer:get-elapsed"),
    getEntries: (filters?: any) =>
      ipcRenderer.invoke("timer:get-entries", filters),
    createEntry: (entry: any) =>
      ipcRenderer.invoke("timer:create-entry", entry),
    updateEntry: (id: string, updates: any) =>
      ipcRenderer.invoke("timer:update-entry", { id, updates }),
    deleteEntry: (id: string) =>
      ipcRenderer.invoke("timer:delete-entry", id),
    splitEntry: (
      originalEntryId: string,
      splitTime: string,
      newIssueId?: string,
    ) =>
      ipcRenderer.invoke("timer:split-entry", originalEntryId, splitTime, newIssueId),
    mergeEntries: (
      entryIds: string[],
      noteStrategy: "concat" | "keep-first" | "keep-last" | "custom",
      customNote?: string,
    ) =>
      ipcRenderer.invoke("timer:merge-entries", entryIds, noteStrategy, customNote),
    getDeletedWorklogs: () => ipcRenderer.invoke("timer:get-deleted-worklogs"),
    clearDeletedWorklog: (id: string) => ipcRenderer.invoke("timer:clear-deleted-worklog", id),
  },

  idle: {
    getTime: () => ipcRenderer.invoke("idle:get-time"),
    onPowerSuspend: (callback: () => void) => {
      const subscription = () => callback();
      ipcRenderer.on("power:suspend", subscription);
      return () => ipcRenderer.removeListener("power:suspend", subscription);
    },
    onPowerResume: (callback: () => void) => {
      const subscription = () => callback();
      ipcRenderer.on("power:resume", subscription);
      return () => ipcRenderer.removeListener("power:resume", subscription);
    },
    onPowerLock: (callback: () => void) => {
      const subscription = () => callback();
      ipcRenderer.on("power:lock", subscription);
      return () => ipcRenderer.removeListener("power:lock", subscription);
    },
    onPowerUnlock: (callback: () => void) => {
      const subscription = () => callback();
      ipcRenderer.on("power:unlock", subscription);
      return () => ipcRenderer.removeListener("power:unlock", subscription);
    },
  },

  timerWindow: {
    create: (mode: "draggable" | "notch") =>
      ipcRenderer.invoke("timer-window:create", mode),
    hide: () => ipcRenderer.invoke("timer-window:hide"),
    expand: () => ipcRenderer.invoke("timer-window:expand"),
    onStateUpdate: (callback: (state: any) => void) => {
      const subscription = (_event: any, state: any) => callback(state);
      ipcRenderer.on("timer:state-update", subscription);
      return () =>
        ipcRenderer.removeListener("timer:state-update", subscription);
    },
    setIgnoreMouse: (ignore: boolean) =>
      ipcRenderer.send("timer-window:set-ignore-mouse", ignore),
    resize: (width: number, height: number) =>
      ipcRenderer.invoke("timer-window:resize", { width, height }),
  },

  updater: {
    checkForUpdates: () => ipcRenderer.invoke("updater:check-for-updates"),
    quitAndInstall: () => ipcRenderer.invoke("updater:quit-and-install"),
  },

  onDeepLink: (callback: (url: string) => void) => {
    const subscription = (_event: any, url: string) => callback(url);
    ipcRenderer.on("app:deep-link", subscription);
    return () => ipcRenderer.removeListener("app:deep-link", subscription);
  },
});

ipcRenderer.on("app:update-available", (_, info) => {
  window.dispatchEvent(new CustomEvent("app:update-available", { detail: info }));
});

ipcRenderer.on("app:update-downloaded", (_, info) => {
  window.dispatchEvent(new CustomEvent("app:update-downloaded", { detail: info }));
});
