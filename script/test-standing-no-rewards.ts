// In-memory fixtures only. No production data, migrations or outbound mail.
// Run: npx tsx script/test-standing-no-rewards.ts
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
process.env.SQLITE_DB_PATH = ":memory:";
process.env.NODE_ENV = "test";
const nativeFetch = globalThis.fetch;
globalThis.fetch = (async () => new Response(JSON.stringify({ id: "qa-not-delivered" }), { status: 200 })) as typeof fetch;
const { db, sqliteDb, storage } = await import("../server/storage");
const s = await import("../shared/schema");
const { CURRENT_LEGAL_VERSION } = await import("../shared/legalVersion");
const { buildLevelUpEmailHtml } = await import("../server/email");
const now = Date.now();
const clinic = await storage.findOrCreateClinicByName("Synthetic pooled clinic");
for (const [id, role] of [[1, "admin"], [2, "partner"], [3, "partner"], [4, "partner"], [5, "student"]] as const) {
  db.insert(s.users).values({
    id, role, name: `Synthetic ${id}`, email: `fixture-${id}@example.invalid`,
    passwordHash: "unused", status: "approved", createdAt: now,
    legalAcceptedVersion: CURRENT_LEGAL_VERSION,
    clinicId: id === 3 || id === 4 ? clinic.id : null,
  }).run();
  db.insert(s.sessions).values({ token: `fixture-${id}`, userId: id, expiresAt: now + 86400000 }).run();
}
db.insert(s.standingRewards).values({
  userId: 2, tierKey: "active_member", rewardDescription: "Legacy fixture: must not be exposed",
  createdAt: now, status: "pending",
}).run();
const legacy = db.select().from(s.standingRewards).all();
const app = express();
app.use(express.json());
const server = createServer(app);
const { registerRoutes } = await import("../server/routes");
await registerRoutes(server, app);
await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${(server.address() as any).port}`;
let checks = 0;
async function request(method: string, path: string, expected: number, userId: number | null, body?: object) {
  const response = await nativeFetch(base + path, {
    method, headers: { "Content-Type": "application/json", ...(userId ? { cookie: `sid=fixture-${userId}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await response.json();
  assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(json)}`);
  checks++;
  return json;
}
try {
  assert.deepEqual(s.STANDING_TIERS.map(t => t.minPoints), [0, 100, 350, 800, 1500]);
  assert.ok(s.STANDING_TIERS.every(t => !("reward" in t)));
  assert.equal("createStandingReward" in storage, false);
  assert.equal("fulfillStandingReward" in storage, false);
  const tiers = await request("GET", "/api/standing/tiers", 200, 2);
  assert.deepEqual(tiers, s.STANDING_TIERS);
  // Two solo referrals and two pooled referrals cross the first tier.
  for (const userId of [2, 2, 3, 4]) {
    await request("POST", "/api/referrals", 200, userId, {
      patientFirstName: "Synthetic", patientLastName: `Fixture ${checks}`,
      patientContact: "QA only", caseDescription: "No real patient data",
      urgency: "Normal", patientConsentAttested: true,
    });
  }
  const solo = await request("GET", "/api/standing/mine", 200, 2);
  assert.equal(solo.tierKey, "active_member");
  assert.equal((await storage.getUser(2))?.standingPoints, 100);
  for (const userId of [3, 4]) {
    assert.equal((await request("GET", "/api/standing/mine", 200, userId)).tierKey, "active_member");
    assert.equal((await storage.getUser(userId))?.standingPoints, 50);
  }
  assert.equal((await storage.listStandingEntriesForUser(2)).length, 2);
  const clinics = await request("GET", "/api/admin/clinics", 200, 1);
  assert.ok(clinics.some((c: any) => c.id === clinic.id));
  const summaries = await request("GET", "/api/admin/standing", 200, 1);
  assert.equal(summaries.find((u: any) => u.userId === 2).points, 100);
  // All remaining levels stay functional with no reward creation.
  for (const points of [250, 450, 700]) {
    await storage.awardStandingPoints({ userId: 2, category: "community", points });
  }
  assert.equal((await request("GET", "/api/standing/mine", 200, 2)).tierKey, "maha_fellow");
  assert.deepEqual(db.select().from(s.standingRewards).all(), legacy);
  for (const [method, path] of [
    ["GET", "/api/admin/standing/rewards"],
    ["PATCH", "/api/admin/standing/rewards/1/fulfill"],
  ]) {
    await request(method, path, 401, null);
    await request(method, path, 403, 2);
    await request(method, path, 403, 5);
    const result = await request(method, path, 410, 1);
    assert.ok(!JSON.stringify(result).includes("Legacy fixture"));
  }
  assert.deepEqual(db.select().from(s.standingRewards).all(), legacy);
  const email = buildLevelUpEmailHtml({
    userName: "Synthetic", userEmail: "fixture@example.invalid",
    tierLabel: "Active Member", pooled: true, openUrl: "https://example.invalid",
  });
  assert.match(email, /Active Member/);
  assert.match(email, /No action is required/);
  assert.doesNotMatch(email, /reward|discount|credit|fulfil/i);
  const importer = readFileSync(new URL("../server/migrateLegacyReferrals.ts", import.meta.url), "utf8");
  assert.doesNotMatch(importer, /createStandingReward|tier\.reward/);
  assert.equal(db.select().from(s.referrals).all().length, 4);
  console.log(`PASS: ${checks} HTTP checks; solo and pooled levels/points, all tier thresholds, referral records, legacy preservation, disabled reward endpoints, neutral level alerts and import guard.`);
} finally {
  await new Promise<void>(resolve => server.close(() => resolve()));
  sqliteDb.close();
}
