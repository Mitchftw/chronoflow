import * as fs from "fs";
import * as path from "path";
import { app } from "electron";

let logsDir: string;

function getLogsDir(): string {
  if (!logsDir) {
    logsDir = path.join(app.getPath("userData"), "logs");
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }
  }
  return logsDir;
}

function getLogFileName(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const isDev = process.env['NODE_ENV'] === "development";
  return `${year}-${month}-${day}${isDev ? ".dev" : ""}.log`;
}

function getTimestamp(): string {
  return new Date().toISOString();
}

function writeToLog(level: string, message: string, ...args: any[]): void {
  try {
    const logFile = path.join(getLogsDir(), getLogFileName());
    const timestamp = getTimestamp();

    let logMessage = `[${timestamp}] [${level}] ${message}`;

    if (args.length > 0) {
      const argsStr = args
        .map((arg) => {
          if (typeof arg === "object") {
            try {
              return JSON.stringify(arg, null, 2);
            } catch {
              return String(arg);
            }
          }
          return String(arg);
        })
        .join(" ");
      logMessage += ` ${argsStr}`;
    }

    logMessage += "\n";
    fs.appendFileSync(logFile, logMessage, "utf8");

    const consoleMethod =
      level === "ERROR"
        ? console.error
        : level === "WARN"
          ? console.warn
          : console.log;
    consoleMethod(`[${level}] ${message}`, ...args);
  } catch (error) {
    console.error("Failed to write to log file:", error);
  }
}

export const logger = {
  info: (message: string, ...args: any[]) =>
    writeToLog("INFO", message, ...args),
  warn: (message: string, ...args: any[]) =>
    writeToLog("WARN", message, ...args),
  error: (message: string, ...args: any[]) =>
    writeToLog("ERROR", message, ...args),
  debug: (message: string, ...args: any[]) =>
    writeToLog("DEBUG", message, ...args),
  getLogsDir,
};
