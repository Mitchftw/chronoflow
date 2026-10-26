import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { logger } from "../utils/logger";

/**
 * Claude Code subscription usage via the same OAuth session the CLI uses.
 *
 * The status line bridge only works in a terminal session. Claude Desktop
 * sessions never render a status line, so this fallback asks Anthropic's
 * OAuth usage endpoint directly (the endpoint behind `/usage`). Both sources
 * write the same normalized windows, so the droplet can prefer whichever
 * reading is newer.
 *
 * The endpoint is undocumented and aggressively rate-limited; all reads are
 * cached for at least 60 seconds and error retries are backed off.
 */

export interface ClaudeUsageWindow {
  usedPercent: number;
  windowMinutes: number;
  /** Unix epoch seconds. */
  resetsAt: number;
}

export interface ClaudeUsageState {
  available: boolean;
  primary?: ClaudeUsageWindow;
  secondary?: ClaudeUsageWindow;
  /** Unix ms of the reading. */
  updatedAt?: number;
  scriptPath: string;
  source?: "statusline" | "oauth";
  error?: string;
}

interface StoredCredentials {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  refreshTokenExpiresAt?: number;
  scopes?: string[];
}

interface CredentialsDocument {
  claudeAiOauth?: StoredCredentials;
  [key: string]: unknown;
}

export const CLAUDE_OAUTH_CLIENT_ID =
  "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const TOKEN_URL = "https://platform.claude.com/v1/oauth/token";
const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const OAUTH_BETA = "oauth-2025-04-20";
const USAGE_CACHE_MS = 60_000;
const ERROR_BACKOFF_MS = 5 * 60_000;
const REFRESH_AHEAD_MS = 2 * 60_000;
const REQUEST_TIMEOUT_MS = 12_000;
const DEFAULT_SCOPES = [
  "user:profile",
  "user:inference",
  "user:file_upload",
  "user:mcp_servers",
  "user:plugins",
  "user:sessions:claude_code",
];

let cached:
  | { at: number; nextAt: number; state: ClaudeUsageState }
  | null = null;
let inFlight: Promise<ClaudeUsageState> | null = null;

export function claudeConfigDir(): string {
  return process.env["CLAUDE_CONFIG_DIR"] || path.join(os.homedir(), ".claude");
}

export function claudeCredentialsPath(): string {
  return path.join(claudeConfigDir(), ".credentials.json");
}

function readCredentials(): {
  document: CredentialsDocument;
  credentials: StoredCredentials;
} | null {
  try {
    const file = claudeCredentialsPath();
    const document = JSON.parse(fs.readFileSync(file, "utf8")) as CredentialsDocument;
    const credentials = document.claudeAiOauth;
    if (!credentials || typeof credentials.accessToken !== "string") {
      return null;
    }
    return { document, credentials };
  } catch {
    return null;
  }
}

function writeCredentials(
  document: CredentialsDocument,
  credentials: StoredCredentials,
): void {
  const file = claudeCredentialsPath();
  const next: CredentialsDocument = {
    ...document,
    claudeAiOauth: {
      ...document.claudeAiOauth,
      ...credentials,
    },
  };
  const temp = `${file}.chronoflow.tmp`;
  fs.writeFileSync(temp, JSON.stringify(next, null, 2), { mode: 0o600 });
  fs.renameSync(temp, file);
}

async function fetchJson(
  url: string,
  init: RequestInit,
): Promise<{ status: number; body: any; text: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": "ChronoFlow",
        ...(init.headers || {}),
      },
    });
    const text = await response.text();
    let body: any = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      // keep text for a useful (token-free) error message
    }
    return { status: response.status, body, text };
  } finally {
    clearTimeout(timeout);
  }
}

function errorMessage(body: any, fallback: string): string {
  const message =
    body?.error?.message ||
    body?.error_description ||
    body?.message ||
    (typeof body?.error === "string" ? body.error : "");
  return typeof message === "string" && message.trim() ? message.trim() : fallback;
}

async function refreshCredentials(
  credentials: StoredCredentials,
): Promise<StoredCredentials> {
  if (!credentials.refreshToken) {
    throw new Error("Claude login has no refresh token. Sign in to Claude Code again.");
  }
  // Let the token endpoint decide whether the refresh token is still valid.
  // Claude Code's local `refreshTokenExpiresAt` is advisory and is not always
  // extended when a refresh response omits `refresh_token_expires_in`.

  const scopes =
    credentials.scopes && credentials.scopes.length > 0
      ? credentials.scopes
      : DEFAULT_SCOPES;
  const response = await fetchJson(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      refresh_token: credentials.refreshToken,
      client_id: CLAUDE_OAUTH_CLIENT_ID,
      scope: scopes.join(" "),
    }),
  });

  if (response.status !== 200 || !response.body?.access_token) {
    throw new Error(
      errorMessage(
        response.body,
        response.status === 401 || response.status === 400
          ? "Claude login expired. Sign in to Claude Code again."
          : "Could not refresh the Claude login.",
      ),
    );
  }

  const body = response.body;
  const next: StoredCredentials = {
    ...credentials,
    accessToken: body.access_token,
    refreshToken:
      typeof body.refresh_token === "string"
        ? body.refresh_token
        : credentials.refreshToken,
    expiresAt:
      typeof body.expires_in === "number"
        ? Date.now() + body.expires_in * 1000
        : credentials.expiresAt,
    refreshTokenExpiresAt:
      typeof body.refresh_token_expires_in === "number"
        ? Date.now() + body.refresh_token_expires_in * 1000
        : credentials.refreshTokenExpiresAt,
    scopes:
      typeof body.scope === "string" && body.scope.trim()
        ? body.scope.trim().split(/\s+/)
        : credentials.scopes,
  };

  // Another Claude Code process may have refreshed at the same time. If the
  // file now contains a different, still-valid token, prefer that one instead
  // of clobbering it with our result.
  const latest = readCredentials();
  if (
    latest &&
    latest.credentials.accessToken !== credentials.accessToken &&
    latest.credentials.expiresAt > Date.now() + REFRESH_AHEAD_MS
  ) {
    return latest.credentials;
  }

  try {
    writeCredentials(
      readCredentials()?.document ?? { claudeAiOauth: credentials },
      next,
    );
  } catch (error) {
    logger.warn("Could not persist refreshed Claude credentials:", error);
    // The access token is still usable in memory for this run.
  }
  return next;
}

function toEpochSeconds(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 1e12 ? Math.floor(value / 1000) : Math.floor(value);
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return Math.floor(parsed / 1000);
  }
  return undefined;
}

function toPercent(value: unknown): number | undefined {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return undefined;
  return Math.max(0, Math.min(100, n));
}

function mapWindow(
  raw: any,
  windowMinutes: number,
  fallback?: any,
): ClaudeUsageWindow | undefined {
  const used = toPercent(raw?.utilization ?? raw?.used_percentage ?? fallback?.percent);
  if (used === undefined) return undefined;
  // `/api/oauth/usage` returns a window with `resets_at: null` when that
  // window is currently inactive (e.g. an unused 5-hour session). Keep the
  // 0% row visible instead of dropping it; AgentsService treats a missing
  // reset as "reset".
  const resets = toEpochSeconds(raw?.resets_at ?? fallback?.resets_at) ?? 0;
  return { usedPercent: used, windowMinutes, resetsAt: resets };
}

function parseUsage(
  body: any,
  scriptPath: string,
  updatedAt: number,
): ClaudeUsageState {
  const rate = body?.rate_limits ?? body ?? {};
  const limits: any[] = Array.isArray(body?.limits) ? body.limits : [];
  const sessionLimit = limits.find((entry) => entry?.kind === "session");
  const weeklyLimit =
    limits.find((entry) => entry?.kind === "weekly_all") ??
    limits.find((entry) => entry?.kind === "weekly") ??
    limits.find((entry) => entry?.kind === "seven_day");

  const primary = mapWindow(rate?.five_hour, 300, sessionLimit);
  const secondary = mapWindow(rate?.seven_day, 10080, weeklyLimit);

  if (!primary && !secondary) {
    return {
      available: false,
      scriptPath,
      source: "oauth",
      updatedAt,
      error: "Claude usage is not available for this account.",
    };
  }

  return {
    available: true,
    primary,
    secondary,
    scriptPath,
    source: "oauth",
    updatedAt,
  };
}

async function readUsageWithCredentials(
  initial: StoredCredentials,
  scriptPath: string,
): Promise<ClaudeUsageState> {
  let credentials = initial;
  if (
    !Number.isFinite(credentials.expiresAt) ||
    credentials.expiresAt <= Date.now() + REFRESH_AHEAD_MS
  ) {
    credentials = await refreshCredentials(credentials);
  }

  let response = await fetchJson(USAGE_URL, {
    headers: {
      Authorization: `Bearer ${credentials.accessToken}`,
      "anthropic-beta": OAUTH_BETA,
    },
  });

  // A stale token can still be present in the file even when the CLI's own
  // refresh interval has not elapsed. Refresh once and retry.
  if (response.status === 401) {
    credentials = await refreshCredentials(credentials);
    response = await fetchJson(USAGE_URL, {
      headers: {
        Authorization: `Bearer ${credentials.accessToken}`,
        "anthropic-beta": OAUTH_BETA,
      },
    });
  }

  if (response.status !== 200) {
    throw new Error(
      errorMessage(
        response.body,
        response.status === 429
          ? "Claude usage is temporarily rate-limited. Retrying later."
          : "Could not load Claude usage.",
      ),
    );
  }

  return parseUsage(response.body, scriptPath, Date.now());
}

/**
 * Return the newest available usage state from the OAuth account, cached for
 * at least a minute. Never throws: failures are converted to a state with an
 * `error` field so the droplet can keep showing the last known windows.
 */
export async function getClaudeOAuthUsage(
  scriptPath: string,
  options: { force?: boolean } = {},
): Promise<ClaudeUsageState> {
  const now = Date.now();
  if (!options.force && cached && now < cached.nextAt) {
    return cached.state;
  }
  if (inFlight) return inFlight;

  inFlight = (async () => {
    const stored = readCredentials();
    if (!stored) {
      const state: ClaudeUsageState = {
        available: false,
        scriptPath,
        source: "oauth",
        updatedAt: Date.now(),
        error: "No Claude login found. Sign in to Claude Code first.",
      };
      cached = { at: Date.now(), nextAt: Date.now() + ERROR_BACKOFF_MS, state };
      return state;
    }

    try {
      const state = await readUsageWithCredentials(stored.credentials, scriptPath);
      cached = { at: Date.now(), nextAt: Date.now() + USAGE_CACHE_MS, state };
      return state;
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Could not load Claude usage.";
      logger.warn("Claude OAuth usage unavailable:", message);
      const previous = cached?.state;
      const state: ClaudeUsageState = {
        ...(previous?.available
          ? previous
          : { available: false, scriptPath, source: "oauth" as const }),
        scriptPath,
        source: "oauth",
        updatedAt: previous?.updatedAt,
        error: message,
      };
      cached = {
        at: Date.now(),
        nextAt: Date.now() + ERROR_BACKOFF_MS,
        state,
      };
      return state;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}
