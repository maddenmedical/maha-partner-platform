import webpush from "web-push";
import type { PushSubscriptionRow } from "@shared/schema";

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

  return { sent, failed, removedEndpoints };
}
