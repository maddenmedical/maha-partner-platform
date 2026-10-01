// Synthetic, in-memory checks only. Never loads .env or sends email.
import assert from "node:assert/strict";
process.env.SQLITE_DB_PATH = ":memory:";
process.env.NODE_ENV = "test";
globalThis.fetch = (async () => { throw new Error("External requests disabled"); }) as typeof fetch;
const { db, sqliteDb, storage } = await import("../server/storage");
const { users } = await import("../shared/schema");
const { hash, compare } = await import("bcryptjs");
const { eq } = await import("drizzle-orm");
const password = "Synthetic-launch-only-2026";
const passwordHash = await hash(password, 4);
const now = Date.now();
const variants = [
  {},
  { migratedPasswordPlain: "Synthetic-outdated-password" },
  { migratedPasswordPlain: null },
  { archivedAt: now },
  { status: "pending" },
  { status: "rejected" },
  { role: "admin" },
  { role: "student" },
  { credentialsIssuedAt: now },
  { migratedFromWp: false },
  { passwordHash: "invalid-hash" },
];
try {
  for (const [index, overrides] of variants.entries()) {
    db.insert(users).values({
      id: index + 1, name: `Synthetic Partner ${index + 1}`,
      email: `launch-qa-${index + 1}@example.invalid`, role: "partner",
      status: "approved", passwordHash, migratedPasswordPlain: password,
      migratedFromWp: true, createdAt: now, ...overrides,
    }).run();
  }
  let rows = await storage.listMigratedUsersAwaitingCredentials();
  assert.deepEqual(rows.map(u => u.id).sort((a, b) => a - b), [1, 2, 3, 11]);
  assert.equal(rows.find(u => u.id === 1)?.migratedPasswordPlain, password);
  for (const id of [2, 3, 11]) assert.equal(rows.find(u => u.id === id)?.migratedPasswordPlain, null);
  // Reading must not silently change account data or mark mail as delivered.
  assert.equal(db.select().from(users).where(eq(users.id, 2)).get()?.migratedPasswordPlain, "Synthetic-outdated-password");
  assert.equal(db.select().from(users).where(eq(users.id, 1)).get()?.credentialsIssuedAt, null);
  const newPassword = "Synthetic-changed-password-2026";
  await storage.updateUserPassword(1, await hash(newPassword, 4));
  const changed = await storage.getUser(1);
  assert.ok(changed);
  assert.equal(changed.migratedPasswordPlain, null);
  assert.equal(changed.credentialsIssuedAt, null);
  assert.equal(await compare(newPassword, changed.passwordHash), true);
  assert.equal(await compare(password, changed.passwordHash), false);
  rows = await storage.listMigratedUsersAwaitingCredentials();
  assert.equal(rows.find(u => u.id === 1)?.migratedPasswordPlain, null);
  await storage.markCredentialsIssued(2);
  assert.equal((await storage.listMigratedUsersAwaitingCredentials()).some(u => u.id === 2), false);
  console.log("PASS: current/stale/missing/malformed credentials; role/status/archive/issued filters; change-password invalidation; read-only audit; issuance exclusion.");
} finally {
  sqliteDb.close();
}
