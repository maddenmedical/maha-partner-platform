import type { Express, RequestHandler, Response } from "express";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { parse, serialize } from "cookie";
import { z } from "zod";
import { and, eq, desc, asc, isNull, sql } from "drizzle-orm";
import { db, storage } from "./storage";
import { guestChatInvites as invites, guestChatMessages as messages, users, chatThreads, chatMessages, sessions } from "@shared/schema";
import { CURRENT_LEGAL_VERSION } from "@shared/legalVersion";
import { sendEmail } from "./email";
import { notifyUsers } from "./push";

const hash = (value: string) => crypto.createHash("sha256").update(value).digest("hex");
const secret = () => crypto.randomBytes(32).toString("hex");
const HOUR = 3600000;
type Invite = typeof invites.$inferSelect;
const fail = (status: number, message: string): never => { throw Object.assign(new Error(message), { status }); };
const find = (id: string) => db.select().from(invites).where(eq(invites.id, id)).get() ?? fail(404, "Invitation not found.");
const rows = (id: string) => db.select().from(messages).where(eq(messages.inviteId, id)).orderBy(asc(messages.id)).all();
const accountByEmail = (email: string) => db.select().from(users).where(sql`lower(${users.email}) = ${email.toLowerCase()}`).get();
const cookieName = (id: string) => `maha_guest_${id.replace(/-/g, "")}`;
function cookie(res: Response, id: string, token: string, expires: number) {
  res.append("Set-Cookie", serialize(cookieName(id), token, { httpOnly: true, secure: process.env.NODE_ENV === "production",
    sameSite: "lax", path: `/api/guest-chat/${id}`, expires: new Date(expires) }));
}
function checkGuest(req: any): Invite {
  const invite = find(String(req.params.id));
  const token = parse(req.headers.cookie || "")[cookieName(invite.id)];
  if (invite.revokedAt || invite.declinedAt || invite.linkedThreadId || !token || !invite.sessionHash ||
    hash(token) !== invite.sessionHash || (invite.sessionExpiresAt ?? 0) <= Date.now()) {
    fail(403, "Guest access has ended. Please contact MAHA to recover this conversation.");
  }
  return invite;
}
function activePartner(id: number) {
  const user = db.select().from(users).where(eq(users.id, id)).get();
  if (!user || user.role !== "partner" || user.status !== "approved" || user.archivedAt) fail(400, "Choose an active, approved partner.");
  return user!;
}
function linkChat(inviteId: string, userId: number, linkedBy: number | null = null) {
  return db.transaction(() => {
    const invite = find(inviteId);
    if (invite.linkedThreadId) {
      if (invite.linkedUserId !== userId) fail(409, "This conversation is already linked to a different account.");
      return invite.linkedThreadId;
    }
    const user = activePartner(userId);
    if (invite.intendedUserId && invite.intendedUserId !== userId) fail(403, "This invitation is intended for a different partner.");
    const now = Date.now();
    const thread = db.insert(chatThreads).values({ userId, userRole: "partner", topic: invite.topic,
      createdAt: invite.createdAt, emailNotified: true, notifiedAt: now, ownerLastReadAt: now }).returning().get();
    for (const message of rows(inviteId)) db.insert(chatMessages).values({
      threadId: thread.id, senderId: message.senderRole === "admin" ? message.senderId! : user.id,
      senderRole: message.senderRole === "admin" ? "admin" : "partner",
      senderName: message.senderRole === "admin" ? message.senderName : "Guest (before account verification)",
      body: message.body, createdAt: message.createdAt,
    }).run();
    db.update(invites).set({ linkedUserId: userId, linkedThreadId: thread.id, linkedBy, linkedAt: now,
      sessionHash: null, verificationHash: null }).where(eq(invites.id, inviteId)).run();
    return thread.id;
  });
}
const safe = (fn: (req: any, res: Response) => any): RequestHandler => async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try { await fn(req, res); } catch (error: any) {
    res.status(error.status || (error instanceof z.ZodError ? 400 : 500))
      .json({ message: error.status ? error.message : error instanceof z.ZodError ? "Please check the required fields." : "Could not complete this action. Please try again." });
  }
};
export function registerGuestChatRoutes(app: Express, requireAuth: RequestHandler, requireAdmin: RequestHandler,
  optionalUser: (req: any) => Promise<any>, setSession: (res: Response, token: string, expiresAt: number) => void) {
  const admin = [requireAuth, requireAdmin];
  app.get("/api/admin/guest-chats", ...admin, safe(async (_req, res) => {
    const list = db.select().from(invites).orderBy(desc(invites.createdAt)).all();
    res.json(list.map(({ id, label, topic, createdAt, intendedUserId, linkedUserId, linkedThreadId, declinedAt, revokedAt, openedAt, expiresAt, adminReadAt }) => {
      const conversation = rows(id); const last = conversation.at(-1);
      return { id, label, topic, createdAt, intendedUserId, linkedUserId, linkedThreadId, declinedAt, revokedAt, openedAt, expiresAt,
        unread: !!last && last.senderRole === "guest" && last.createdAt > (adminReadAt ?? 0), messageCount: conversation.length };
    }));
  }));
  app.post("/api/admin/guest-chats", ...admin, safe(async (req, res) => {
    const input = z.object({ label: z.string().trim().min(1).max(120), topic: z.string().trim().min(1).max(160),
      message: z.string().trim().min(1).max(5000), intendedUserId: z.number().int().positive().nullable() }).parse(req.body);
    if (input.intendedUserId) activePartner(input.intendedUserId);
    const id = crypto.randomUUID(), token = secret(), now = Date.now();
    db.transaction(() => {
      db.insert(invites).values({ id, tokenHash: hash(token), createdBy: req.user.id, label: input.label,
        topic: input.topic, intendedUserId: input.intendedUserId, createdAt: now, expiresAt: now + 7 * 24 * HOUR }).run();
      db.insert(messages).values({ inviteId: id, senderId: req.user.id, senderName: req.user.name,
        senderRole: "admin", body: input.message, requestId: crypto.randomUUID(), createdAt: now }).run();
    });
    res.status(201).json({ id, path: `/#/continue-chat/${id}/${token}` });
  }));
  app.get("/api/admin/guest-chats/:id", ...admin, safe(async (req, res) => {
    const invite = find(req.params.id);
    db.update(invites).set({ adminReadAt: Date.now() }).where(eq(invites.id, invite.id)).run();
    res.json({ messages: rows(invite.id), linkedThreadId: invite.linkedThreadId });
  }));
  app.post("/api/admin/guest-chats/:id/reply", ...admin, safe(async (req, res) => {
    const invite = find(req.params.id);
    if (invite.linkedThreadId || invite.declinedAt || invite.revokedAt) fail(409, "This guest session is closed. Open the linked chat or send a new invitation.");
    const input = z.object({ body: z.string().trim().min(1).max(5000), requestId: z.string().uuid() }).parse(req.body);
    const existing = db.select().from(messages).where(and(eq(messages.inviteId, invite.id), eq(messages.requestId, input.requestId))).get();
    if (!existing) db.insert(messages).values({ ...input, inviteId: invite.id, senderId: req.user.id,
      senderRole: "admin", senderName: req.user.name, createdAt: Date.now() }).run();
    res.json({ ok: true });
  }));
  app.post("/api/admin/guest-chats/:id/revoke", ...admin, safe(async (req, res) => {
    const invite = find(req.params.id);
    db.update(invites).set({ revokedAt: Date.now(), sessionHash: null, verificationHash: null }).where(eq(invites.id, invite.id)).run();
    res.json({ ok: true });
  }));
  app.post("/api/admin/guest-chats/:id/link", ...admin, safe(async (req, res) => {
    const { userId } = z.object({ userId: z.number().int().positive() }).parse(req.body);
    res.json({ threadId: linkChat(req.params.id, userId, req.user.id) });
  }));

  // A GET never redeems an invitation: WhatsApp previews/link scanners cannot
  // consume it. Only an explicit Start chat action claims a browser session.
  app.post("/api/guest-chat/:id/start", safe(async (req, res) => {
    const invite = find(req.params.id);
    const { token } = z.object({ token: z.string().regex(/^[a-f0-9]{64}$/) }).parse(req.body);
    if (hash(token) !== invite.tokenHash || invite.revokedAt || invite.declinedAt || invite.expiresAt < Date.now()) fail(403, "This invitation is no longer available. Please ask MAHA for a new link.");
    const user = await optionalUser(req);
    if (user && user.role === "partner" && user.status === "approved" && !user.archivedAt &&
      (!invite.intendedUserId || invite.intendedUserId === user.id || invite.linkedUserId === user.id)) {
      return res.json({ threadId: linkChat(invite.id, user.id) });
    }
    if (invite.linkedThreadId) fail(403, "This conversation has been saved to a partner account. Sign in to that account to continue.");
    const old = parse(req.headers.cookie || "")[cookieName(invite.id)];
    if (old && invite.sessionHash === hash(old) && (invite.sessionExpiresAt ?? 0) > Date.now()) return res.json({ ok: true });
    if (invite.openedAt) fail(403, "This invitation has already been opened on another browser. Ask MAHA for help recovering the conversation.");
    const session = secret(), now = Date.now();
    const redeemed = db.update(invites).set({ openedAt: now, sessionHash: hash(session), sessionExpiresAt: now + 24 * HOUR })
      .where(and(eq(invites.id, invite.id), isNull(invites.openedAt), isNull(invites.linkedThreadId), isNull(invites.revokedAt))).run();
    if (!redeemed.changes) fail(409, "This invitation was already opened. Please use the browser where you started.");
    cookie(res, invite.id, session, now + 24 * HOUR);
    res.json({ ok: true });
  }));
  app.get("/api/guest-chat/:id", safe(async (req, res) => {
    const invite = checkGuest(req);
    res.json({ topic: invite.topic, messages: rows(invite.id).map(({ id, senderRole, senderName, body, createdAt }) =>
      ({ id, senderRole, senderName, body, createdAt })), expiresAt: invite.sessionExpiresAt });
  }));
  app.post("/api/guest-chat/:id/message", safe(async (req, res) => {
    const invite = checkGuest(req);
    const input = z.object({ body: z.string().trim().min(1).max(5000), requestId: z.string().uuid() }).parse(req.body);
    const previous = rows(invite.id);
    if (previous.some(m => m.requestId === input.requestId)) return res.json({ ok: true });
    const recent = previous.filter(m => m.senderRole === "guest" && m.createdAt > Date.now() - 60000);
    if (recent.length >= 20 || previous.length >= 500) fail(429, "Please pause before sending more messages.");
    db.insert(messages).values({ ...input, inviteId: invite.id, senderRole: "guest", senderName: "Guest (not yet verified)", createdAt: Date.now() }).run();
    const admins = await storage.listAdmins();
    void notifyUsers(admins.map(a => a.id), "chat", {
      previewTitle: "New invitation chat message", previewBody: "Open Chat invitations to reply.",
      genericTitle: "New invitation chat message", genericBody: "Open Chat invitations to reply.", url: "/admin/chat",
    }).catch(() => {});
    res.json({ ok: true });
  }));
  app.post("/api/guest-chat/:id/decline", safe(async (req, res) => {
    const invite = checkGuest(req);
    db.update(invites).set({ declinedAt: Date.now(), sessionHash: null, verificationHash: null }).where(eq(invites.id, invite.id)).run();
    cookie(res, invite.id, "", 0);
    res.json({ ok: true });
  }));
  app.post("/api/guest-chat/:id/send-code", safe(async (req, res) => {
    const invite = checkGuest(req), now = Date.now();
    const { email } = z.object({ email: z.string().trim().toLowerCase().email().max(254) }).parse(req.body);
    if (invite.verificationSentAt && now - invite.verificationSentAt < 60000) fail(429, "Please wait one minute before requesting another code.");
    if (invite.verificationSends >= 5) fail(429, "Please contact MAHA to complete verification.");
    if (invite.intendedUserId && activePartner(invite.intendedUserId).email.toLowerCase() !== email) fail(400, "Use the email address of the invited partner account, or contact MAHA.");
    const account = accountByEmail(email);
    if (account && (account.role !== "partner" || account.status !== "approved" || account.archivedAt)) fail(403, "Please contact MAHA about access to this account.");
    const code = String(crypto.randomInt(100000, 1000000));
    db.update(invites).set({ verificationEmail: email, verificationHash: hash(`${invite.id}:${code}`),
      verificationExpiresAt: now + 10 * 60000, verificationSentAt: now, verificationAttempts: 0,
      verificationSends: invite.verificationSends + 1 }).where(eq(invites.id, invite.id)).run();
    const result = await sendEmail([email], "Your MAHA chat verification code",
      `<p>Your MAHA verification code is:</p><p style="font-size:28px;letter-spacing:4px">${code}</p><p>It expires in 10 minutes. Do not share this code. If you did not request it, ignore this email.</p>`);
    if (!result[0]?.ok) {
      db.update(invites).set({ verificationHash: null }).where(eq(invites.id, invite.id)).run();
      fail(502, "The verification email could not be sent. Please try again shortly.");
    }
    res.json({ ok: true });
  }));
  app.post("/api/guest-chat/:id/verify", safe(async (req, res) => {
    const invite = checkGuest(req);
    const input = z.object({ code: z.string().regex(/^\d{6}$/), firstName: z.string().trim().max(100),
      lastName: z.string().trim().max(100), prefix: z.string().trim().max(40).optional(),
      acceptedLegal: z.literal(true) }).parse(req.body);
    if (!invite.verificationHash || (invite.verificationExpiresAt ?? 0) < Date.now() || invite.verificationAttempts >= 5) fail(400, "Request a new verification code.");
    db.update(invites).set({ verificationAttempts: invite.verificationAttempts + 1 }).where(eq(invites.id, invite.id)).run();
    if (invite.verificationHash !== hash(`${invite.id}:${input.code}`)) fail(400, "Incorrect verification code.");
    // Hash outside the synchronous transaction; recheck invitation state
    // inside it so concurrent redemption cannot create duplicate chats/users.
    const passwordHash = await bcrypt.hash(secret(), 10);
    const session = secret(), expiresAt = Date.now() + 90 * 24 * HOUR;
    const threadId = db.transaction(() => {
      const fresh = checkGuest(req);
      if (fresh.verificationHash !== invite.verificationHash) fail(409, "Please use the latest verification code.");
      let user = accountByEmail(invite.verificationEmail!);
      if (!user) {
        if (!input.firstName || !input.lastName) fail(400, "Enter your first and last name to create your account.");
        user = db.insert(users).values({ role: "partner", status: "approved", email: invite.verificationEmail!, passwordHash,
          name: [input.prefix, input.firstName, input.lastName].filter(Boolean).join(" "), firstName: input.firstName,
          lastName: input.lastName, prefix: input.prefix || null, username: `partner-${crypto.randomUUID()}`,
          approvalEmailNotified: true, legalAcceptedVersion: CURRENT_LEGAL_VERSION, legalAcceptedAt: Date.now(), createdAt: Date.now() }).returning().get();
      }
      activePartner(user.id);
      if (fresh.intendedUserId && fresh.intendedUserId !== user.id) fail(403, "This invitation is for another account.");
      db.update(users).set({ legalAcceptedVersion: CURRENT_LEGAL_VERSION, legalAcceptedAt: Date.now() }).where(eq(users.id, user.id)).run();
      const thread = linkChat(invite.id, user.id);
      db.insert(sessions).values({ token: session, userId: user.id, expiresAt }).run();
      return thread;
    });
    setSession(res, session, expiresAt);
    cookie(res, invite.id, "", 0);
    res.json({ threadId });
  }));
  app.post("/api/guest-chat/:id/keep", requireAuth, safe(async (req, res) => {
    const invite = checkGuest(req);
    if (req.user.role !== "partner" || req.user.impersonating) fail(403, "Sign in with your own partner account.");
    res.json({ threadId: linkChat(invite.id, req.user.id) });
  }));
}
