import { _electron as electron, expect, test } from "@playwright/test";

test("notch clips expanding droplets and scrolls long agent panels", async () => {
  const app = await electron.launch({
    args: ["dist/electron/main.js"],
    env: { ...process.env, NODE_ENV: "production", IS_TEST: "true", CHRONOFLOW_MCP_PORT: "0" },
  });
  try {
    const main = await app.firstWindow();
    await main.waitForSelector("app-root");
    await main.evaluate(async () => {
      await window.electronAPI!.store.set("app", { droplets: { media: true, agents: true } });
    });
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler("media:set-enabled");
      ipcMain.handle("media:set-enabled", () => ({
        success: true,
        state: { active: true, status: "paused", title: "Demo track", artist: "Demo artist", durationMs: 60000 },
      }));
      ipcMain.removeHandler("agents:set-enabled");
      ipcMain.handle("agents:set-enabled", () => ({
        success: true,
        state: {
          codex: { available: true, primary: { usedPercent: 12, resetsAt: Date.now() / 1000 + 7200 } },
          claude: { available: false, error: "Sign in to Claude Code again to view usage limits.", scriptPath: "" },
          sessions: Array.from({ length: 12 }, (_, i) => ({ id: String(i), agent: "codex", project: "Session " + i, activity: "Done", added: 0, removed: 0 })),
        },
      }));
    });
    const opened = app.waitForEvent("window");
    await main.evaluate(() => window.electronAPI!.timerWindow.create("notch"));
    const page = await opened;
    await page.emulateMedia({ reducedMotion: "no-preference" });
    const notch = page.locator("app-notch-timer");
    await expect(notch).toHaveCSS("width", "384px");
    const media = notch.getByRole("button", { name: "Toggle now playing" });
    const agents = notch.getByRole("button", { name: "Toggle agent usage" });
    await expect(media).toBeVisible();
    await expect(agents).toBeVisible();
    // Pause the opening transition part-way through to check the actual clip edge.
    const intermediate = await media.evaluate(async button => {
      const host = button.closest("app-notch-timer")!;
      (button as HTMLButtonElement).click();
      for (let frame = 0; frame < 60; frame++) {
        await new Promise(requestAnimationFrame);
        const transition = host.getAnimations().find(a => (a as CSSTransition).transitionProperty === "height");
        if (!transition) continue;
        transition.pause();
        transition.currentTime = 30;
        const shell = host.firstElementChild!;
        const panel = host.querySelector("app-media-panel")!;
        const edge = host.getBoundingClientRect().bottom;
        const rect = panel.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.left + 8, edge + 4);
        const clipped = { somewhereBelowEdge: rect.bottom > edge, overflow: getComputedStyle(shell).overflowY, panelHit: panel.contains(hit), height: host.getBoundingClientRect().height };
        transition.play();
        return clipped;
      }
      return {html:host.getAttribute("style"), classes:host.className, transition:getComputedStyle(host).transition, panel:!!host.querySelector("app-media-panel"), height:host.getBoundingClientRect().height};
    });
    expect(intermediate).toMatchObject({ somewhereBelowEdge: true, overflow: "hidden", panelHit: false });
    await expect(notch.getByText("Demo track")).toBeVisible();
    await agents.click();
    const panel = notch.locator("app-agents-panel");
    await expect(panel.getByText("Sign in to Claude Code again to view usage limits.")).toBeVisible();
    const scroll = panel.locator("..");
    await expect.poll(() => scroll.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
    await scroll.evaluate(el => el.scrollTop = el.scrollHeight);
    await expect(panel.getByText("Session 11")).toBeInViewport();
    await agents.click();
    await expect(panel).toHaveCount(0);
    await expect(notch).toHaveCSS("height", "38px");
  } finally {
    await app.close();
  }
});
