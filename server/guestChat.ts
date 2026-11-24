import type { Express, RequestHandler, Response } from "express";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import multer from "multer";
import path from "node:path";
import { parse, serialize } from "cookie";
import { z } from "zod";
import { and, eq, desc, asc, isNull, lt, gt, sql } from "drizzle-orm";
import { db, storage } from "./storage";
import { guestChatInvites as invites, guestChatRecoveries as repairs, guestChatMessages as messages, guestChatFiles as files, guestChatMarks as marks,
  users, chatThreads, chatMessages, chatMessageFlags, chatMessageReactions, uploadedFiles, sessions } from "@shared/schema";
import { uploadToDrive, streamFromDriveRanged } from "./googleDrive";
import { CURRENT_LEGAL_VERSION } from "@shared/legalVersion";
import { sendEmail } from "./email";
import { notifyUsers } from "./push";
import { readAdminConversationNotices } from "./notificationStore";
import { recordInboxRead, inboxInvitations, carryInvitationReads } from "./adminInbox";
import {clearGuestPush,enrollGuest,notifyGuest} from "./guestPush";
import {activeGuest} from "./guestAccess";

const hash = (value: string) => crypto.createHash("sha256").update(value).digest("hex");
const secret = () => crypto.randomBytes(32).toString("hex");
const HOUR = 3600000;
// Browser storage only; never used to compute server authorization.
const DEVICE_COOKIE_LIFETIME=400*24*HOUR;
type Invite = typeof invites.$inferSelect;
type GuestNextStep = "sign-in" | "review-in-chat" | "check-email";
const fail = (status: number, message: string, nextStep?: GuestNextStep): never => { throw Object.assign(new Error(message), { status, nextStep }); };
const find = (id: string) => db.select().from(invites).where(eq(invites.id, id)).get() ?? fail(404, "Invitation not found.");
const rows = (id: string) => db.select().from(messages).where(eq(messages.inviteId, id)).orderBy(asc(messages.id)).all();
const fileRows = (id: string) => db.select().from(files).where(eq(files.inviteId, id)).all();
const markRows = (id: string) => db.select().from(marks).where(eq(marks.inviteId, id)).all();
const actor = (req: any, admin: boolean) => admin ? `admin:${req.user.id}` : req.sharedActor || "guest";
const sharedName="Shared link guest";
const sharedCookie=(id:string)=>`maha_share_${id.replace(/-/g,"")}`;
const sharing=(i:Invite)=>!!(i.sharedLinkKey&&i.openedAt&&!i.revokedAt&&!i.declinedAt&&!i.linkedThreadId);
const signShare=(i:Invite,nonce:string)=>crypto.createHmac("sha256",i.sharedLinkKey!).update(`${i.id}:${nonce}`).digest("hex");
function sharedBrowser(req:any,i:Invite){
  if(!sharing(i))return null;
  const raw=parse(req.headers.cookie||"")[sharedCookie(i.id)]||"";
  if(!/^[a-f0-9]{64}\.[a-f0-9]{64}$/.test(raw))return null;
  const [nonce,sig]=raw.split(".");if(!crypto.timingSafeEqual(Buffer.from(sig,"hex"),Buffer.from(signShare(i,nonce),"hex")))return null;
  return nonce;
}
function openShared(req:any,res:Response,i:Invite){
  const n=sharedBrowser(req,i)||secret();
  res.append("Set-Cookie",serialize(sharedCookie(i.id),`${n}.${signShare(i,n)}`,{httpOnly:true,sameSite:"lax",secure:process.env.NODE_ENV==="production",path:`/api/guest-chat/${i.id}`,maxAge:DEVICE_COOKIE_LIFETIME/1000}));
  res.set("Cache-Control","private, no-store").json({state:"shared",...(i.sharedNoticeAt?{sharedNotice:true}:{})});
}
function sharedOperation(method:string,path:string){
  return method==="GET"&&(path==="/"||/^\/files\/[a-f0-9-]+$/.test(path))||
    method==="POST"&&(/^\/(message|upload)$/.test(path)||/^\/messages\/\d+\/(star|reaction)$/.test(path));
}
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
      sharedAuthor:!!m.sharedActor, mineBySharedBrowser:!!m.sharedActor&&m.sharedActor===actorKey,
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
    if (retry.senderRole !== (admin ? "admin" : "guest") || (admin && retry.senderId !== req.user.id) || (!admin&&(retry.sharedActor||null)!==(req.sharedActor||null))) fail(409, "Please retry with a new message identifier.");
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
    senderRole: admin ? "admin" : "guest", senderName: admin ? req.user.name : req.sharedActor?sharedName:"Guest (not yet verified)",sharedActor:admin?null:req.sharedActor||null,
    body: input.body, requestId: input.requestId, createdAt: Date.now(),
    attachmentId: file?.id ?? null, replyToMessageId: input.replyToMessageId ?? null }).run();
  return true;
}
const accountByEmail = (email: string) => db.select().from(users).where(sql`lower(${users.email}) = ${email.toLowerCase()}`).get();
const cookieName = (id: string) => `maha_guest_${id.replace(/-/g, "")}`;
const repairName=(id:string)=>`maha_repair_${id.replace(/-/g,"")}`;
const REPAIR_WINDOW=20*60000;
const repairCode=(proof:string,id:string)=>hash(`match:${id}:${proof}`).slice(0,12).toUpperCase();
const generation=(i:Invite)=>hash(`device:${i.id}:${i.openedAt}:${i.sessionHash??""}`);
const repairSession=(proof:string)=>hash(`recovered-session:${proof}`);
function limitRepair(req:any,kind:string,max:number){
  const now=Date.now(),key=`${kind}:${req.ip||req.socket.remoteAddress}`;
  if(now>=repairWindow){repairWindow=now+10*60000;repairRates.clear();repairTotal=0;}
  if(repairTotal>=2400||(repairRates.get(key)||0)>=max)fail(429,"Too many requests. Please try again in ten minutes.");
  repairTotal++;repairRates.set(key,(repairRates.get(key)||0)+1);
}
const repairRates=new Map<string,number>();let repairWindow=0,repairTotal=0;
function original(i:Invite,body:unknown){
  const {token}=z.object({token:z.string().regex(/^[a-f0-9]{64}$/)}).parse(body);
  if(hash(token)!==i.tokenHash||i.revokedAt||i.declinedAt)fail(403,"This invitation is not available. Contact MAHA in your original conversation.");
}
function hasDevice(req:any,i:Invite){
  const key=i.personalNoticeVersion===1?req.get("x-maha-page-key"):parse(req.headers.cookie||"")[cookieName(i.id)];
  return !!(!i.sharedLinkKey&&i.openedAt&&!i.revokedAt&&!i.declinedAt&&!i.linkedThreadId&&key&&hash(key)===i.sessionHash);
}
function repairEligible(i:Invite){editable(i);if(i.personalNoticeVersion===1||i.sharedLinkKey||!i.openedAt)fail(409,"Private browser restoration is not available for this invitation.");}
function onlyApp(req:any){
  if(!req.is("application/json")||req.get("sec-fetch-site")==="cross-site")fail(415,"Use the personal link in MAHA.");
}
function cookie(res: Response, id: string, token: string, expires: number) {
  res.append("Set-Cookie", serialize(cookieName(id), token, { httpOnly: true, secure: process.env.NODE_ENV === "production",
    sameSite: "lax", path: `/api/guest-chat/${id}`, expires: new Date(expires) }));
}
function checkGuest(req: any): Invite {
  const invite = find(String(req.params.id));
  if(req.sharedActor){
    const n=sharedBrowser(req,invite);if(!n||req.sharedActor!==`shared:${hash(n)}`)fail(403,"Shared access has ended.");
    return invite;
  }
  if(invite.personalNoticeVersion===1){
    if(!hasDevice(req,invite))fail(403,"This guest session has ended. If you registered, sign in to your MAHA Portal account.");
    return invite;
  }
  const token = parse(req.headers.cookie || "")[cookieName(invite.id)];
  if (!activeGuest(invite)||!token||hash(token)!==invite.sessionHash) {
    fail(403, "Guest access has ended. Please contact MAHA to recover this conversation.");
  }
  if(invite.guestDurableSince==null)touchGuest(req,req.res,invite);
  return invite;
}
function touchGuest(req:any,res:Response,invite:Invite) {
  if(req.sharedActor||invite.personalNoticeVersion===1)return;
  if(invite.guestDurableSince==null){
    invite.guestDurableSince=Date.now();
    db.update(invites).set({guestDurableSince:invite.guestDurableSince,sessionExpiresAt:null}).where(eq(invites.id,invite.id)).run();
    invite.sessionExpiresAt=null;
  }
  if(!res.locals.guestCookieRenewed){cookie(res,invite.id,parse(req.headers.cookie||"")[cookieName(invite.id)]!,Date.now()+DEVICE_COOKIE_LIFETIME);res.locals.guestCookieRenewed=true;}
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
    if(invite.sharedLinkKey)fail(409,"Turn off shared-link access before connecting a verified account.");
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
        threadId: thread.id, senderId: message.sharedActor?0:message.senderRole === "admin" ? message.senderId! : user.id,
        senderRole: message.sharedActor?"guest":message.senderRole === "admin" ? "admin" : "partner",
        senderName: message.sharedActor?sharedName:message.senderRole === "admin" ? message.senderName : "Guest (before account verification)",
        body: message.body, createdAt: message.createdAt, editedAt: message.editedAt,
        deletedAt: message.deletedAt, deletedByName: message.deletedByName,
        attachmentUrl: file ? `/api/files/${file.driveFileId}` : null, attachmentType: file?.type, attachmentName: file?.name,
      }).returning().get();
      mapping.set(message.id, transferred.id);
    }
    carryInvitationReads(invite.id,thread.id,mapping);
    for (const message of transcript) if (message.replyToMessageId) {
      db.update(chatMessages).set({ replyToMessageId: mapping.get(message.replyToMessageId) ?? null })
        .where(eq(chatMessages.id, mapping.get(message.id)!)).run();
    }
    for (const mark of markRows(inviteId)) {
      const messageId = mapping.get(mark.messageId);
      if (!messageId||mark.actorKey.startsWith("shared:")) continue;
      const markUserId = mark.actorKey === "guest" ? user.id : Number(mark.actorKey.split(":")[1]);
      if (!db.select({ id: users.id }).from(users).where(eq(users.id, markUserId)).get()) continue;
      if (mark.kind === "star") db.insert(chatMessageFlags).values({ messageId, userId: markUserId, createdAt: mark.createdAt }).run();
      else db.insert(chatMessageReactions).values({ messageId, userId: markUserId, emoji: mark.emoji!,
        userName: mark.actorKey === "guest" ? "Guest (before account verification)" : mark.actorName, createdAt: mark.createdAt }).run();
    }
    db.update(invites).set({ linkedUserId: userId, linkedThreadId: thread.id, linkedBy, linkedAt: now,
      sessionHash: null, verificationHash: null,deviceMoveHash:null,deviceMoveUntil:null,...clearGuestPush }).where(eq(invites.id, inviteId)).run();
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
  app.use("/api/guest-chat/:id",async(req,res,next)=>{
    // This allowlist never treats a link visitor as the original guest or the
    // browser's signed-in account. No registration, transfer, decline or push.
    try{const i=find(req.params.id);if(i.sharedLinkKey){
      if(req.path==="/return")return next();
      const n=sharedBrowser(req,i);
      if(!n||!sharedOperation(req.method,req.path))return res.status(403).set("Cache-Control","no-store").json({message:"This action is unavailable. Open the original invitation."});
      if(req.method==="POST"&&req.get("sec-fetch-site")==="cross-site")return res.sendStatus(403);
      (req as any).sharedActor=`shared:${hash(n)}`;return next();
    }
    // A browser that also owned the original private session must not silently
    // switch identities in an open shared composer when sharing is turned off.
    if(parse(req.headers.cookie||"")[sharedCookie(i.id)]&&req.path!=="/return")
      return res.status(403).set("Cache-Control","no-store").json({message:"Shared access has ended. Reopen the original invitation."});
    if(i.personalNoticeVersion===1&&(/^\/(?:notifications\/|restore(?:\/|$)|device-code(?:\/|$))/i).test(req.path))
      return res.status(403).set("Cache-Control","no-store").json({message:"This personal guest chat is available only in the page where it started."});
    }catch(e){return res.status(404).set("Cache-Control","no-store").json({message:"Invitation not found."});}
    if(req.path==="/start"||req.path==="/keep"||req.path==="/resume"||req.path==="/return")return next();
    try{if(await optionalUser(req))return res.status(409).set("Cache-Control","no-store").json({message:"Use your signed-in account, or sign out to return to a guest chat."});next();}catch(e){next(e);}
  });
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
          if(req.sharedActor&&!old&&markRows(invite.id).length>=3000)fail(429,"Too many reactions or stars in this conversation.");
          if (!old || (kind === "reaction" && old.emoji !== emoji))
            db.insert(marks).values({ id, inviteId: invite.id, messageId: message.id, actorKey,
              actorName: isAdmin ? req.user.name : req.sharedActor?sharedName:"Guest (not yet verified)", kind, emoji, createdAt: Date.now() }).run();
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
  app.get("/api/admin/chat/inbox-invitations", ...admin, safe(async (req,res)=>{
    res.set("Cache-Control","private, no-store").json(inboxInvitations(req.user.id));
  }));
  app.get("/api/admin/guest-chats", ...admin, safe(async (req, res) => {
    const pending=new Set(inboxInvitations(req.user.id).filter(i=>i.unread).map(i=>i.id));
    const list = db.select().from(invites).orderBy(desc(invites.createdAt)).all();
    res.json(list.map(i => {const { id, label, topic, createdAt, intendedUserId, linkedUserId, linkedThreadId, declinedAt, revokedAt, openedAt, expiresAt }=i;
      const conversation = rows(id); const last = conversation.at(-1);
      return { id, label, topic, createdAt, intendedUserId, linkedUserId, linkedThreadId, declinedAt, revokedAt, openedAt, expiresAt,
        linkSharing:sharing(i),
        ...(i.personalNoticeVersion===1?{pageOnly:true}:{}),...(sharing(i)&&i.sharedNoticeAt?{sharedNotice:true}:{}),
        canRemind: activeGuest(i) && last?.senderRole==="admin" && !last.deletedAt && conversation.some(m=>m.senderRole==="guest"),
        guestAccessEnded: !!openedAt && !activeGuest(i) && !sharing(i) && !(i.personalNoticeVersion===1&&i.sessionHash),
        unread: pending.has(id), messageCount: conversation.length };
    }));
  }));
  app.post("/api/admin/guest-chats/:id/link-sharing",...admin,safe(async(req,res)=>{
    onlyApp(req);
    const {enabled,confirmExposure}=z.object({enabled:z.boolean(),confirmExposure:z.boolean()}).strict().parse(req.body);
    const i=find(req.params.id);if(enabled){editable(i);if(!i.openedAt||!confirmExposure)fail(409,"Confirm that anyone with this existing link may read all prior messages and files and reply.");}
    if(!!i.sharedLinkKey!==enabled)db.transaction(()=>{
      const now=Date.now();
      db.update(invites).set({sharedLinkKey:enabled?secret():null,sharedLinkChangedAt:now,sharedLinkChangedBy:req.user.id,sharedNoticeAt:null,sharedNoticeBy:null,...(i.personalNoticeVersion===1?{sessionHash:null}:{}),
        deviceMoveHash:null,deviceMoveUntil:null,verificationHash:null,...clearGuestPush}).where(eq(invites.id,i.id)).run();
      db.update(repairs).set({until:now}).where(eq(repairs.inviteId,i.id)).run();
    });
    res.json({linkSharing:sharing(find(i.id))});
  }));
  app.post("/api/admin/guest-chats/:id/shared-notice",...admin,safe(async(req,res)=>{
    onlyApp(req);const {enabled}=z.object({enabled:z.boolean()}).strict().parse(req.body),i=find(req.params.id);
    if(!sharing(i))fail(409,"This notice is available only for an open shared link.");
    if(!!i.sharedNoticeAt!==enabled)db.update(invites).set({sharedNoticeAt:enabled?Date.now():null,sharedNoticeBy:req.user.id}).where(eq(invites.id,i.id)).run();
    res.json({sharedNotice:!!find(i.id).sharedNoticeAt,linkSharing:true});
  }));
  app.post("/api/admin/guest-chats", ...admin, safe(async (req, res) => {
    const input = z.object({ label: z.string().trim().min(1).max(120), topic: z.string().trim().min(1).max(160),
      message: z.string().trim().min(1).max(5000), intendedUserId: z.number().int().positive().nullable() }).parse(req.body);
    if (input.intendedUserId) activePartner(input.intendedUserId);
    const id = crypto.randomUUID(), token = secret(), now = Date.now();
    db.transaction(() => {
      db.insert(invites).values({ id, tokenHash: hash(token), createdBy: req.user.id, label: input.label,
        topic: input.topic, intendedUserId: input.intendedUserId, personalNoticeVersion:1, createdAt: now, expiresAt: now + 7 * 24 * HOUR }).run();
      db.insert(messages).values({ inviteId: id, senderId: req.user.id, senderName: req.user.name,
        senderRole: "admin", body: input.message, requestId: crypto.randomUUID(), createdAt: now }).run();
    });
    res.status(201).json({ id, path: `/#/continue-chat/${id}/${token}` });
  }));
  app.get("/api/admin/guest-chats/:id", ...admin, safe(async (req, res) => {
    const invite = find(req.params.id);
    const transcript=present(invite.id,actor(req,true),true);
    recordInboxRead(req.user.id,`invite:${invite.id}`,transcript.reduce((n,m)=>Math.max(n,m.id),0));
    readAdminConversationNotices(req.user.id,`/admin/chat/invitation/${invite.id}`);
    res.json({ messages: transcript, linkedThreadId: invite.linkedThreadId });
  }));
  app.post("/api/admin/guest-chats/:id/reply", ...admin, safe(async (req, res) => {
    const invite = find(req.params.id);
    if(send(req, invite, true))await notifyGuest(invite);
    res.json({ ok: true });
  }));
  app.post("/api/admin/guest-chats/:id/revoke", ...admin, safe(async (req, res) => {
    const invite = find(req.params.id);
    db.update(invites).set({ revokedAt: Date.now(), sharedLinkKey:null,sessionHash: null, verificationHash: null,deviceMoveHash:null,deviceMoveUntil:null,...clearGuestPush }).where(eq(invites.id, invite.id)).run();
    res.json({ ok: true });
  }));
  app.post("/api/admin/guest-chats/:id/link", ...admin, safe(async (req, res) => {
    const { userId } = z.object({ userId: z.number().int().positive() }).parse(req.body);
    res.json({ threadId: linkChat(req.params.id, userId, req.user.id) });
  }));

  // A GET never redeems an invitation: WhatsApp previews/link scanners cannot
  // consume it. Only an explicit Start chat action claims a browser session.
  app.post("/api/guest-chat/:id/start", safe(async (req, res) => {
    const user = await optionalUser(req);
    const invite = find(req.params.id);
    const { token } = z.object({ token: z.string().regex(/^[a-f0-9]{64}$/) }).parse(req.body);
    if (hash(token) !== invite.tokenHash || invite.revokedAt || invite.declinedAt) fail(403, "This invitation is no longer available. Please ask MAHA for a new link.");
    const alreadyHere=hasDevice(req,invite);
    const owner=!!(invite.linkedThreadId&&user?.role==="partner"&&invite.linkedUserId===user.id);
    if(invite.expiresAt<Date.now() && !alreadyHere && !owner)fail(403,"This invitation is no longer available. Please use your original link to restore an opened chat.");
    if(user && invite.openedAt && invite.linkedUserId!==user.id)fail(403,"This guest chat is already on a device. Open it there and choose Register & keep this chat.");
    if (user && user.role === "partner" && user.status === "approved" && !user.archivedAt &&
      (!invite.intendedUserId || invite.intendedUserId === user.id || invite.linkedUserId === user.id)) {
      return res.json({ threadId: linkChat(invite.id, user.id) });
    }
    if (invite.linkedThreadId) fail(403, "This conversation has been saved to a partner account. Sign in to that account to continue.");
    if(user)fail(403,"This invitation is not for this signed-in account. Use the intended partner account or a separate browser.");
    if (alreadyHere) {touchGuest(req,res,invite);return res.json({ok:true});}
    if (invite.openedAt) fail(403, invite.personalNoticeVersion===1?"Guest access cannot be restarted. If you registered, sign in to MAHA Portal.":"This invitation has already been opened on another browser. Ask MAHA for help recovering the conversation.");
    const session = secret(), now = Date.now();
    // A v1 page key is issued exactly once. It is NEVER in a cookie or URL.
    // Refuse obsolete clients before consuming their invitation.
    if(invite.personalNoticeVersion===1&&req.body.pageProtocol!==1)fail(409,"Update or refresh this page before starting your chat.");
    const redeemed = db.update(invites).set({ openedAt: now, sessionHash: hash(session), sessionExpiresAt:null,guestDurableSince:invite.personalNoticeVersion===1?null:now })
      .where(and(eq(invites.id, invite.id), isNull(invites.openedAt), isNull(invites.linkedThreadId), isNull(invites.revokedAt))).run();
    if (!redeemed.changes) fail(409, "This invitation was already opened. Please use the browser where you started.");
    if(invite.personalNoticeVersion===1)return res.json({ok:true,pageKey:session});
    cookie(res, invite.id, session, now + DEVICE_COOKIE_LIFETIME);
    res.json({ ok: true });
  }));
  // Opening an original URL never starts an unclaimed invitation. A used
  // private link is a locator unless an admin explicitly enabled sharing.
  app.post("/api/guest-chat/:id/return",safe(async(req,res)=>{
    onlyApp(req);const initial=find(req.params.id);original(initial,req.body);
    if(sharing(initial))return openShared(req,res,initial);
    const member=await optionalUser(req),i=find(req.params.id);original(i,req.body);
    if(sharing(i))return openShared(req,res,i);
    if(parse(req.headers.cookie||"")[sharedCookie(i.id)])res.append("Set-Cookie",serialize(sharedCookie(i.id),"",{httpOnly:true,sameSite:"lax",secure:process.env.NODE_ENV==="production",path:`/api/guest-chat/${i.id}`,maxAge:0}));
    if(i.linkedThreadId){
      if(member?.role==="partner"&&i.linkedUserId===member.id)return res.json({state:"member",threadId:i.linkedThreadId});
      return res.json({state:"sign-in"});
    }
    if(!i.openedAt)return res.json({state:"start",...(!member&&i.personalNoticeVersion===1?{personalNoticeVersion:1}:{})});
    if(member)return res.json({state:"sign-out"});
    // Require BOTH original secret and matching current device cookie to
    // rescue a legacy deadline. An old rotated cookie cannot pass this test.
    if(hasDevice(req,i)){touchGuest(req,res,i);return res.json({state:"guest"});}
    if(i.personalNoticeVersion===1)return res.json({state:"guest-ended"});
    const proof=parse(req.headers.cookie||"")[repairName(i.id)];
    if(proof){const r=db.select().from(repairs).where(eq(repairs.proofHash,hash(proof))).get();
      if(r&&r.inviteId===i.id&&r.until>Date.now()&&((!r.consumedAt&&r.generation===generation(i))||(r.consumedAt&&i.sessionHash===hash(repairSession(proof)))))
        return res.json({state:"restore",code:repairCode(proof,i.id).match(/.{4}/g)!.join("-"),until:r.until});}
    return res.json({state:"restore"});
  }));
  app.post("/api/guest-chat/:id/restore",safe(async(req,res)=>{
    onlyApp(req);const i=find(req.params.id);original(i,req.body);repairEligible(i);
    const now=Date.now(),existing=parse(req.headers.cookie||"")[repairName(i.id)];
    const prior=existing?db.select().from(repairs).where(eq(repairs.proofHash,hash(existing))).get():null;
    const show=(proof:string,until:number)=>res.json({code:repairCode(proof,i.id).match(/.{4}/g)!.join("-"),until});
    if(prior&&existing&&prior.inviteId===i.id&&prior.generation===generation(i)&&!prior.consumedAt&&prior.until>now)return show(existing,prior.until);
    limitRepair(req,"create",12);
    db.delete(repairs).where(and(lt(repairs.requestedAt,now-24*HOUR),isNull(repairs.approvedAt))).run();
    db.delete(repairs).where(lt(repairs.requestedAt,now-90*24*HOUR)).run();
    if(db.select({n:sql<number>`count(*)`}).from(repairs).where(and(eq(repairs.inviteId,i.id),gt(repairs.requestedAt,now-HOUR))).get()!.n>=12)fail(429,"Too many restore requests for this chat. Please contact MAHA in your original WhatsApp conversation.");
    const proof=secret(),until=now+REPAIR_WINDOW,code=repairCode(proof,i.id);
    db.insert(repairs).values({proofHash:hash(proof),codeHash:hash(`verify:${i.id}:${code}`),inviteId:i.id,generation:generation(i),requestedAt:now,until}).run();
    res.append("Set-Cookie",serialize(repairName(i.id),proof,{path:`/api/guest-chat/${i.id}`,httpOnly:true,sameSite:"strict",secure:process.env.NODE_ENV==="production",expires:new Date(until)}));
    return show(proof,until);
  }));
  app.post("/api/admin/guest-chats/:id/approve-restore",...admin,safe(async(req,res)=>{
    onlyApp(req);limitRepair(req,"approve",24);const i=find(req.params.id);repairEligible(i);
    const {code}=z.object({verifiedOriginalContact:z.literal(true),code:z.string().max(24)}).parse(req.body);
    const normalized=code.replace(/[\s-]/g,"").toUpperCase();
    const row=db.select().from(repairs).where(and(eq(repairs.inviteId,i.id),eq(repairs.codeHash,hash(`verify:${i.id}:${normalized}`)),eq(repairs.generation,generation(i)),gt(repairs.until,Date.now()),isNull(repairs.consumedAt))).get();
    if(!row)fail(409,"No matching current request for this conversation. Recheck the code with the original recipient.");
    if(!row!.approvedAt)db.update(repairs).set({approvedAt:Date.now(),approvedBy:req.user.id}).where(eq(repairs.proofHash,row!.proofHash)).run();
    res.json({ok:true});
  }));
  app.post("/api/guest-chat/:id/restore/check",safe(async(req,res)=>{
    onlyApp(req);const i=find(req.params.id);original(i,req.body);repairEligible(i);
    const proof=parse(req.headers.cookie||"")[repairName(i.id)],now=Date.now();
    if(!proof)fail(403,"Start a restore request in this browser.");
    const row=db.select().from(repairs).where(eq(repairs.proofHash,hash(proof!))).get();
    if(!row||row.inviteId!==i.id||row.until<=now)fail(409,"This restore request has ended. Request a new code in this browser.");
    const session=repairSession(proof!);
    if(row!.consumedAt&&i.sessionHash===hash(session)){cookie(res,i.id,session,now+DEVICE_COOKIE_LIFETIME);return res.json({state:"guest"});}
    if(row!.consumedAt||row!.generation!==generation(i))fail(409,"Chat access changed. This restore request is no longer valid.");
    if(!row!.approvedAt)return res.json({state:"pending"});
    db.transaction(()=>{
      db.update(invites).set({sessionHash:hash(session),guestDurableSince:now,sessionExpiresAt:null,deviceMoveHash:null,deviceMoveUntil:null,verificationHash:null,...clearGuestPush}).where(eq(invites.id,i.id)).run();
      db.update(repairs).set({consumedAt:now}).where(eq(repairs.proofHash,row!.proofHash)).run();
    });
    cookie(res,i.id,session,now+DEVICE_COOKIE_LIFETIME);res.json({state:"guest"});
  }));
  // Read-only locators never authenticate. Only the original HttpOnly guest
  // cookie or a freshly issued single-use transfer can open this conversation.
  app.post("/api/guest-chat/:id/resume",safe(async(req,res)=>{
    const member=await optionalUser(req);
    if(member){const prior=find(String(req.params.id));if(prior.linkedThreadId&&prior.linkedUserId===member.id&&member.role==="partner")return res.json({threadId:prior.linkedThreadId});fail(409,"Use your own account, or sign out before opening a guest conversation.");}
    const i=find(String(req.params.id));
    if(!hasDevice(req,i)){if(i.personalNoticeVersion===1) return res.status(403).json({message:"This guest session has ended.",nextStep:"guest-ended"});fail(403,"Use your original WhatsApp invitation to restore this chat.");}
    touchGuest(req,res,i);res.set("Cache-Control","no-store").json({ok:true,...(i.personalNoticeVersion===1?{personalNoticeVersion:1}:{})});
  }));
  app.post("/api/guest-chat/:id/end-page",safe(async(req,res)=>{
    onlyApp(req);const i=checkGuest(req);if(i.personalNoticeVersion!==1||req.sharedActor)fail(403,"Not available.");
    db.update(invites).set({sessionHash:null,verificationHash:null}).where(and(eq(invites.id,i.id),eq(invites.sessionHash,i.sessionHash!))).run();
    res.json({ok:true});
  }));
  app.post("/api/guest-chat/:id/device-code",safe(async(req,res)=>{
    if(!req.is("application/json"))fail(415,"Open this action in the chat.");
    if(await optionalUser(req))fail(409,"Use the chat in your account.");
    const i=checkGuest(req),now=Date.now();
    const code=crypto.randomBytes(10).toString("hex").toUpperCase(); // 80 bits, never an invite token
    db.update(invites).set({deviceMoveHash:hash(`move:${code}`),deviceMoveUntil:now+5*60000}).where(eq(invites.id,i.id)).run();
    res.set("Cache-Control","no-store").json({code:code.match(/.{4}/g)!.join("-")});
  }));
  const attempts=new Map<string,number>();let attemptWindow=0,attemptTotal=0;
  app.post("/api/guest-device/move",safe(async(req,res)=>{
    if(!req.is("application/json"))fail(415,"Use the MAHA app to enter the code.");
    if(await optionalUser(req))fail(409,"Sign out before moving a guest chat.");
    const now=Date.now(),ip=(process.env.RENDER && req.get("x-forwarded-for")?.split(",").pop()?.trim())||req.socket.remoteAddress||"unknown";
    if(now>=attemptWindow){attempts.clear();attemptTotal=0;attemptWindow=now+5*60000;}
    if((attempts.get(ip)||0)>=15 || attemptTotal>=600)fail(429,"Too many attempts. Try again in five minutes.");
    attempts.set(ip,(attempts.get(ip)||0)+1);attemptTotal++;
    const raw=z.string().max(40).parse(req.body.code).replace(/[\s-]/g,"").toUpperCase();
    const digest=hash(`move:${raw}`);
    const i=/^[A-F0-9]{20}$/.test(raw) ? db.select().from(invites).where(eq(invites.deviceMoveHash,digest)).get():undefined;
    if(!i||!activeGuest(i,now)||(i.deviceMoveUntil??0)<=now)
      fail(403,"This code cannot be used. Request a fresh code in the original chat.");
    const session=secret(),expires=now+DEVICE_COOKIE_LIFETIME;
    const updated=db.update(invites).set({sessionHash:hash(session),guestDurableSince:now,sessionExpiresAt:null,deviceMoveHash:null,deviceMoveUntil:null,verificationHash:null,...clearGuestPush})
      .where(and(eq(invites.id,i!.id),eq(invites.deviceMoveHash,digest))).run();
    if(!updated.changes)fail(403,"This code has already been used.");
    cookie(res,i!.id,session,expires);res.set("Cache-Control","no-store").json({id:i!.id});
  }));
  for(const mode of ["enable","disable","check"])app.post(`/api/guest-chat/:id/notifications/${mode}`,safe(async(req,res)=>{
    if(!req.is("application/json"))fail(415,"Open this action in your chat.");
    if(await optionalUser(req))fail(409,"Use notifications in your signed-in account.");
    const i=checkGuest(req);
    if(mode==="enable")enrollGuest(i,req.body);
    if(mode==="disable")db.update(invites).set({...clearGuestPush,guestPushChangedAt:Date.now()}).where(eq(invites.id,i.id)).run();
    if(mode==="check"&&(!i.guestPushEndpoint||req.body.endpoint!==i.guestPushEndpoint))fail(403,"Notifications are off.");
    res.json({ok:true});
  }));
  app.get("/api/guest-chat/:id", safe(async (req, res) => {
    const invite = checkGuest(req);
    res.set("Cache-Control","private, no-store").json({ topic: invite.topic, messages: present(invite.id, actor(req,false), false), ...(req.sharedActor?{sharedNotice:!!invite.sharedNoticeAt}:{}),expiresAt:req.sharedActor?null:invite.sessionExpiresAt,notifications:!req.sharedActor&&!!invite.guestPushEndpoint });
  }));
  app.post("/api/guest-chat/:id/message", safe(async (req, res) => {
    const invite = checkGuest(req);
    if (!send(req, invite, false)) return res.json({ ok: true });
    touchGuest(req,res,invite);
    const admins = await storage.listAdmins();
    const intended=invite.intendedUserId ? await storage.getUser(invite.intendedUserId) : null;
    const previewTitle=intended?.name.trim() ? `Invitation for ${intended.name.trim()}` : `Invitation chat ${invite.id.slice(0,6).toUpperCase()}`;
    void notifyUsers(admins.map(a => a.id), "chat", {
      // The internal contact label is not verified guest identity and can be
      // free text. Show it only inside the authenticated admin inbox.
      inboxTitle: invite.label.trim() ? `Invitation chat: ${invite.label.trim()}` : "Invitation chat",
      previewTitle, previewBody: "Open this conversation to reply.",
      genericTitle: "New invitation chat message", genericBody: "Open this conversation to reply.",
      url: `/admin/chat/invitation/${invite.id}`,
    }).catch(() => {});
    res.json({ ok: true });
  }));
  app.post("/api/guest-chat/:id/decline", safe(async (req, res) => {
    const invite = checkGuest(req);
    db.update(invites).set({ declinedAt: Date.now(), sessionHash: null, verificationHash: null,deviceMoveHash:null,deviceMoveUntil:null,...clearGuestPush }).where(eq(invites.id, invite.id)).run();
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
