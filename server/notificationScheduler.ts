import type { IStorage } from "./storage";
import { sendEmail, buildRegistrationEmailHtml } from "./email";
import { deliverReferralAlerts } from "./referralAlerts";
import { deliverChatReminders } from "./chatReminders";

// Guard against duplicate intervals (e.g. tsx hot reload in dev). Clearing any
// existing interval before creating a new one keeps exactly one running.
let intervalHandle: ReturnType<typeof setInterval> | null = null;
let running = false;

// Retry a failed registration alert. A failed mail service must never lose
// an applicant or falsely mark their notification as delivered.
export async function retryRegistrationAlerts(storage: IStorage) {
  const origin = process.env.APP_BASE_URL || "https://maha-partner-portal.pplx.app";
  const api = `${origin}${process.env.APP_API_PATH_PREFIX ?? "/port/5001"}`;
  const pending = await storage.listUsersByRoleStatus(undefined, "pending");
  for (const user of pending.filter(user => user.approvalToken && !user.approvalEmailNotified && (user.role === "partner" || user.role === "student")).slice(0, 20)) {
    const html = buildRegistrationEmailHtml({
      fullName: user.name, role: user.role, email: user.email, phone: user.phone || "", username: user.username || "",
      businessName: user.businessName, vatNumber: user.vatNumber, profession: user.profession,
      homepageUrl: user.homepageUrl, city: user.city, address: user.address, country: user.country,
      additionalInfo: user.additionalInfo,
      degreeFileUrl: user.degreeFileUrl ? `${api}/api/admin/registration-document?token=${user.approvalToken}` : null,
      approveUrl: `${api}/api/admin/registration-action?token=${user.approvalToken}&action=approve`,
      declineUrl: `${api}/api/admin/registration-action?token=${user.approvalToken}&action=decline`,
    });
    const results = await sendEmail(["partner@maha.clinic"], `New ${user.role} registration: ${user.name}`, html);
    if (results.some(result => result.ok)) await storage.setUserApprovalEmailNotified(user.id, true);
    await new Promise(resolve => setTimeout(resolve, 300));
  }
}

const CHECK_INTERVAL_MS = 2 * 60_000; // every 2 minutes

const ORDER_BASE_RECIPIENTS = ["partner@maha.clinic", "tina@maha.si"];
const CHAT_BASE_RECIPIENTS = ["partner@maha.clinic"];

// Dr. Perko and Elisabeth Madden (the admin accounts) must always get these
// emails per the standing notification rules -- merged into every recipient
// list below, in addition to the shared/team addresses already there.
// Fetched fresh each poll (not cached) so a newly added admin account starts
// receiving notifications immediately with no code change or restart.
async function getAdminEmails(storage: IStorage): Promise<string[]> {
  const admins = await storage.listAdmins();
  return admins.map((a) => a.email).filter((e): e is string => !!e);
}

function mergeRecipients(base: string[], admins: string[]): string[] {
  return Array.from(new Set([...base, ...admins]));
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

// Polls for new referrals and shop orders and emails the relevant MAHA team
// addresses, mirroring the caseDiscussionScheduler / backupScheduler pattern.
// Referrals use a durable per-recipient outbox; provider acceptance for every
// current recipient is required before marking the referral notified.
export function startNotificationScheduler(storage: IStorage) {
  if (intervalHandle) clearInterval(intervalHandle);

  const run = async () => {
    if (running) return;
    running = true;
    try {
      await deliverReferralAlerts();
      await deliverChatReminders();
      await retryRegistrationAlerts(storage);
      const adminEmails = await getAdminEmails(storage);
      const ORDER_RECIPIENTS = mergeRecipients(ORDER_BASE_RECIPIENTS, adminEmails);
      const CHAT_RECIPIENTS = mergeRecipients(CHAT_BASE_RECIPIENTS, adminEmails);

      const orders = await storage.listUnnotifiedOrders();
      for (const order of orders) {
        const partner = await storage.getUser(order.partnerId);
        const items = await storage.listItemsForOrder(order.id);
        const rows = await Promise.all(
          items.map(async (item) => {
            const product = await storage.getProduct(item.productId);
            const total = ((item.unitPriceAtOrder * item.quantity) / 100).toFixed(2);
            return `<tr><td style="padding:4px 12px 4px 0;font-size:13px;">${escapeHtml(product?.name || `Product #${item.productId}`)}</td><td style="font-size:13px;text-align:right;">${item.quantity}</td><td style="font-size:13px;text-align:right;">€${total}</td></tr>`;
          }),
        );
        const html = `
          <div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;">
            <h2>New shop order request</h2>
            <p><b>${escapeHtml(partner?.name || "A partner")}</b> submitted a new order to ${escapeHtml(order.destinationCountry || "")}.</p>
            <table style="border-collapse:collapse;width:100%;">
              <tr><th style="text-align:left;font-size:12px;color:#666;">Product</th><th style="text-align:right;font-size:12px;color:#666;">Qty</th><th style="text-align:right;font-size:12px;color:#666;">Total</th></tr>
              ${rows.join("")}
            </table>
            ${order.estimatedShippingCost != null ? `<p style="font-size:13px;color:#666;">Estimated shipping: €${(order.estimatedShippingCost / 100).toFixed(2)}</p>` : ""}
          </div>`;
        const orderResults = await sendEmail(ORDER_RECIPIENTS, `New order request from ${partner?.name || "a partner"}`, html);
        if (orderResults.some((r) => r.to === "partner@maha.clinic" && r.ok)) {
          await storage.markOrdersNotified([order.id], Date.now());
        }
        await new Promise((resolve) => setTimeout(resolve, 300));
      }

      const threads = await storage.listUnnotifiedChatThreads();
      for (const thread of threads) {
        // The dedicated referral alert replaces the auto-created chat alert.
        if (thread.kind === "referral") continue;
        const starter = await storage.getUser(thread.userId);
        const html = `
          <div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;">
            <h2>New chat started</h2>
            <p><b>${escapeHtml(starter?.name || "A " + thread.userRole)}</b> (${escapeHtml(thread.userRole)}) started a new chat: <b>${escapeHtml(thread.topic)}</b>.</p>
            <p style="font-size:13px;color:#666;">Reply from the admin chat inbox in the Partner Platform.</p>
          </div>`;
        const chatResults = await sendEmail(CHAT_RECIPIENTS, `New chat started: ${thread.topic}`, html);
        if (chatResults.some((r) => r.to === "partner@maha.clinic" && r.ok)) {
          await storage.markChatThreadsNotified([thread.id], Date.now());
        }
        await new Promise((resolve) => setTimeout(resolve, 300));
      }

    } catch (err) {
      console.error("[notification-scheduler] error:", err);
    } finally {
      running = false;
    }
  };

  run(); // catch up on anything pending immediately on boot
  intervalHandle = setInterval(run, CHECK_INTERVAL_MS);
}
