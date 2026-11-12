// Isolated QA only: in-memory SQLite, synthetic accounts, mocked Drive/Resend.
// No .env, no production database, no schedulers and no external delivery.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import express from "express";
import path from "node:path";
import { createServer } from "node:http";
import { Readable } from "node:stream";
import { google } from "googleapis";
import Database from "better-sqlite3";
process.env.SQLITE_DB_PATH = ":memory:";
process.env.NODE_ENV = "test";
process.env.GOOGLE_OAUTH_CLIENT_ID = "synthetic";
process.env.GOOGLE_OAUTH_CLIENT_SECRET = "synthetic";
process.env.GOOGLE_OAUTH_REFRESH_TOKEN = "synthetic";
process.env.GOOGLE_DRIVE_FOLDER_ID = "synthetic";
const fileStore = new Map<string, { bytes: Buffer; type: string }>();
(google as any).drive = () => ({ files: {
  create: async ({ media }: any) => {
    const chunks: Buffer[] = [];
    for await (const chunk of media.body) chunks.push(Buffer.from(chunk));
    const id = `qa_${crypto.randomUUID()}`;
    fileStore.set(id, { bytes: Buffer.concat(chunks), type: media.mimeType });
    return { data: { id } };
  },
  get: async ({ fileId }: any) => {
    const file = fileStore.get(fileId)!;
    return { data: Readable.from(file.bytes), status: 200, headers: new Headers({ "content-length": String(file.bytes.length), "content-type": file.type }) };
  },
} });
const nativeFetch = globalThis.fetch;
let code = "", mailFails = false;
globalThis.fetch = (async (_url: any, options: any) => {
  const data = options?.body ? JSON.parse(options.body) : {};
  const match = data.html?.match(/>(\d{6})<\/p>/);
  if (match) code = match[1];
  return new Response(JSON.stringify(mailFails ? { message: "synthetic failure" } : { id: "qa-no-delivery" }), { status: mailFails ? 503 : 200 });
}) as typeof fetch;
const { db, storage } = await import("../server/storage");
const s = await import("../shared/schema");
const { eq } = await import("drizzle-orm");
const { CURRENT_LEGAL_VERSION } = await import("../shared/legalVersion");
for (const [id, role, status, name] of [[1, "admin", "approved", "Dr. QA Admin"], [2, "partner", "approved", "Dr. QA Partner"], [3, "partner", "approved", "Dr. Other Partner"], [4, "partner", "pending", "Pending Partner"]] as const) {
  db.insert(s.users).values({ id, role, status, name, email: `qa-${id}@example.invalid`, passwordHash: "synthetic",
    legalAcceptedVersion: CURRENT_LEGAL_VERSION, createdAt: Date.now() }).run();
  db.insert(s.sessions).values({ token: `feature-${id}`, userId: id, expiresAt: Date.now() + 86400000 }).run();
}
const { registerRoutes } = await import("../server/routes");
const app = express(); app.use(express.json());
if (process.argv.includes("--serve") && !process.argv.includes("--preview")) app.get("/__qa/last-code", (_req, res) => res.json({ code }));
if (process.argv.includes("--preview")) app.use((req, _res, next) => {
  // Private preview: synthetic admin only; no real account or data.
  req.headers.cookie = `${req.headers.cookie || ""}; sid=feature-1`; next();
});
const server = createServer(app);
await registerRoutes(server, app);
app.use(express.static(path.resolve("dist/public")));
app.use("/{*path}", (_req, res) => res.sendFile(path.resolve("dist/public/index.html")));
app.use((err: any, _req: any, res: any, _next: any) => res.status(500).json({ message: err.message }));
const serve = process.argv.includes("--serve");
await new Promise<void>(resolve => server.listen(serve ? Number(process.env.QA_PORT || 5090) : 0, "0.0.0.0", resolve));
const base = `http://127.0.0.1:${(server.address() as any).port}`;
let checks = 0;
async function request(method: string, url: string, expected: number, body?: any, cookie = "sid=feature-1") {
  const response = await nativeFetch(base + url, { method, headers: { ...(body instanceof FormData ? {} : { "Content-Type": "application/json" }), ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body) });
  const text = await response.text();
  assert.equal(response.status, expected, `${method} ${url}: ${text}`);
  checks++;
  return { data: response.headers.get("content-type")?.includes("json") ? JSON.parse(text) : text,
    cookies: response.headers.getSetCookie().map(v => v.split(";")[0]).join("; "), headers: response.headers };
}
const event = { topic: "QA multi-day symposium", scheduledAt: Date.now() + 86400000, endsAt: Date.now() + 3 * 86400000,
  zoomLink: "https://example.com/symposium", registrationMode: "external" };
const inviteBody = { label: "Synthetic contact", topic: "Invitation QA", message: "Welcome to this synthetic chat.", intendedUserId: null };
async function invite(intendedUserId: number | null = null) {
  const result = (await request("POST", "/api/admin/guest-chats", 201, { ...inviteBody, intendedUserId })).data;
  return { ...result, token: result.path.split("/").pop(), endpoint: `/api/guest-chat/${result.id}` };
}
async function start(i: any) { return (await request("POST", `${i.endpoint}/start`, 200, { token: i.token }, "")).cookies; }
if (serve) {
  await storage.createCaseDiscussion(event);
  await storage.createCaseDiscussion({ ...event, topic: "QA partner meeting", registrationMode: "app", endsAt: null });
  console.log(`Synthetic events and chat invitations fixture: ${base}`);
} else try {
  // Additive upgrade preserves a real old-format row and old column reads.
  const oldDb = new Database(":memory:");
  oldDb.exec("CREATE TABLE case_discussions (id INTEGER PRIMARY KEY, topic TEXT NOT NULL, presenter_name TEXT, scheduled_at INTEGER NOT NULL, zoom_link TEXT NOT NULL, notes TEXT, notified_at INTEGER, created_at INTEGER NOT NULL)");
  oldDb.prepare("INSERT INTO case_discussions (id, topic, scheduled_at, zoom_link, created_at) VALUES (1, 'Existing event', 1, 'https://example.com', 1)").run();
  const { autoMigrate } = await import("../server/autoMigrate");
  autoMigrate(oldDb);
  assert.equal((oldDb.prepare("SELECT count(*) AS n FROM case_discussions").get() as any).n, 1);
  assert.equal((oldDb.prepare("SELECT topic, registration_mode, ends_at FROM case_discussions").get() as any).registration_mode, "app");
  oldDb.close();
  // Events: authorization, validation, file binding, calendars and migration-safe defaults.
  await request("POST", "/api/admin/case-discussions", 401, event, "");
  await request("POST", "/api/admin/case-discussions", 403, event, "sid=feature-2");
  const ev = (await request("POST", "/api/admin/case-discussions", 200, event)).data;
  await request("POST", `/api/case-discussions/${ev.id}/rsvp`, 409, {}, "sid=feature-2");
  for (const patch of [{ endsAt: event.scheduledAt - 1 }, { zoomLink: "javascript:alert(1)" }, { registrationMode: "automatic" }])
    await request("PATCH", `/api/admin/case-discussions/${ev.id}`, 400, patch);
  const ics = (await request("GET", `/api/case-discussions/${ev.id}/ical`, 200, undefined, "sid=feature-2")).data;
  assert.match(ics, /DTEND:/); assert.match(ics, /does not register you/); assert.doesNotMatch(ics, /Zoom/);
  const invalidFile = new FormData(); invalidFile.append("file", new Blob(["<script>bad</script>"]), "bad.html");
  await request("POST", "/api/admin/event-attachments", 400, invalidFile);
  const upload = new FormData(); upload.append("file", new Blob(["%PDF-1.4\nSynthetic event programme"]), "Programme.pdf");
  await request("POST", "/api/admin/event-attachments", 403, upload, "sid=feature-2");
  const file = (await request("POST", "/api/admin/event-attachments", 200, upload)).data;
  await request("GET", file.url, 403, undefined, "sid=feature-2");
  await request("PATCH", `/api/admin/case-discussions/${ev.id}`, 400, { attachments: [{ ...file, url: "/api/files/not_uploaded" }] });
  await request("PATCH", `/api/admin/case-discussions/${ev.id}`, 200, { attachments: [file] });
  await request("PATCH", `/api/admin/case-discussions/${ev.id}`, 400, { attachments: Array(11).fill(file) });
  await request("PATCH", `/api/admin/case-discussions/${ev.id}`, 200, { id: 9999, createdAt: 1 });
  assert.equal((await storage.getCaseDiscussionById(ev.id))!.createdAt, ev.createdAt);
  const download = await request("GET", file.url, 200, undefined, "sid=feature-2");
  assert.match(download.headers.get("content-disposition")!, /^attachment/); assert.match(download.data, /Synthetic/);
  await request("GET", file.url, 401, undefined, "");
  await request("PATCH", `/api/admin/case-discussions/${ev.id}`, 200, { attachments: [], registrationMode: "app" });
  await request("GET", file.url, 403, undefined, "sid=feature-2");
  await request("POST", `/api/case-discussions/${ev.id}/rsvp`, 200, {}, "sid=feature-2");
  await request("PATCH", `/api/admin/case-discussions/${ev.id}`, 200, { registrationMode: "external" });
  assert.equal((await storage.listCaseDiscussionAttendees(ev.id)).length, 1);
  const ongoing = await storage.createCaseDiscussion({ ...event, scheduledAt: Date.now() - 86400000, endsAt: Date.now() + 86400000 });
  assert.ok((await storage.listUpcomingCaseDiscussions(2)).some(e => e.id === ongoing.id));
  const legacy = (await request("POST", "/api/admin/case-discussions", 200, { topic: "Legacy", zoomLink: "https://example.com", scheduledAt: Date.now() + 86400000 })).data;
  assert.equal(legacy.registrationMode, "app");

  // Invitations: public links expose no history until explicitly redeemed.
  await request("POST", "/api/admin/guest-chats", 401, inviteBody, "");
  await request("POST", "/api/admin/guest-chats", 403, inviteBody, "sid=feature-2");
  const i = await invite();
  await request("GET", i.endpoint, 403, undefined, "");
  await request("POST", `${i.endpoint}/start`, 403, { token: "a".repeat(64) }, "");
  const guestCookie = await start(i);
  await request("POST", `${i.endpoint}/start`, 403, { token: i.token }, "");
  await request("GET", i.endpoint, 200, undefined, guestCookie);
  const message = { body: "Synthetic guest message", requestId: crypto.randomUUID() };
  await request("POST", `${i.endpoint}/message`, 200, message, guestCookie);
  await request("POST", `${i.endpoint}/message`, 200, message, guestCookie);
  assert.equal((await request("GET", i.endpoint, 200, undefined, guestCookie)).data.messages.length, 2);
  await request("GET", "/api/chat/threads", 401, undefined, guestCookie);
  await request("GET", "/api/admin/guest-chats", 401, undefined, guestCookie);
  const adminList = (await request("GET", "/api/admin/guest-chats", 200)).data;
  assert.equal(adminList[0].unread, true); assert.ok(!JSON.stringify(adminList).includes("tokenHash"));
  await request("POST", `/api/admin/guest-chats/${i.id}/reply`, 200, { body: "Synthetic admin reply", requestId: crypto.randomUUID() });
  await request("POST", `${i.endpoint}/send-code`, 200, { email: "new-partner@example.invalid" }, guestCookie);
  const correctCode = code; assert.match(correctCode, /^\d{6}$/);
  const verify = { code: "000000", firstName: "Test", lastName: "Partner", acceptedLegal: true };
  await request("POST", `${i.endpoint}/verify`, 400, verify, guestCookie);
  await request("POST", `${i.endpoint}/verify`, 400, { ...verify, code: correctCode, acceptedLegal: false }, guestCookie);
  const verified = await request("POST", `${i.endpoint}/verify`, 200, { ...verify, code: correctCode }, guestCookie);
  const newUser = db.select().from(s.users).where(eq(s.users.email, "new-partner@example.invalid")).get()!;
  assert.equal(newUser.status, "approved"); assert.equal(newUser.legalAcceptedVersion, CURRENT_LEGAL_VERSION);
  assert.equal((await storage.listMessagesForThread(verified.data.threadId)).length, 3);
  await request("GET", "/api/auth/me", 200, undefined, verified.cookies);
  await request("GET", i.endpoint, 403, undefined, guestCookie);
  await request("POST", `${i.endpoint}/verify`, 403, { ...verify, code: correctCode }, guestCookie);

  // Existing signed-in account: straight to a new member chat, no guest step.
  const existing = await invite(2);
  const direct = (await request("POST", `${existing.endpoint}/start`, 200, { token: existing.token }, "sid=feature-2")).data;
  assert.ok(direct.threadId);
  const repeat = (await request("POST", `${existing.endpoint}/start`, 200, { token: existing.token }, "sid=feature-2")).data;
  assert.equal(repeat.threadId, direct.threadId);
  await request("POST", `${existing.endpoint}/start`, 403, { token: existing.token }, "sid=feature-3");
  // Signed-out existing partner verifies once and reuses their account.
  const returning = await invite(2), returningCookie = await start(returning);
  await request("POST", `${returning.endpoint}/send-code`, 400, { email: "qa-3@example.invalid" }, returningCookie);
  await request("POST", `${returning.endpoint}/send-code`, 200, { email: "qa-2@example.invalid" }, returningCookie);
  const beforeUsers = db.select().from(s.users).all().length;
  await request("POST", `${returning.endpoint}/verify`, 200, { ...verify, code, firstName: "", lastName: "" }, returningCookie);
  assert.equal(db.select().from(s.users).all().length, beforeUsers);
  // Declined session retained, then safely linked later by admin.
  const declined = await invite(), declinedCookie = await start(declined);
  await request("POST", `${declined.endpoint}/message`, 200, { ...message, requestId: crypto.randomUUID() }, declinedCookie);
  await request("POST", `${declined.endpoint}/decline`, 200, {}, declinedCookie);
  await request("GET", declined.endpoint, 403, undefined, declinedCookie);
  const retained = (await request("GET", `/api/admin/guest-chats/${declined.id}`, 200)).data;
  assert.equal(retained.messages.length, 2);
  await request("POST", `/api/admin/guest-chats/${declined.id}/link`, 200, { userId: 3 });
  await request("POST", `/api/admin/guest-chats/${declined.id}/link`, 409, { userId: 2 });
  // Delivery failure, revocation, pending user, expired invite.
  const failed = await invite(), failedCookie = await start(failed); mailFails = true;
  await request("POST", `${failed.endpoint}/send-code`, 502, { email: "delivery@example.invalid" }, failedCookie); mailFails = false;
  await request("POST", `/api/admin/guest-chats/${failed.id}/revoke`, 200, {});
  await request("GET", failed.endpoint, 403, undefined, failedCookie);
  await request("POST", "/api/admin/guest-chats", 400, { ...inviteBody, intendedUserId: 4 });
  const expired = await invite(); db.update(s.guestChatInvites).set({ expiresAt: 1 }).where(eq(s.guestChatInvites.id, expired.id)).run();
  await request("POST", `${expired.endpoint}/start`, 403, { token: expired.token }, "");
  const limited = await invite(), limitedCookie = await start(limited);
  await request("POST", `${limited.endpoint}/send-code`, 200, { email: "limit@example.invalid" }, limitedCookie);
  const limitedCode = code;
  await request("POST", `${limited.endpoint}/send-code`, 429, { email: "limit@example.invalid" }, limitedCookie);
  for (let n = 0; n < 5; n++) await request("POST", `${limited.endpoint}/verify`, 400, { ...verify, code: "000000" }, limitedCookie);
  await request("POST", `${limited.endpoint}/verify`, 400, { ...verify, code: limitedCode }, limitedCookie);
  const stale = await invite(), staleCookie = await start(stale);
  await request("POST", `${stale.endpoint}/send-code`, 200, { email: "stale@example.invalid" }, staleCookie);
  db.update(s.guestChatInvites).set({ verificationExpiresAt: 1 }).where(eq(s.guestChatInvites.id, stale.id)).run();
  await request("POST", `${stale.endpoint}/verify`, 400, { ...verify, code }, staleCookie);
  const constrained = await invite(2), constrainedCookie = await start(constrained);
  await request("POST", `${constrained.endpoint}/keep`, 403, {}, `${constrainedCookie}; sid=feature-3`);
  await request("POST", `/api/admin/guest-chats/${constrained.id}/link`, 403, { userId: 3 });
  const raced = await invite();
  const raceResponses = await Promise.all([1, 2].map(() => nativeFetch(base + raced.endpoint + "/start", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: raced.token }),
  })));
  assert.equal(raceResponses.filter(r => r.status === 200).length, 1);
  assert.equal(raceResponses.filter(r => r.status >= 400).length, 1);
  console.log(`PASS: ${checks} HTTP checks plus assertions; events, attachments and chat-first invitations. No external delivery.`);
} finally { server.close(); }
