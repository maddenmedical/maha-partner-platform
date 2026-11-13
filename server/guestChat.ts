import type { Express, RequestHandler, Response } from "express";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import multer from "multer";
import path from "node:path";
import { parse, serialize } from "cookie";
import { z } from "zod";
import { and, eq, desc, asc, isNull, sql } from "drizzle-orm";
import { db, storage } from "./storage";
import { guestChatInvites as invites, guestChatMessages as messages, guestChatFiles as files, guestChatMarks as marks,
  users, chatThreads, chatMessages, chatMessageFlags, chatMessageReactions, uploadedFiles, sessions } from "@shared/schema";
import { uploadToDrive, streamFromDriveRanged } from "./googleDrive";
import { CURRENT_LEGAL_VERSION } from "@shared/legalVersion";
import { sendEmail } from "./email";
import { notifyUsers } from "./push";

const hash = (value: string) => crypto.createHash("sha256").update(value).digest("hex");
const secret = () => crypto.randomBytes(32).toString("hex");
const HOUR = 3600000;
type Invite = typeof invites.$inferSelect;
type GuestNextStep = "sign-in" | "review-in-chat" | "check-email";
const fail = (status: number, message: string, nextStep?: GuestNextStep): never => { throw Object.assign(new Error(message), { status, nextStep }); };
const find = (id: string) => db.select().from(invites).where(eq(invites.id, id)).get() ?? fail(404, "Invitation not found.");
const rows = (id: string) => db.select().from(messages).where(eq(messages.inviteId, id)).orderBy(asc(messages.id)).all();
const fileRows = (id: string) => db.select().from(files).where(eq(files.inviteId, id)).all();
const markRows = (id: string) => db.select().from(marks).where(eq(marks.inviteId, id)).all();
const actor = (req: any, admin: boolean) => admin ? `admin:${req.user.id}` : "guest";
function editable(invite: Invite) {
  if (invite.linkedThreadId || invite.declinedAt || invite.revokedAt) fail(409, "This guest session is closed. Open the linked chat or send a new invitation.");
}
function messageIn(inviteId: string, id: number) {
  return db.select().from(messages).where(and(eq(messages.id, id), eq(messages.inviteId, inviteId))).get() ?? fail(404, "Message not found.");
}
function present(inviteId: string, actorKey: string, admin: boolean) {
  const attachments = fileRows(inviteId), allMarks = markRows(inviteId);
  return rows(inviteId).map(m => {
    const file = m.deletedAt ? undefined : attachments.find(f => f.id === m.attachmentId);
    const reactions = allMarks.filter(mark => mark.messageId === m.id && mark.kind === "reaction");
    return { id: m.id, threadId: 0, senderId: m.senderId ?? 0, senderRole: m.senderRole, senderName: m.senderName,
      body: m.deletedAt ? "" : m.body, createdAt: m.createdAt, editedAt: m.editedAt, deletedAt: m.deletedAt,
      deletedByName: admin ? m.deletedByName : null, replyToMessageId: m.replyToMessageId,
      attachmentUrl: file ? `${admin ? "/api/admin/guest-chats" : "/api/guest-chat"}/${inviteId}/files/${file.id}` : null,
      attachmentType: file?.type ?? null, attachmentName: file?.name ?? null,
      flaggedByMe: allMarks.some(mark => mark.messageId === m.id && mark.kind === "star" && mark.actorKey === actorKey),
      reactions: m.deletedAt ? [] : Array.from(new Set(reactions.map(r => r.emoji!))).map(emoji => {
        const group = reactions.filter(r => r.emoji === emoji);
        return { emoji, count: group.length, mine: group.some(r => r.actorKey === actorKey), userNames: group.map(r => r.actorName) };
      }) };
  });
}
const messageInput = z.object({ body: z.string().trim().max(5000).default(""), requestId: z.string().uuid(),
  attachmentUrl: z.string().max(500).optional(), attachmentType: z.string().max(30).optional(),
  attachmentName: z.string().max(200).optional(), replyToMessageId: z.number().int().positive().optional() });
function send(req: any, invite: Invite, admin: boolean) {
  editable(invite);
  const input = messageInput.parse(req.body), actorKey = actor(req, admin);
  const previous = rows(invite.id);
  const retry = previous.find(m => m.requestId === input.requestId);
  if (retry) {
    if (retry.senderRole !== (admin ? "admin" : "guest") || (admin && retry.senderId !== req.user.id)) fail(409, "Please retry with a new message identifier.");
    return false;
  }
  if (!input.body && !input.attachmentUrl) fail(400, "Write a message or attach a file.");
  if (previous.length >= 500 || previous.filter(m => m.senderRole === (admin ? "admin" : "guest") && m.createdAt > Date.now() - 60000).length >= 20)
    fail(429, "Please pause before sending more messages.");
  let file: typeof files.$inferSelect | undefined;
  if (input.attachmentUrl) {
    file = fileRows(invite.id).find(f => input.attachmentUrl === `${admin ? "/api/admin/guest-chats" : "/api/guest-chat"}/${invite.id}/files/${f.id}`);
    if (!file || file.uploaderKey !== actorKey) fail(400, "Choose a file uploaded by you in this conversation.");
    if (input.attachmentType && input.attachmentType !== file!.type) fail(400, "Attachment type does not match.");
    if (input.attachmentName && input.attachmentName !== file!.name) fail(400, "Attachment name does not match.");
  }
  if (input.replyToMessageId && messageIn(invite.id, input.replyToMessageId).deletedAt) fail(400, "That message was deleted. Cancel the reply and try again.");
  db.insert(messages).values({ inviteId: invite.id, senderId: admin ? req.user.id : null,
    senderRole: admin ? "admin" : "guest", senderName: admin ? req.user.name : "Guest (not yet verified)",
    body: input.body, requestId: input.requestId, createdAt: Date.now(),
    attachmentId: file?.id ?? null, replyToMessageId: input.replyToMessageId ?? null }).run();
  return true;
}
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
function checkGuestAccount(user: typeof users.$inferSelect) {
  if (user.role !== "partner") fail(403,
    "This email is already linked to a MAHA account that is not a partner account. Open your existing account in a separate tab, or use your partner-account email if you have one. Signing in separately will not attach this guest conversation to that account.",
    "sign-in");
  if (user.archivedAt || user.status === "rejected") fail(403,
    "This existing partner account is not currently active. You can continue chatting here. Ask the MAHA team in this conversation to review access to your existing account before keeping the chat. Please do not create a second account.",
    "review-in-chat");
  if (user.status !== "approved") fail(403,
    "This partner account is still awaiting approval. You can continue chatting here. Ask the MAHA team in this conversation to review your existing account, then try keeping the chat again. Please do not create a second account.",
    "review-in-chat");
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
    const attachments = fileRows(inviteId), mapping = new Map<number, number>();
    const transcript = rows(inviteId);
    for (const file of attachments.filter(f => transcript.some(m => m.attachmentId === f.id))) {
      db.insert(uploadedFiles).values({ driveFileId: file.driveFileId, filename: file.name, mimeType: file.mimeType,
        size: file.size, category: "chat", ownerId: user.id, threadId: thread.id, uploadedAt: file.createdAt }).run();
    }
    for (const message of transcript) {
      const file = attachments.find(f => f.id === message.attachmentId);
      const transferred = db.insert(chatMessages).values({
        threadId: thread.id, senderId: message.senderRole === "admin" ? message.senderId! : user.id,
        senderRole: message.senderRole === "admin" ? "admin" : "partner",
        senderName: message.senderRole === "admin" ? message.senderName : "Guest (before account verification)",
        body: message.body, createdAt: message.createdAt, editedAt: message.editedAt,
        deletedAt: message.deletedAt, deletedByName: message.deletedByName,
        attachmentUrl: file ? `/api/files/${file.driveFileId}` : null, attachmentType: file?.type, attachmentName: file?.name,
      }).returning().get();
      mapping.set(message.id, transferred.id);
    }
    for (const message of transcript) if (message.replyToMessageId) {
      db.update(chatMessages).set({ replyToMessageId: mapping.get(message.replyToMessageId) ?? null })
        .where(eq(chatMessages.id, mapping.get(message.id)!)).run();
    }
    for (const mark of markRows(inviteId)) {
      const messageId = mapping.get(mark.messageId);
      if (!messageId) continue;
      const markUserId = mark.actorKey === "guest" ? user.id : Number(mark.actorKey.split(":")[1]);
      if (!db.select({ id: users.id }).from(users).where(eq(users.id, markUserId)).get()) continue;
      if (mark.kind === "star") db.insert(chatMessageFlags).values({ messageId, userId: markUserId, createdAt: mark.createdAt }).run();
      else db.insert(chatMessageReactions).values({ messageId, userId: markUserId, emoji: mark.emoji!,
        userName: mark.actorKey === "guest" ? "Guest (before account verification)" : mark.actorName, createdAt: mark.createdAt }).run();
    }
    db.update(invites).set({ linkedUserId: userId, linkedThreadId: thread.id, linkedBy, linkedAt: now,
      sessionHash: null, verificationHash: null }).where(eq(invites.id, inviteId)).run();
    return thread.id;
  });
}
const safe = (fn: (req: any, res: Response) => any): RequestHandler => async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try { await fn(req, res); } catch (error: any) {
    if (res.headersSent) { res.end(); return; }
    res.status(error.status || (error instanceof z.ZodError ? 400 : 500))
      .json({ message: error.status ? error.message : error instanceof z.ZodError ? "Please check the required fields." : "Could not complete this action. Please try again.",
        ...(error.status && error.nextStep ? { nextStep: error.nextStep } : {}) });
  }
};
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024, files: 1, fields: 2, parts: 3 } }).single("file");
const uploading = new Set<string>();
function inspectFile(file: Express.Multer.File) {
  const ext = path.extname(file.originalname).toLowerCase();
  const b = file.buffer, ascii = (a: number, n: number) => b.subarray(a, a + n).toString("ascii");
  const hex = b.subarray(0, 12).toString("hex");
  let mimeType = "", type = "document", valid = false;
  switch (ext) {
    case ".pdf": mimeType = "application/pdf"; valid = ascii(0, 5) === "%PDF-"; break;
    case ".txt": mimeType = "text/plain"; valid = !b.includes(0); break;
    case ".doc": case ".xls": case ".ppt":
      mimeType = ({ ".doc": "application/msword", ".xls": "application/vnd.ms-excel", ".ppt": "application/vnd.ms-powerpoint" })[ext]!;
      valid = hex.startsWith("d0cf11e0a1b11ae1"); break;
    case ".docx": case ".xlsx": case ".pptx":
      mimeType = `application/vnd.openxmlformats-officedocument.${({ ".docx": "wordprocessingml.document", ".xlsx": "spreadsheetml.sheet", ".pptx": "presentationml.presentation" })[ext]}`;
      valid = hex.startsWith("504b0304"); break;
    case ".jpg": case ".jpeg": type = "image"; mimeType = "image/jpeg"; valid = hex.startsWith("ffd8ff"); break;
    case ".png": type = "image"; mimeType = "image/png"; valid = hex.startsWith("89504e470d0a1a0a"); break;
    case ".gif": type = "image"; mimeType = "image/gif"; valid = ["GIF87a", "GIF89a"].includes(ascii(0, 6)); break;
    case ".webp": type = "image"; mimeType = "image/webp"; valid = ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP"; break;
    case ".mp4": case ".mov": case ".m4a":
      type = ext === ".m4a" ? "audio" : "video"; mimeType = type === "audio" ? "audio/mp4" : "video/mp4";
      valid = ascii(4, 4) === "ftyp"; break;
    case ".webm": type = file.mimetype.startsWith("audio/") ? "audio" : "video"; mimeType = `${type}/webm`; valid = hex.startsWith("1a45dfa3"); break;
    case ".mp3": type = "audio"; mimeType = "audio/mpeg"; valid = ascii(0, 3) === "ID3" || (b[0] === 255 && (b[1] & 224) === 224); break;
    case ".wav": type = "audio"; mimeType = "audio/wav"; valid = ascii(0, 4) === "RIFF" && ascii(8, 4) === "WAVE"; break;
    case ".ogg": type = "audio"; mimeType = "audio/ogg"; valid = ascii(0, 4) === "OggS"; break;
  }
  if (!b.length || !valid) fail(400, "Unsupported or invalid file. Choose a photo, PDF, Office document, text file, audio or video.");
  return { mimeType, type, name: path.basename(file.originalname).replace(/[\x00-\x1f\x7f]/g, "").slice(0, 180) || `attachment${ext}` };
}
export function registerGuestChatRoutes(app: Express, requireAuth: RequestHandler, requireAdmin: RequestHandler,
  optionalUser: (req: any) => Promise<any>, setSession: (res: Response, token: string, expiresAt: number) => void) {
  const admin = [requireAuth, requireAdmin];
  for (const isAdmin of [false, true]) {
    const prefix = isAdmin ? "/api/admin/guest-chats/:id" : "/api/guest-chat/:id";
    const guards = isAdmin ? admin : [];
    const access = (req: any) => isAdmin ? find(req.params.id) : checkGuest(req);
    app.post(`${prefix}/upload`, ...guards, safe(async (req, res) => {
      const invite = access(req); editable(invite);
      if (uploading.has(invite.id)) fail(429, "Another upload is in progress. Please wait.");
      const existing = fileRows(invite.id);
      if (existing.length >= 25 || existing.reduce((n, f) => n + f.size, 0) >= 100 * 1024 * 1024)
        fail(429, "This temporary chat has reached its upload limit. Keep the chat in a partner account to continue.");
      uploading.add(invite.id);
      try {
        await new Promise<void>((resolve, reject) => upload(req, res, err => err ? reject(Object.assign(new Error("Upload failed. Maximum 20 MB per file."), { status: 400 })) : resolve()));
        if (!req.file) fail(400, "Choose a file.");
        const info = inspectFile(req.file);
        if (existing.reduce((n, f) => n + f.size, 0) + req.file.size > 100 * 1024 * 1024) fail(429, "This chat has reached its 100 MB upload limit.");
        const result = await uploadToDrive(req.file.buffer, info.name, info.mimeType);
        // Linking/revocation can happen while Drive is uploading. Do not grant
        // access based on the old session snapshot.
        editable(access(req));
        const id = crypto.randomUUID();
        db.insert(files).values({ id, inviteId: invite.id, uploaderKey: actor(req, isAdmin), driveFileId: result.driveFileId,
          ...info, size: req.file.size, createdAt: Date.now() }).run();
        res.json({ url: `${isAdmin ? "/api/admin/guest-chats" : "/api/guest-chat"}/${invite.id}/files/${id}`, ...info });
      } finally { uploading.delete(invite.id); }
    }));
    app.get(`${prefix}/files/:fileId`, ...guards, safe(async (req, res) => {
      const invite = access(req);
      const file = db.select().from(files).where(and(eq(files.id, req.params.fileId), eq(files.inviteId, invite.id))).get();
      if (!file) fail(404, "File not found.");
      const attached = rows(invite.id).filter(m => m.attachmentId === file!.id);
      if (!isAdmin && !attached.some(m => !m.deletedAt) && (attached.length || file!.uploaderKey !== actor(req, false))) fail(403, "File is not available.");
      const result = await streamFromDriveRanged(file!.driveFileId, req.headers.range);
      // Recheck after the external read too, before releasing any bytes.
      try { access(req); } catch (e) { (result.stream as any).destroy?.(); throw e; }
      res.status(result.status === 206 ? 206 : 200);
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Content-Security-Policy", "sandbox; default-src 'none'");
      res.setHeader("Content-Type", file!.mimeType);
      res.setHeader("Accept-Ranges", "bytes");
      if (result.headers["content-range"]) res.setHeader("Content-Range", result.headers["content-range"]);
      if (result.headers["content-length"]) res.setHeader("Content-Length", result.headers["content-length"]);
      res.setHeader("Content-Disposition", `${file!.type === "document" || req.query.download === "1" ? "attachment" : "inline"}; filename="attachment${path.extname(file!.name)}"; filename*=UTF-8''${encodeURIComponent(file!.name)}`);
      result.stream.on("error", () => { if (!res.headersSent) res.status(502).json({ message: "Could not load attachment." }); else res.end(); });
      result.stream.pipe(res);
    }));
    for (const kind of ["star", "reaction"] as const) {
      app.post(`${prefix}/messages/:messageId/${kind}`, ...guards, safe(async (req, res) => {
        const invite = access(req);
        if (invite.linkedThreadId) fail(409, "Open the linked member chat to continue.");
        const message = messageIn(invite.id, Number(req.params.messageId));
        if (message.deletedAt) fail(400, "This message was deleted.");
        const emoji = kind === "reaction" ? z.object({ emoji: z.string().min(1).max(20).regex(new RegExp("^[\\p{Extended_Pictographic}\\p{Emoji_Component}\\u200d\\uFE0F]+$", "u")) }).parse(req.body).emoji : null;
        const actorKey = actor(req, isAdmin), id = `${message.id}:${actorKey}:${kind}`;
        const old = db.select().from(marks).where(eq(marks.id, id)).get();
        db.transaction(() => {
          if (old) db.delete(marks).where(eq(marks.id, id)).run();
          if (!old || (kind === "reaction" && old.emoji !== emoji))
            db.insert(marks).values({ id, inviteId: invite.id, messageId: message.id, actorKey,
              actorName: isAdmin ? req.user.name : "Guest (not yet verified)", kind, emoji, createdAt: Date.now() }).run();
        });
        res.json({ ok: true });
      }));
    }
  }
  app.patch("/api/admin/guest-chats/:id/messages/:messageId", ...admin, safe(async (req, res) => {
    const invite = find(req.params.id); editable(invite);
    const message = messageIn(invite.id, Number(req.params.messageId));
    if (message.senderRole !== "admin" || message.senderId !== req.user.id || message.deletedAt) fail(403, "Only your own undeleted messages can be edited.");
    const { body } = z.object({ body: z.string().trim().min(1).max(5000) }).parse(req.body);
    db.update(messages).set({ body, editedAt: Date.now() }).where(eq(messages.id, message.id)).run();
    res.json({ ok: true });
  }));
  app.delete("/api/admin/guest-chats/:id/messages/:messageId", ...admin, safe(async (req, res) => {
    const invite = find(req.params.id); editable(invite);
    const message = messageIn(invite.id, Number(req.params.messageId));
    if (!message.deletedAt) db.update(messages).set({ deletedAt: Date.now(), deletedByName: req.user.name }).where(eq(messages.id, message.id)).run();
    res.json({ ok: true });
  }));
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
    res.json({ messages: present(invite.id, actor(req, true), true), linkedThreadId: invite.linkedThreadId });
  }));
  app.post("/api/admin/guest-chats/:id/reply", ...admin, safe(async (req, res) => {
    const invite = find(req.params.id);
    send(req, invite, true);
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
    res.json({ topic: invite.topic, messages: present(invite.id, "guest", false), expiresAt: invite.sessionExpiresAt });
  }));
  app.post("/api/guest-chat/:id/message", safe(async (req, res) => {
    const invite = checkGuest(req);
    if (!send(req, invite, false)) return res.json({ ok: true });
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
    if (invite.verificationSends >= 5) fail(429, "For security, no more codes can be requested with this invitation. Continue this conversation and ask the MAHA team here for a new invitation.", "review-in-chat");
    if (invite.intendedUserId) {
      const intended = db.select().from(users).where(eq(users.id, invite.intendedUserId)).get();
      if (!intended || intended.email.toLowerCase() !== email) fail(400, "This invitation is for a different partner email. Enter the email address the invitation was intended for. If you are unsure, continue this conversation and ask the MAHA team here.", "check-email");
      checkGuestAccount(intended!);
    }
    const account = accountByEmail(email);
    if (account) checkGuestAccount(account);
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
      checkGuestAccount(user);
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
    const account = db.select().from(users).where(eq(users.id, req.user.id)).get();
    if (account) checkGuestAccount(account);
    res.json({ threadId: linkChat(invite.id, req.user.id) });
  }));
}
