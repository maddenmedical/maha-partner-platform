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

// Builds a CREATE TABLE IF NOT EXISTS statement from a Drizzle table's column
// metadata, so a brand-new table added to shared/schema.ts (like
// webauthn_credentials) gets created automatically on next boot instead of
// requiring a manual `drizzle-kit push` against the production data.db, which
// nothing in the deploy pipeline runs. Intentionally minimal: no foreign keys
// or indexes, since the app never relies on DB-enforced constraints beyond
// primary key / unique / not null / default.
function buildCreateTableSql(tableName: string, columns: Record<string, any>): string {
  const colDefs: string[] = [];
  for (const col of Object.values(columns) as any[]) {
    let def = `"${col.name}" ${sqlTypeFor(col.columnType)}`;
    if (col.primary) {
      def += col.autoIncrement ? " PRIMARY KEY AUTOINCREMENT" : " PRIMARY KEY";
    } else {
      if (col.notNull) def += " NOT NULL";
      if (col.isUnique) def += " UNIQUE";
    }
    if (col.hasDefault && col.default !== undefined && typeof col.default !== "object") {
      const d = col.default;
      if (typeof d === "boolean") def += ` DEFAULT ${d ? 1 : 0}`;
      else if (typeof d === "number") def += ` DEFAULT ${d}`;
      else if (typeof d === "string") def += ` DEFAULT '${d.replace(/'/g, "''")}'`;
    }
    colDefs.push(def);
  }
  return `CREATE TABLE IF NOT EXISTS "${tableName}" (${colDefs.join(", ")})`;
}

// `ALTER TABLE ADD COLUMN` above always adds the column bare (nullable, no
// DEFAULT clause -- see comment block above), so every pre-existing row gets
// NULL instead of the schema's declared default. For a plain `.default(false)`
// boolean that's harmless (NULL reads back falsy, same as false). But for a
// `.default(true)` boolean, drizzle's SQLiteBoolean.mapFromDriverValue does
// `Number(value) === 1`, so NULL reads back as `false` -- the *opposite* of
// the intended default -- and every existing row silently gets the disabled
// behavior instead of the enabled one. Concretely: notifyCommunityEnabled/
// notifyChatEnabled/notifyOrdersEnabled/notifyOffersEnabled all
// default(true), so every user account that existed before those columns
// were added (in a past deploy, not necessarily this boot) had push
// notifications for that category silently OFF, with no code path that ever
// re-checked or corrected it. Backfill NULLs to the schema's real default on
// every boot -- for brand-new columns and for columns that already drifted
// in a previous deploy alike -- so existing rows behave like the schema
// says, not just newly-created ones. Idempotent: WHERE ... IS NULL is a
// no-op once a row has any real value, including an explicit user choice.
function backfillNullDefault(sqlite: Database.Database, tableName: string, col: any) {
  if (!col.hasDefault || col.default === undefined || typeof col.default === "object") return;
  const d = col.default;
  let literal: string | null = null;
  if (typeof d === "boolean") literal = d ? "1" : "0";
  else if (typeof d === "number") literal = String(d);
  else if (typeof d === "string") literal = `'${d.replace(/'/g, "''")}'`;
  if (literal === null) return;
  try {
    const result = sqlite
      .prepare(`UPDATE "${tableName}" SET "${col.name}" = ${literal} WHERE "${col.name}" IS NULL`)
      .run();
    if (result.changes > 0) {
      console.log(
        `[auto-migrate] backfilled ${result.changes} row(s) of ${tableName}.${col.name} from NULL to default ${literal}`,
      );
    }
  } catch (e: any) {
    console.error(`[auto-migrate] FAILED to backfill default for ${tableName}.${col.name}:`, e?.message || e);
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
    if (!tableName) continue;

    const expectedCols = getTableColumns(value as Table);

    if (!existingTables.has(tableName)) {
      try {
        sqlite.prepare(buildCreateTableSql(tableName, expectedCols)).run();
        console.log(`[auto-migrate] created missing table ${tableName}`);
      } catch (e: any) {
        console.error(`[auto-migrate] FAILED to create table ${tableName}:`, e?.message || e);
      }
      continue; // freshly created with every expected column already
    }
    const actualCols = new Set(
      (sqlite.prepare(`PRAGMA table_info('${tableName}')`).all() as { name: string }[]).map((c) => c.name)
    );

    for (const col of Object.values(expectedCols) as any[]) {
      if (actualCols.has(col.name)) {
        backfillNullDefault(sqlite, tableName, col);
        continue;
      }
      const sqlType = sqlTypeFor(col.columnType);
      // SQLite's ALTER TABLE ADD COLUMN rejects a UNIQUE constraint outright
      // ("Cannot add a UNIQUE column") even though CREATE TABLE allows it.
      // Add the bare column first, then enforce uniqueness with a separate
      // index -- functionally equivalent, and index creation on an all-NULL
      // / sparse new column never conflicts. Without this split, the ADD
      // COLUMN throws, is swallowed by this try/catch, and the column is
      // silently never created -- so the very next query referencing it
      // throws "no such column" *outside* any try/catch, which crashes the
      // whole process (see file header comment). This is exactly that bug,
      // triggered by `users.wp_user_id`.
      try {
        sqlite.prepare(`ALTER TABLE "${tableName}" ADD COLUMN "${col.name}" ${sqlType}`).run();
        console.log(`[auto-migrate] added missing column ${tableName}.${col.name} (${sqlType})`);
      } catch (e: any) {
        console.error(`[auto-migrate] FAILED to add ${tableName}.${col.name}:`, e?.message || e);
        continue;
      }
      backfillNullDefault(sqlite, tableName, col);
      if (col.isUnique) {
        try {
          sqlite
            .prepare(
              `CREATE UNIQUE INDEX IF NOT EXISTS "uq_${tableName}_${col.name}" ON "${tableName}"("${col.name}")`,
            )
            .run();
          console.log(`[auto-migrate] created unique index for ${tableName}.${col.name}`);
        } catch (e: any) {
          console.error(`[auto-migrate] FAILED to create unique index for ${tableName}.${col.name}:`, e?.message || e);
        }
      }
    }
  }
}
