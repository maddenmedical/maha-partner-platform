import webpush from "web-push";
import type { PushSubscriptionRow } from "@shared/schema";
import { storage } from "./storage";
import { addNotice, notificationSummary } from "./notificationStore";

let configured = false;

// Wires web-push with the VAPID credentials from the environment. Returns false
// when keys are absent so callers can degrade gracefully instead of throwing.
export function ensurePushConfigured(): boolean {
  if (configured) return true;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return false;
  const subject = process.env.VAPID_SUBJECT || "mailto:info@maha.clinic";
  webpush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
  return true;
}

export function getVapidPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY || null;
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string | null;
  // Quiet notifications still display, without sound. badgeCount is the
  // authoritative unread ledger count, never a client-side increment.
  silent?: boolean;
  badgeCount?: number;
  tag?: string;
  requireInteraction?: boolean;
  priority?: "high" | "normal";
}

export interface SendResult {
  sent: number;
  failed: number;
  removedEndpoints: string[];
}

// Fans a payload out to every subscription. Endpoints that report 404/410 are
// expired/unsubscribed and returned so the caller can prune them from storage.
export async function sendToSubscriptions(
  subs: PushSubscriptionRow[],
  payload: PushPayload,
): Promise<SendResult> {
  if (!ensurePushConfigured()) {
    return { sent: 0, failed: subs.length, removedEndpoints: [] };
  }
  const body = JSON.stringify(payload);
  let sent = 0;
  let failed = 0;
  const removedEndpoints: string[] = [];

  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          body,
          { urgency: payload.priority || "normal", TTL: 24 * 60 * 60, timeout: 10_000 },
        );
        sent++;
      } catch (err: any) {
        failed++;
        const statusCode = err?.statusCode;
        if (statusCode === 404 || statusCode === 410) {
          removedEndpoints.push(s.endpoint);
        }
      }
    }),
  );

  if (removedEndpoints.length > 0) {
    await storage.deletePushSubscriptionsByEndpoints(removedEndpoints);
  }

  return { sent, failed, removedEndpoints };
}

// ---------------------------------------------------------------------------
// Preference-aware notifications
//
// Every push a user receives falls into one of four categories they control
// independently (community / chat / orders / offers), each with its own
// on/off switch and delivery style:
//   - "silent"  -- quiet generic popup + badge, without sound
//   - "alert"   -- tone + popup, generic text (no message content revealed)
//   - "preview" -- tone + popup with the actual content (platform default)
// notifyUsers() is the single place that turns a caller's "what happened"
// description into the right payload for each recipient's own preference,
// so route handlers never have to branch on style themselves.
// ---------------------------------------------------------------------------

export type NotificationCategory = "community" | "chat" | "orders" | "offers" | "standing" | "staff";

export interface NotifyContent {
  threadId?: number;
  messageId?: number;
  // Shown for "alert" style -- must not reveal message/order content.
  genericTitle: string;
  genericBody: string;
  // Shown for "preview" style -- the real content, e.g.
  // `Dr. Moreira just opened a new Community thread called "..."`.
  previewTitle: string;
  previewBody: string;
  url?: string | null;
}

const CATEGORY_COLS: Record<NotificationCategory, { enabled: string; style: string }> = {
  community: { enabled: "notifyCommunityEnabled", style: "notifyCommunityStyle" },
  chat: { enabled: "notifyChatEnabled", style: "notifyChatStyle" },
  orders: { enabled: "notifyOrdersEnabled", style: "notifyOrdersStyle" },
  offers: { enabled: "notifyOffersEnabled", style: "notifyOffersStyle" },
  // Admin-only category (level-up alerts) -- reuses the "offers" preference
  // columns since it is never surfaced to partners/students and doesn't
  // warrant its own settings-page toggle for a single alert type. Any admin
  // who has turned off "offers" pushes for themselves will also skip this.
  standing: { enabled: "notifyOffersEnabled", style: "notifyOffersStyle" },
  staff: { enabled: "notifyStaffEnabled", style: "notifyStaffStyle" },
};

// Sends one notification per recipient, each shaped by that recipient's own
// category preference. userIds with the category disabled are skipped
// entirely (not even a silent badge bump). Safe to call with an empty list.
export async function notifyUsers(
  userIds: number[],
  category: NotificationCategory,
  content: NotifyContent,
): Promise<void> {
  const uniqueIds = Array.from(new Set(userIds));
  if (uniqueIds.length === 0) return;
  const cols = CATEGORY_COLS[category];

  await Promise.all(
    uniqueIds.map(async (userId) => {
      const user = await storage.getUser(userId);
      if (!user || user.status !== "approved" || user.archivedAt) return;
      const enabled = (user as any)[cols.enabled];
      if (!enabled) return;
      const style: string = (user as any)[cols.style] || "preview";
      let url = content.url || "/#/";
      if (url.startsWith("/") && !url.startsWith("//") && !url.includes("#")) {
        const route = user.role === "admin" && url === "/community" ? "/admin/community" : url;
        url = `/#${route}`;
      }
      const id = addNotice({ userId, category, title: content.genericTitle, body: content.genericBody,
        url, threadId: content.threadId, messageId: content.messageId, createdAt: Date.now() });
      const badgeCount = notificationSummary(userId).count;

      const subs = await storage.getPushSubscriptionsForUserIds([userId]);
      if (subs.length === 0) return;

      let payload: PushPayload;
      if (style === "silent") {
        payload = { title: content.genericTitle, body: content.genericBody, silent: true, url: content.url ?? null };
      } else if (style === "alert") {
        payload = { title: content.genericTitle, body: content.genericBody, url: content.url ?? null };
      } else {
        payload = { title: content.previewTitle, body: content.previewBody, url: content.url ?? null };
      }

      // Ask supporting platforms to retain alerting notifications. Android and
      // Firefox control their own presentation; never override Quiet mode.
      await sendToSubscriptions(subs, { ...payload, url, badgeCount, tag: id,
        requireInteraction: style !== "silent" && user.notifyEnhancedVisibility !== false });
    }),
  );
}
