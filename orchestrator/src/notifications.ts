/**
 * notifications.ts — Notification history persisted to JSONL
 *
 * Appends structured notification records for session events, battery warnings,
 * memory pressure alerts, and daemon lifecycle events.
 */

import { existsSync, appendFileSync, readFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type { NotificationRecord, NotificationType } from "./types.js";

const HOME = process.env.HOME ?? "/data/data/com.termux/files/home";
const NOTIFICATIONS_PATH = join(HOME, ".local", "share", "tmx", "logs", "notifications.jsonl");

/** Ensure parent directory exists */
function ensureDir(): void {
  const dir = dirname(NOTIFICATIONS_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/** Append a notification record to the JSONL file */
export function appendNotification(opts: {
  type: NotificationType;
  title: string;
  content: string;
  session?: string;
}): NotificationRecord {
  ensureDir();
  const record: NotificationRecord = {
    id: randomUUID().slice(0, 12),
    timestamp: new Date().toISOString(),
    type: opts.type,
    title: opts.title,
    content: opts.content,
    session: opts.session,
  };
  appendFileSync(NOTIFICATIONS_PATH, JSON.stringify(record) + "\n");
  return record;
}

/** Read notifications from the JSONL file (reverse chronological, with optional filters) */
export function readNotifications(opts?: {
  limit?: number;
  since?: string;
}): NotificationRecord[] {
  const limit = opts?.limit ?? 50;
  const sinceDate = opts?.since ? new Date(opts.since) : null;

  if (!existsSync(NOTIFICATIONS_PATH)) return [];

  const content = readFileSync(NOTIFICATIONS_PATH, "utf-8");
  const lines = content.trim().split("\n");
  const results: NotificationRecord[] = [];

  // Read from end for reverse chronological order
  for (let i = lines.length - 1; i >= 0 && results.length < limit; i--) {
    const line = lines[i].trim();
    if (!line) continue;
    try {
      const record = JSON.parse(line) as NotificationRecord;
      if (sinceDate && new Date(record.timestamp) < sinceDate) break;
      results.push(record);
    } catch {
      // Skip malformed lines
    }
  }

  return results;
}
