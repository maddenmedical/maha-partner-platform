import { eq, and, isNull } from "drizzle-orm";
import { createHash } from "node:crypto";
import { appNotifications, referralEmailDeliveries, type Referral } from "@shared/schema";
import { storage, db } from "./storage";
import { addNotice, notificationSummary } from "./notificationStore";
import { sendEmail } from "./email";
import { sendToSubscriptions } from "./push";

const teamEmails = ["partner@maha.clinic", "coordinator@maha.si"];
export function referralCopy(referral: Pick<Referral, "id" | "urgency">) {
  const urgent = referral.urgency === "Urgent";
  const title = urgent ? "URGENT: new referral requires review" : "New referral requires review";
  const body = `Referral #${referral.id}. Please sign in to review the patient details.`;
  const url = `/?referral=${referral.id}#/admin/referrals`;
  return { title, body, url };
}
export async function queueReferralAlerts(referral: Referral, inAppOnly = false) {
  if (referral.archivedAt) return;
  const admins = await storage.listAdmins();
  const copy = referralCopy(referral);
  for (const admin of admins) {
    addNotice({ id: `referral:${referral.id}:${admin.id}`, userId: admin.id, category: "referral",
      ...copy, critical: true, createdAt: referral.createdAt, pushSentAt: inAppOnly ? Date.now() : null });
  }
  if (inAppOnly) return;
  const recipients = Array.from(new Set([...admins.map(a => a.email), ...teamEmails]
    .filter(Boolean).map(email => email.trim().toLowerCase())));
  for (const email of recipients) {
    db.insert(referralEmailDeliveries).values({ id: `referral:${referral.id}:${email}`, referralId: referral.id, email })
      .onConflictDoNothing().run();
  }
}

async function deliverReferralPushes() {
  const admins = await storage.listAdmins();
  for (const notice of db.select().from(appNotifications).where(and(
    eq(appNotifications.category, "referral"), isNull(appNotifications.pushSentAt), isNull(appNotifications.readAt),
  )).all()) {
    if (!admins.some(a => a.id === notice.userId)) continue;
    const referral = await storage.getReferral(Number(notice.id.split(":")[1]));
    if (!referral || referral.archivedAt) {
      db.update(appNotifications).set({ readAt: Date.now() }).where(eq(appNotifications.id, notice.id)).run();
      continue;
    }
    const subs = await storage.getPushSubscriptionsForUserIds([notice.userId]);
    if (!subs.length) continue;
    const delivered = new Set<string>(JSON.parse(notice.pushDeliveredDevices));
    const deviceKey = (endpoint: string) => createHash("sha256").update(endpoint).digest("hex");
    for (const sub of subs) {
      const key = deviceKey(sub.endpoint);
      if (delivered.has(key)) continue;
      const result = await sendToSubscriptions([sub], { title: notice.title, body: notice.body, url: notice.url,
        badgeCount: notificationSummary(notice.userId).count, tag: notice.id, requireInteraction: true, priority: "high" });
      if (result.sent || result.removedEndpoints.length) {
        delivered.add(key);
        db.update(appNotifications).set({ pushDeliveredDevices: JSON.stringify(Array.from(delivered)) })
          .where(eq(appNotifications.id, notice.id)).run();
      }
    }
    if (subs.every(sub => delivered.has(deviceKey(sub.endpoint)))) {
      db.update(appNotifications).set({ pushSentAt: Date.now() }).where(eq(appNotifications.id, notice.id)).run();
    }
  }
}

let running: Promise<void> | null = null;
// Durable per-recipient outbox. Provider acceptance is not inbox delivery.
// A successful shared-mailbox send never masks a failed Dr. Perko/admin send.
export function deliverReferralAlerts(): Promise<void> {
  if (running) return running;
  running = runDeliveries().finally(() => { running = null; });
  return running;
}
async function runDeliveries() {
    const admins = await storage.listAdmins();
    const eligible = new Set([...teamEmails, ...admins.map(a => a.email)].map(e => e.trim().toLowerCase()));
    // Surface existing unresolved "New" referrals after this upgrade without
    // replaying historical emails or push alerts. Existing read rows win.
    for (const referral of await storage.listAllReferrals()) {
      if (referral.emailNotified && referral.status === "New" && !referral.archivedAt) {
        await queueReferralAlerts(referral, true);
      }
    }
    const pending = await storage.listUnnotifiedReferrals();
    for (const referral of pending) await queueReferralAlerts(referral);
    // Push is independent of email availability and goes first.
    await deliverReferralPushes();
    for (const referral of pending) {
      if (referral.archivedAt) continue;
      const copy = referralCopy(referral);
      const origin = process.env.APP_BASE_URL || "https://maha-partner-platform.onrender.com";
      const href = `${origin.replace(/\/$/, "")}${copy.url}`;
      const html = `<div style="font-family:Arial,sans-serif;max-width:560px">
        <h2 style="color:#9f1239">${copy.title}</h2><p>${copy.body}</p>
        <p><a href="${href.replace(/"/g, "&quot;")}" style="display:inline-block;padding:12px 20px;background:#ffbf42;color:#2c2c3f;font-weight:bold;text-decoration:none">Review referral #${referral.id}</a></p>
        <p style="font-size:12px;color:#666">Patient information is available only inside the signed-in MAHA Partner Platform.</p></div>`;
      const deliveries = db.select().from(referralEmailDeliveries)
        .where(eq(referralEmailDeliveries.referralId, referral.id)).all().filter(d => eligible.has(d.email));
      for (const delivery of deliveries) {
        const current = await storage.getReferral(referral.id);
        if (!current || current.archivedAt) break;
        if (delivery.acceptedAt || delivery.nextAttemptAt > Date.now()) continue;
        const result = (await sendEmail([delivery.email], `[MAHA REFERRAL #${referral.id}] ${copy.title}`, html,
          { idempotencyKey: `maha-referral-${referral.id}`, highPriority: true }))[0];
        db.update(referralEmailDeliveries).set({
          acceptedAt: result?.ok ? Date.now() : null, attempts: delivery.attempts + 1,
          nextAttemptAt: Date.now() + Math.min(30 * 60_000, 30_000 * 2 ** Math.min(delivery.attempts, 6)),
        }).where(eq(referralEmailDeliveries.id, delivery.id)).run();
        await new Promise(resolve => setTimeout(resolve, 300));
      }
      const remaining = db.select().from(referralEmailDeliveries)
        .where(and(eq(referralEmailDeliveries.referralId, referral.id), isNull(referralEmailDeliveries.acceptedAt)))
        .all().filter(d => eligible.has(d.email));
      if (deliveries.length && !remaining.length) await storage.markReferralsNotified([referral.id], Date.now());
    }
}
