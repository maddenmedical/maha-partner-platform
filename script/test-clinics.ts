// Run: npx tsx script/test-clinics.ts. In-memory DB only; no server/schedulers.
import assert from "node:assert/strict";
process.env.SQLITE_DB_PATH = ":memory:";
const { storage, db, sqliteDb } = await import("../server/storage");
const { users, standingRewards, referrals, orders, chatThreads, chatMessages } = await import("../shared/schema");
const { eq } = await import("drizzle-orm");

const first = await storage.findOrCreateClinicByName("Test Clinic");
const other = await storage.findOrCreateClinicByName("Other Clinic");
db.insert(users).values({
  id: 1, role: "partner", name: "QA Member", email: "clinic-unit@example.invalid",
  passwordHash: "test", status: "approved", createdAt: Date.now(),
  clinicId: first.id, standingPoints: 125, businessName: "Original business",
}).run();
db.insert(standingRewards).values({
  id: 1, userId: 1, clinicId: first.id, tierKey: "test", rewardDescription: "History",
  status: "fulfilled", createdAt: Date.now(), fulfilledByName: "QA Admin",
  fulfillmentNote: "Keep this original note",
}).run();
const before = await storage.getUser(1);
db.insert(referrals).values({ partnerId: 1, patientFirstName: "Test", patientLastName: "Patient",
  patientContact: "fixture", caseDescription: "Preserve clinical notes", createdAt: Date.now() }).run();
db.insert(orders).values({ partnerId: 1, createdAt: Date.now() }).run();
const thread = db.insert(chatThreads).values({ userId: 1, userRole: "partner", createdAt: Date.now() }).returning().get();
db.insert(chatMessages).values({ threadId: thread.id, senderId: 1, senderRole: "partner",
  senderName: "QA Member", body: "Preserve original message", createdAt: Date.now() }).run();
const beforeRecords = {
  referrals: db.select().from(referrals).all(), orders: db.select().from(orders).all(),
  threads: db.select().from(chatThreads).all(), messages: db.select().from(chatMessages).all(),
};
const renamed = await storage.renameClinic(first.id, " Renamed Clinic ");
assert.equal(renamed?.name, "Renamed Clinic");
assert.equal(renamed?.normalizedName, "renamed clinic");
assert.equal((await storage.findOrCreateClinicByName(" RENAMED CLINIC ")).id, first.id);
await assert.rejects(storage.renameClinic(first.id, "other clinic"), /UNIQUE/);
assert.deepEqual(await storage.deleteClinic(first.id, "Wrong name"), { deleted: false, conflict: true });
assert.equal((await storage.getUser(1))?.clinicId, first.id);
// Force a dependent update failure to prove deletion is atomic.
sqliteDb.exec("CREATE TRIGGER qa_abort_reward BEFORE UPDATE ON standing_rewards BEGIN SELECT RAISE(ABORT, 'QA rollback'); END");
await assert.rejects(storage.deleteClinic(first.id, "Renamed Clinic"), /QA rollback/);
assert.equal((await storage.getUser(1))?.clinicId, first.id);
assert.ok(await storage.getClinic(first.id));
sqliteDb.exec("DROP TRIGGER qa_abort_reward");
assert.deepEqual(await storage.deleteClinic(first.id, "Renamed Clinic"), { deleted: true, detachedMembers: 1 });
assert.equal(await storage.getClinic(first.id), undefined);
const after = await storage.getUser(1);
assert.deepEqual(after, { ...before, clinicId: null });
assert.deepEqual({
  referrals: db.select().from(referrals).all(), orders: db.select().from(orders).all(),
  threads: db.select().from(chatThreads).all(), messages: db.select().from(chatMessages).all(),
}, beforeRecords);
const reward = db.select().from(standingRewards).where(eq(standingRewards.id, 1)).get()!;
assert.equal(reward.clinicId, null);
assert.equal(reward.status, "fulfilled");
assert.equal(reward.fulfilledByName, "QA Admin");
assert.match(reward.fulfillmentNote!, /Keep this original note/);
assert.match(reward.fulfillmentNote!, /Former clinic: Renamed Clinic/);
assert.ok(await storage.getClinic(other.id));
assert.deepEqual(await storage.deleteClinic(first.id, "Renamed Clinic"), { deleted: false });
assert.equal(await storage.renameClinic(999999, "Absent"), undefined);
assert.deepEqual(await storage.deleteClinic(other.id, "Other Clinic"), { deleted: true, detachedMembers: 0 });
sqliteDb.close();
console.log("PASS: rename, normalization, duplicate rejection, confirmation, rollback, member/points preservation, reward history, isolation, repeat deletion, empty clinic.");
