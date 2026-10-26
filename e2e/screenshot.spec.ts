import { _electron as electron } from "@playwright/test";
import { test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

test("take screenshot", async () => {
  const mainJs = path.resolve(process.cwd(), "dist/electron/main.js");
  fs.mkdirSync(path.resolve(process.cwd(), "test-results"), { recursive: true });

  const electronApp = await electron.launch({
    args: [mainJs],
    env: { ...process.env, NODE_ENV: "production", IS_TEST: "true" },
  });

  try {
    const window = await electronApp.firstWindow();
    await window.waitForSelector("app-root", { timeout: 30000 });
    await window.waitForTimeout(2000);

    const screenshotPath = path.resolve(
      process.cwd(),
      "test-results",
      "app-screenshot.png",
    );
    await window.screenshot({ path: screenshotPath, type: "png" });
    console.log("Screenshot saved to:", screenshotPath);

    const snapshot = await window.evaluate(() => {
      const root = document.querySelector("app-root");
      return {
        hasTitleBar: !!document.querySelector("app-title-bar"),
        hasSideNav: !!document.querySelector("app-side-nav"),
        hasRouterOutlet: !!document.querySelector("router-outlet"),
        hasAppRoot: !!root,
        rootClasses: root ? Array.from(root.classList) : [],
        htmlClasses: Array.from(document.documentElement.classList),
        bodyChildCount: document.body.children.length,
        mainContent: document.querySelector("main")?.innerHTML?.slice(0, 500),
        appRootHTML: root?.innerHTML?.slice(0, 800),
      };
    });
    console.log("APP SNAPSHOT:", JSON.stringify(snapshot, null, 2));
  } finally {
    await electronApp.close();
  }
});
