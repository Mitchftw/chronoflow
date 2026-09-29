import * as fs from "fs";
import * as os from "os";
import * as path from "path";

/**
 * Live coding-agent sessions for the Agents droplet.
 *
 * Claude Code (`~/.claude/projects/<project>/<id>.jsonl`) and Codex
 * (`~/.codex/sessions/.../rollout-*.jsonl`) append one JSON event per line.
 * Each recently-touched file is read incrementally (only the bytes added since
 * the last poll) and folded into a small summary: what the agent is doing right
 * now, which file/command, and how many lines it has changed. Local files only.
 */

export type AgentKind = "claude" | "codex";

export interface AgentSession {
  id: string;
  agent: AgentKind;
  /** Working directory's folder name. */
  project: string;
  working: boolean;
  /** "Thinking", "Editing", "Running", ... */
  activity: string;
  /** File name, command or search pattern of the current tool call. */
  detail?: string;
  added: number;
  removed: number;
  toolCalls: number;
  /** Unix ms of the last event. */
  updatedAt: number;
}

interface Tracker {
  file: string;
  agent: AgentKind;
  offset: number;
  carry: string;
  session: AgentSession;
  /** The agent finished its turn (end_turn / task_complete). */
  finished: boolean;
}

const ACTIVE_MS = 10 * 60_000;
const WORKING_MS = 3 * 60_000;
const INITIAL_BYTES = 4 * 1024 * 1024;
const MAX_CHUNK = 8 * 1024 * 1024;
const RESCAN_MS = 10_000;
const MAX_SESSIONS = 4;

const trackers = new Map<string, Tracker>();
let claudeCandidates: string[] = [];
let lastScan = 0;

function claudeProjectsDir(): string {
  return path.join(process.env["CLAUDE_CONFIG_DIR"] || path.join(os.homedir(), ".claude"), "projects");
}

/** Recently modified Claude Code transcripts (top-level files only, no subagent logs). */
function scanClaude(): string[] {
  const root = claudeProjectsDir();
  const out: string[] = [];
  let dirs: string[] = [];
  try {
    dirs = fs.readdirSync(root);
  } catch {
    return out;
  }
  const cutoff = Date.now() - ACTIVE_MS;
  for (const d of dirs) {
    const dir = path.join(root, d);
    let files: string[];
    try {
      files = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const f of files) {
      if (!f.endsWith(".jsonl")) continue;
      const full = path.join(dir, f);
      try {
        if (fs.statSync(full).mtimeMs >= cutoff) out.push(full);
      } catch {
        // rotated
      }
    }
  }
  return out;
}

function lineCount(s: unknown): number {
  if (typeof s !== "string" || s.length === 0) return 0;
  return s.split("\n").length;
}

function base(p: unknown): string | undefined {
  return typeof p === "string" && p ? path.basename(p) : undefined;
}

function clip(s: string, n = 60): string {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > n ? one.slice(0, n - 1) + "…" : one;
}

function toolActivity(name: string, input: any, s: AgentSession): void {
  s.toolCalls++;
  switch (name) {
    case "Edit":
      s.activity = "Editing";
      s.detail = base(input?.file_path);
      s.added += lineCount(input?.new_string);
      s.removed += lineCount(input?.old_string);
      break;
    case "MultiEdit":
      s.activity = "Editing";
      s.detail = base(input?.file_path);
      for (const e of Array.isArray(input?.edits) ? input.edits : []) {
        s.added += lineCount(e?.new_string);
        s.removed += lineCount(e?.old_string);
      }
      break;
    case "Write":
      s.activity = "Writing";
      s.detail = base(input?.file_path);
      s.added += lineCount(input?.content);
      break;
    case "NotebookEdit":
      s.activity = "Editing";
      s.detail = base(input?.notebook_path);
      break;
    case "Read":
      s.activity = "Reading";
      s.detail = base(input?.file_path);
      break;
    case "Bash":
      s.activity = "Running";
      s.detail = typeof input?.command === "string" ? clip(input.command) : undefined;
      break;
    case "Grep":
    case "Glob":
      s.activity = "Searching";
      s.detail = typeof input?.pattern === "string" ? clip(input.pattern) : undefined;
      break;
    case "WebFetch":
    case "WebSearch":
      s.activity = "Browsing";
      s.detail = clip(String(input?.url ?? input?.query ?? ""));
      break;
    case "Task":
    case "Agent":
      s.activity = "Delegating";
      s.detail = typeof input?.description === "string" ? clip(input.description) : undefined;
      break;
    case "TodoWrite":
      s.activity = "Planning";
      s.detail = undefined;
      break;
    default:
      s.activity = name.replace(/^mcp__/, "").replace(/__/g, " · ");
      s.detail = undefined;
  }
}

function applyClaude(t: Tracker, evt: any): void {
  const s = t.session;
  if (evt.cwd) s.project = path.basename(String(evt.cwd));
  if (evt.timestamp) s.updatedAt = Date.parse(evt.timestamp) || s.updatedAt;
  if (evt.type === "assistant") {
    const content = evt.message?.content;
    t.finished = evt.message?.stop_reason === "end_turn";
    if (!Array.isArray(content)) return;
    for (const block of content) {
      if (block?.type === "tool_use") {
        toolActivity(String(block.name), block.input, s);
      } else if (block?.type === "thinking") {
        s.activity = "Thinking";
        s.detail = undefined;
      } else if (block?.type === "text") {
        s.activity = t.finished ? "Done" : "Responding";
        s.detail = undefined;
      }
    }
  } else if (evt.type === "user") {
    t.finished = false;
    s.activity = "Thinking";
    s.detail = undefined;
  }
}

/** Counts +/- lines of an apply_patch body and returns the last file it touches. */
function applyPatch(text: string, s: AgentSession): void {
  s.toolCalls++;
  s.activity = "Editing";
  for (const line of text.split("\n")) {
    const m = /^\*\*\* (?:Update|Add|Delete) File: (.+)$/.exec(line);
    if (m) s.detail = path.basename(m[1].trim());
    else if (line.startsWith("+") && !line.startsWith("+++")) s.added++;
    else if (line.startsWith("-") && !line.startsWith("---")) s.removed++;
  }
}

function applyCodex(t: Tracker, evt: any): void {
  const s = t.session;
  if (evt.timestamp) s.updatedAt = Date.parse(evt.timestamp) || s.updatedAt;
  const p = evt.payload;
  if (!p) return;
  if (evt.type === "session_meta" && p.cwd) {
    s.project = path.basename(String(p.cwd));
  } else if (evt.type === "turn_context" && p.cwd && s.project === "codex") {
    s.project = path.basename(String(p.cwd));
  } else if (evt.type === "event_msg") {
    if (p.type === "task_started" || p.type === "user_message") {
      t.finished = false;
      s.activity = "Thinking";
      s.detail = undefined;
    } else if (p.type === "task_complete" || p.type === "turn_aborted") {
      t.finished = true;
      s.activity = "Done";
      s.detail = undefined;
    }
  } else if (evt.type === "response_item") {
    if (p.type === "reasoning") {
      s.activity = "Thinking";
      s.detail = undefined;
    } else if (p.type === "function_call") {
      s.toolCalls++;
      s.activity = "Running";
      try {
        const args = JSON.parse(p.arguments ?? "{}");
        const cmd = Array.isArray(args.command) ? args.command.slice(-1)[0] : args.command ?? args.cmd;
        s.detail = typeof cmd === "string" ? clip(cmd) : undefined;
      } catch {
        s.detail = undefined;
      }
    } else if (p.type === "custom_tool_call" && p.name === "apply_patch") {
      applyPatch(String(p.input ?? ""), s);
    } else if (p.type === "message" && p.role === "assistant") {
      s.activity = "Responding";
      s.detail = undefined;
    }
  }
}

function update(file: string, agent: AgentKind): Tracker | null {
  let size: number;
  let mtimeMs: number;
  try {
    const st = fs.statSync(file);
    size = st.size;
    mtimeMs = st.mtimeMs;
  } catch {
    return null;
  }

  let t = trackers.get(file);
  let skipPartial = false;
  if (!t) {
    const id = path.basename(file, ".jsonl");
    t = {
      file,
      agent,
      offset: Math.max(0, size - INITIAL_BYTES),
      carry: "",
      finished: false,
      session: {
        id,
        agent,
        project: agent,
        working: false,
        activity: "Idle",
        added: 0,
        removed: 0,
        toolCalls: 0,
        updatedAt: mtimeMs,
      },
    };
    skipPartial = t.offset > 0;
    trackers.set(file, t);
  } else if (size < t.offset) {
    // truncated or replaced: start over
    trackers.delete(file);
    return update(file, agent);
  }

  if (size > t.offset) {
    const len = Math.min(size - t.offset, MAX_CHUNK);
    const buf = Buffer.alloc(len);
    try {
      const fd = fs.openSync(file, "r");
      try {
        fs.readSync(fd, buf, 0, len, t.offset);
      } finally {
        fs.closeSync(fd);
      }
    } catch {
      return t;
    }
    t.offset += len;
    const lines = (t.carry + buf.toString("utf8")).split("\n");
    t.carry = lines.pop() ?? "";
    if (skipPartial) lines.shift();
    for (const line of lines) {
      if (!line) continue;
      try {
        const evt = JSON.parse(line);
        if (agent === "claude") applyClaude(t, evt);
        else applyCodex(t, evt);
      } catch {
        // partial or unrelated line
      }
    }
  }

  const s = t.session;
  s.updatedAt = Math.max(s.updatedAt, mtimeMs);
  s.working = !t.finished && Date.now() - mtimeMs < WORKING_MS;
  if (!s.working && s.activity !== "Done") s.activity = "Idle";
  return t;
}

/** Newest few sessions across Claude Code and Codex, most recently active first. */
export function readSessions(codexRollouts: string[]): AgentSession[] {
  const now = Date.now();
  if (now - lastScan > RESCAN_MS) {
    claudeCandidates = scanClaude();
    lastScan = now;
  }

  const seen = new Set<string>();
  const found: AgentSession[] = [];
  const consider = (file: string, agent: AgentKind) => {
    seen.add(file);
    const t = update(file, agent);
    if (t && now - t.session.updatedAt < ACTIVE_MS) found.push({ ...t.session });
  };
  for (const f of claudeCandidates) consider(f, "claude");
  for (const f of codexRollouts) consider(f, "codex");

  for (const key of trackers.keys()) if (!seen.has(key)) trackers.delete(key);

  return found.sort((a, b) => Number(b.working) - Number(a.working) || b.updatedAt - a.updatedAt).slice(0, MAX_SESSIONS);
}
