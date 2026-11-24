import { BrowserWindow } from "electron";
import { z } from "zod";
import { enqueueWrite } from "./write-queue";
import { pad2, parseLocalDate } from "../utils/time";

export const id = z.string().trim().min(1);
export const localDate = z.string().refine(value => !!parseLocalDate(value), "Use a valid local date (YYYY-MM-DD).");
export const status = z.enum(["todo", "in_progress", "done"]);
export const color = z.string().regex(/^#[0-9a-f]{6}$/i, "Use a six-digit hex color.");

export function normalizeWallClock(value: string): string | null {
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
  if (!match) return null;
  const [hours, minutes, seconds] = [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)];
  if (hours > 23 || minutes > 59 || seconds > 59) return null;
  return [hours, minutes, seconds].map(pad2).join(":");
}

export const clock = z.string().transform((value, ctx) => {
  const normalized = normalizeWallClock(value);
  if (normalized) return normalized;
  ctx.addIssue({ code: "custom", message: "Use HH:MM or HH:MM:SS." });
  return z.NEVER;
});

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };
export const ok = (value: unknown): ToolResult => ({
  content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
});
export const fail = (message: string): ToolResult => ({ content: [{ type: "text", text: message }], isError: true });

export function wrap<T>(run: (args: T) => Promise<ToolResult>) {
  return async (args: T): Promise<ToolResult> => {
    try {
      return await run(args);
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error));
    }
  };
}

export function write<T>(run: (args: T) => Promise<ToolResult>) {
  return wrap((args: T) => enqueueWrite(async () => {
    const result = await run(args);
    if (!result.isError) {
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.webContents.isDestroyed()) window.webContents.send("mcp:data-changed");
      }
    }
    return result;
  }));
}
