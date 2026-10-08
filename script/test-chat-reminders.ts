import assert from "node:assert/strict";
process.env.SQLITE_DB_PATH = ":memory:";
process.env.NODE_ENV = "test";
process.env.EMAIL_FROM_ADDRESS = "MAHA Partner Platform <partner@maha.clinic>";
delete process.env.CUSTOM_CRED_API_RESEND_COM_URL;
delete process.env.CUSTOM_CRED_API_RESEND_COM_TOKEN;
process.env.RESEND_API_KEY = "fixture-not-a-key";
const mail: any[] = [];
let failAdmin2 = false;
globalThis.fetch = (async (url: any, opts: any) => {
  assert.equal(String(url), "https://api.resend.com/emails", "No external fixture requests");
  const payload = JSON.parse(opts.body);
  mail.push({ ...payload, requestHeaders: opts.headers });
  return new Response("{}", { status: failAdmin2 && payload.to[0] === "admin2@example.invalid" ? 503 : 200 });
}) as typeof fetch;
const { db, storage, sqliteDb } = await import("../server/storage");
const s = await import("../shared/schema");
const { eq } = await import("drizzle-orm");
const { deliverChatReminders, CHAT_REMINDER_DELAY_MS: delay } = await import("../server/chatReminders");
const now = Date.now();
for (const [id, role, email] of [[1, "admin", "admin1@example.invalid"], [2, "admin", "admin2@example.invalid"],
  [3, "partner", "partner@example.invalid"], [4, "student", "student@example.invalid"]] as const) {
  db.insert(s.users).values({ id, role, email, name: `Dr. Fixture ${id}`, passwordHash: "not-used", status: "approved", createdAt: now }).run();
}
let checks = 0;
function check(ok: any, label: string) { assert.ok(ok, label); checks++; console.log(`PASS ${label}`); }
async function message(threadId: number, senderId: number, at: number) {
  return storage.createMessage({ threadId, senderId, senderRole: senderId <= 2 ? "admin" : senderId === 3 ? "partner" : "student",
    senderName: "PRIVATE NAME", body: "PRIVATE CASE CONTENT", createdAt: at });
}
try {
  const thread = await storage.createThread(3, "partner", "PRIVATE PATIENT TOPIC");
  await message(thread.id, 3, now - delay + 1);
  await deliverChatReminders(now);
  check(mail.length === 0, "no email before two hours");
  failAdmin2 = true;
  await deliverChatReminders(now + 2);
  check(mail.length === 2 && mail.every(m => m.to[0].startsWith("admin")), "unanswered partner message reminds admins, not its sender");
  check(db.select().from(s.chatReminderDeliveries).all().filter(d => d.acceptedAt).length === 1, "partial admin acceptance saved independently");
  check(mail.every(m => !/PRIVATE/.test(JSON.stringify(m)) && m.from.includes("partner@maha.clinic") &&
    m.html.includes(`?thread=${thread.id}#/admin/chat`) && m.requestHeaders["Idempotency-Key"]), "private content excluded; correct sender, conversation link and idempotency");
  await message(thread.id, 3, now + 10);
  await deliverChatReminders(now + 20);
  check(mail.length === 2, "same-side follow-up neither resets clock nor duplicates accepted reminder");
  failAdmin2 = false;
  await deliverChatReminders(now + 40_000);
  check(mail.length === 3 && mail[2].to[0] === "admin2@example.invalid", "retry sends only to failed admin");
  await deliverChatReminders(now + 4 * delay);
  check(mail.length === 3, "no recurring reminders for same waiting episode");
  await message(thread.id, 1, now + 4 * delay + 1);
  await deliverChatReminders(now + 4 * delay + 2);
  check(mail.length === 3, "admin reply closes team reminder and gives partner a fresh two-hour window");
  await storage.updateThread(thread.id, { ownerLastReadAt: now + 4 * delay + 20 });
  await deliverChatReminders(now + 5 * delay + 2);
  check(mail.length === 4 && mail[3].to[0] === "partner@example.invalid" && mail[3].html.includes(`?thread=${thread.id}#/chat`),
    "read but unanswered admin message reminds only owning partner at two hours");
  await message(thread.id, 3, now + 5 * delay + 3);
  await deliverChatReminders(now + 6 * delay + 4);
  check(mail.length === 6 && mail.slice(-2).every(m => m.to[0].startsWith("admin")), "new waiting episode after reply can remind again");
  await storage.updateThread(thread.id, { archivedAt: now });

  const stale = await storage.createThread(3, "partner", "PRIVATE");
  await message(stale.id, 3, now - 3 * delay);
  failAdmin2 = true;
  await deliverChatReminders(now);
  const afterFailure = mail.length;
  await message(stale.id, 2, now + 1);
  failAdmin2 = false;
  await deliverChatReminders(now + 60_000);
  check(mail.length === afterFailure, "any admin reply cancels another admin's pending retry");
  await storage.updateThread(stale.id, { archivedAt: now });
  await deliverChatReminders(now + 10 * delay);
  check(mail.length === afterFailure, "archived conversations never remind");
  await storage.deleteThread(stale.id);
  check(!db.select().from(s.chatReminderDeliveries).all().some(d => d.threadId === stale.id), "deleted chat cleans reminder outbox");

  const deleted = await storage.createThread(3, "partner", "PRIVATE");
  const gone = await message(deleted.id, 1, now - 3 * delay);
  await storage.deleteMessage(gone.id, "QA Admin");
  await deliverChatReminders(now);
  check(mail.length === afterFailure, "deleted and empty messages excluded");
  const inactive = await storage.createThread(3, "partner", "PRIVATE");
  await message(inactive.id, 1, now - 3 * delay);
  db.update(s.users).set({ archivedAt: now }).where(eq(s.users.id, 3)).run();
  await deliverChatReminders(now);
  check(mail.length === afterFailure, "archived partner excluded");
  db.update(s.users).set({ archivedAt: null, status: "pending" }).where(eq(s.users.id, 3)).run();
  await deliverChatReminders(now);
  check(mail.length === afterFailure, "unapproved partner excluded");
  const student = await storage.createThread(4, "student", "PRIVATE");
  await message(student.id, 1, now - 3 * delay);
  await deliverChatReminders(now);
  check(mail.length === afterFailure, "no unrequested student-facing reminder");
  console.log(`ALL ${checks} CHAT REMINDER CHECKS PASSED`);
} finally { sqliteDb.close(); }
