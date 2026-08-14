import type { IStorage } from "./storage";
import { sendEmail } from "./email";

// Guard against duplicate intervals (e.g. tsx hot reload in dev). Clearing any
// existing interval before creating a new one keeps exactly one running.
let intervalHandle: ReturnType<typeof setInterval> | null = null;

const CHECK_INTERVAL_MS = 2 * 60_000; // every 2 minutes

const REFERRAL_RECIPIENTS = ["partner@maha.clinic", "coordinator@maha.si"];
const ORDER_RECIPIENTS = ["partner@maha.clinic", "tina@maha.si"];

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

// Polls for new referrals and shop orders and emails the relevant MAHA team
// addresses, mirroring the caseDiscussionScheduler / backupScheduler pattern.
// Each row is marked notified once an email attempt was made for it (even if
// a secondary recipient like coordinator@maha.si / tina@maha.si can't yet be
// delivered because no sending domain is verified in Resend — partner@maha.clinic
// still gets it, and every recipient will start working automatically the
// moment a domain is verified, no re-notification needed since it's a config
// change, not a data change).
export function startNotificationScheduler(storage: IStorage) {
  if (intervalHandle) clearInterval(intervalHandle);

  const run = async () => {
    try {
      const referrals = await storage.listUnnotifiedReferrals();
      for (const referral of referrals) {
        const partner = await storage.getUser(referral.partnerId);
        const html = `
          <div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;">
            <h2>New patient referral</h2>
            <p><b>${escapeHtml(partner?.name || "A partner")}</b> submitted a new referral (${escapeHtml(referral.urgency)}).</p>
            <table style="border-collapse:collapse;">
              <tr><td style="padding:4px 12px 4px 0;color:#666;font-size:13px;">Patient</td><td style="font-size:13px;">${escapeHtml(referral.patientFirstName)} ${escapeHtml(referral.patientLastName)}</td></tr>
              <tr><td style="padding:4px 12px 4px 0;color:#666;font-size:13px;">Contact</td><td style="font-size:13px;">${escapeHtml(referral.patientContact)}</td></tr>
              <tr><td style="padding:4px 12px 4px 0;color:#666;font-size:13px;vertical-align:top;">Case</td><td style="font-size:13px;">${escapeHtml(referral.caseDescription)}</td></tr>
              ${referral.notes ? `<tr><td style="padding:4px 12px 4px 0;color:#666;font-size:13px;vertical-align:top;">Notes</td><td style="font-size:13px;">${escapeHtml(referral.notes)}</td></tr>` : ""}
            </table>
          </div>`;
        const referralResults = await sendEmail(REFERRAL_RECIPIENTS, `New referral: ${referral.patientFirstName} ${referral.patientLastName}`, html);
        // Only mark notified once the guaranteed recipient (partner@maha.clinic)
        // got it — secondary Resend-sandbox-blocked recipients don't block this,
        // but a total failure (rate limit, network) leaves it unnotified so the
        // next poll retries automatically.
        if (referralResults.some((r) => r.to === "partner@maha.clinic" && r.ok)) {
          await storage.markReferralsNotified([referral.id], Date.now());
        }
        await new Promise((resolve) => setTimeout(resolve, 300));
      }

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
    } catch (err) {
      console.error("[notification-scheduler] error:", err);
    }
  };

  run(); // catch up on anything pending immediately on boot
  intervalHandle = setInterval(run, CHECK_INTERVAL_MS);
}
