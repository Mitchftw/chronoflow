import { _electron as electron } from "@playwright/test";
import { test, expect } from "@playwright/test";
import type { ElectronApplication, Page } from "@playwright/test";

const ELECTRON_MAIN = "dist/electron/main.js";

let electronApp: ElectronApplication;
let page: Page;

const pad = (n: number) => String(n).padStart(2, "0");
const localDate = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const today = new Date();
const todayISO = localDate(today);
const yesterday = new Date(today);
yesterday.setDate(yesterday.getDate() - 1);
const yesterdayISO = localDate(yesterday);

test.beforeAll(async () => {
  electronApp = await electron.launch({
    args: [ELECTRON_MAIN],
    env: { ...process.env, NODE_ENV: "production", IS_TEST: "true" },
  });
  page = await electronApp.firstWindow();
  await page.waitForSelector("app-root", { timeout: 30000 });
  await page.waitForTimeout(800);

  await page.evaluate(
    async ({ todayISO, yesterdayISO }) => {
      const api = window.electronAPI;
      if (!api) throw new Error("electronAPI is not available");
      await api.store.set("app", {
        themePreference: "light",
        autoStartTimer: true,
        roundTo15Min: false,
        idleThresholdMinutes: 5,
        timerMode: "draggable",
        autoUpdate: false,
        autoHideNotch: false,
        notchDisplayId: null,
        defaultVacationHours: 8,
        dailyGoalHours: 8,
        defaultVacationIssueKey: null,
        droplets: {},
      });
      await api.store.set("projects", [
        {
          id: "smoke-project",
          name: "Smoke Project",
          description: "Test fixture",
          color: "#6366f1",
          createdAt: 1,
        },
      ]);
      await api.store.set("issues", [
        {
          id: "smoke-issue",
          title: "Smoke task",
          description: "Fixture issue",
          projectId: "smoke-project",
          status: "in_progress",
          jiraIssueKey: "SMOKE-1",
          jiraConnectionId: null,
          estimate: 60,
          timeSpent: 0,
          isRunning: false,
          startTime: null,
          createdAt: Date.now(),
          date: todayISO,
          color: "#6366f1",
        },
      ]);
      await api.timer.createEntry({
        id: "smoke-entry-today-1",
        issueId: "smoke-issue",
        startTime: "09:00:00",
        endTime: "10:00:00",
        date: todayISO,
        note: "Today first",
        jiraWorklogId: null,
        isDirty: false,
      });
      await api.timer.createEntry({
        id: "smoke-entry-today-2",
        issueId: "smoke-issue",
        startTime: "10:30:00",
        endTime: "12:00:00",
        date: todayISO,
        note: "Today second",
        jiraWorklogId: null,
        isDirty: false,
      });
      await api.timer.createEntry({
        id: "smoke-entry-yesterday",
        issueId: "smoke-issue",
        startTime: "13:00:00",
        endTime: "17:00:00",
        date: yesterdayISO,
        note: "Yesterday",
        jiraWorklogId: null,
        isDirty: false,
      });
    },
    { todayISO, yesterdayISO },
  );

  await page.reload();
  await page.waitForSelector("app-root h1", { timeout: 30000 });
  await page.waitForTimeout(800);
});

test.afterAll(async () => {
  await electronApp.close();
});

const nav = async (label: string) => {
  await page.locator("app-side-nav").getByText(label, { exact: true }).click();
  await page.waitForTimeout(500);
};

test("timesheets only show the selected local day", async () => {
  await nav("Timesheets");
  await expect(page.locator("app-timesheets")).toContainText("Total: 2h 30m");
  await expect(page.locator("app-timesheets")).toContainText("Today first");
  await expect(page.locator("app-timesheets")).not.toContainText("Yesterday");

  const dateInput = page.locator("app-timesheets input[type='date']").first();
  await dateInput.fill(yesterdayISO);
  await dateInput.dispatchEvent("change");
  await page.waitForTimeout(500);

  await expect(page.locator("app-timesheets")).toContainText("Total: 4h");
  await expect(page.locator("app-timesheets")).toContainText("Yesterday");
  await expect(page.locator("app-timesheets")).not.toContainText("Today first");
});

test("dashboard follows the selected day and shows its label", async () => {
  await nav("Dashboard");
  await expect(page.locator("app-stats-cards")).toContainText("Tracked today");
  await expect(page.locator("app-stats-cards")).toContainText("2h 30m");

  await page.locator("button[title='Previous day']").first().click();
  await page.waitForTimeout(500);
  await expect(page.locator("app-stats-cards")).toContainText("Tracked on");
  await expect(page.locator("app-stats-cards")).toContainText("4h");

  // Monday-based week comparison: on a Monday, "yesterday" is last week.
  const weekStart = (d: Date) => {
    const copy = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const offset = (copy.getDay() + 6) % 7;
    copy.setDate(copy.getDate() - offset);
    return copy.getTime();
  };
  if (weekStart(yesterday) !== weekStart(today)) {
    await expect(page.locator("app-week-heatmap")).not.toContainText("This week");
  }

  await page.getByRole("button", { name: "Today", exact: true }).click();
  await page.waitForTimeout(400);
});

test("dialogs close on backdrop click and Escape", async () => {
  await nav("Issues");
  await page.getByRole("button", { name: /New Issue/i }).click();
  await expect(page.locator("app-dialog [role='dialog']")).toBeVisible();

  const overlay = page.locator("app-dialog div.fixed").first();
  await overlay.click({ position: { x: 8, y: 8 } });
  await expect(page.locator("app-dialog [role='dialog']")).not.toBeVisible();

  await page.getByRole("button", { name: /New Issue/i }).click();
  await expect(page.locator("app-dialog [role='dialog']")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("app-dialog [role='dialog']")).not.toBeVisible();
});

test("issues can be edited inline from the list", async () => {
  await nav("Issues");
  const card = page.locator("app-issue-card").filter({ hasText: "Smoke task" });
  await expect(card).toBeVisible();

  const edit = card
    .locator("button[aria-label*='Edit' i], button[title*='Edit' i]")
    .first();
  await expect(edit).toBeVisible();
  await edit.click();
  await expect(page.locator("app-dialog [role='dialog']")).toContainText(
    "Edit Issue",
  );

  const title = page.locator("input#issue-title");
  await title.fill("Smoke task edited");
  await page
    .locator("app-dialog button:has-text('Save Changes')")
    .first()
    .click();
  await page.waitForTimeout(700);
  await expect(page.locator("app-issue-card")).toContainText("Smoke task edited");
});

test("search results support keyboard selection", async () => {
  await nav("Dashboard");
  const input = page.locator("app-active-timer-card app-search-bar input").first();
  await input.fill("Smoke");
  await page.waitForTimeout(500);
  await input.press("ArrowDown");
  await input.press("ArrowDown");
  await input.press("Enter");
  await page.waitForTimeout(700);

  await expect(page.locator("app-active-timer-card")).toContainText(
    "Currently Tracking",
  );
  await page.locator("app-active-timer-card button", { hasText: "Stop" }).click();
});
