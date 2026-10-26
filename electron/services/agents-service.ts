import { ipcMain, BrowserWindow } from "electron";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { logger } from "../utils/logger";
import { readSessions, type AgentSession } from "./agent-sessions";
import { getClaudeOAuthUsage, type ClaudeUsageState } from "./claude-usage";

/**
 * Agents droplet backend.
 *
 * Codex writes its plan limits into every session rollout file
 * (`~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`) as a `rate_limits` block on
 * `token_count` events. We tail the newest rollout files, so this needs no
 * login, no network and no tokens. Only polls while a renderer has the
 * droplet enabled.
 */

export interface UsageWindow {
  usedPercent: number;
  windowMinutes: number;
  /** Unix seconds. */
  resetsAt: number;
}

export interface CodexState {
  available: boolean;
  primary?: UsageWindow;
  secondary?: UsageWindow;
  /** True when a rollout file was written to in the last ~20s. */
  working?: boolean;
  /** Unix ms of the event the limits were read from. */
  updatedAt?: number;
}

export type ClaudeState = ClaudeUsageState;

export interface AgentsState {
  codex: CodexState;
  claude: ClaudeState;
  /** Live sessions, most recently active first. */
  sessions: AgentSession[];
}

const POLL_MS = 2000;
const TAIL_BYTES = 512 * 1024;
const WORKING_WINDOW_MS = 20_000;

let timer: ReturnType<typeof setInterval> | null = null;
let lastState: AgentsState = { codex: { available: false }, claude: { available: false, scriptPath: "" }, sessions: [] };
let lastJson = "";
let getTargetWindows: () => (BrowserWindow | null)[] = () => [];

function codexSessionsDir(): string {
  return path.join(process.env["CODEX_HOME"] || path.join(os.homedir(), ".codex"), "sessions");
}

function listDesc(dir: string): string[] {
  try {
    return fs.readdirSync(dir).sort().reverse();
  } catch {
    return [];
  }
}

/** Newest rollout files first, across the year/month/day folders. */
function newestRollouts(limit: number): string[] {
  const root = codexSessionsDir();
  const out: string[] = [];
  for (const y of listDesc(root)) {
    for (const m of listDesc(path.join(root, y))) {
      for (const d of listDesc(path.join(root, y, m))) {
        const dayDir = path.join(root, y, m, d);
        for (const f of listDesc(dayDir)) {
          if (f.startsWith("rollout-") && f.endsWith(".jsonl")) out.push(path.join(dayDir, f));
          if (out.length >= limit) return out;
        }
      }
    }
  }
  return out;
}

function readTail(file: string): string {
  const fd = fs.openSync(file, "r");
  try {
    const { size } = fs.fstatSync(fd);
    const len = Math.min(size, TAIL_BYTES);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    return buf.toString("utf8");
  } finally {
    fs.closeSync(fd);
  }
}

function toWindow(raw: any): UsageWindow | undefined {
  if (!raw || typeof raw.used_percent !== "number") return undefined;
  return {
    usedPercent: raw.used_percent,
    windowMinutes: raw.window_minutes,
    resetsAt: raw.resets_at,
  };
}

function readCodex(): CodexState {
  const files = newestRollouts(6);
  if (files.length === 0) return { available: false };

  let working = false;
  try {
    working = Date.now() - fs.statSync(files[0]).mtimeMs < WORKING_WINDOW_MS;
  } catch {
    // file rotated between listing and stat
  }

  for (const file of files) {
    let lines: string[];
    try {
      lines = readTail(file).split("\n");
    } catch {
      continue;
    }
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (!line.includes('"rate_limits"')) continue;
      try {
        const evt = JSON.parse(line);
        const limits = evt?.payload?.rate_limits;
        const primary = toWindow(limits?.primary);
        if (!primary) continue;
        return {
          available: true,
          primary,
          secondary: toWindow(limits?.secondary),
          working,
          updatedAt: evt.timestamp ? Date.parse(evt.timestamp) : undefined,
        };
      } catch {
        // partial first line of the tail chunk, or unrelated JSON
      }
    }
  }
  return { available: true, working };
}

// ---- Claude Code ----
// Claude Code hands `rate_limits` (5-hour / 7-day plan usage) to its statusline
// command on stdin — for Claude.ai subscriptions only. The tiny script below is
// registered as that command; it stores the latest reading in a JSON file that
// we poll. Nothing leaves the machine.

const CLAUDE_DIR = path.join(os.homedir(), ".chronoflow");
const CLAUDE_SCRIPT = path.join(CLAUDE_DIR, "claude-statusline.js");
const CLAUDE_SNAPSHOT = path.join(CLAUDE_DIR, "claude-rate-limits.json");

const CLAUDE_SCRIPT_SOURCE = `// Written by ChronoFlow. Registered as Claude Code's statusLine command; saves
// the plan rate limits Claude Code passes on stdin and prints an empty status line.
const fs = require("fs");
let raw = "";
process.stdin.on("data", (d) => (raw += d));
process.stdin.on("end", () => {
  try {
    const rl = JSON.parse(raw).rate_limits;
    if (rl) fs.writeFileSync(${JSON.stringify(CLAUDE_SNAPSHOT)}, JSON.stringify({ at: Date.now(), rate_limits: rl }));
  } catch {}
});
`;

function ensureClaudeScript(): void {
  try {
    fs.mkdirSync(CLAUDE_DIR, { recursive: true });
    if (!fs.existsSync(CLAUDE_SCRIPT) || fs.readFileSync(CLAUDE_SCRIPT, "utf8") !== CLAUDE_SCRIPT_SOURCE) {
      fs.writeFileSync(CLAUDE_SCRIPT, CLAUDE_SCRIPT_SOURCE);
    }
  } catch (err) {
    logger.warn("Failed to write Claude statusline script:", err);
  }
}

function toClaudeWindow(raw: any, windowMinutes: number): UsageWindow | undefined {
  if (!raw || typeof raw.used_percentage !== "number") return undefined;
  return { usedPercent: raw.used_percentage, windowMinutes, resetsAt: raw.resets_at };
}

function readClaudeSnapshot(): ClaudeState | null {
  try {
    const snap = JSON.parse(fs.readFileSync(CLAUDE_SNAPSHOT, "utf8"));
    const primary = toClaudeWindow(snap?.rate_limits?.five_hour, 300);
    const secondary = toClaudeWindow(snap?.rate_limits?.seven_day, 10080);
    if (!primary && !secondary) return null;
    return {
      available: true,
      primary,
      secondary,
      updatedAt: typeof snap.at === "number" ? snap.at : undefined,
      scriptPath: CLAUDE_SCRIPT,
      source: "statusline",
    };
  } catch {
    return null;
  }
}

const SNAPSHOT_FRESH_MS = 5 * 60_000;

/**
 * Prefer a recent terminal statusline snapshot (no network), then fall back
 * to the local Claude OAuth session so Claude Desktop-only users also get
 * usage. `getClaudeOAuthUsage` is cached/backed off internally.
 */
async function readClaude(): Promise<ClaudeState> {
  const snapshot = readClaudeSnapshot();
  const snapshotFresh =
    !!snapshot?.available &&
    typeof snapshot.updatedAt === "number" &&
    Date.now() - snapshot.updatedAt < SNAPSHOT_FRESH_MS;

  let oauth: ClaudeState | null = null;
  if (!snapshotFresh) {
    oauth = await getClaudeOAuthUsage(CLAUDE_SCRIPT);
  }

  if (
    oauth &&
    (!snapshot ||
      !snapshot.available ||
      (oauth.updatedAt ?? 0) >= (snapshot.updatedAt ?? 0))
  ) {
    return oauth;
  }

  return snapshot ?? { available: false, scriptPath: CLAUDE_SCRIPT };
}

let pollInFlight = false;

async function poll(): Promise<void> {
  if (pollInFlight) return;
  pollInFlight = true;
  try {
    lastState = {
      codex: readCodex(),
      claude: await readClaude(),
      sessions: readSessions(newestRollouts(4)),
    };
  } catch (err) {
    logger.warn("agents poll failed:", err);
    return;
  } finally {
    pollInFlight = false;
  }

  const json = JSON.stringify(lastState);
  if (json === lastJson) return;
  lastJson = json;
  for (const win of getTargetWindows()) {
    if (win && !win.isDestroyed()) win.webContents.send("agents:state", lastState);
  }
}

export function stopAgentsService(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

export function registerAgentsHandlers(windows: () => (BrowserWindow | null)[]): void {
  getTargetWindows = windows;

  ipcMain.handle("agents:set-enabled", async (_e, enabled: boolean) => {
    if (enabled) {
      ensureClaudeScript();
      lastJson = "";
      void poll();
      if (!timer) timer = setInterval(() => void poll(), POLL_MS);
    } else {
      stopAgentsService();
    }
    return { success: true, state: lastState };
  });
}
