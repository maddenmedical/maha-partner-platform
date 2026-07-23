// Defensive startup migration.
//
// Why this exists: `data.db` is preserved across redeployments (see
// website-publishing docs), but schema changes made to `shared/schema.ts`
// during development are only applied to the LOCAL dev database via
// `drizzle-kit push`. That push is never run against the production
// database, so any column added to the schema after the last production
// `db:push` silently doesn't exist on the live file. Drizzle's generated
// SELECT/INSERT statements reference every column in the schema, so the
// very first query against a drifted table throws "no such column", which
// is an uncaught exception in an async Express handler -> unhandled
// rejection -> Node process crash -> every subsequent request 503s until
// restarted (and immediately crashes again). This exact bug took production
// login down silently. See git history around 2026-07-23 for the incident.
//
// Fix: on every server boot, diff each schema table's expected columns
// against the actual SQLite table and ALTER TABLE ADD COLUMN anything
// missing (as a nullable column, since SQLite can't add a NOT NULL column
// without a default to a non-empty table, and we don't want a rare
// constraint mismatch to block boot). This makes `data.db` self-healing on
// every deploy so schema drift can never crash the app again. It is
// intentionally conservative: it only ADDS missing columns; it never
// renames, drops, or changes types.
import Database from "better-sqlite3";
import { getTableColumns, getTableName, type Table } from "drizzle-orm";
import * as schema from "@shared/schema";

function sqlTypeFor(columnType: string): string {
  switch (columnType) {
    case "SQLiteInteger":
    case "SQLiteBoolean":
    case "SQLiteTimestamp":
      return "INTEGER";
    case "SQLiteReal":
      return "REAL";
    default:
      return "TEXT";
  }
}

export function autoMigrate(sqlite: Database.Database) {
  const existingTables = new Set(
    (sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map(
      (r) => r.name
    )
  );

  for (const value of Object.values(schema)) {
    // Only sqliteTable exports have a table name resolvable this way.
    let tableName: string;
    try {
      tableName = getTableName(value as Table);
    } catch {
      continue; // not a table (schema also exports zod schemas, types, etc.)
    }
    if (!tableName || !existingTables.has(tableName)) continue;

    const expectedCols = getTableColumns(value as Table);
    const actualCols = new Set(
      (sqlite.prepare(`PRAGMA table_info('${tableName}')`).all() as { name: string }[]).map((c) => c.name)
    );

    for (const col of Object.values(expectedCols) as any[]) {
      if (actualCols.has(col.name)) continue;
      const sqlType = sqlTypeFor(col.columnType);
      try {
        sqlite.prepare(`ALTER TABLE "${tableName}" ADD COLUMN "${col.name}" ${sqlType}`).run();
        console.log(`[auto-migrate] added missing column ${tableName}.${col.name} (${sqlType})`);
      } catch (e: any) {
        console.error(`[auto-migrate] FAILED to add ${tableName}.${col.name}:`, e?.message || e);
      }
    }
  }
}
