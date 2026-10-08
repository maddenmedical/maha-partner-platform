import crypto from "node:crypto";
import { and, eq, isNull, desc, sql, inArray } from "drizzle-orm";
import { appNotifications } from "@shared/schema";
import { db } from "./storage";

type NewNotice = Omit<typeof appNotifications.$inferInsert, "id"> & { id?: string };
export function addNotice(input: NewNotice) {
  const id = input.id || crypto.randomUUID();
  db.insert(appNotifications).values({ ...input, id }).onConflictDoNothing().run();
  return id;
}
export function notificationSummary(userId: number) {
  const unseen = and(eq(appNotifications.userId, userId), isNull(appNotifications.readAt));
  const count = db.select({ n: sql<number>`count(*)` }).from(appNotifications).where(unseen).get()!.n;
  const criticalCount = db.select({ n: sql<number>`count(*)` }).from(appNotifications)
    .where(and(unseen, eq(appNotifications.critical, true))).get()!.n;
  const firstCritical = db.select().from(appNotifications)
    .where(and(unseen, eq(appNotifications.critical, true))).orderBy(desc(appNotifications.createdAt)).get();
  const items = db.select().from(appNotifications).where(unseen)
    .orderBy(desc(appNotifications.critical), desc(appNotifications.createdAt)).limit(50).all();
  return { count, criticalCount, firstCritical, items };
}
export function readNotices(userId: number, ids?: string[]) {
  const condition = ids
    ? inArray(appNotifications.id, ids.length ? ids : [""])
    : eq(appNotifications.critical, false);
  db.update(appNotifications).set({ readAt: Date.now() })
    .where(and(eq(appNotifications.userId, userId), eq(appNotifications.critical, false), isNull(appNotifications.readAt), condition)).run();
}
export function readReferralNotice(userId: number, referralId: number) {
  db.update(appNotifications).set({ readAt: Date.now() })
    .where(and(eq(appNotifications.userId, userId), eq(appNotifications.id, `referral:${referralId}:${userId}`))).run();
}
export function readChatNotices(userId: number, threadId: number, messageIds: number[]) {
  if (!messageIds.length) return;
  db.update(appNotifications).set({ readAt: Date.now() }).where(and(
    eq(appNotifications.userId, userId), eq(appNotifications.category, "chat"),
    eq(appNotifications.threadId, threadId), inArray(appNotifications.messageId, messageIds),
    isNull(appNotifications.readAt),
  )).run();
}
