// Only synthetic data, never loads .env or starts production schedulers.
// npx tsx script/test-admin-controls.ts [--serve] [--preview]
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import path from "node:path";
process.env.SQLITE_DB_PATH = ":memory:";
process.env.NODE_ENV = "test";
const nativeFetch = globalThis.fetch;
globalThis.fetch = ((url: any, opts?: any) => {
  if (!String(url).startsWith("http://127.0.0.1:")) throw new Error("External requests disabled in QA");
  return nativeFetch(url, opts);
}) as typeof fetch;
const { db, sqliteDb, storage } = await import("../server/storage");
const s = await import("../shared/schema");
const { eq } = await import("drizzle-orm");
const { CURRENT_LEGAL_VERSION } = await import("../shared/legalVersion");
const bcrypt = await import("bcryptjs");
const fixturePassword = await bcrypt.hash("QA-password-2026", 10);
const now = Date.now();
for (const [id, name, role] of [[1, "QA Admin", "admin"], [2, "Other Admin", "admin"], [3, "Third Admin", "admin"], [4, "QA Partner", "partner"], [5, "QA Student", "student"]] as const) {
  db.insert(s.users).values({ id, name, role, email: `qa-${id}@example.invalid`, passwordHash: fixturePassword,
    status: "approved", legalAcceptedVersion: CURRENT_LEGAL_VERSION, createdAt: now, standingPoints: 100 }).run();
  db.insert(s.sessions).values({ token: `qa-${id}`, userId: id, expiresAt: now + 100 * 86400000 }).run();
}
db.insert(s.sessions).values({ token: "qa-view-as", userId: 1, impersonatingUserId: 4, expiresAt: now + 100 * 86400000 }).run();
db.insert(s.chatThreads).values({ id: 1, userId: 4, userRole: "partner", createdAt: now }).run();
db.insert(s.chatMessages).values({ id: 1, threadId: 1, senderId: 2, senderRole: "admin", senderName: "Other Admin", body: "Original clinical note", createdAt: now }).run();
db.insert(s.adminTodos).values({ id: 1, messageId: 1, threadId: 1, createdByAdminId: 2, assignedToAdminId: 2, note: "Another admin's note", createdAt: now }).run();
db.insert(s.adminTodos).values({ id: 2, messageId: 1, threadId: 1, createdByAdminId: 1, assignedToAdminId: 1, note: "My own note", createdAt: now }).run();
db.insert(s.announcements).values([
  { id: 1, title: "My announcement", body: "Original own content", audience: "all", sentByUserId: 1, recipientCount: 0, sentAt: now },
  { id: 2, title: "Other announcement", body: "Original other content", audience: "all", sentByUserId: 2, recipientCount: 0, sentAt: now },
]).run();
db.insert(s.orders).values([{ id: 1, partnerId: 4, createdAt: now }, { id: 2, partnerId: 4, createdAt: now }]).run();
db.insert(s.orderItems).values([{ orderId: 1, productId: 1, quantity: 2, unitPriceAtOrder: 1000 }, { orderId: 2, productId: 1, quantity: 3, unitPriceAtOrder: 1000 }]).run();
db.insert(s.modules).values([{ id: 1, name: "QA Module", description: "Training module" }, { id: 2, name: "Keep Module" }]).run();
db.insert(s.cohorts).values([{ id: 1, moduleId: 1, name: "QA Cohort" }, { id: 2, moduleId: 2, name: "Keep Cohort" }]).run();
db.insert(s.classSessions).values([{ id: 1, cohortId: 1, title: "QA Class", datetime: now, zoomLink: "https://example.invalid/meeting" }, { id: 2, cohortId: 2, title: "Keep Class", datetime: now, zoomLink: "https://example.invalid/meeting" }]).run();
db.insert(s.cohortEnrollments).values([{ id: 1, cohortId: 1, studentId: 5 }, { id: 2, cohortId: 2, studentId: 5 }]).run();
db.insert(s.homeworkSubmissions).values([{ id: 1, studentId: 5, classSessionId: 1, fileUrl: "/api/files/qa-file", fileType: "pdf", createdAt: now }, { id: 2, studentId: 5, classSessionId: 2, fileUrl: "/api/files/qa-other", fileType: "pdf", createdAt: now }]).run();
db.insert(s.coursePurchases).values({ id: 1, courseId: 1, userId: 4, amountCents: 500, status: "completed", stripeSessionId: "qa-not-real", createdAt: now }).run();
db.insert(s.staffRoomMessages).values({ id: 1, senderId: 2, senderName: "Other Admin", body: "Keep authorship", createdAt: now }).run();
db.insert(s.staffDmThreads).values({ id: 1, adminAId: 1, adminBId: 2, pairKey: "1:2", createdAt: now }).run();
db.insert(s.staffDmMessages).values({ id: 1, threadId: 1, senderId: 2, senderName: "Other Admin", body: "Private message", createdAt: now }).run();
const clinic = await storage.findOrCreateClinicByName("QA Clinic");
db.update(s.users).set({ clinicId: clinic.id }).where(eq(s.users.id, 4)).run();
db.insert(s.products).values({ id: 1, name: "QA Product", description: "Synthetic product for launch checks", unitPrice: 1000, weightGrams: 100 }).run();
db.insert(s.priceTiers).values({ productId: 1, minQty: 5, maxQty: null, pricePerUnit: 800 }).run();
db.insert(s.courses).values([
  { id: 1, name: "QA Open Course", accessType: "open" },
  { id: 2, name: "QA Free Enrollment", accessType: "enroll" },
  { id: 3, name: "QA Paid Course", accessType: "paid", priceCents: 1000 },
]).run();
db.insert(s.videos).values({ title: "QA Lesson", category: "QA Open Course", courseId: 1, url: "https://example.invalid/qa-lesson.mp4" }).run();

const { registerRoutes } = await import("../server/routes");
const app = express();
app.use(express.json());
const server = createServer(app);
if (process.argv.includes("--preview")) {
  // This path is exclusively for the private fixture preview, not production.
  app.use((_req, res, next) => { res.setHeader("Set-Cookie", "__Host-sid=qa-1; Path=/; HttpOnly; Secure; SameSite=None"); next(); });
  app.use((req, _res, next) => { req.headers.cookie = "sid=qa-1"; next(); });
}
app.get("/api/admin/backups/status", (_req, res) => res.json({ lastBackupAt: null, totalBackups: 0 }));
await registerRoutes(server, app);
app.use(express.static(path.resolve("dist/public")));
app.use("/{*path}", (_req, res) => res.sendFile(path.resolve("dist/public/index.html")));
app.use((err: any, _req: any, res: any, _next: any) => res.status(err.status || 500).json({ message: err.message }));
const serve = process.argv.includes("--serve");
await new Promise<void>(resolve => server.listen(serve ? Number(process.env.QA_PORT || 5058) : 0, "0.0.0.0", resolve));
if (serve) {
  console.log("QA fixture server listening on 5058; synthetic data only.");
} else {
  const port = (server.address() as any).port;
  let checks = 0;
  async function request(method: string, url: string, expected: number, body?: any, token: string | null = "qa-1") {
    const response = await nativeFetch(`http://127.0.0.1:${port}${url}`, { method, headers: { ...(token ? { cookie: `sid=${token}` } : {}), "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    const result = await response.json();
    assert.equal(response.status, expected, `${method} ${url}: ${JSON.stringify(result)}`);
    checks++;
    return result;
  }
  const url = (kind: string, id = 1) => `/api/admin/record-controls/${kind}/${id}`;
  try {
    for (const method of ["GET", "PATCH", "DELETE"]) {
      await request(method, url("order"), 401, method === "GET" ? undefined : {}, null);
      for (const token of ["qa-4", "qa-5", "qa-view-as"]) await request(method, url("order"), 403, method === "GET" ? undefined : {}, token);
    }
    await request("GET", url("users"), 400);
    await request("GET", "/api/admin/record-controls/order/nope", 400);
    await request("GET", url("order", 99999), 404);
    await request("GET", "/api/health", 200, undefined, null);
    await request("GET", "/api/class-sessions", 403, undefined, "qa-4");
    await request("GET", "/api/class-sessions", 403, undefined, "qa-5");
    await request("GET", "/api/students/my-classes", 403, undefined, "qa-4");
    const classes = await request("GET", "/api/students/my-classes", 200, undefined, "qa-5");
    assert.equal(classes.length, 2);
    await request("GET", "/api/chat/threads/1/messages", 404, undefined, "qa-5");
    const courses = await request("GET", "/api/courses", 200, undefined, "qa-4");
    assert.ok(courses.every((c: any) => c.lessons.every((v: any) => !("url" in v))));
    assert.equal(courses.find((c: any) => c.id === 3).hasAccess, false);
    await request("POST", "/api/courses/3/enroll", 400, {}, "qa-4");
    await request("POST", "/api/courses/2/enroll", 200, {}, "qa-4");
    assert.equal((await request("GET", "/api/courses", 200, undefined, "qa-4")).find((c: any) => c.id === 2).hasAccess, true);
    await request("POST", "/api/courses/3/checkout", 503, {}, "qa-4");
    // Chat identity must come from the session, never the submitted payload.
    const chat = await request("POST", "/api/chat/threads", 200, { topic: "QA conversation" }, "qa-4");
    await request("POST", `/api/chat/threads/${chat.id}/messages`, 400, { body: " " }, "qa-4");
    const message = await request("POST", `/api/chat/threads/${chat.id}/messages`, 200, { body: "QA original", senderId: 1, senderRole: "admin" }, "qa-4");
    assert.equal(message.senderId, 4);
    await request("GET", `/api/chat/threads/${chat.id}/messages`, 404, undefined, "qa-5");
    await request("PATCH", `/api/admin/chat/messages/${message.id}`, 403, { body: "Not allowed" });
    await request("DELETE", `/api/admin/chat/messages/${message.id}`, 200);
    const redacted = await request("GET", `/api/chat/threads/${chat.id}/messages`, 200, undefined, "qa-4");
    assert.ok(!JSON.stringify(redacted).includes("QA original"));
    await request("PATCH", "/api/admin/community/enabled", 200, { enabled: true });
    const community = await request("POST", "/api/community/topics", 201, { title: "QA community", body: "QA public post" }, "qa-4");
    await request("GET", `/api/community/topics/${community.topic.id}/messages`, 200, undefined, "qa-5");
    await request("DELETE", `/api/admin/community/messages/${community.firstMessage.id}`, 200);
    await request("DELETE", `/api/admin/community/topics/${community.topic.id}`, 200);
    const event = await request("POST", "/api/admin/case-discussions", 200, { topic: "Synthetic QA event", scheduledAt: now + 86400000, zoomLink: "https://example.invalid/qa" });
    await request("POST", `/api/case-discussions/${event.id}/rsvp`, 200, {}, "qa-4");
    await request("POST", `/api/case-discussions/${event.id}/rsvp`, 200, {}, "qa-4");
    assert.equal((await request("GET", `/api/admin/case-discussions/${event.id}/attendees`, 200)).length, 1);
    await request("DELETE", `/api/case-discussions/${event.id}/rsvp`, 200, undefined, "qa-4");
    await request("DELETE", `/api/admin/case-discussions/${event.id}`, 200);
    const homework = { classSessionId: 2, fileUrl: "/api/files/synthetic", fileType: "pdf", comment: "QA homework" };
    await request("POST", "/api/homework", 403, homework, "qa-4");
    await request("POST", "/api/homework", 403, { ...homework, classSessionId: 99999 }, "qa-5");
    const submittedHomework = await request("POST", "/api/homework", 200, { ...homework, studentId: 4 }, "qa-5");
    assert.equal(submittedHomework.studentId, 5);
    // Launch regressions. All outbound mail is intercepted, never delivered.
    const registration = { role: "partner", firstName: "New", lastName: "Partner", email: "  New.Partner@EXAMPLE.invalid  ",
      password: "QA-password-2026", username: "new-partner", phone: "+431234567", businessName: "QA New Clinic", acceptedLegal: true };
    await request("POST", "/api/auth/register", 400, { ...registration, acceptedLegal: false }, null);
    const registered = await request("POST", "/api/auth/register", 200, registration, null);
    const applicant = await storage.getUser(registered.id);
    assert.equal(applicant?.email, "new.partner@example.invalid");
    assert.equal(applicant?.approvalEmailNotified, false);
    assert.equal(applicant?.status, "pending");
    assert.ok(applicant?.clinicId);
    await request("POST", "/api/auth/login", 403, { email: registration.email, password: registration.password }, null);
    await request("POST", "/api/auth/register", 400, registration, null);
    await request("POST", "/api/auth/register", 400, { ...registration, email: "different@example.invalid", username: "NEW-PARTNER" }, null);
    const { retryRegistrationAlerts } = await import("../server/notificationScheduler");
    let capturedEmails: any[] = [];
    globalThis.fetch = (async (input: any, init: any) => {
      if (String(input).includes("api.resend.com/emails")) {
        capturedEmails.push(JSON.parse(init.body));
        return new Response(JSON.stringify({ id: "qa-delivery-no-email-sent" }), { status: 200 });
      }
      throw new Error("External request disabled in QA");
    }) as typeof fetch;
    await retryRegistrationAlerts(storage);
    assert.equal((await storage.getUser(registered.id))?.approvalEmailNotified, true);
    assert.equal(capturedEmails.length, 1);
    await retryRegistrationAlerts(storage);
    assert.equal(capturedEmails.length, 1);
    await request("PATCH", `/api/admin/users/${registered.id}/status`, 200, { status: "approved" });
    assert.match(capturedEmails.at(-1).subject, /approved/);
    await request("POST", "/api/auth/login", 200, { email: "NEW.PARTNER@example.invalid", password: registration.password }, null);
    await request("POST", "/api/auth/login", 401, { email: registration.email, password: "wrong" }, null);
    await request("POST", "/api/auth/forgot-password", 200, { email: registration.email }, null);
    const resetUser = (await storage.getUser(registered.id))!;
    assert.match(capturedEmails.at(-1).subject, /Reset/);
    await request("POST", "/api/auth/reset-password", 200, { token: resetUser.passwordResetToken, newPassword: "New-password-2026" }, null);
    await request("POST", "/api/auth/reset-password", 400, { token: resetUser.passwordResetToken, newPassword: "New-password-2026" }, null);
    await request("POST", "/api/auth/login", 401, { email: registration.email, password: registration.password }, null);
    await request("POST", "/api/auth/login", 200, { email: registration.email, password: "New-password-2026" }, null);
    const referralBody = { patientFirstName: "QA", patientLastName: "Patient", patientContact: "Synthetic", caseDescription: "Synthetic case", patientConsentAttested: true };
    const beforeReferrals = (await storage.listAllReferrals()).length;
    await request("POST", "/api/referrals", 400, { ...referralBody, patientConsentAttested: false }, "qa-4");
    await request("POST", "/api/referrals", 403, { ...referralBody, linkThreadId: 99999 }, "qa-4");
    await request("POST", "/api/referrals", 400, { ...referralBody, caseDescription: " " }, "qa-4");
    assert.equal((await storage.listAllReferrals()).length, beforeReferrals);
    sqliteDb.exec("CREATE TRIGGER qa_referral_rollback BEFORE INSERT ON chat_threads BEGIN SELECT RAISE(ABORT, 'qa rollback'); END");
    await request("POST", "/api/referrals", 500, referralBody, "qa-4");
    assert.equal((await storage.listAllReferrals()).length, beforeReferrals);
    sqliteDb.exec("DROP TRIGGER qa_referral_rollback");
    const newReferral = await request("POST", "/api/referrals", 200, referralBody, "qa-4");
    assert.equal((await storage.getThread(newReferral.chatThreadId))?.referralId, newReferral.id);
    await request("POST", "/api/referrals", 400, { ...referralBody, linkThreadId: newReferral.chatThreadId }, "qa-4");
    assert.equal((await storage.listAllReferrals()).length, beforeReferrals + 1);
    const studentReferrals = await request("GET", "/api/referrals/mine", 200, undefined, "qa-5");
    assert.equal(studentReferrals.some((r: any) => r.id === newReferral.id), false);
    const beforeOrders = (await storage.listAllOrders()).length;
    await request("POST", "/api/orders", 400, { items: [{ productId: 1, quantity: 1.5 }], destinationCountry: "AT" }, "qa-4");
    await request("POST", "/api/orders", 400, { items: [{ productId: 1, quantity: 1 }], destinationCountry: "ZZ" }, "qa-4");
    await request("POST", "/api/orders", 400, { items: [{ productId: 999999, quantity: 1 }], destinationCountry: "AT" }, "qa-4");
    assert.equal((await storage.listAllOrders()).length, beforeOrders);
    sqliteDb.exec("CREATE TRIGGER qa_items_rollback BEFORE INSERT ON order_items BEGIN SELECT RAISE(ABORT, 'qa rollback'); END");
    await request("POST", "/api/orders", 500, { items: [{ productId: 1, quantity: 1 }], destinationCountry: "AT" }, "qa-4");
    assert.equal((await storage.listAllOrders()).length, beforeOrders);
    sqliteDb.exec("DROP TRIGGER qa_items_rollback");
    const newOrder = await request("POST", "/api/orders", 200, { items: [{ productId: 1, quantity: 2 }, { productId: 1, quantity: 3 }], destinationCountry: "AT" }, "qa-4");
    const newItems = await storage.listItemsForOrder(newOrder.id);
    assert.equal(newItems.length, 1);
    assert.equal(newItems[0].quantity, 5);
    assert.equal(newItems[0].unitPriceAtOrder, 800);
    // Order changes must use the existing workflow (points and notifications),
    // never the generic record editor.
    await request("PATCH", url("order"), 403, { status: "Confirmed" });
    await request("PATCH", "/api/admin/orders/1/status", 400, { status: "invalid" });
    await request("PATCH", "/api/admin/orders/1/status", 200, { status: "Confirmed" });
    // Let the existing asynchronous points award finish before checking that
    // deletion itself does not change the member's points or profile.
    await new Promise(resolve => setImmediate(resolve));
    const originalPartner = await storage.getUser(4);
    await request("DELETE", url("order"), 400, { confirmation: "DELETE 2" });
    sqliteDb.exec("CREATE TRIGGER qa_order_rollback BEFORE DELETE ON orders BEGIN SELECT RAISE(ABORT, 'qa rollback'); END");
    await request("DELETE", url("order"), 500, { confirmation: "DELETE 1" });
    assert.equal(db.select().from(s.orderItems).where(eq(s.orderItems.orderId, 1)).all().length, 1);
    sqliteDb.exec("DROP TRIGGER qa_order_rollback");
    await request("DELETE", url("order"), 200, { confirmation: "DELETE 1" });
    assert.equal(db.select().from(s.orderItems).where(eq(s.orderItems.orderId, 1)).all().length, 0);
    assert.equal(db.select().from(s.orderItems).where(eq(s.orderItems.orderId, 2)).all().length, 1);
    assert.deepEqual(await storage.getUser(4), originalPartner);
    const otherTodo = await request("GET", url("todo"), 200);
    assert.equal(otherTodo.canEditText, false);
    assert.equal("note" in otherTodo.values, false);
    await request("PATCH", url("todo"), 403, { status: "open", assignedToAdminId: 1, note: "forged" });
    await request("PATCH", url("todo"), 400, { status: "open", assignedToAdminId: 4 });
    await request("DELETE", url("admin-account", 2), 409, { confirmation: "DELETE 2" });
    await request("PATCH", url("admin-account", 2), 409, { archived: true });
    await request("PATCH", url("todo"), 200, { status: "done", assignedToAdminId: 1 });
    assert.equal((await storage.getAdminTodo(1))?.note, "Another admin's note");
    await request("PATCH", url("todo", 2), 200, { status: "open", assignedToAdminId: 1, note: "Edited own note" });
    await request("PATCH", url("announcement", 2), 403, { title: "Forged", body: "forged", url: null });
    await request("PATCH", url("announcement"), 400, { title: "Valid", body: "Valid", url: "javascript:alert(1)" });
    await request("PATCH", url("announcement"), 200, { title: "Updated", body: "Edited by author", url: "https://example.invalid" });
    await request("DELETE", url("announcement", 2), 200, { confirmation: "DELETE 2" });
    await request("PATCH", "/api/admin/staff-chat/room/messages/1", 403, { body: "Forged" });
    await request("DELETE", "/api/admin/staff-chat/room/messages/1", 200);
    assert.equal((await storage.getStaffRoomMessage(1))?.senderId, 2);
    await request("DELETE", "/api/admin/staff-chat/dm/messages/1", 403, undefined, "qa-3");
    await request("PATCH", "/api/admin/staff-chat/dm/messages/1", 403, { body: "Forged" });
    await request("DELETE", "/api/admin/staff-chat/dm/messages/1", 200);
    await request("PATCH", url("cohort"), 400, { name: "QA", moduleId: 9999 });
    await request("PATCH", url("enrollment"), 409, { cohortId: 2 });
    await request("PATCH", url("class-session"), 200, { title: "Updated class", cohortId: 1, datetime: now + 86400000, zoomLink: "https://example.invalid/updated", notes: "Session details" });
    await request("PATCH", url("homework"), 403, { comment: "Forged" });
    const impact = await request("GET", url("module"), 200);
    assert.match(impact.impact, /1 cohorts.*1 class sessions and 1 enrollments.*1 homework/);
    await request("DELETE", "/api/admin/modules/1", 400);
    sqliteDb.exec("CREATE TRIGGER qa_module_rollback BEFORE DELETE ON modules BEGIN SELECT RAISE(ABORT, 'qa rollback'); END");
    await request("DELETE", url("module"), 500, { confirmation: "DELETE 1" });
    assert.ok(db.select().from(s.homeworkSubmissions).where(eq(s.homeworkSubmissions.id, 1)).get());
    sqliteDb.exec("DROP TRIGGER qa_module_rollback");
    await request("DELETE", url("module"), 200, { confirmation: "DELETE 1" });
    for (const table of [s.modules, s.cohorts, s.classSessions, s.cohortEnrollments, s.homeworkSubmissions]) {
      assert.equal(db.select().from(table).where(eq(table.id, 1)).get(), undefined);
      assert.ok(db.select().from(table).where(eq(table.id, 2)).get());
    }
    assert.ok(await storage.getUser(5));
    await request("DELETE", url("course-purchase"), 200, { confirmation: "DELETE 1" });
    await request("PATCH", url("admin-account", 1), 403, { archived: true });
    await request("DELETE", url("admin-account", 1), 409, { confirmation: "DELETE 1" });
    await request("PATCH", "/api/admin/users/1/status", 400, { status: "rejected" });
    await request("PATCH", url("admin-account", 2), 400, { archived: true, role: "partner" });
    await request("PATCH", url("admin-account", 2), 200, { archived: true });
    assert.equal(await storage.getSession("qa-2"), undefined);
    await request("GET", url("order", 2), 401, undefined, "qa-2");
    assert.ok(!(await storage.listAdmins()).some(u => u.id === 2));
    const team = await request("GET", "/api/admin/team", 200);
    assert.ok(team.find((u: any) => u.id === 2)?.archivedAt);
    assert.ok(team.every((u: any) => !("passwordHash" in u) && !("migratedPasswordPlain" in u)));
    await request("PATCH", url("admin-account", 2), 200, { archived: false });
    await request("DELETE", url("admin-account", 2), 200, { confirmation: "DELETE 2" });
    assert.equal(await storage.getUser(2), undefined);
    assert.equal((await storage.getMessage(1))?.body, "Original clinical note");
    await request("DELETE", url("todo"), 200, { confirmation: "DELETE 1" });
    assert.ok(await storage.getMessage(1));
    db.update(s.users).set({ archivedAt: now }).where(eq(s.users.id, 3)).run();
    const last = await request("GET", url("admin-account", 1), 200);
    assert.equal(last.canDelete, false);
    assert.match(last.blockedReason, /last active admin/);
    const audit = db.select().from(s.adminRecordAudit).all();
    assert.ok(audit.length >= 12);
    assert.ok(audit.every(row => row.actorId === 1 && row.actorName === "QA Admin"));
    assert.ok(!JSON.stringify(audit).includes("Original clinical note"));
    console.log(`PASS: ${checks} API checks plus atomic rollback, isolation, authorship, account/session, audit and cascade assertions.`);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    sqliteDb.close();
  }
}
