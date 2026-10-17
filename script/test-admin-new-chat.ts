// Synthetic in-memory database only. Never loads .env or starts schedulers.
// QA inventory: roles, minimal directory, general/referral starts, retries,
// transaction rollback, stale recipients, same-thread referral conversion.
// Browser inventory: search/change partner, mode toggle, cancel, send,
// error/retry, mobile gutters/scrolling, partner form and retained first message.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express from "express";
import { createServer } from "node:http";
import path from "node:path";
process.env.SQLITE_DB_PATH = ":memory:";
process.env.NODE_ENV = "test";
const nativeFetch = globalThis.fetch;
globalThis.fetch = (async () => new Response(JSON.stringify({ id: "qa-no-delivery" }), { status: 200 })) as typeof fetch;
const { db, sqliteDb, storage } = await import("../server/storage");
const s = await import("../shared/schema");
const { eq } = await import("drizzle-orm");
const { CURRENT_LEGAL_VERSION } = await import("../shared/legalVersion");
const now = Date.now();
for (const [id, name, role, status, archivedAt] of [
  [1, "Dr. QA Admin", "admin", "approved", null],
  [2, "Dr. Anna Müller", "partner", "approved", null],
  [3, "Dr. QA Other Partner", "partner", "approved", null],
  [4, "Pending Partner", "partner", "pending", null],
  [5, "Archived Partner", "partner", "approved", now],
  [6, "QA Student", "student", "approved", null],
] as const) {
  db.insert(s.users).values({
    id, name, role, status, archivedAt, email: `qa-${id}@example.invalid`,
    businessName: "Synthetic Clinic", passwordHash: "not-a-real-password",
    legalAcceptedVersion: CURRENT_LEGAL_VERSION, createdAt: now,
  }).run();
  db.insert(s.sessions).values({ token: `new-chat-${id}`, userId: id, expiresAt: now + 86400000 }).run();
}
db.insert(s.sessions).values({ token: "new-chat-view", userId: 1, impersonatingUserId: 2, expiresAt: now + 86400000 }).run();
const { registerRoutes } = await import("../server/routes");
const app = express();
app.use(express.json());
if (process.argv.includes("--preview")) app.use((req, _res, next) => { req.headers.cookie = "sid=new-chat-1"; next(); });
app.get("/api/admin/backups/status", (_req, res) => res.json({ lastBackupAt: null, totalBackups: 0 }));
const server = createServer(app);
await registerRoutes(server, app);
app.use(express.static(path.resolve("dist/public")));
app.use("/{*path}", (_req, res) => res.sendFile(path.resolve("dist/public/index.html")));
app.use((err: any, _req: any, res: any, _next: any) => res.status(err.status || 500).json({ message: err.message }));
const serve = process.argv.includes("--serve");
await new Promise<void>(resolve => server.listen(serve ? Number(process.env.QA_PORT || 5080) : 0, "0.0.0.0", resolve));
if (serve) {
  console.log(`Synthetic New Chat fixture on ${(server.address() as any).port}`);
} else {
  let checks = 0;
  const port = (server.address() as any).port;
  async function req(method: string, url: string, expected: number, body?: any, token: string | null = "new-chat-1") {
    const response = await nativeFetch(`http://127.0.0.1:${port}${url}`, {
      method, headers: { "Content-Type": "application/json", ...(token ? { cookie: `sid=${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const result = await response.json();
    assert.equal(response.status, expected, `${method} ${url}: ${JSON.stringify(result)}`);
    checks++;
    return result;
  }
  const startUrl = "/api/admin/chat/start";
  const recipientsUrl = "/api/admin/chat/recipients";
  const payload = (extra = {}) => ({ userId: 2, mode: "general", topic: "QA conversation", message: "Synthetic first message", requestId: randomUUID(), ...extra });
  const count = (table: any) => db.select().from(table).all().length;
  try {
    for (const [token, code] of [[null, 401], ["new-chat-2", 403], ["new-chat-6", 403], ["new-chat-view", 403]] as const) {
      await req("GET", recipientsUrl, code, undefined, token);
      await req("POST", startUrl, code, payload(), token);
    }
    const recipients = await req("GET", recipientsUrl, 200);
    assert.deepEqual(recipients.map((p: any) => p.id).sort(), [2, 3]);
    assert.ok(recipients.every((p: any) => Object.keys(p).sort().join() === "businessName,email,id,name"));
    for (const bad of [{ userId: 1 }, { userId: 4 }, { userId: 5 }, { userId: 6 }, { userId: 9999 },
      { userId: -1 }, { userId: "2" }, { mode: "wrong" }, { topic: " " }, { message: " " },
      { topic: "a".repeat(161) }, { message: "a".repeat(5001) }, { requestId: "bad" }, { senderId: 99 }]) {
      await req("POST", startUrl, 400, payload(bad));
    }
    assert.equal(count(s.chatThreads), 0);
    const general = payload();
    const { thread } = await req("POST", startUrl, 201, general);
    const noticesBeforeReplay = count(s.appNotifications);
    assert.ok(noticesBeforeReplay > 0, "first message creates an in-app notification");
    assert.ok(db.select().from(s.appNotifications).all().every(n => n.userId === 2));
    assert.equal(thread.pendingReferralRequestedAt, null);
    assert.equal(thread.emailNotified, true);
    const messages = await req("GET", `/api/chat/threads/${thread.id}/messages`, 200, undefined, "new-chat-2");
    assert.equal(messages.length, 1);
    assert.equal(messages[0].senderId, 1);
    assert.equal(messages[0].body, general.message);
    await req("GET", `/api/chat/threads/${thread.id}/messages`, 404, undefined, "new-chat-3");
    assert.equal((await req("POST", startUrl, 200, general)).thread.id, thread.id);
    assert.equal(count(s.chatMessages), 1);
    assert.equal(count(s.appNotifications), noticesBeforeReplay, "replay does not duplicate notifications");
    // Re-run the production migrator against populated data, including the
    // new ledger. A second startup must preserve existing conversations.
    (await import("../server/autoMigrate")).autoMigrate(sqliteDb);
    assert.equal(count(s.chatMessages), 1);
    assert.equal(count(s.adminChatStarts), 1);
    await req("POST", startUrl, 409, { ...general, message: "Changed" });
    const referral = payload({ mode: "referral" });
    const started = (await req("POST", startUrl, 201, referral)).thread;
    assert.ok(started.pendingReferralRequestedAt);
    assert.equal(started.pendingReferralRequestedByRole, "admin");
    assert.equal(started.ownerLastReadAt, null);
    const referralBody = { patientFirstName: "Synthetic", patientLastName: "Patient", patientContact: "QA only",
      caseDescription: "Synthetic case for tests", patientConsentAttested: true, linkThreadId: started.id };
    await req("POST", "/api/referrals", 403, referralBody, "new-chat-3");
    await req("POST", "/api/referrals", 200, referralBody, "new-chat-2");
    const converted = await storage.getThread(started.id);
    assert.equal(converted?.kind, "referral");
    assert.ok(converted?.referralId);
    assert.equal(converted?.pendingReferralRequestedAt, null);
    assert.equal(count(s.chatThreads), 2);
    assert.equal((await storage.listMessagesForThread(started.id))[0].body, referral.message);
    await req("POST", "/api/referrals", 400, referralBody, "new-chat-2");
    const before = [count(s.chatThreads), count(s.chatMessages), count(s.adminChatStarts)];
    sqliteDb.exec("CREATE TRIGGER qa_new_chat_failure BEFORE INSERT ON chat_messages BEGIN SELECT RAISE(ABORT, 'qa rollback'); END");
    const retry = payload();
    await req("POST", startUrl, 500, retry);
    assert.deepEqual([count(s.chatThreads), count(s.chatMessages), count(s.adminChatStarts)], before);
    sqliteDb.exec("DROP TRIGGER qa_new_chat_failure");
    await req("POST", startUrl, 201, retry);
    await storage.deleteThread(thread.id);
    await req("POST", startUrl, 410, general);
    db.update(s.users).set({ archivedAt: Date.now() }).where(eq(s.users.id, 2)).run();
    await req("POST", startUrl, 400, payload());
    assert.equal((await req("GET", recipientsUrl, 200)).length, 1);
    console.log(`PASS: ${checks} HTTP checks plus directory, ownership, idempotency, rollback and same-thread conversion assertions.`);
  } finally {
    // Await the mocked asynchronous alert worker before closing its database.
    await (await import("../server/referralAlerts")).deliverReferralAlerts();
    await new Promise<void>(resolve => server.close(() => resolve()));
    sqliteDb.close();
  }
}
