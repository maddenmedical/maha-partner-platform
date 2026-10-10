// Isolated regression suite / visual fixture. Never uses real accounts,
// production DB, provider credentials, or external delivery.
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import path from "node:path";
import vm from "node:vm";
import { readFileSync } from "node:fs";
process.env.SQLITE_DB_PATH = ":memory:";
process.env.NODE_ENV = "test";
process.env.RESEND_API_KEY = "fixture-not-a-key";
process.env.EMAIL_FROM_ADDRESS = "MAHA Partner Platform <partner@maha.clinic>";
delete process.env.CUSTOM_CRED_API_RESEND_COM_URL;
delete process.env.CUSTOM_CRED_API_RESEND_COM_TOKEN;
const nativeFetch = globalThis.fetch;
let failSecond = true;
let failExtraDevice = false;
const mail: any[] = [];
const pushes: any[] = [];
globalThis.fetch = (async (url: any, opts?: any) => {
  if (String(url) === "https://api.resend.com/emails") {
    const payload = JSON.parse(opts.body);
    mail.push({ ...payload, requestHeaders: opts.headers });
    return new Response("{}", { status: failSecond && payload.to[0] === "qa-2@example.invalid" ? 503 : 200 });
  }
  if (String(url).startsWith("http://127.0.0.1:")) return nativeFetch(url, opts);
  throw new Error("External requests disabled in notification QA");
}) as typeof fetch;
const webpush = (await import("web-push")).default;
const keys = webpush.generateVAPIDKeys();
process.env.VAPID_PUBLIC_KEY = keys.publicKey;
process.env.VAPID_PRIVATE_KEY = keys.privateKey;
webpush.sendNotification = (async (sub: any, body: any, opts: any) => {
  pushes.push({ sub, payload: JSON.parse(body), opts });
  if (failExtraDevice && sub.endpoint.endsWith("/extra")) throw Object.assign(new Error("Fixture push failure"), { statusCode: 503 });
  return { statusCode: 201, body: "", headers: {} };
}) as any;
const { db, sqliteDb, storage } = await import("../server/storage");
const s = await import("../shared/schema");
const { eq } = await import("drizzle-orm");
const { addNotice, notificationSummary, readNotices, readReferralNotice } = await import("../server/notificationStore");
const { queueReferralAlerts, deliverReferralAlerts } = await import("../server/referralAlerts");
const { notifyUsers } = await import("../server/push");
const { CURRENT_LEGAL_VERSION } = await import("../shared/legalVersion");
const now = Date.now();
for (const [id, role] of [[1, "admin"], [2, "admin"], [3, "partner"]] as const) {
  db.insert(s.users).values({ id, role, name: `Dr. QA ${id}`, email: `qa-${id}@example.invalid`,
    passwordHash: "not-used", status: "approved", createdAt: now, legalAcceptedVersion: CURRENT_LEGAL_VERSION,
    pushNudgeLastPromptedAt: now, installBannerDismissedAt: now }).run();
  db.insert(s.sessions).values({ token: `qa-${id}`, userId: id, expiresAt: now + 86400000 }).run();
  db.insert(s.pushSubscriptions).values({ userId: id, endpoint: `https://push.example.invalid/${id}`, p256dh: "mock", auth: "mock", createdAt: now }).run();
}
const ref = await storage.createReferralWithThread({ partnerId: 3, patientFirstName: "Synthetic",
  patientLastName: "Private", patientContact: "private-contact", caseDescription: "private-case",
  urgency: "Urgent", createdAt: now, patientConsentAttestedAt: now }, "partner");
await queueReferralAlerts(ref);
addNotice({ id: "ordinary", userId: 1, category: "community", title: "New community activity",
  body: "Open the community to review the discussion.", url: "/#/admin/community", createdAt: now });
const { registerRoutes } = await import("../server/routes");
const app = express();
app.use(express.json());
if (process.argv.includes("--preview")) app.use((req, _res, next) => { req.headers.cookie = "sid=qa-1"; next(); });
const server = createServer(app);
await registerRoutes(server, app);
app.use(express.static(path.resolve("dist/public")));
app.use("/{*path}", (_req, res) => res.sendFile(path.resolve("dist/public/index.html")));
app.use((err: any, _req: any, res: any, _next: any) => res.status(err.status || 500).json({ message: err.message }));
const serve = process.argv.includes("--serve");
await new Promise<void>(r => server.listen(serve ? Number(process.env.QA_PORT || 5062) : 0, "0.0.0.0", r));
if (serve) console.log(`Notification QA on ${process.env.QA_PORT || 5062}. Synthetic data; all outgoing messages intercepted.`);
else {
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  let checks = 0;
  function check(value: any, label: string) { assert.ok(value, label); checks++; console.log(`PASS ${label}`); }
  async function api(method: string, url: string, token = "qa-1", body?: any) {
    return nativeFetch(base + url, { method, headers: { cookie: `sid=${token}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body) });
  }
  try {
    await queueReferralAlerts(ref);
    check(notificationSummary(1).count === 2 && notificationSummary(2).count === 1, "queue deduplicated, counts per user");
    check((await (await api("GET", "/api/auth/me")).json()).notifyEnhancedVisibility === true,
      "enhanced visibility defaults on");
    check((await api("PATCH", "/api/notifications/preferences", "none", { category: "visibility", enabled: false })).status === 401,
      "visibility preference requires authentication");
    check((await api("PATCH", "/api/notifications/preferences", "qa-1", { category: "visibility", enabled: "false" })).status === 400,
      "visibility preference rejects non-boolean input");
    check((await api("PATCH", "/api/notifications/preferences", "qa-1", { category: "visibility", enabled: false, userId: 2 })).status === 400,
      "visibility preference rejects cross-account payload");
    await api("PATCH", "/api/notifications/preferences", "qa-1", { category: "visibility", enabled: false });
    check((await (await api("GET", "/api/auth/me")).json()).notifyEnhancedVisibility === false &&
      (await storage.getUser(2))!.notifyEnhancedVisibility === true, "visibility preference persisted only for own account");
    check(notificationSummary(1).count === 2 && notificationSummary(1).criticalCount === 1,
      "turning enhanced visibility off preserves unread and critical ledger");
    check((await api("GET", "/api/notifications", "none")).status === 401, "unauthenticated count denied");
    check((await api("POST", `/api/admin/referrals/${ref.id}/seen`, "qa-3", {})).status === 403, "partner cannot acknowledge admin referral");
    check((await api("POST", "/api/notifications/read", "qa-1", { ids: [42] })).status === 400, "malformed read rejected");
    await api("POST", "/api/notifications/read", "qa-2", { ids: ["ordinary"] });
    check(notificationSummary(1).count === 2, "other user cannot clear my notice");
    await api("GET", "/api/notifications");
    check(notificationSummary(1).count === 2, "opening app does not clear counts");
    await api("POST", "/api/notifications/read", "qa-1", { ids: [`referral:${ref.id}:1`] });
    check(notificationSummary(1).criticalCount === 1, "critical notice cannot be bulk/explicitly dismissed in generic inbox");
    await deliverReferralAlerts();
    check(mail.length === 4, "one email per eligible admin and shared mailbox");
    check(!(await storage.getReferral(ref.id))!.emailNotified, "failed individual admin not hidden by shared-mailbox success");
    check(db.select().from(s.referralEmailDeliveries).all().filter(d => !!d.acceptedAt).length === 3, "successful recipients recorded independently");
    check(mail.every(m => !/Synthetic|Private|private-contact|private-case/.test(JSON.stringify(m))), "referral emails contain no patient details");
    check(mail.every(m => m.from.includes("partner@maha.clinic") && m.headers.Importance === "high" && m.requestHeaders["Idempotency-Key"]), "sender, priority and provider idempotency header");
    check(pushes.length === 2 && pushes.every(p => p.payload.requireInteraction && p.opts.urgency === "high"), "visible high-priority push for each admin");
    check((await storage.getUser(1))!.notifyEnhancedVisibility === false,
      "critical referral push remains high priority even with enhanced visibility off");
    check(pushes.find(p => p.sub.endpoint.endsWith("/1")).payload.badgeCount === 2, "push includes absolute ledger count");
    await deliverReferralAlerts();
    check(mail.length === 4 && pushes.length === 2, "retry backoff and successful push deduplication");
    db.update(s.referralEmailDeliveries).set({ nextAttemptAt: 0 }).run();
    failSecond = false;
    await deliverReferralAlerts();
    check(mail.length === 5 && mail[4].to[0] === "qa-2@example.invalid", "only failed recipient retried");
    check((await storage.getReferral(ref.id))!.emailNotified, "referral marked notified only after every recipient accepted");
    await api("POST", "/api/notifications/read", "qa-1", {});
    check(notificationSummary(1).count === 1, "mark ordinary read preserves referral");
    await api("POST", `/api/admin/referrals/${ref.id}/seen`, "qa-1", {});
    check(notificationSummary(1).count === 0 && notificationSummary(2).count === 1, "opening detail clears only reviewing admin");
    await queueReferralAlerts(ref);
    check(notificationSummary(1).count === 0, "retry never resurrects read referral");
    for (const style of ["preview", "alert", "silent"]) {
      db.update(s.users).set({ notifyChatStyle: style, notifyChatEnabled: true }).where(eq(s.users.id, 3)).run();
      await notifyUsers([3, 3], "chat", { genericTitle: "New message", genericBody: "Sign in to view", previewTitle: "Example", previewBody: "Example", url: "/#/chat" });
    }
    check(notificationSummary(3).count === 3, "all notification styles count and duplicate recipient IDs collapse");
    check(pushes.slice(-3).map(p => p.payload.badgeCount).join(",") === "1,2,3", "all push styles carry badge counts");
    check(pushes.slice(-3).map(p => p.payload.requireInteraction).join(",") === "true,true,false",
      "preview and alert request persistence; Quiet preference preserved");
    db.delete(s.pushSubscriptions).where(eq(s.pushSubscriptions.userId, 3)).run();
    await notifyUsers([3], "chat", { genericTitle: "New message", genericBody: "Sign in", previewTitle: "", previewBody: "" });
    check(notificationSummary(3).count === 4, "in-app notices work without push subscription");
    db.update(s.users).set({ notifyChatEnabled: false }).where(eq(s.users.id, 3)).run();
    await notifyUsers([3], "chat", { genericTitle: "New message", genericBody: "", previewTitle: "", previewBody: "" });
    check(notificationSummary(3).count === 4, "disabled category respected");
    await storage.setReferralArchived(ref.id, true);
    check(notificationSummary(2).count === 0, "archiving removes stale critical alert");
    await storage.deleteReferral(ref.id);
    check(db.select().from(s.referralEmailDeliveries).all().length === 0, "deleting cleans delivery outbox");
    const second = await storage.createReferral({ partnerId: 3, patientFirstName: "Synthetic", patientLastName: "Private",
      patientContact: "private-contact", caseDescription: "private-case", createdAt: now });
    db.insert(s.pushSubscriptions).values({ userId: 1, endpoint: "https://push.example.invalid/extra", p256dh: "mock", auth: "mock", createdAt: now }).run();
    failExtraDevice = true;
    await deliverReferralAlerts();
    const pushCount = pushes.length;
    failExtraDevice = false;
    await deliverReferralAlerts();
    check(pushes.length === pushCount + 1 && pushes[pushes.length - 1].sub.endpoint.endsWith("/extra"),
      "only failed device retried; successful devices not alerted again");
    await storage.deleteReferral(second.id);
    const historic = await storage.createReferral({ partnerId: 3, patientFirstName: "Old", patientLastName: "Synthetic",
      patientContact: "private", caseDescription: "private", createdAt: now - 86400000 });
    await storage.markReferralsNotified([historic.id], now - 80000000);
    const beforeBackfill = { mail: mail.length, push: pushes.length };
    await deliverReferralAlerts();
    check(notificationSummary(1).criticalCount === 1 && mail.length === beforeBackfill.mail && pushes.length === beforeBackfill.push,
      "existing New referrals backfilled in-app only, no historical email/push replay");
    readReferralNotice(1, historic.id);
    await deliverReferralAlerts();
    check(notificationSummary(1).criticalCount === 0, "historical backfill never resurrects reviewed notices");
    await storage.deleteReferral(historic.id);
    const chat = await storage.createThread(3, "partner", "Fixture chat");
    const msg = await storage.createMessage({ threadId: chat.id, senderId: 3, senderRole: "partner",
      senderName: "Fixture", body: "Synthetic only", createdAt: now });
    for (const userId of [1, 2]) addNotice({ id: `chat-test-${userId}`, userId, category: "chat",
      threadId: chat.id, messageId: msg.id, title: "New message", body: "Sign in", url: "/#/admin/chat", createdAt: now });
    await api("GET", `/api/admin/chat/threads/${chat.id}/messages`, "qa-1");
    check(!notificationSummary(1).items.some(n => n.id === "chat-test-1") &&
      notificationSummary(2).items.some(n => n.id === "chat-test-2"),
      "reading real chat messages clears only that viewer's matching app notices");
    await storage.deleteThread(chat.id);
    check(!notificationSummary(2).items.some(n => n.id === "chat-test-2"), "deleting chat removes orphan notification");

    // Browser worker contract, including offline fallback and zero.
    for (const [style, count, offline] of [["preview", 3, false], ["alert", 0, false], ["silent", 8, true]] as const) {
      const handlers: any = {}, badges: number[] = [], shown: any[] = [];
      const self = { navigator: { setAppBadge: async (n: number) => { badges.push(n); } },
        registration: { scope: "https://example.invalid/", showNotification: async (...v: any[]) => { shown.push(v); } },
        location: { origin: "https://example.invalid" },
        clients: { matchAll: async () => [] }, addEventListener: (name: string, fn: any) => { handlers[name] = fn; } };
      vm.runInNewContext(readFileSync("client/public/sw.js", "utf8"), { self, URL, AbortController, setTimeout, clearTimeout,
        fetch: async () => { if (offline) throw new Error("offline"); return { ok: true, json: async () => ({ count }) }; } });
      let pending: any;
      handlers.push({ data: { json: () => ({ title: "MAHA", body: "Review", badgeCount: 8, silent: style === "silent" }) },
        waitUntil: (p: any) => { pending = p; } });
      await pending;
      check(badges[0] === count && shown.length === 1, `service worker ${style}: navigator badge, visible alert, zero/offline handling`);
    }
    // Firefox/Android capability fallback: no Badging API, but visible pushes
    // must still work. Retention never forces Quiet alerts to vibrate.
    for (const style of ["referral", "chat", "quiet"]) {
      const handlers: any = {}, shown: any[] = [];
      let closed = 0, destination = "", pending: any;
      const client = { url: "https://example.invalid/", postMessage() {},
        async navigate(url: string) { destination = url; }, async focus() {} };
      const self = { navigator: {}, location: { origin: "https://example.invalid" },
        registration: { scope: "https://example.invalid/", showNotification: async (...v: any[]) => { shown.push(v); } },
        clients: { claim: async () => {}, matchAll: async () => [client] },
        addEventListener: (name: string, fn: any) => { handlers[name] = fn; } };
      vm.runInNewContext(readFileSync("client/public/sw.js", "utf8"), {
        self, URL, AbortController, setTimeout, clearTimeout,
        fetch: async () => ({ ok: true, json: async () => ({ count: 4 }) }),
      });
      handlers.push({ data: { json: () => ({ title: "MAHA", tag: style,
        requireInteraction: style !== "quiet", priority: style === "referral" ? "high" : "normal",
        silent: style === "quiet", url: "/?thread=1#/chat" }) }, waitUntil: (p: any) => { pending = p; } });
      await pending;
      check(shown.length === 1 && !!shown[0][1].vibrate === (style === "referral"),
        `Android fallback ${style}: no badge API required; only priority referrals request vibration`);
      handlers.activate({ waitUntil: (p: any) => { pending = p; } }); await pending;
      check(closed === 0 && !handlers.notificationclose, `Android fallback ${style}: activation and swipe do not mark read`);
      handlers.notificationclick({ notification: { data: shown[0][1].data, close() { closed++; } },
        waitUntil: (p: any) => { pending = p; } }); await pending;
      check(closed === 1 && destination === "https://example.invalid/?thread=1#/chat",
        `Android fallback ${style}: tap closes only tapped notification and opens destination`);
    }
    await api("PATCH", "/api/notifications/preferences", "qa-3", { category: "visibility", enabled: false });
    db.update(s.users).set({ notifyChatEnabled: true, notifyChatStyle: "alert" }).where(eq(s.users.id, 3)).run();
    db.insert(s.pushSubscriptions).values({ userId: 3, endpoint: "https://push.example.invalid/3-new", p256dh: "mock", auth: "mock", createdAt: now }).run();
    await notifyUsers([3], "chat", { genericTitle: "New message", genericBody: "Sign in", previewTitle: "", previewBody: "" });
    check(pushes.at(-1).payload.requireInteraction === false, "enhanced visibility off stops ordinary push retention request");
    const restored = await api("PATCH", "/api/notifications/preferences", "qa-3", { category: "visibility", enabled: true });
    check((await restored.json()).notifyEnhancedVisibility === true, "partner can re-enable enhanced visibility");
    await notifyUsers([3], "chat", { genericTitle: "New message", genericBody: "Sign in", previewTitle: "", previewBody: "" });
    check(pushes.at(-1).payload.requireInteraction === true, "re-enabled enhanced visibility requests ordinary push retention");
    console.log(`ALL ${checks} NOTIFICATION CHECKS PASSED`);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(r => server.close(() => r()));
    sqliteDb.close();
  }
}
