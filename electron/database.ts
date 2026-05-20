import * as path from "path";
import * as fs from "fs";
import { app } from "electron";
import sqlite3 from "sqlite3";
import { open, Database } from "sqlite";
import { logger } from "./utils/logger";

let db: Database | null = null;

export function getPath(): string {
  return path.join(app.getPath("userData"), "databases");
}

export async function initDatabase(): Promise<Database> {
  const dbDir = getPath();
  logger.info("Database directory:", dbDir);

  if (!fs.existsSync(dbDir)) {
    logger.info("Creating databases directory...");
    fs.mkdirSync(dbDir, { recursive: true });
  }

  const dbPath = getDatabasePath();
  logger.info("Database path:", dbPath);

  db = await open({ filename: dbPath, driver: sqlite3.Database });
  logger.info("Database opened successfully");

  await db.exec("PRAGMA foreign_keys = ON");
  await createTables();
  logger.info("Database tables created successfully");

  await applyMigrations();
  logger.info("Database migrations applied successfully");

  return db;
}

async function createTables(): Promise<void> {
  if (!db) throw new Error("Database not initialized");

  await db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      color TEXT,
      created_at INTEGER NOT NULL
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS issues (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      project_id TEXT,
      status TEXT NOT NULL DEFAULT 'todo',
      jira_issue_key TEXT,
      jira_connection_id TEXT,
      estimate INTEGER DEFAULT 0,
      time_spent INTEGER DEFAULT 0,
      is_running INTEGER DEFAULT 0,
      start_time INTEGER,
      created_at INTEGER NOT NULL,
      date TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS time_entries (
      id TEXT PRIMARY KEY,
      issue_id TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT,
      date TEXT NOT NULL,
      note TEXT,
      jira_worklog_id TEXT,
      is_dirty INTEGER DEFAULT 0,
      FOREIGN KEY (issue_id) REFERENCES issues(id) ON DELETE CASCADE
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS jira_connections (
      id TEXT PRIMARY KEY,
      name TEXT,
      auth_type TEXT,
      domain TEXT NOT NULL,
      email TEXT,
      api_token TEXT,
      access_token TEXT,
      refresh_token TEXT,
      expires_at INTEGER,
      cloud_id TEXT,
      client_id TEXT,
      client_secret TEXT,
      is_default INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS deleted_jira_worklogs (
      id TEXT PRIMARY KEY,
      jira_worklog_id TEXT NOT NULL,
      jira_connection_id TEXT,
      issue_key TEXT NOT NULL,
      deleted_at INTEGER NOT NULL
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  await db.exec(`
    CREATE INDEX IF NOT EXISTS idx_issues_date ON issues(date);
    CREATE INDEX IF NOT EXISTS idx_issues_project_id ON issues(project_id);
    CREATE INDEX IF NOT EXISTS idx_issues_status ON issues(status);
    CREATE INDEX IF NOT EXISTS idx_time_entries_issue_id ON time_entries(issue_id);
    CREATE INDEX IF NOT EXISTS idx_time_entries_date ON time_entries(date);
    CREATE INDEX IF NOT EXISTS idx_jira_connections_is_default ON jira_connections(is_default);
  `);
}

async function applyMigrations(): Promise<void> {
  if (!db) throw new Error("Database not initialized");

  // Migration: Add cloud_id to jira_connections if missing
  const jiraColumns = await db.all("PRAGMA table_info(jira_connections)");
  const hasCloudId = (jiraColumns as any[]).some(
    (col) => col.name === "cloud_id",
  );
  if (!hasCloudId) {
    await db.exec("ALTER TABLE jira_connections ADD COLUMN cloud_id TEXT");
  }

  // Migration: Add client_id and client_secret to jira_connections if missing
  const hasClientId = (jiraColumns as any[]).some(
    (col) => col.name === "client_id",
  );
  if (!hasClientId) {
    await db.exec("ALTER TABLE jira_connections ADD COLUMN client_id TEXT");
  }

  const hasClientSecret = (jiraColumns as any[]).some(
    (col) => col.name === "client_secret",
  );
  if (!hasClientSecret) {
    await db.exec("ALTER TABLE jira_connections ADD COLUMN client_secret TEXT");
  }

  // Migration: Add jira_worklog_id to time_entries if missing
  const timeColumns = await db.all("PRAGMA table_info(time_entries)");
  const hasJiraWorklogId = (timeColumns as any[]).some(
    (col) => col.name === "jira_worklog_id",
  );
  if (!hasJiraWorklogId) {
    await db.exec("ALTER TABLE time_entries ADD COLUMN jira_worklog_id TEXT");
  }

  // Migration: Add is_dirty to time_entries if missing
  const hasIsDirty = (timeColumns as any[]).some(
    (col) => col.name === "is_dirty",
  );
  if (!hasIsDirty) {
    await db.exec("ALTER TABLE time_entries ADD COLUMN is_dirty INTEGER DEFAULT 0");
  }

  // Migration: Create deleted_jira_worklogs table if it doesn't exist
  await db.exec(`
    CREATE TABLE IF NOT EXISTS deleted_jira_worklogs (
      id TEXT PRIMARY KEY,
      jira_worklog_id TEXT NOT NULL,
      jira_connection_id TEXT,
      issue_key TEXT NOT NULL,
      deleted_at INTEGER NOT NULL
    )
  `);
}

export function getDatabase(): Database {
  if (!db) {
    throw new Error("Database not initialized. Call initDatabase() first.");
  }
  return db;
}

export async function closeDatabase(): Promise<void> {
  if (db) {
    await db.close();
    db = null;
  }
}

export function getDatabasePath(): string {
  const isDev = process.env['NODE_ENV'] === "development";
  const dbName = isDev ? "todo-tracker.dev.db" : "todo-tracker.db";
  return path.join(getPath(), dbName);
}
