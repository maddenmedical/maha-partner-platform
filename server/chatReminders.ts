import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { chatReminderDeliveries, type ChatMessage } from "@shared/schema";
import { db, storage } from "./storage";
import { sendEmail } from "./email";

export const CHAT_REMINDER_DELAY_MS = 2 * 60 * 60_000;

// A same-side follow-up never restarts the two-hour clock. The first message
// since the opposite side last answered anchors this waiting episode.
export function waitingEpisode(messages: ChatMessage[]) {
  const visible = messages.filter(m => !m.deletedAt).sort((a, b) => a.createdAt - b.createdAt || a.id - b.id);
  if (!visible.length) return null;
  const last = visible[visible.length - 1];
  const fromAdmin = last.senderRole === "admin";
  let first = last;
  for (let i = visible.length - 2; i >= 0; i--) {
    if ((visible[i].senderRole === "admin") !== fromAdmin) break;
    first = visible[i];
  }
  return { first, last, fromAdmin };
}

let running: Promise<void> | null = null;
export function deliverChatReminders(now = Date.now()): Promise<void> {
  if (running) return running;
  running = runReminders(now).finally(() => { running = null; });
  return running;
}
async function runReminders(now: number) {
  const admins = await storage.listAdmins();
  for (const thread of await storage.listThreads()) {
    if (thread.archivedAt) continue;
    const owner = await storage.getUser(thread.userId);
    if (!owner || owner.status !== "approved" || owner.archivedAt) continue;
    const episode = waitingEpisode(await storage.listMessagesForThread(thread.id));
    if (!episode || now - episode.first.createdAt < CHAT_REMINDER_DELAY_MS) continue;
    // Admin reminders retain coverage of the shared partner/student inbox.
    // Partner-facing reminders are restricted to partners, as requested.
    const recipients = episode.fromAdmin ? (owner.role === "partner" ? [owner] : []) : admins;
    for (const recipient of recipients) {
      const email = recipient.email.trim().toLowerCase();
      const key = createHash("sha256").update(`${thread.id}:${episode.first.id}:${recipient.id}:${email}`).digest("hex");
      const id = `chat-reminder:${key}`;
      db.insert(chatReminderDeliveries).values({ id, threadId: thread.id, episodeMessageId: episode.first.id,
        recipientId: recipient.id, email }).onConflictDoNothing().run();
      const delivery = db.select().from(chatReminderDeliveries).where(eq(chatReminderDeliveries.id, id)).get()!;
      if (delivery.acceptedAt || delivery.nextAttemptAt > now) continue;

      // Recheck after each awaited provider request: a reply/archive/delete or
      // account change while the job runs must stop the remaining stale sends.
      const current = await storage.getThread(thread.id);
      const user = await storage.getUser(recipient.id);
      const currentOwner = await storage.getUser(thread.userId);
      if (!current || current.archivedAt || !currentOwner || currentOwner.archivedAt || currentOwner.status !== "approved") break;
      if (!user || user.archivedAt || user.status !== "approved" ||
          user.role !== recipient.role || user.email.trim().toLowerCase() !== email) continue;
      const currentEpisode = waitingEpisode(await storage.listMessagesForThread(thread.id));
      if (!currentEpisode || currentEpisode.first.id !== episode.first.id) break;

      const origin = (process.env.APP_BASE_URL || "https://maha-partner-platform.onrender.com").replace(/\/$/, "");
      const route = episode.fromAdmin ? "/chat" : "/admin/chat";
      const href = `${origin}/?thread=${thread.id}#${route}`.replace(/"/g, "&quot;");
      // Stable content is intentional: retries use the same provider
      // idempotency key, even if the recipient has opened the thread since.
      const html = `<div style="font-family:Arial,sans-serif;max-width:560px">
        <h2>A message is waiting for you</h2>
        <p>A message in MAHA chat #${thread.id} has been waiting for your attention for more than two hours.</p>
        <p>Please open the conversation and reply when you can.</p>
        <p><a href="${href}" style="display:inline-block;padding:12px 20px;background:#ffbf42;color:#2c2c3f;font-weight:bold;text-decoration:none">Open conversation</a></p>
        <p style="font-size:12px;color:#666">For privacy, message content and patient details are available only inside the signed-in MAHA Partner Platform.</p></div>`;
      const result = (await sendEmail([email], "MAHA: a message is waiting for you", html,
        { idempotencyKey: id }))[0];
      db.update(chatReminderDeliveries).set({ acceptedAt: result?.ok ? now : null,
        attempts: delivery.attempts + 1,
        nextAttemptAt: now + Math.min(30 * 60_000, 30_000 * 2 ** Math.min(delivery.attempts, 6)),
      }).where(eq(chatReminderDeliveries.id, id)).run();
      await new Promise(resolve => setTimeout(resolve, 300));
    }
  }
}
