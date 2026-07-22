import type Database from "better-sqlite3";
import { readFileSync, unlinkSync, existsSync } from "node:fs";
import path from "node:path";
import {
  uploadToDrive,
  getOrCreateBackupFolderId,
  listFolderFiles,
  deleteFromDrive,
} from "./googleDrive";

// ~25 days of history at 6 backups/day; prevents unbounded Drive growth.
const KEEP_MOST_RECENT = 150;

// Produce a consistent point-in-time snapshot of the live SQLite database using
// `VACUUM INTO` (safe against a live, in-use DB — it does not block or corrupt
// concurrent readers/writers), upload it to the dedicated Drive backup folder,
// prune old backups beyond the retention window, then always clean up the local
// temp file. This never writes to or mutates the live database.
export async function backupDatabaseToDrive(
  db: Database.Database,
): Promise<
  | { ok: true; driveFileId: string; filename: string }
  | { ok: false; error: string }
> {
  const tmpPath = path.join("/tmp", `maha-backup-${Date.now()}.db`);
  try {
    // VACUUM INTO fails if the target already exists. The Date.now() suffix
    // makes collisions extremely unlikely, but guard against a leftover file
    // from a crashed prior run just in case.
    if (existsSync(tmpPath)) {
      try {
        unlinkSync(tmpPath);
      } catch {
        /* fall through — VACUUM INTO will surface a clear error if it persists */
      }
    }

    db.exec(`VACUUM INTO '${tmpPath}'`);
    const buffer = readFileSync(tmpPath);
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `maha-backup-${timestamp}.db`;
    const folderId = await getOrCreateBackupFolderId();
    const { driveFileId } = await uploadToDrive(
      buffer,
      filename,
      "application/x-sqlite3",
      folderId,
    );

    // Retention: prune oldest backups beyond KEEP_MOST_RECENT. Filenames are
    // ISO-timestamp-sortable, so lexicographic sort == chronological sort.
    const files = await listFolderFiles(folderId);
    const backups = files
      .filter((f) => f.name.startsWith("maha-backup-"))
      .sort((a, b) => a.name.localeCompare(b.name));
    const toDelete = backups.slice(
      0,
      Math.max(0, backups.length - KEEP_MOST_RECENT),
    );
    for (const f of toDelete) {
      try {
        await deleteFromDrive(f.id);
      } catch {
        /* best-effort, don't fail the backup over pruning */
      }
    }

    return { ok: true, driveFileId, filename };
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) };
  } finally {
    if (existsSync(tmpPath)) {
      try {
        unlinkSync(tmpPath);
      } catch {
        /* ignore */
      }
    }
  }
}
