import type Database from "better-sqlite3";
import { backupDatabaseToDrive } from "./backup";

// Guard against duplicate intervals (e.g. tsx hot reload in dev). Clearing any
// existing interval before creating a new one keeps exactly one running.
let intervalHandle: ReturnType<typeof setInterval> | null = null;

// Most recent backup outcome, kept in memory so the admin status route can
// report it without a DB round-trip. It's acceptable to lose this across a
// server restart — a fresh backup always runs immediately on boot.
type BackupStatus =
  | { at: number; ok: true; filename: string }
  | { at: number; ok: false; error: string };

let lastBackupStatus: BackupStatus | null = null;

const BACKUP_INTERVAL_MS = 4 * 60 * 60 * 1000; // every 4 hours

// In-process scheduler: back up the entire database to Google Drive every 4
// hours (and once immediately on boot). Mirrors the caseDiscussionScheduler
// pattern — module-level duplicate guard, all work wrapped in try/catch so a
// failure never crashes server boot.
export function startBackupScheduler(db: Database.Database) {
  if (intervalHandle) clearInterval(intervalHandle);

  const run = async () => {
    try {
      const result = await backupDatabaseToDrive(db);
      if (result.ok) {
        lastBackupStatus = { at: Date.now(), ok: true, filename: result.filename };
        console.log(`[backup] uploaded ${result.filename} to Drive`);
      } else {
        lastBackupStatus = { at: Date.now(), ok: false, error: result.error };
        console.error(`[backup] failed:`, result.error);
      }
    } catch (err) {
      console.error("[backup] scheduler error:", err);
    }
  };

  run(); // also back up once immediately on server start
  intervalHandle = setInterval(run, BACKUP_INTERVAL_MS);
}

// Exported so the admin status route can report it without a DB round-trip.
export function getLastBackupStatus() {
  return lastBackupStatus;
}

// Exported so the manual-trigger route can reflect its result in the in-memory
// status immediately (the scheduler's own runs update it via startBackupScheduler).
export function setLastBackupStatus(status: BackupStatus) {
  lastBackupStatus = status;
}
