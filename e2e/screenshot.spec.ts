import { _electron as electron } from "@playwright/test";
import { test } from "@playwright/test";
import path from "path";

test("take screenshot", async () => {
  const mainJs = path.resolve(process.cwd(), "dist/electron/main.js");
  const electronApp = await electron.launch({
    args: [mainJs],
    env: { ...process.env, NODE_ENV: "production" },
  });

  const window = await electronApp.firstWindow();
  await window.waitForSelector("app-root", { timeout: 30000 });
  await window.waitForTimeout(2000);

  const screenshotPath = path.resolve(process.cwd(), "screenshot.png");
  await window.screenshot({ path: screenshotPath, type: "png" });
  console.log("Screenshot saved to:", screenshotPath);

  // Also capture HTML snapshot for analysis
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

  await electronApp.close();
});
