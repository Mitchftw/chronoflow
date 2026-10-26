import { _electron as electron } from "@playwright/test";
import { test, expect } from "@playwright/test";
import type { ElectronApplication, Page } from "@playwright/test";

const ELECTRON_MAIN = "dist/electron/main.js";

let electronApp: ElectronApplication;
let window: Page;

const pad = (n: number) => String(n).padStart(2, "0");
const localDate = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

test.beforeAll(async () => {
  electronApp = await electron.launch({
    args: [ELECTRON_MAIN],
    env: { ...process.env, NODE_ENV: "production", IS_TEST: "true" },
  });
  window = await electronApp.firstWindow();
  await window.waitForSelector("app-root", { timeout: 30000 });
});

test.afterAll(async () => {
  await electronApp.close();
});

test("repro: dashboard keeps selected date across re-entry", async () => {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayISO = localDate(yesterday);

  await window.locator("app-side-nav").locator("text=Dashboard").click();
  await window.waitForTimeout(500);

  // Navigate to yesterday
  await window.locator("button[title='Previous day']").first().click();
  await window.waitForTimeout(400);
  await expect(window.locator("app-dashboard header")).toContainText("Yesterday");

  // Leave the dashboard and come back
  await window.locator("app-side-nav").locator("text=Issues").click();
  await window.waitForTimeout(400);
  await window.locator("app-side-nav").locator("text=Dashboard").click();
  await window.waitForTimeout(500);

  await expect(window.locator("app-dashboard header")).toContainText("Yesterday");

  // Open add entry dialog and verify it pre-fills yesterday's date
  await window
    .locator("button:has-text('Add entry'), button:has-text('Add Entry')")
    .first()
    .click();
  await window.waitForTimeout(400);
  const dateInput = window.locator("input#edit-entry-date");
  await expect(dateInput).toBeVisible();
  await expect(dateInput).toHaveValue(yesterdayISO);
  await window.locator("app-dialog button:has-text('Cancel')").first().click();
});
