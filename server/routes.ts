import type { Express, Request, Response, NextFunction } from "express";
import { createServer } from "node:http";
import type { Server } from "node:http";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import multer from "multer";
import { parse as parseCookie, serialize as serializeCookie } from "cookie";
import { storage, sqliteDb } from "./storage";
import { uploadToDrive, streamFromDrive, listFolderFiles, getOrCreateBackupFolderId } from "./googleDrive";
import { convertDriveAudioToMp3, cleanupTempFiles } from "./audioConvert";
import { backupDatabaseToDrive } from "./backup";
import { getLastBackupStatus, setLastBackupStatus } from "./backupScheduler";
import {
  sendEmail, buildRegistrationEmailHtml, buildApprovalEmailHtml, buildDeclineEmailHtml,
  buildAdminTodoEmailHtml,
} from "./email";
import {
  registerSchema, loginSchema, changePasswordSchema, updateProfileSchema, adminEditUserSchema, insertProductSchema, insertPriceTierSchema,
  createOrderSchema, insertReferralSchema, courseInputSchema, lessonInputSchema,
  insertModuleSchema, insertCohortSchema, insertCohortEnrollmentSchema, insertClassSessionSchema,
  insertHomeworkSubmissionSchema, insertChatMessageSchema, insertUserSchema,
  estimateShippingCostCents, pushSubscribeSchema, createAnnouncementSchema,
  insertCaseDiscussionSchema,
} from "@shared/schema";
import type { Course, Video } from "@shared/schema";
import { CURRENT_LEGAL_VERSION } from "@shared/legalVersion";
import { getVapidPublicKey, sendToSubscriptions } from "./push";
import { buildCaseDiscussionIcs } from "./ical";
import { getStripe, isStripeConfigured } from "./stripe";
import { syncLearnDashEnrollment, fetchLearnDashCourses, isLearnDashConfigured } from "./learndash";
import { runLegacyPartnerImport } from "./migrateLegacyPartners";
import {
  buildRegistrationOptions, verifyRegistration, buildAuthenticationOptions, verifyAuthentication,
  labelFromUserAgent,
} from "./webauthn";
import type { RegistrationResponseJSON, AuthenticationResponseJSON } from "@simplewebauthn/server";

// Single shared redeem code that unlocks the paid "Maha Symposium lectures"
// course (our course id 16) for free — e.g. for people who attended the live
// event. No expiry, no per-user limit, by explicit request.
const SYMPOSIUM_REDEEM_CODE = "castlemaha2026";
const SYMPOSIUM_COURSE_NAME = "Maha Symposium lectures";

// Base URL used to build absolute links inside outbound emails. Falls back to
// the known published production URL.
const SITE_ORIGIN = process.env.APP_BASE_URL || "https://maha-partner-portal.pplx.app";
// Published pplx.app sites route backend API calls through /port/<PORT>/... —
// plain /api/... paths hit the static asset server and 404. Append that
// prefix so every backend link (approve/decline, document view) resolves
// correctly on the live site (and still works if APP_BASE_URL is overridden
// for another env).
const APP_BASE_URL = `${SITE_ORIGIN}/port/5001`;
// Frontend (non-API) links, e.g. the "Sign in now" button in the approval
// email, must NOT include the /port/5001 API prefix — the SPA is served from
// the plain site origin.
const FRONTEND_SIGNIN_URL = `${SITE_ORIGIN}/`;

// Notifies a registrant of the admin's approve/decline decision. Fire-and-
// forget from the caller's perspective — failures are logged inside sendEmail
// and never block the decision itself from taking effect.
async function sendDecisionEmail(user: { name: string; role: string; email: string }, status: "approved" | "rejected") {
  const html = status === "approved"
    ? buildApprovalEmailHtml({ fullName: user.name, role: user.role, signInUrl: FRONTEND_SIGNIN_URL })
    : buildDeclineEmailHtml({ fullName: user.name, role: user.role, signInUrl: FRONTEND_SIGNIN_URL });
  const subject = status === "approved"
    ? "Your MAHA Partner Platform registration has been approved"
    : "Update on your MAHA Partner Platform registration";
  await sendEmail([user.email], subject, html);
}

// Item 11: push a notification to every admin when a partner/student writes
// into a chat that ALREADY had prior messages (a brand-new first message
// is a "new chat" and is covered separately by the email in
// notificationScheduler, so we don't double-notify for that case).
async function notifyAdminsOfNewMessage(thread: { id: number; topic: string }, msg: { senderName: string; body: string | null }) {
  const messageCount = await storage.countMessagesForThread(thread.id);
  if (messageCount <= 1) return; // first message in the thread -- handled as "new chat" via email
  const admins = await storage.listAdmins();
  const adminIds = admins.map((a) => a.id);
  if (!adminIds.length) return;
  const subs = await storage.getPushSubscriptionsForUserIds(adminIds);
  if (!subs.length) return;
  const bodyPreview = (msg.body || "[attachment]").slice(0, 120);
  const result = await sendToSubscriptions(subs, {
    title: `${msg.senderName}: ${thread.topic}`,
    body: bodyPreview,
    url: "/admin/chat",
  });
  if (result.removedEndpoints.length) {
    await storage.deletePushSubscriptionsByEndpoints(result.removedEndpoints);
  }
}

const UPLOAD_DIR = path.join(process.cwd(), "uploads");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// Files are received into memory (multipart) and then streamed straight to
// Google Drive — nothing is written to local disk anymore.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

interface AuthedRequest extends Request {
  user?: PublicUser;
}

type PublicUser = {
  id: number;
  role: string;
  name: string;
  email: string;
  status: string;
  installBannerDismissedAt: number | null;
  prefix: string | null;
  firstName: string | null;
  lastName: string | null;
  suffix: string | null;
  username: string | null;
  phone: string | null;
  businessName: string | null;
  vatNumber: string | null;
  profession: string | null;
  homepageUrl: string | null;
  degreeFileUrl: string | null;
  city: string | null;
  address: string | null;
  country: string | null;
  legalAcceptedVersion: string | null;
};

// Shapes a full DB user row down to the fields safe to send to the frontend.
// Includes `prefix`/`firstName`/`lastName` (kept separate from the free-text
// `name` and from post-nominal `suffix`) so the dashboard greeting can build
// "{prefix} {lastName}" or "{firstName} {lastName}" without ever parsing a
// concatenated string or leaking credentials like "DDS, PhD" into a greeting.
function toPublicUser(user: {
  id: number;
  role: string;
  name: string;
  email: string;
  status: string;
  installBannerDismissedAt: number | null;
  prefix?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  suffix?: string | null;
  username?: string | null;
  phone?: string | null;
  businessName?: string | null;
  vatNumber?: string | null;
  profession?: string | null;
  homepageUrl?: string | null;
  degreeFileUrl?: string | null;
  city?: string | null;
  address?: string | null;
  country?: string | null;
  legalAcceptedVersion?: string | null;
}): PublicUser {
  return {
    id: user.id,
    role: user.role,
    name: user.name,
    email: user.email,
    status: user.status,
    installBannerDismissedAt: user.installBannerDismissedAt,
    prefix: user.prefix ?? null,
    firstName: user.firstName ?? null,
    lastName: user.lastName ?? null,
    suffix: user.suffix ?? null,
    username: user.username ?? null,
    phone: user.phone ?? null,
    businessName: user.businessName ?? null,
    vatNumber: user.vatNumber ?? null,
    profession: user.profession ?? null,
    homepageUrl: user.homepageUrl ?? null,
    degreeFileUrl: user.degreeFileUrl ?? null,
    city: user.city ?? null,
    address: user.address ?? null,
    country: user.country ?? null,
    legalAcceptedVersion: user.legalAcceptedVersion ?? null,
  };
}

// The session lives in an httpOnly cookie rather than a client-readable
// Bearer token, so a login survives page reloads without needing localStorage
// (which is unavailable both in the sandboxed preview iframe and — by policy
// on this platform — isn't the right place for auth tokens anyway). In
// production the cookie uses the __Host- prefix, which the publishing proxy
// requires to avoid being stripped for cross-tenant isolation; that prefix
// mandates the Secure attribute, so we only use it when actually serving over
// HTTPS (production) and fall back to a plain cookie in local dev.
const IS_PRODUCTION = process.env.NODE_ENV === "production";
const SESSION_COOKIE_NAME = IS_PRODUCTION ? "__Host-sid" : "sid";

function getSessionToken(req: Request): string | undefined {
  const raw = req.headers.cookie;
  if (!raw) return undefined;
  return parseCookie(raw)[SESSION_COOKIE_NAME];
}

function setSessionCookie(res: Response, token: string, expiresAt: number) {
  res.setHeader(
    "Set-Cookie",
    serializeCookie(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      secure: IS_PRODUCTION,
      sameSite: "lax",
      path: "/",
      expires: new Date(expiresAt),
    }),
  );
}

function clearSessionCookie(res: Response) {
  res.setHeader(
    "Set-Cookie",
    serializeCookie(SESSION_COOKIE_NAME, "", {
      httpOnly: true,
      secure: IS_PRODUCTION,
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    }),
  );
}

async function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const token = getSessionToken(req);
  if (!token) {
    return res.status(401).json({ message: "Not authenticated" });
  }
  const session = await storage.getSession(token);
  if (!session || session.expiresAt < Date.now()) {
    return res.status(401).json({ message: "Session expired" });
  }
  const user = await storage.getUser(session.userId);
  if (!user || user.status !== "approved") {
    return res.status(401).json({ message: "Account not approved" });
  }
  // Sliding expiry: push the session another 90 days out whenever it's used,
  // so active users never hit the limit. Only rewrite once/day to avoid a
  // database write on every single API call.
  if (session.expiresAt - Date.now() < NINETY_DAYS - SESSION_REFRESH_THRESHOLD) {
    const newExpiry = Date.now() + NINETY_DAYS;
    await storage.updateSessionExpiry(token, newExpiry);
    setSessionCookie(res, token, newExpiry);
  }
  req.user = toPublicUser(user);
  next();
}

// Resolves the authenticated user if a valid session cookie is present,
// otherwise returns undefined. Used by the shared upload-document endpoint,
// which is hit both pre-auth (registration) and authenticated (referral
// attachments).
async function getOptionalUser(req: Request): Promise<AuthedRequest["user"] | undefined> {
  const token = getSessionToken(req);
  if (!token) return undefined;
  const session = await storage.getSession(token);
  if (!session || session.expiresAt < Date.now()) return undefined;
  const user = await storage.getUser(session.userId);
  if (!user || user.status !== "approved") return undefined;
  return toPublicUser(user);
}

function requireRole(...roles: string[]) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ message: "Forbidden" });
    }
    next();
  };
}

function requireNotifyKey(req: Request, res: Response, next: NextFunction) {
  const key = req.headers["x-notify-key"];
  if (!key || key !== process.env.NOTIFY_API_KEY) {
    return res.status(401).json({ message: "Invalid notify key" });
  }
  next();
}

// Sessions last 90 days and slide forward on every authenticated request, so
// an actively-used login effectively never expires; only 90 days of total
// inactivity logs someone out.
const NINETY_DAYS = 90 * 24 * 60 * 60 * 1000;
const SESSION_REFRESH_THRESHOLD = 24 * 60 * 60 * 1000; // only rewrite the row once/day of use

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // ---------- legacy local uploads (pre-Drive records only) ----------
  // New uploads go to Google Drive and are served via /api/files/:driveFileId.
  // This route is kept only so any pre-existing local-path records still resolve.
  app.get("/api/uploads/:filename", (req, res) => {
    const filePath = path.join(UPLOAD_DIR, path.basename(req.params.filename));
    if (!fs.existsSync(filePath)) return res.status(404).json({ message: "Not found" });
    res.sendFile(filePath);
  });

  // ---------- authenticated file-serving proxy (Google Drive) ----------
  // Streams a Drive-stored file back to the browser after re-checking the same
  // authorization rule that applied to the original upload.
  app.get("/api/files/:driveFileId", requireAuth, async (req: AuthedRequest, res) => {
    const rec = await storage.getUploadedFileByDriveId(String(req.params.driveFileId));
    if (!rec) return res.status(404).json({ message: "Not found" });

    const isAdmin = req.user!.role === "admin";
    let allowed = false;
    switch (rec.category) {
      case "homework":
        // Owning student or an admin/instructor only.
        allowed = isAdmin || req.user!.id === rec.ownerId;
        break;
      case "referral":
        // The partner who submitted the referral or an admin.
        allowed = isAdmin || req.user!.id === rec.ownerId;
        break;
      case "registration":
        // Registration documents are reviewed by admins only.
        allowed = isAdmin;
        break;
      case "product":
        // Product informational files/videos are visible to any signed-in
        // partner or student, plus admins.
        allowed = true;
        break;
      case "chat": {
        // Chat attachments are visible to the thread's owner (partner/student)
        // or an admin -- same rule as reading the thread's messages.
        const thread = rec.threadId ? await storage.getThread(rec.threadId) : undefined;
        allowed = isAdmin || (!!thread && thread.userId === req.user!.id);
        break;
      }
      default:
        allowed = isAdmin;
    }
    if (!allowed) return res.status(403).json({ message: "Forbidden" });

    try {
      const stream = await streamFromDrive(rec.driveFileId);
      res.setHeader("Content-Type", rec.mimeType);
      res.setHeader(
        "Content-Disposition",
        `inline; filename="${rec.filename.replace(/"/g, "")}"`,
      );
      stream.on("error", () => {
        if (!res.headersSent) res.status(502).json({ message: "Failed to fetch file" });
        else res.end();
      });
      stream.pipe(res);
    } catch {
      res.status(502).json({ message: "Failed to fetch file from storage" });
    }
  });

  // Admin-only: repackages a chat voice-note attachment (recorded in the
  // browser as webm/opus or m4a -- MediaRecorder can't record straight to
  // mp3) as a standalone mp3 so admins can save/forward it outside the app.
  // Never transcribes -- same audio, just a more portable container+codec.
  app.get("/api/admin/files/:driveFileId/download-mp3", requireAuth, requireRole("admin"), async (req, res) => {
    const rec = await storage.getUploadedFileByDriveId(String(req.params.driveFileId));
    if (!rec) return res.status(404).json({ message: "Not found" });
    if (!rec.mimeType.startsWith("audio/")) {
      return res.status(400).json({ message: "This attachment is not an audio file" });
    }
    let tempPaths: string[] = [];
    try {
      const { inputPath, outputPath } = await convertDriveAudioToMp3(rec.driveFileId);
      tempPaths = [inputPath, outputPath];
      const baseName = (rec.filename || "voice-note").replace(/\.[^.]+$/, "").replace(/"/g, "") || "voice-note";
      res.setHeader("Content-Type", "audio/mpeg");
      res.setHeader("Content-Disposition", `attachment; filename="${baseName}.mp3"`);
      const readStream = fs.createReadStream(outputPath);
      readStream.on("close", () => cleanupTempFiles(...tempPaths));
      readStream.on("error", () => {
        if (!res.headersSent) res.status(500).json({ message: "Failed to read converted audio" });
        else res.end();
        cleanupTempFiles(...tempPaths);
      });
      readStream.pipe(res);
    } catch (err) {
      console.error("[download-mp3] conversion failed:", err);
      cleanupTempFiles(...tempPaths);
      if (!res.headersSent) res.status(502).json({ message: "Failed to convert audio to mp3" });
    }
  });

  // ---------- AUTH ----------
  app.post("/api/auth/register", async (req, res) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.errors[0]?.message || "Invalid input" });
    const data = parsed.data;
    const existing = await storage.getUserByEmail(data.email);
    if (existing) return res.status(400).json({ message: "An account with this email already exists" });

    const passwordHash = await bcrypt.hash(data.password, 10);
    const fullName = [data.prefix, data.firstName, data.lastName, data.suffix].filter(Boolean).join(" ");
    const approvalToken = crypto.randomBytes(24).toString("hex");
    const user = await storage.createUser({
      role: data.role,
      name: fullName,
      email: data.email,
      passwordHash,
      status: "pending",
      approvalToken,
      phone: data.phone,
      businessName: data.businessName || null,
      vatNumber: data.vatNumber || null,
      profession: data.profession || null,
      homepageUrl: data.homepageUrl || null,
      degreeFileUrl: data.degreeFileUrl || null,
      firstName: data.firstName,
      lastName: data.lastName,
      prefix: data.prefix || null,
      suffix: data.suffix || null,
      username: data.username,
      city: data.city || null,
      address: data.address || null,
      country: data.country || null,
      additionalInfo: data.additionalInfo,
      legalAcceptedVersion: CURRENT_LEGAL_VERSION,
      legalAcceptedAt: Date.now(),
    } as any);

    // Notify partner@maha.clinic with the full registration and one-click
    // approve/decline links. Never let an email hiccup fail the signup itself.
    try {
      const html = buildRegistrationEmailHtml({
        fullName,
        role: data.role,
        email: data.email,
        phone: data.phone,
        username: data.username,
        businessName: data.businessName,
        vatNumber: data.vatNumber,
        profession: data.profession,
        homepageUrl: data.homepageUrl,
        city: data.city,
        address: data.address,
        country: data.country,
        additionalInfo: data.additionalInfo,
        degreeFileUrl: data.degreeFileUrl ? `${APP_BASE_URL}/api/admin/registration-document?token=${approvalToken}` : null,
        approveUrl: `${APP_BASE_URL}/api/admin/registration-action?token=${approvalToken}&action=approve`,
        declineUrl: `${APP_BASE_URL}/api/admin/registration-action?token=${approvalToken}&action=decline`,
      });
      await sendEmail(["partner@maha.clinic"], `New ${data.role} registration: ${fullName}`, html);
      await storage.setUserApprovalEmailNotified(user.id, true);
    } catch (err) {
      console.error("[register] failed to send approval email:", err);
    }

    res.json({ id: user.id, status: user.status });
  });

  // One-click approve/decline links from the registration notification email.
  // No login required — the random token itself is the credential, and it is
  // cleared after first use so a link can't be replayed.
  app.get("/api/admin/registration-action", async (req, res) => {
    const token = String(req.query.token || "");
    const action = String(req.query.action || "");
    const page = (title: string, body: string) => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
      <style>body{font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:64px auto;padding:0 24px;color:#222;}h1{font-size:20px;}a{color:#b8860b;}</style>
      </head><body><h1>${title}</h1><p>${body}</p></body></html>`;

    if (!token || !["approve", "decline"].includes(action)) {
      return res.status(400).send(page("Invalid link", "This link is missing required information."));
    }
    const user = await storage.getUserByApprovalToken(token);
    if (!user) {
      return res.status(410).send(page("Link already used", "This registration has already been reviewed, or the link is invalid."));
    }
    const status = action === "approve" ? "approved" : "rejected";
    await storage.updateUserStatus(user.id, status);
    await storage.setUserApprovalToken(user.id, null);
    await sendDecisionEmail(user, status);
    const verb = action === "approve" ? "approved" : "declined";
    res.send(page(`Registration ${verb}`, `${user.name}'s ${user.role} registration request has been ${verb}. They have been notified by email.`));
  });

  // Token-gated document view so the degree/license file can be opened directly
  // from the notification email without requiring the reviewer to be logged in.
  // Only works while the token is still active (i.e. before a decision is made).
  app.get("/api/admin/registration-document", async (req, res) => {
    const token = String(req.query.token || "");
    if (!token) return res.status(400).json({ message: "Missing token" });
    const user = await storage.getUserByApprovalToken(token);
    if (!user || !user.degreeFileUrl) return res.status(404).json({ message: "Not found" });
    const driveFileId = user.degreeFileUrl.split("/").pop()!;
    const rec = await storage.getUploadedFileByDriveId(driveFileId);
    if (!rec) return res.status(404).json({ message: "Not found" });
    try {
      const stream = await streamFromDrive(rec.driveFileId);
      res.setHeader("Content-Type", rec.mimeType);
      res.setHeader("Content-Disposition", `inline; filename="${rec.filename.replace(/"/g, "")}"`);
      stream.on("error", () => {
        if (!res.headersSent) res.status(502).json({ message: "Failed to fetch file" });
        else res.end();
      });
      stream.pipe(res);
    } catch {
      res.status(502).json({ message: "Failed to fetch file from storage" });
    }
  });

  // Shared upload endpoint for registration documents (pre-auth) and referral
  // attachments (authenticated partner). The file goes straight to Drive; we
  // record its metadata and return the proxy URL.
  app.post("/api/auth/upload-document", upload.single("file"), async (req, res) => {
    if (!req.file) return res.status(400).json({ message: "No file uploaded" });
    const user = await getOptionalUser(req);
    const category = req.body?.context === "referral" ? "referral" : "registration";
    try {
      const { driveFileId } = await uploadToDrive(req.file.buffer, req.file.originalname, req.file.mimetype);
      await storage.createUploadedFile({
        driveFileId,
        filename: req.file.originalname,
        mimeType: req.file.mimetype,
        size: req.file.size,
        category,
        ownerId: category === "referral" ? user?.id ?? null : null,
        uploadedAt: Date.now(),
      });
      res.json({ url: `/api/files/${driveFileId}`, name: req.file.originalname });
    } catch (err: any) {
      res.status(502).json({ message: "File storage upload failed" });
    }
  });

  app.post("/api/auth/login", async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid input" });
    const { email, password } = parsed.data;
    const user = await storage.getUserByEmail(email);
    if (!user) return res.status(401).json({ message: "Invalid email or password" });
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(401).json({ message: "Invalid email or password" });
    if (user.status !== "approved") {
      return res.status(403).json({ message: "pending", status: user.status });
    }
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = Date.now() + NINETY_DAYS;
    await storage.createSession({ token, userId: user.id, expiresAt });
    setSessionCookie(res, token, expiresAt);
    res.json({
      user: toPublicUser(user),
    });
  });

  app.post("/api/auth/logout", requireAuth, async (req: AuthedRequest, res) => {
    const token = getSessionToken(req);
    if (token) await storage.deleteSession(token);
    clearSessionCookie(res);
    res.json({ ok: true });
  });

  app.get("/api/auth/me", requireAuth, async (req: AuthedRequest, res) => {
    res.json(req.user);
  });

  // One-time acknowledgment for existing users whose account predates the
  // Privacy Policy/Terms pages, or whenever CURRENT_LEGAL_VERSION is bumped
  // after a material change (see legalContent.ts §11). The frontend gates on
  // user.legalAcceptedVersion !== CURRENT_LEGAL_VERSION and calls this once
  // acknowledged, blocking app use until then via LegalAcknowledgmentGate.
  app.post("/api/auth/accept-legal", requireAuth, async (req: AuthedRequest, res) => {
    const updated = await storage.updateUserProfile(req.user!.id, {
      legalAcceptedVersion: CURRENT_LEGAL_VERSION,
      legalAcceptedAt: Date.now(),
    });
    if (!updated) return res.status(404).json({ message: "User not found" });
    res.json({ user: toPublicUser(updated) });
  });

  app.post("/api/auth/change-password", requireAuth, async (req: AuthedRequest, res) => {
    const parsed = changePasswordSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid input" });
    const { currentPassword, newPassword } = parsed.data;
    const user = await storage.getUser(req.user!.id);
    if (!user) return res.status(404).json({ message: "User not found" });
    const ok = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!ok) return res.status(401).json({ message: "Current password is incorrect" });
    const passwordHash = await bcrypt.hash(newPassword, 10);
    await storage.updateUserPassword(user.id, passwordHash);
    res.json({ ok: true });
  });

  // Self-service profile editing -- works for every role (partner, student,
  // admin). Every field is optional; the client only sends what changed.
  app.patch("/api/auth/profile", requireAuth, async (req: AuthedRequest, res) => {
    const parsed = updateProfileSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.errors[0]?.message || "Invalid input" });
    const patch = parsed.data;
    if (patch.email) {
      const existing = await storage.getUserByEmail(patch.email);
      if (existing && existing.id !== req.user!.id) {
        return res.status(400).json({ message: "That email is already in use by another account" });
      }
    }
    if (patch.username) {
      const existing = await storage.getUserByUsername(patch.username);
      if (existing && existing.id !== req.user!.id) {
        return res.status(400).json({ message: "That username is already in use by another account" });
      }
    }
    const updated = await storage.updateUserProfile(req.user!.id, patch);
    if (!updated) return res.status(404).json({ message: "User not found" });
    res.json({ user: toPublicUser(updated) });
  });

  // Password resets are admin-initiated only (see /api/admin/users/:id/reset-password
  // below) — there is no self-service "email me a link" flow, since that would
  // require sending mail to arbitrary partner addresses and Resend's sandbox
  // mode can't deliver those reliably. The login page instead points partners
  // to email the clinic directly so an admin can reset it for them.

  app.post("/api/auth/dismiss-install-banner", requireAuth, async (req: AuthedRequest, res) => {
    const updated = await storage.dismissInstallBanner(req.user!.id);
    if (!updated) return res.status(404).json({ message: "User not found" });
    res.json(toPublicUser(updated));
  });

  // ---------- WEBAUTHN (Face ID / Fingerprint login) ----------
  // Registration (adding a new passkey to an already-logged-in account).
  app.post("/api/webauthn/register/options", requireAuth, async (req: AuthedRequest, res) => {
    const existing = await storage.listWebauthnCredentialsForUser(req.user!.id);
    const options = await buildRegistrationOptions(
      req,
      { id: req.user!.id, email: req.user!.email, name: req.user!.name },
      existing.map((c) => c.credentialId)
    );
    res.json(options);
  });

  app.post("/api/webauthn/register/verify", requireAuth, async (req: AuthedRequest, res) => {
    const response = req.body?.response as RegistrationResponseJSON | undefined;
    if (!response) return res.status(400).json({ message: "Missing WebAuthn response" });
    const result = await verifyRegistration(req, req.user!.id, response);
    if (!result.verified || !result.credential) {
      return res.status(400).json({ message: "Could not verify this device. Please try again." });
    }
    const { credential, deviceType, backedUp } = result;
    await storage.createWebauthnCredential({
      userId: req.user!.id,
      credentialId: credential.id,
      publicKey: Buffer.from(credential.publicKey).toString("base64url"),
      counter: credential.counter,
      deviceType: deviceType || "singleDevice",
      backedUp: !!backedUp,
      transports: credential.transports ? JSON.stringify(credential.transports) : null,
      label: labelFromUserAgent(req.headers["user-agent"]),
      createdAt: Date.now(),
    });
    res.json({ ok: true });
  });

  // Login (no auth yet — this is how the user authenticates).
  app.get("/api/webauthn/login/options", async (req, res) => {
    const options = await buildAuthenticationOptions(req);
    res.json(options);
  });

  app.post("/api/webauthn/login/verify", async (req, res) => {
    const response = req.body?.response as AuthenticationResponseJSON | undefined;
    if (!response?.id) return res.status(400).json({ message: "Missing WebAuthn response" });

    const stored = await storage.getWebauthnCredentialByCredentialId(response.id);
    if (!stored) return res.status(401).json({ message: "This device is not registered. Please use your password or register Face ID / Fingerprint from your account settings first." });

    const result = await verifyAuthentication(req, response, stored);
    if (!result.verified) return res.status(401).json({ message: "Verification failed. Please try again." });

    await storage.updateWebauthnCredentialCounter(stored.id, result.newCounter ?? stored.counter, Date.now());

    const user = await storage.getUser(stored.userId);
    if (!user || user.status !== "approved") {
      return res.status(403).json({ message: "Account not approved" });
    }
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = Date.now() + NINETY_DAYS;
    await storage.createSession({ token, userId: user.id, expiresAt });
    setSessionCookie(res, token, expiresAt);
    res.json({
      user: toPublicUser(user),
    });
  });

  // Manage registered devices from account settings.
  app.get("/api/webauthn/credentials", requireAuth, async (req: AuthedRequest, res) => {
    const rows = await storage.listWebauthnCredentialsForUser(req.user!.id);
    res.json(rows.map((r) => ({ id: r.id, label: r.label, deviceType: r.deviceType, createdAt: r.createdAt, lastUsedAt: r.lastUsedAt })));
  });

  app.delete("/api/webauthn/credentials/:id", requireAuth, async (req: AuthedRequest, res) => {
    const ok = await storage.deleteWebauthnCredential(Number(req.params.id), req.user!.id);
    if (!ok) return res.status(404).json({ message: "Not found" });
    res.json({ ok: true });
  });

  // ---------- PARTNER: REFERRALS ----------
  // Students also get partner functions (referrals, shop, courses, case
  // discussions) on top of their own classes/homework — see requireRole calls
  // below and courseHasAccess. Their booked module/cohort content stays
  // exclusive to students and is never exposed to plain partners.
  // `linkThreadId` (optional) is set when this referral is being filled in
  // from inside a chat -- either the partner's own chat clicking "Create
  // patient referral" directly, or filling in the form after an admin
  // "referral requested" prompt on their chat. Either way we link/create the
  // dedicated referral chat here so the referral<->chat relationship is
  // always established at the moment the referral itself is created.
  app.post("/api/referrals", requireAuth, requireRole("partner", "student"), async (req: AuthedRequest, res) => {
    const { linkThreadId, patientConsentAttested, ...rest } = req.body ?? {};
    if (patientConsentAttested !== true) {
      return res.status(400).json({ message: "You must confirm you're entitled to share this patient's information before submitting a referral." });
    }
    const parsed = insertReferralSchema.safeParse({ ...rest, partnerId: req.user!.id });
    if (!parsed.success) return res.status(400).json({ message: parsed.error.errors[0]?.message || "Invalid input" });
    const referral = await storage.createReferral({ ...parsed.data, createdAt: Date.now(), patientConsentAttestedAt: Date.now() });
    const patientTopic = `Patient: ${referral.patientFirstName} ${referral.patientLastName}`;

    let chatThreadId: number;
    if (linkThreadId) {
      const thread = await storage.getThread(Number(linkThreadId));
      if (!thread || thread.userId !== req.user!.id) {
        return res.status(403).json({ message: "You don't have access to that chat." });
      }
      if (thread.referralId) {
        return res.status(400).json({ message: "That chat is already linked to a different referral." });
      }
      const updated = await storage.updateThread(thread.id, {
        kind: "referral",
        referralId: referral.id,
        topic: patientTopic,
        pendingReferralRequestedAt: null,
        pendingReferralRequestedByRole: null,
      });
      chatThreadId = updated!.id;
    } else {
      const newThread = await storage.createThread(req.user!.id, req.user!.role, patientTopic, {
        kind: "referral",
        referralId: referral.id,
      });
      chatThreadId = newThread.id;
    }
    res.json({ ...referral, chatThreadId });
  });

  app.get("/api/referrals/mine", requireAuth, requireRole("partner", "student"), async (req: AuthedRequest, res) => {
    const rows = await storage.listReferralsForPartner(req.user!.id);
    const withThread = await Promise.all(
      rows.map(async (r) => {
        const thread = await storage.getThreadByReferralId(r.id);
        return { ...r, chatThreadId: thread?.id ?? null };
      })
    );
    res.json(withThread);
  });

  // ---------- ADMIN: REFERRALS ----------
  app.get("/api/admin/referrals", requireAuth, requireRole("admin"), async (_req, res) => {
    const rows = await storage.listAllReferrals();
    const withPartner = await Promise.all(
      rows.map(async (r) => {
        const partner = await storage.getUser(r.partnerId);
        const thread = await storage.getThreadByReferralId(r.id);
        return { ...r, partnerName: partner?.name, partnerEmail: partner?.email, partnerPhone: partner?.phone, chatThreadId: thread?.id ?? null };
      })
    );
    res.json(withPartner);
  });

  app.patch("/api/admin/referrals/:id/status", requireAuth, requireRole("admin"), async (req, res) => {
    const { status } = req.body;
    const updated = await storage.updateReferralStatus(Number(req.params.id), status);
    if (!updated) return res.status(404).json({ message: "Not found" });
    res.json(updated);
  });

  // ---------- SHOP: PRODUCTS ----------
  app.get("/api/products", async (_req, res) => {
    const products = await storage.listProducts();
    const withTiers = await Promise.all(
      products.map(async (p) => ({
        ...p,
        tiers: await storage.listTiersForProduct(p.id),
        resources: await storage.listResourcesForProduct(p.id),
      }))
    );
    res.json(withTiers);
  });

  app.post("/api/admin/products", requireAuth, requireRole("admin"), async (req, res) => {
    const parsed = insertProductSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.errors[0]?.message || "Invalid input" });
    const product = await storage.createProduct(parsed.data);
    res.json(product);
  });

  app.patch("/api/admin/products/:id", requireAuth, requireRole("admin"), async (req, res) => {
    const updated = await storage.updateProduct(Number(req.params.id), req.body);
    if (!updated) return res.status(404).json({ message: "Not found" });
    res.json(updated);
  });

  app.delete("/api/admin/products/:id", requireAuth, requireRole("admin"), async (req, res) => {
    await storage.deleteTiersForProduct(Number(req.params.id));
    await storage.deleteProduct(Number(req.params.id));
    res.json({ ok: true });
  });

  app.post("/api/admin/products/:id/tiers", requireAuth, requireRole("admin"), async (req, res) => {
    const parsed = insertPriceTierSchema.safeParse({ ...req.body, productId: Number(req.params.id) });
    if (!parsed.success) return res.status(400).json({ message: parsed.error.errors[0]?.message || "Invalid input" });
    const tier = await storage.createTier(parsed.data);
    res.json(tier);
  });

  app.delete("/api/admin/tiers/:id", requireAuth, requireRole("admin"), async (req, res) => {
    await storage.deleteTier(Number(req.params.id));
    res.json({ ok: true });
  });

  // Informational files (spec sheets, certificates) and videos about a product.
  // Either an uploaded file (multipart, goes to Drive) or a pasted external
  // URL (e.g. a YouTube link) is accepted — not both.
  app.post("/api/admin/products/:id/resources", requireAuth, requireRole("admin"), upload.single("file"), async (req: AuthedRequest, res) => {
    const productId = Number(req.params.id);
    const kind = req.body.kind === "video" ? "video" : "file";
    const title = typeof req.body.title === "string" ? req.body.title.trim() : "";
    if (!title) return res.status(400).json({ message: "Please provide a title." });

    try {
      if (req.file) {
        const { driveFileId } = await uploadToDrive(req.file.buffer, req.file.originalname, req.file.mimetype);
        await storage.createUploadedFile({
          driveFileId,
          filename: req.file.originalname,
          mimeType: req.file.mimetype,
          size: req.file.size,
          category: "product",
          ownerId: null,
          uploadedAt: Date.now(),
        });
        const resource = await storage.createProductResource({ productId, kind, title, driveFileId, externalUrl: null });
        return res.json(resource);
      }
      const externalUrl = typeof req.body.externalUrl === "string" ? req.body.externalUrl.trim() : "";
      if (!externalUrl) return res.status(400).json({ message: "Upload a file or provide a link." });
      const resource = await storage.createProductResource({ productId, kind, title, driveFileId: null, externalUrl });
      res.json(resource);
    } catch (err: any) {
      res.status(502).json({ message: "File storage upload failed" });
    }
  });

  app.delete("/api/admin/products/resources/:id", requireAuth, requireRole("admin"), async (req, res) => {
    await storage.deleteProductResource(Number(req.params.id));
    res.json({ ok: true });
  });

  // ---------- PARTNER: ORDERS ----------
  app.post("/api/orders", requireAuth, requireRole("partner", "student"), async (req: AuthedRequest, res) => {
    const parsed = createOrderSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.errors[0]?.message || "Invalid order" });

    // Compute total weight across cart items for the shipping estimate.
    let totalWeightGrams = 0;
    for (const item of parsed.data.items) {
      const product = await storage.getProduct(item.productId);
      if (!product) continue;
      totalWeightGrams += (product.weightGrams || 0) * item.quantity;
    }
    const estimatedShippingCost = estimateShippingCostCents(totalWeightGrams, parsed.data.destinationCountry);

    const order = await storage.createOrder({
      partnerId: req.user!.id,
      destinationCountry: parsed.data.destinationCountry.toUpperCase(),
      estimatedShippingCost,
      createdAt: Date.now(),
    } as any);
    for (const item of parsed.data.items) {
      const product = await storage.getProduct(item.productId);
      if (!product) continue;
      const tiers = await storage.listTiersForProduct(item.productId);
      let unitPrice = product.unitPrice;
      for (const tier of tiers) {
        if (item.quantity >= tier.minQty && (tier.maxQty == null || item.quantity <= tier.maxQty)) {
          unitPrice = tier.pricePerUnit;
        }
      }
      await storage.createOrderItem({
        orderId: order.id,
        productId: item.productId,
        quantity: item.quantity,
        unitPriceAtOrder: unitPrice,
      });
    }
    res.json(order);
  });

  app.get("/api/orders/mine", requireAuth, requireRole("partner", "student"), async (req: AuthedRequest, res) => {
    const rows = await storage.listOrdersForPartner(req.user!.id);
    const withItems = await Promise.all(
      rows.map(async (o) => ({ ...o, items: await storage.listItemsForOrder(o.id) }))
    );
    res.json(withItems);
  });

  // ---------- ADMIN: ORDERS ----------
  app.get("/api/admin/orders", requireAuth, requireRole("admin"), async (_req, res) => {
    const rows = await storage.listAllOrders();
    const withDetails = await Promise.all(
      rows.map(async (o) => {
        const partner = await storage.getUser(o.partnerId);
        const items = await storage.listItemsForOrder(o.id);
        return { ...o, partnerName: partner?.name, partnerEmail: partner?.email, items };
      })
    );
    res.json(withDetails);
  });

  app.patch("/api/admin/orders/:id/status", requireAuth, requireRole("admin"), async (req, res) => {
    const { status } = req.body;
    const updated = await storage.updateOrderStatus(Number(req.params.id), status);
    if (!updated) return res.status(404).json({ message: "Not found" });
    res.json(updated);
  });

  // ---------- COURSES & LESSONS (Education) ----------
  // This is the general paid/purchasable video library ("Learn" tab) — a
  // partner or student has access to a course here when it is 'open' (free,
  // no gate), OR they have a completed purchase for it (paid unlock or free
  // self-enroll), OR an admin has manually granted it. This is entirely
  // separate from a student's booked module/cohort (classes + homework),
  // which is never exposed here and never purchasable by partners.
  function courseHasAccess(
    role: string,
    course: Course,
    completed: Set<number>,
    granted: Set<number>,
  ): boolean {
    if (role === "admin") return true;
    if (course.accessType === "open") return true;
    return completed.has(course.id) || granted.has(course.id);
  }

  function isFreeCourse(course: Course): boolean {
    return course.accessType !== "paid" || !course.priceCents;
  }

  app.get("/api/courses", requireAuth, async (req: AuthedRequest, res) => {
    const allCourses = await storage.listCourses();
    const allVideos = await storage.listVideos();

    let completed = new Set<number>();
    let granted = new Set<number>();
    if (req.user!.role === "partner" || req.user!.role === "student") {
      completed = new Set((await storage.listCompletedPurchasesForUser(req.user!.id)).map((p) => p.courseId));
      granted = new Set((await storage.listGrantsForPartner(req.user!.id)).map((g) => g.courseId));
    }

    const result = allCourses.map((c) => {
      const lessons = allVideos.filter((v) => v.courseId === c.id);
      // Never send the raw video URL to the browser — it's an unauthenticated
      // external link (e.g. a WordPress upload) that anyone could copy from
      // devtools and share around. The frontend plays lessons through
      // /api/videos/:id/stream instead, which re-checks entitlement on every
      // request and is scoped to the viewer's own logged-in session.
      const safeLessons = lessons.map(({ url, ...rest }) => ({ ...rest, hasVideo: !!url }));
      return {
        ...c,
        lessons: safeLessons,
        lessonCount: lessons.length,
        hasAccess: courseHasAccess(req.user!.role, c, completed, granted),
      };
    });
    res.json(result);
  });

  // Stream a lesson's video through the backend instead of handing the
  // browser a direct, unauthenticated link to the underlying file host.
  // Re-checks entitlement on every request (not just once at page load) and
  // forwards Range headers so seeking/scrubbing still works. A copied
  // request URL is useless to anyone else since it relies on the viewer's
  // own __Host-sid session cookie, which the browser only ever sends on
  // same-origin requests.
  app.get("/api/videos/:id/stream", requireAuth, async (req: AuthedRequest, res) => {
    const video = await storage.getVideo(Number(req.params.id));
    if (!video || !video.url) return res.status(404).json({ message: "Video not found" });

    const course = video.courseId ? await storage.getCourse(video.courseId) : undefined;
    if (!course) return res.status(404).json({ message: "Video not found" });

    let completed = new Set<number>();
    let granted = new Set<number>();
    if (req.user!.role === "partner" || req.user!.role === "student") {
      completed = new Set((await storage.listCompletedPurchasesForUser(req.user!.id)).map((p) => p.courseId));
      granted = new Set((await storage.listGrantsForPartner(req.user!.id)).map((g) => g.courseId));
    }
    if (!courseHasAccess(req.user!.role, course, completed, granted)) {
      return res.status(403).json({ message: "You don't have access to this lesson" });
    }

    try {
      const upstreamHeaders: Record<string, string> = {};
      if (req.headers.range) upstreamHeaders.Range = String(req.headers.range);
      const upstream = await fetch(video.url, { headers: upstreamHeaders });
      if (!upstream.ok && upstream.status !== 206) {
        return res.status(502).json({ message: "Failed to fetch video" });
      }
      res.status(upstream.status);
      const passthroughHeaders = ["content-type", "content-length", "content-range", "accept-ranges"];
      for (const h of passthroughHeaders) {
        const v = upstream.headers.get(h);
        if (v) res.setHeader(h, v);
      }
      if (!upstream.body) return res.end();
      const { Readable } = await import("node:stream");
      const nodeStream = Readable.fromWeb(upstream.body as any);
      nodeStream.on("error", () => {
        if (!res.headersSent) res.status(502).json({ message: "Video stream failed" });
        else res.end();
      });
      nodeStream.pipe(res);
    } catch {
      res.status(502).json({ message: "Failed to fetch video" });
    }
  });

  // Admin-only: fetch a single lesson including its real video URL, used to
  // prefill the edit form. Never exposed through /api/courses (see above).
  app.get("/api/admin/videos/:id", requireAuth, requireRole("admin"), async (req, res) => {
    const video = await storage.getVideo(Number(req.params.id));
    if (!video) return res.status(404).json({ message: "Not found" });
    res.json(video);
  });

  // Free self-enroll — creates access without payment (recorded as a completed
  // purchase with amount 0). Only valid for non-paid courses.
  app.post("/api/courses/:id/enroll", requireAuth, requireRole("partner", "student"), async (req: AuthedRequest, res) => {
    const course = await storage.getCourse(Number(req.params.id));
    if (!course) return res.status(404).json({ message: "Course not found" });
    if (!isFreeCourse(course)) {
      return res.status(400).json({ message: "This course requires payment" });
    }
    const existing = await storage.getCompletedPurchase(req.user!.id, course.id);
    if (!existing) {
      await storage.createCoursePurchase({
        userId: req.user!.id,
        courseId: course.id,
        amountCents: 0,
        currency: course.currency,
        stripeSessionId: null,
        status: "completed",
        createdAt: Date.now(),
      });
      syncLearnDashEnrollment({ email: req.user!.email, name: req.user!.name }, course.learndashCourseId);
    }
    res.json({ ok: true, hasAccess: true });
  });

  // Start a paid checkout. Gates gracefully when Stripe is not configured yet.
  app.post("/api/courses/:id/checkout", requireAuth, requireRole("partner", "student"), async (req: AuthedRequest, res) => {
    const course = await storage.getCourse(Number(req.params.id));
    if (!course) return res.status(404).json({ message: "Course not found" });
    if (isFreeCourse(course)) {
      return res.status(400).json({ message: "This course is free — use enroll" });
    }
    const already = await storage.getCompletedPurchase(req.user!.id, course.id);
    if (already) return res.json({ alreadyOwned: true });

    const stripe = getStripe();
    if (!stripe) {
      // No STRIPE_SECRET_KEY set — surface a clear, non-fatal signal the client
      // turns into a "contact the MAHA team" message.
      return res.status(503).json({ error: "payments_not_configured" });
    }

    const origin = req.headers.origin || `${req.protocol}://${req.get("host")}`;
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: course.currency,
            unit_amount: course.priceCents!,
            product_data: { name: course.name, description: course.description || undefined },
          },
        },
      ],
      success_url: `${origin}/#/videos?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/#/videos?checkout=cancelled`,
      metadata: { courseId: String(course.id), userId: String(req.user!.id) },
    });

    await storage.createCoursePurchase({
      userId: req.user!.id,
      courseId: course.id,
      amountCents: course.priceCents!,
      currency: course.currency,
      stripeSessionId: session.id,
      status: "pending",
      createdAt: Date.now(),
    });

    res.json({ url: session.url });
  });

  // Confirm a completed checkout by verifying the session with Stripe directly
  // (avoids needing a separately configured webhook endpoint for now).
  app.get("/api/courses/checkout/confirm", requireAuth, requireRole("partner", "student"), async (req: AuthedRequest, res) => {
    const sessionId = typeof req.query.session_id === "string" ? req.query.session_id : null;
    if (!sessionId) return res.status(400).json({ message: "Missing session_id" });

    const purchase = await storage.getCoursePurchaseBySession(sessionId);
    if (!purchase || purchase.userId !== req.user!.id) {
      return res.status(404).json({ message: "Purchase not found" });
    }
    if (purchase.status === "completed") {
      return res.json({ ok: true, courseId: purchase.courseId, alreadyConfirmed: true });
    }

    const stripe = getStripe();
    if (!stripe) return res.status(503).json({ error: "payments_not_configured" });

    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.payment_status !== "paid") {
      return res.status(402).json({ message: "Payment not completed" });
    }
    await storage.updateCoursePurchaseStatus(purchase.id, "completed");
    const purchasedCourse = await storage.getCourse(purchase.courseId);
    if (purchasedCourse) {
      syncLearnDashEnrollment({ email: req.user!.email, name: req.user!.name }, purchasedCourse.learndashCourseId);
    }
    res.json({ ok: true, courseId: purchase.courseId });
  });

  // Redeem the shared Symposium access code (e.g. handed out to attendees of
  // the live event) for free access to the paid "Maha Symposium lectures"
  // course. Single shared code, no expiry, no per-user redemption limit.
  app.post("/api/courses/redeem-code", requireAuth, requireRole("partner", "student"), async (req: AuthedRequest, res) => {
    const code = typeof req.body?.code === "string" ? req.body.code.trim() : "";
    if (code !== SYMPOSIUM_REDEEM_CODE) {
      return res.status(400).json({ message: "Invalid code" });
    }
    const course = await storage.getCourseByName(SYMPOSIUM_COURSE_NAME);
    if (!course) return res.status(500).json({ message: "Symposium course not found" });

    const existingGrant = await storage.getGrant(course.id, req.user!.id);
    const existingPurchase = await storage.getCompletedPurchase(req.user!.id, course.id);
    if (!existingGrant && !existingPurchase) {
      await storage.createGrant({ courseId: course.id, partnerId: req.user!.id });
      syncLearnDashEnrollment({ email: req.user!.email, name: req.user!.name }, course.learndashCourseId);
    }
    res.json({ ok: true, courseId: course.id, hasAccess: true });
  });

  // ---------- ADMIN: COURSES ----------
  // Live list of LearnDash courses on partner.maha.clinic, for the "link to
  // LearnDash course" dropdown when creating/editing a course here.
  app.get("/api/admin/learndash/courses", requireAuth, requireRole("admin"), async (_req, res) => {
    if (!isLearnDashConfigured()) return res.json({ configured: false, courses: [] });
    try {
      const courses = await fetchLearnDashCourses();
      res.json({ configured: true, courses });
    } catch (err) {
      console.error("[learndash] course list failed:", err);
      res.status(502).json({ configured: true, courses: [], error: "Could not reach LearnDash" });
    }
  });

  app.post("/api/admin/courses", requireAuth, requireRole("admin"), async (req, res) => {
    const parsed = courseInputSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.errors[0]?.message || "Invalid input" });
    const d = parsed.data;
    const course = await storage.createCourse({
      name: d.name,
      description: d.description || null,
      priceCents: d.accessType === "paid" ? d.priceCents ?? 0 : null,
      currency: d.currency || "eur",
      accessType: d.accessType,
      learndashCourseId: d.learndashCourseId ?? null,
    });
    res.json(course);
  });

  app.patch("/api/admin/courses/:id", requireAuth, requireRole("admin"), async (req, res) => {
    const parsed = courseInputSchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.errors[0]?.message || "Invalid input" });
    const d = parsed.data;
    const patch: Record<string, unknown> = {};
    if (d.name !== undefined) patch.name = d.name;
    if (d.description !== undefined) patch.description = d.description || null;
    if (d.currency !== undefined) patch.currency = d.currency;
    if (d.learndashCourseId !== undefined) patch.learndashCourseId = d.learndashCourseId;
    if (d.accessType !== undefined) {
      patch.accessType = d.accessType;
      patch.priceCents = d.accessType === "paid" ? d.priceCents ?? 0 : null;
    } else if (d.priceCents !== undefined) {
      patch.priceCents = d.priceCents;
    }
    // Keep lessons' denormalized category in sync if the course is renamed.
    if (d.name !== undefined) {
      const lessons = await storage.listVideosForCourse(Number(req.params.id));
      for (const l of lessons) await storage.updateVideo(l.id, { category: d.name });
    }
    const updated = await storage.updateCourse(Number(req.params.id), patch);
    if (!updated) return res.status(404).json({ message: "Not found" });
    res.json(updated);
  });

  app.delete("/api/admin/courses/:id", requireAuth, requireRole("admin"), async (req, res) => {
    const id = Number(req.params.id);
    const lessons = await storage.listVideosForCourse(id);
    for (const l of lessons) await storage.deleteVideo(l.id);
    const grants = await storage.listGrantsForCourse(id);
    for (const g of grants) await storage.deleteGrant(g.id);
    await storage.deleteCourse(id);
    res.json({ ok: true });
  });

  // ---------- ADMIN: LESSONS (videos scoped to a course) ----------
  app.post("/api/admin/videos", requireAuth, requireRole("admin"), async (req, res) => {
    const parsed = lessonInputSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.errors[0]?.message || "Invalid input" });
    const course = await storage.getCourse(parsed.data.courseId);
    if (!course) return res.status(400).json({ message: "Course not found" });
    const video = await storage.createVideo({
      title: parsed.data.title,
      description: parsed.data.description || null,
      url: parsed.data.url || "",
      category: course.name,
      courseId: course.id,
      isPremium: course.accessType === "paid",
      thumbnailUrl: null,
    });
    res.json(video);
  });

  app.patch("/api/admin/videos/:id", requireAuth, requireRole("admin"), async (req, res) => {
    const patch: Partial<Video> = {};
    if (typeof req.body.title === "string") patch.title = req.body.title;
    if (req.body.description !== undefined) patch.description = req.body.description || null;
    if (req.body.url !== undefined) patch.url = req.body.url || "";
    if (req.body.courseId !== undefined) {
      const course = await storage.getCourse(Number(req.body.courseId));
      if (!course) return res.status(400).json({ message: "Course not found" });
      patch.courseId = course.id;
      patch.category = course.name;
      patch.isPremium = course.accessType === "paid";
    }
    const updated = await storage.updateVideo(Number(req.params.id), patch);
    if (!updated) return res.status(404).json({ message: "Not found" });
    res.json(updated);
  });

  app.delete("/api/admin/videos/:id", requireAuth, requireRole("admin"), async (req, res) => {
    await storage.deleteVideo(Number(req.params.id));
    res.json({ ok: true });
  });

  // ---------- ADMIN: COURSE GRANTS (manual comps) ----------
  app.get("/api/admin/courses/:id/grants", requireAuth, requireRole("admin"), async (req, res) => {
    const grants = await storage.listGrantsForCourse(Number(req.params.id));
    const withNames = await Promise.all(
      grants.map(async (g) => {
        const partner = await storage.getUser(g.partnerId);
        return { ...g, partnerName: partner?.name, partnerEmail: partner?.email };
      })
    );
    res.json(withNames);
  });

  app.post("/api/admin/courses/:id/grants", requireAuth, requireRole("admin"), async (req, res) => {
    const courseId = Number(req.params.id);
    const partnerId = Number(req.body.partnerId);
    if (!partnerId) return res.status(400).json({ message: "Invalid input" });
    const existing = await storage.getGrant(courseId, partnerId);
    if (existing) return res.json(existing);
    const grant = await storage.createGrant({ courseId, partnerId });
    const grantedCourse = await storage.getCourse(courseId);
    const grantedPartner = await storage.getUser(partnerId);
    if (grantedCourse && grantedPartner) {
      syncLearnDashEnrollment({ email: grantedPartner.email, name: grantedPartner.name }, grantedCourse.learndashCourseId);
    }
    res.json(grant);
  });

  app.delete("/api/admin/course-grants/:id", requireAuth, requireRole("admin"), async (req, res) => {
    await storage.deleteGrant(Number(req.params.id));
    res.json({ ok: true });
  });

  // ---------- ADMIN: PURCHASE HISTORY ----------
  app.get("/api/admin/course-purchases", requireAuth, requireRole("admin"), async (_req, res) => {
    const rows = await storage.listAllCoursePurchases();
    const withDetails = await Promise.all(
      rows.map(async (p) => {
        const user = await storage.getUser(p.userId);
        const course = await storage.getCourse(p.courseId);
        return {
          ...p,
          partnerName: user?.name,
          partnerEmail: user?.email,
          courseName: course?.name,
        };
      })
    );
    res.json(withDetails);
  });

  // ---------- INSTITUTE: MODULES / COHORTS / SESSIONS ----------
  app.get("/api/modules", requireAuth, async (_req, res) => {
    res.json(await storage.listModules());
  });
  app.post("/api/admin/modules", requireAuth, requireRole("admin"), async (req, res) => {
    const parsed = insertModuleSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid input" });
    res.json(await storage.createModule(parsed.data));
  });
  app.patch("/api/admin/modules/:id", requireAuth, requireRole("admin"), async (req, res) => {
    const updated = await storage.updateModule(Number(req.params.id), req.body);
    if (!updated) return res.status(404).json({ message: "Not found" });
    res.json(updated);
  });
  app.delete("/api/admin/modules/:id", requireAuth, requireRole("admin"), async (req, res) => {
    await storage.deleteModule(Number(req.params.id));
    res.json({ ok: true });
  });

  app.get("/api/cohorts", requireAuth, async (_req, res) => {
    res.json(await storage.listCohorts());
  });
  app.post("/api/admin/cohorts", requireAuth, requireRole("admin"), async (req, res) => {
    const parsed = insertCohortSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid input" });
    res.json(await storage.createCohort(parsed.data));
  });
  app.delete("/api/admin/cohorts/:id", requireAuth, requireRole("admin"), async (req, res) => {
    await storage.deleteCohort(Number(req.params.id));
    res.json({ ok: true });
  });

  app.get("/api/admin/enrollments", requireAuth, requireRole("admin"), async (_req, res) => {
    const cohorts = await storage.listCohorts();
    const all = [];
    for (const c of cohorts) {
      const enrollments = await storage.listEnrollmentsForCohort(c.id);
      for (const e of enrollments) {
        const student = await storage.getUser(e.studentId);
        all.push({ ...e, studentName: student?.name, studentEmail: student?.email, cohortName: c.name });
      }
    }
    res.json(all);
  });
  app.post("/api/admin/enrollments", requireAuth, requireRole("admin"), async (req, res) => {
    const parsed = insertCohortEnrollmentSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid input" });
    res.json(await storage.createEnrollment(parsed.data));
  });
  app.delete("/api/admin/enrollments/:id", requireAuth, requireRole("admin"), async (req, res) => {
    await storage.deleteEnrollment(Number(req.params.id));
    res.json({ ok: true });
  });

  app.get("/api/class-sessions", requireAuth, async (_req, res) => {
    res.json(await storage.listClassSessions());
  });

  app.get("/api/students/my-classes", requireAuth, requireRole("student"), async (req: AuthedRequest, res) => {
    const enrollments = await storage.listEnrollmentsForStudent(req.user!.id);
    const cohortIds = enrollments.map((e) => e.cohortId);
    const allSessions = await storage.listClassSessions();
    const mine = allSessions.filter((s) => cohortIds.includes(s.cohortId));
    const cohorts = await storage.listCohorts();
    const modules = await storage.listModules();
    const enriched = mine.map((s) => {
      const cohort = cohorts.find((c) => c.id === s.cohortId);
      const module = modules.find((m) => m.id === cohort?.moduleId);
      return { ...s, cohortName: cohort?.name, moduleName: module?.name };
    });
    res.json(enriched);
  });

  app.post("/api/admin/class-sessions", requireAuth, requireRole("admin"), async (req, res) => {
    const parsed = insertClassSessionSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid input" });
    res.json(await storage.createClassSession(parsed.data));
  });
  app.patch("/api/admin/class-sessions/:id", requireAuth, requireRole("admin"), async (req, res) => {
    const updated = await storage.updateClassSession(Number(req.params.id), req.body);
    if (!updated) return res.status(404).json({ message: "Not found" });
    res.json(updated);
  });
  app.delete("/api/admin/class-sessions/:id", requireAuth, requireRole("admin"), async (req, res) => {
    await storage.deleteClassSession(Number(req.params.id));
    res.json({ ok: true });
  });

  // ---------- HOMEWORK ----------
  app.post("/api/homework/upload", requireAuth, requireRole("student"), upload.single("file"), async (req: AuthedRequest, res) => {
    if (!req.file) return res.status(400).json({ message: "No file uploaded" });
    try {
      const { driveFileId } = await uploadToDrive(req.file.buffer, req.file.originalname, req.file.mimetype);
      await storage.createUploadedFile({
        driveFileId,
        filename: req.file.originalname,
        mimeType: req.file.mimetype,
        size: req.file.size,
        category: "homework",
        ownerId: req.user!.id,
        uploadedAt: Date.now(),
      });
      res.json({ url: `/api/files/${driveFileId}`, name: req.file.originalname, type: req.file.mimetype });
    } catch (err: any) {
      res.status(502).json({ message: "File storage upload failed" });
    }
  });

  app.post("/api/homework", requireAuth, requireRole("student"), async (req: AuthedRequest, res) => {
    const parsed = insertHomeworkSubmissionSchema.safeParse({ ...req.body, studentId: req.user!.id });
    if (!parsed.success) return res.status(400).json({ message: parsed.error.errors[0]?.message || "Invalid input" });
    const hw = await storage.createHomework({ ...parsed.data, createdAt: Date.now() });
    res.json(hw);
  });

  app.get("/api/homework/mine", requireAuth, requireRole("student"), async (req: AuthedRequest, res) => {
    const rows = await storage.listHomeworkForStudent(req.user!.id);
    res.json(rows);
  });

  app.get("/api/admin/homework", requireAuth, requireRole("admin"), async (req, res) => {
    const { classSessionId, studentId } = req.query;
    let rows = await storage.listAllHomework();
    if (classSessionId) rows = rows.filter((h) => h.classSessionId === Number(classSessionId));
    if (studentId) rows = rows.filter((h) => h.studentId === Number(studentId));
    const withNames = await Promise.all(
      rows.map(async (h) => {
        const student = await storage.getUser(h.studentId);
        const session = await storage.getClassSession(h.classSessionId);
        return { ...h, studentName: student?.name, sessionTitle: session?.title };
      })
    );
    res.json(withNames);
  });

  // ---------- ADMIN: PENDING APPROVALS ----------
  app.get("/api/admin/pending-users", requireAuth, requireRole("admin"), async (_req, res) => {
    const rows = await storage.listUsersByRoleStatus(undefined, "pending");
    res.json(rows);
  });

  app.patch("/api/admin/users/:id/status", requireAuth, requireRole("admin"), async (req, res) => {
    const { status } = req.body;
    if (!["approved", "rejected", "pending"].includes(status)) {
      return res.status(400).json({ message: "Invalid status" });
    }
    const updated = await storage.updateUserStatus(Number(req.params.id), status);
    if (!updated) return res.status(404).json({ message: "Not found" });
    // Mirror the one-click email link's notification behavior here too, so
    // registrants reviewed from the admin dashboard also hear back.
    if (status === "approved" || status === "rejected") {
      await storage.setUserApprovalToken(updated.id, null);
      await sendDecisionEmail(updated, status);
    }
    res.json(updated);
  });

  app.get("/api/admin/partners", requireAuth, requireRole("admin"), async (_req, res) => {
    res.json(await storage.listUsersByRoleStatus("partner", "approved"));
  });
  app.get("/api/admin/students", requireAuth, requireRole("admin"), async (_req, res) => {
    res.json(await storage.listUsersByRoleStatus("student", "approved"));
  });

  // Full partner + student directory for the admin "Partners & Students" page
  // — every status (pending/approved/rejected) and both roles, so admins can
  // find a partner-turned-student (or vice versa) and convert them back and
  // forth. Unlike /api/admin/partners above, which only returns approved
  // partners (used by the video-access dropdown).
  app.get("/api/admin/all-partners", requireAuth, requireRole("admin"), async (_req, res) => {
    const partners = await storage.listUsersByRoleStatus("partner");
    const students = await storage.listUsersByRoleStatus("student");
    res.json([...partners, ...students].sort((a, b) => b.createdAt - a.createdAt));
  });

  // Admin-initiated role switch between partner <-> student, reversible any
  // number of times. All of a user's history (referrals, orders, purchases,
  // homework, class enrollments) is keyed by their user id, not their role,
  // so this is safe and preserves everything on both sides of the switch.
  app.post("/api/admin/users/:id/role", requireAuth, requireRole("admin"), async (req, res) => {
    const { role } = req.body;
    if (role !== "partner" && role !== "student") {
      return res.status(400).json({ message: "Role must be 'partner' or 'student'" });
    }
    const user = await storage.getUser(Number(req.params.id));
    if (!user) return res.status(404).json({ message: "Not found" });
    if (user.role !== "partner" && user.role !== "student") {
      return res.status(400).json({ message: "Only partner/student accounts can be converted" });
    }
    const updated = await storage.updateUserRole(user.id, role);
    res.json(updated);
  });

  // Admin-initiated password reset: generates a fresh random password,
  // applies it immediately, and returns the plaintext once so the admin can
  // relay it to the partner directly (e.g. by phone or their own email
  // client). This is the only password reset path — deliberately no
  // automated email is sent, since Resend's sandbox mode can only deliver
  // reliably to the account owner's own address and a paid/verified domain
  // is out of scope for now.
  app.post("/api/admin/users/:id/reset-password", requireAuth, requireRole("admin"), async (req, res) => {
    const user = await storage.getUser(Number(req.params.id));
    if (!user) return res.status(404).json({ message: "Not found" });
    const newPassword = crypto.randomBytes(9).toString("base64url"); // 12-char random password
    const passwordHash = await bcrypt.hash(newPassword, 10);
    await storage.updateUserPassword(user.id, passwordHash);
    await storage.setPasswordResetToken(user.id, null, null);
    res.json({ id: user.id, name: user.name, email: user.email, newPassword });
  });

  // Admin-initiated edit of a user's core contact details -- works for ANY
  // account, including other admins (not just partners/students). Scope is
  // deliberately limited to name/email/phone; role, status, and password
  // changes each go through their own dedicated endpoints above.
  app.patch("/api/admin/users/:id/profile", requireAuth, requireRole("admin"), async (req, res) => {
    const parsed = adminEditUserSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.errors[0]?.message || "Invalid input" });
    const patch = parsed.data;
    const target = await storage.getUser(Number(req.params.id));
    if (!target) return res.status(404).json({ message: "Not found" });
    if (patch.email) {
      const existing = await storage.getUserByEmail(patch.email);
      if (existing && existing.id !== target.id) {
        return res.status(400).json({ message: "That email is already in use by another account" });
      }
    }
    const updated = await storage.updateUserProfile(target.id, patch);
    if (!updated) return res.status(404).json({ message: "Not found" });
    res.json(toPublicUser(updated));
  });

  // ---------- ADMIN: LEGACY WORDPRESS PARTNER MIGRATION ----------
  // One-time (safely re-runnable) bulk import of existing partner.maha.clinic
  // accounts, purchase history, and LearnDash course access. Runs entirely
  // server-side against the live database — no emails or push notifications
  // are ever sent as part of this. Generated passwords are retrievable below
  // until an admin marks them as issued.
  app.post("/api/admin/migrate-legacy-partners", requireAuth, requireRole("admin"), async (_req, res) => {
    try {
      const summary = await runLegacyPartnerImport();
      res.json({ ok: true, summary });
    } catch (err) {
      console.error("Legacy partner import failed:", err);
      res.status(500).json({ message: err instanceof Error ? err.message : "Import failed" });
    }
  });

  // Migrated accounts whose generated password hasn't been retrieved/marked
  // issued yet. Returns the plaintext password so the admin can hand it out
  // manually — never emailed or pushed automatically.
  app.get("/api/admin/migrated-users", requireAuth, requireRole("admin"), async (_req, res) => {
    const rows = await storage.listMigratedUsersAwaitingCredentials();
    res.json(rows.map((u) => ({
      id: u.id,
      name: u.name,
      prefix: u.prefix,
      firstName: u.firstName,
      lastName: u.lastName,
      email: u.email,
      username: u.username,
      password: u.migratedPasswordPlain,
      wpUserId: u.wpUserId,
      createdAt: u.createdAt,
    })));
  });

  app.post("/api/admin/migrated-users/:id/mark-issued", requireAuth, requireRole("admin"), async (req, res) => {
    const updated = await storage.markCredentialsIssued(Number(req.params.id));
    if (!updated) return res.status(404).json({ message: "Not found" });
    res.json({ ok: true });
  });

  app.get("/api/admin/legacy-orders/:userId", requireAuth, requireRole("admin"), async (req, res) => {
    res.json(await storage.listLegacyOrdersForUser(Number(req.params.userId)));
  });

  // ---------- ADMIN: TEAM ----------
  app.get("/api/admin/team", requireAuth, requireRole("admin"), async (_req, res) => {
    res.json(await storage.listAdmins());
  });
  app.post("/api/admin/team", requireAuth, requireRole("admin"), async (req, res) => {
    const parsed = insertUserSchema.safeParse({
      role: "admin",
      name: req.body.name,
      email: req.body.email,
      passwordHash: "x",
      status: "approved",
      phone: req.body.phone || null,
    });
    if (!parsed.success) return res.status(400).json({ message: "Invalid input" });
    const existing = await storage.getUserByEmail(req.body.email);
    if (existing) return res.status(400).json({ message: "Email already in use" });
    const passwordHash = await bcrypt.hash(req.body.password, 10);
    const admin = await storage.createUser({ ...parsed.data, passwordHash, status: "approved" } as any);
    res.json({ id: admin.id, name: admin.name, email: admin.email });
  });

  // ---------- CHAT ----------
  // Partners/students can have several topic-based threads at once, so list
  // and create routes operate over all of the caller's own threads.
  //
  // Shared helpers below implement the referral<->chat linking/merge logic
  // once and are reused by both the partner/student and admin route pairs.

  async function requestReferralForThread(threadId: number, requestedByRole: "partner" | "student" | "admin") {
    const thread = await storage.getThread(threadId);
    if (!thread) return { status: 404 as const, body: { message: "Chat not found" } };
    if (thread.referralId) return { status: 400 as const, body: { message: "This chat is already linked to a referral." } };
    const updated = await storage.updateThread(threadId, {
      pendingReferralRequestedAt: Date.now(),
      pendingReferralRequestedByRole: requestedByRole,
    });
    return { status: 200 as const, body: updated };
  }

  // Links `currentThreadId` to `referralId`. If a *different* thread is
  // already the dedicated chat for that referral and has messages, a merge is
  // required (and only performed once `confirmMerge` is true) -- the target
  // (survivor) is always the pre-existing referral thread, so its topic/kind
  // linkage never needs to change; the current thread's messages are moved
  // over in chronological order and the now-empty current thread is removed.
  async function linkThreadToReferralHandler(currentThreadId: number, referralId: number, confirmMerge: boolean) {
    const currentThread = await storage.getThread(currentThreadId);
    if (!currentThread) return { status: 404 as const, body: { message: "Chat not found" } };
    const referral = await storage.getReferral(referralId);
    if (!referral) return { status: 404 as const, body: { message: "Referral not found" } };
    if (referral.partnerId !== currentThread.userId) {
      return { status: 403 as const, body: { message: "That referral doesn't belong to this chat's owner." } };
    }
    if (currentThread.referralId && currentThread.referralId !== referralId) {
      return { status: 400 as const, body: { message: "This chat is already linked to a different referral." } };
    }

    const patientTopic = `Patient: ${referral.patientFirstName} ${referral.patientLastName}`;
    const existingThread = await storage.getThreadByReferralId(referralId);

    if (!existingThread || existingThread.id === currentThreadId) {
      const updated = await storage.updateThread(currentThreadId, {
        kind: "referral",
        referralId,
        topic: patientTopic,
        pendingReferralRequestedAt: null,
        pendingReferralRequestedByRole: null,
      });
      return { status: 200 as const, body: { thread: updated, merged: false } };
    }

    const existingMsgCount = await storage.countMessagesForThread(existingThread.id);
    if (existingMsgCount === 0) {
      // Dedicated referral thread exists but is empty -- nothing worth
      // preserving, so just drop it and relink the current chat directly.
      await storage.deleteThread(existingThread.id);
      const updated = await storage.updateThread(currentThreadId, {
        kind: "referral",
        referralId,
        topic: patientTopic,
        pendingReferralRequestedAt: null,
        pendingReferralRequestedByRole: null,
      });
      return { status: 200 as const, body: { thread: updated, merged: false } };
    }

    if (!confirmMerge) {
      const preview = await storage.listMessagesForThread(existingThread.id);
      const last = preview[preview.length - 1];
      return {
        status: 409 as const,
        body: {
          mergeRequired: true,
          message: "Merge this chat with existing patient referral chat?",
          existingThread: {
            id: existingThread.id,
            topic: existingThread.topic,
            messageCount: preview.length,
            lastMessage: last?.body,
            lastMessageAt: last?.createdAt,
          },
        },
      };
    }

    await storage.reassignMessages(currentThreadId, existingThread.id);
    await storage.deleteThread(currentThreadId);
    const survivor = await storage.updateThread(existingThread.id, {
      pendingReferralRequestedAt: null,
      pendingReferralRequestedByRole: null,
    });
    return { status: 200 as const, body: { thread: survivor, merged: true, survivingThreadId: existingThread.id } };
  }

  // Groups raw reaction rows for a thread into a per-message emoji summary
  // (emoji + count + whether the current caller is one of the reactors),
  // WhatsApp-style -- each user contributes at most one emoji per message.
  async function reactionSummariesForThread(threadId: number, currentUserId: number) {
    const rows = await storage.getReactionsForThread(threadId);
    const byMessage = new Map<number, { emoji: string; count: number; mine: boolean; userNames: string[] }[]>();
    for (const r of rows) {
      const list = byMessage.get(r.messageId) ?? [];
      let entry = list.find((e) => e.emoji === r.emoji);
      if (!entry) {
        entry = { emoji: r.emoji, count: 0, mine: false, userNames: [] };
        list.push(entry);
      }
      entry.count += 1;
      entry.userNames.push(r.userName);
      if (r.userId === currentUserId) entry.mine = true;
      byMessage.set(r.messageId, list);
    }
    return byMessage;
  }

  // A soft-deleted message (admin-only delete) keeps its row -- flags,
  // reactions, and admin to-dos still point at a valid messageId -- but its
  // content is blanked out here at the API boundary so every consumer
  // (partner/student and admin chat views alike) renders a neutral
  // "message was deleted" placeholder instead of leftover content.
  function redactDeletedMessage<T extends { deletedAt: number | null; body: string; attachmentUrl: string | null; attachmentType: string | null; attachmentName: string | null }>(m: T): T {
    if (!m.deletedAt) return m;
    return { ...m, body: "", attachmentUrl: null, attachmentType: null, attachmentName: null };
  }

  app.get("/api/chat/threads", requireAuth, requireRole("partner", "student"), async (req: AuthedRequest, res) => {
    const threads = await storage.listThreadsForUser(req.user!.id);
    const withPreview = await Promise.all(
      threads.map(async (t) => {
        const messages = await storage.listMessagesForThread(t.id);
        const last = messages[messages.length - 1];
        // Unread-for-owner (Item 10): the most recent message came from an
        // admin and is newer than the last time this owner opened the thread.
        const unread = !!last && last.senderRole === "admin" && last.createdAt > (t.ownerLastReadAt ?? 0);
        return {
          ...t,
          lastMessage: last?.body,
          lastMessageAt: last?.createdAt,
          messageCount: messages.length,
          unread,
        };
      })
    );
    res.json(withPreview);
  });

  app.post("/api/chat/threads", requireAuth, requireRole("partner", "student"), async (req: AuthedRequest, res) => {
    // Optional `referralId` lets the @-mention "start new chat for this
    // referral" flow create a dedicated thread in one call, instead of the
    // two-step create-then-link-referral dance. Plain topic-only creation
    // (no referralId) is unchanged for the regular "New chat" dialog.
    const referralId = req.body.referralId != null ? Number(req.body.referralId) : null;
    if (referralId) {
      const referral = await storage.getReferral(referralId);
      if (!referral || referral.partnerId !== req.user!.id) {
        return res.status(404).json({ message: "Referral not found" });
      }
      const existing = await storage.getThreadByReferralId(referralId);
      if (existing) return res.json(existing);
      const patientTopic = `Patient: ${referral.patientFirstName} ${referral.patientLastName}`;
      const thread = await storage.createThread(req.user!.id, req.user!.role, patientTopic, {
        kind: "referral",
        referralId,
      });
      return res.json(thread);
    }
    const topic = typeof req.body.topic === "string" ? req.body.topic.trim() : "";
    if (!topic) return res.status(400).json({ message: "Please give the chat a topic." });
    const thread = await storage.createThread(req.user!.id, req.user!.role, topic);
    res.json(thread);
  });

  app.get("/api/chat/threads/:id/messages", requireAuth, requireRole("partner", "student"), async (req: AuthedRequest, res) => {
    const thread = await storage.getThread(Number(req.params.id));
    if (!thread || thread.userId !== req.user!.id) return res.status(404).json({ message: "Not found" });
    const messages = await storage.listMessagesForThread(thread.id);
    const flaggedIds = new Set(await storage.getFlaggedMessageIdsForUser(req.user!.id, thread.id));
    const reactionsByMessage = await reactionSummariesForThread(thread.id, req.user!.id);
    // Opening the thread clears the unread marker for its owner (Item 10).
    await storage.updateThread(thread.id, { ownerLastReadAt: Date.now() });
    res.json(messages.map((m) => redactDeletedMessage({ ...m, flaggedByMe: flaggedIds.has(m.id), reactions: reactionsByMessage.get(m.id) ?? [] })));
  });

  app.post("/api/chat/threads/:id/messages", requireAuth, requireRole("partner", "student"), async (req: AuthedRequest, res) => {
    const thread = await storage.getThread(Number(req.params.id));
    if (!thread || thread.userId !== req.user!.id) return res.status(404).json({ message: "Not found" });
    const bodyText = typeof req.body.body === "string" ? req.body.body : "";
    if (!bodyText.trim() && !req.body.attachmentUrl) {
      return res.status(400).json({ message: "Message can't be empty." });
    }
    const parsed = insertChatMessageSchema.safeParse({
      threadId: thread.id,
      senderId: req.user!.id,
      senderRole: req.user!.role,
      senderName: req.user!.name,
      body: bodyText,
      attachmentUrl: req.body.attachmentUrl ?? null,
      attachmentType: req.body.attachmentType ?? null,
      attachmentName: req.body.attachmentName ?? null,
    });
    if (!parsed.success) return res.status(400).json({ message: "Invalid input" });
    const msg = await storage.createMessage({ ...parsed.data, createdAt: Date.now() });
    notifyAdminsOfNewMessage(thread, msg).catch((err) => console.error("[push] new-message notify failed:", err));
    res.json(msg);
  });

  // Partner/student self-service: request a referral to be created for this
  // chat is not needed (they can fill it in immediately via POST /api/referrals
  // with linkThreadId), but they can still use this to flag intent without
  // filling the form right away -- e.g. from a shared "neutral" chat.
  app.post("/api/chat/threads/:id/request-referral", requireAuth, requireRole("partner", "student"), async (req: AuthedRequest, res) => {
    const thread = await storage.getThread(Number(req.params.id));
    if (!thread || thread.userId !== req.user!.id) return res.status(404).json({ message: "Not found" });
    const result = await requestReferralForThread(thread.id, req.user!.role as "partner" | "student");
    res.status(result.status).json(result.body);
  });

  app.post("/api/chat/threads/:id/link-referral", requireAuth, requireRole("partner", "student"), async (req: AuthedRequest, res) => {
    const thread = await storage.getThread(Number(req.params.id));
    if (!thread || thread.userId !== req.user!.id) return res.status(404).json({ message: "Not found" });
    const referralId = Number(req.body.referralId);
    if (!referralId) return res.status(400).json({ message: "referralId is required" });
    const result = await linkThreadToReferralHandler(thread.id, referralId, !!req.body.confirmMerge);
    res.status(result.status).json(result.body);
  });

  // Chat file/photo/video uploads -- mirrors the homework upload pattern but
  // requires the caller to already have access to the target thread.
  app.post("/api/chat/upload", requireAuth, requireRole("partner", "student"), upload.single("file"), async (req: AuthedRequest, res) => {
    const threadId = Number(req.body.threadId);
    if (!threadId) return res.status(400).json({ message: "threadId is required" });
    const thread = await storage.getThread(threadId);
    if (!thread || thread.userId !== req.user!.id) return res.status(404).json({ message: "Not found" });
    if (!req.file) return res.status(400).json({ message: "No file uploaded" });
    try {
      const { driveFileId } = await uploadToDrive(req.file.buffer, req.file.originalname, req.file.mimetype);
      await storage.createUploadedFile({
        driveFileId,
        filename: req.file.originalname,
        mimeType: req.file.mimetype,
        size: req.file.size,
        category: "chat",
        ownerId: req.user!.id,
        threadId,
        uploadedAt: Date.now(),
      });
      const type = req.file.mimetype.startsWith("image/") ? "image" : req.file.mimetype.startsWith("video/") ? "video" : req.file.mimetype.startsWith("audio/") ? "audio" : "document";
      res.json({ url: `/api/files/${driveFileId}`, name: req.file.originalname, mimeType: req.file.mimetype, type });
    } catch {
      res.status(502).json({ message: "File storage upload failed" });
    }
  });

  app.patch("/api/chat/messages/:id/flag", requireAuth, requireRole("partner", "student"), async (req: AuthedRequest, res) => {
    const message = await storage.getMessage(Number(req.params.id));
    if (!message) return res.status(404).json({ message: "Not found" });
    const thread = await storage.getThread(message.threadId);
    if (!thread || thread.userId !== req.user!.id) return res.status(404).json({ message: "Not found" });
    const flagged = await storage.toggleMessageFlag(message.id, req.user!.id);
    res.json({ flagged });
  });

  app.patch("/api/chat/messages/:id/react", requireAuth, requireRole("partner", "student"), async (req: AuthedRequest, res) => {
    const message = await storage.getMessage(Number(req.params.id));
    if (!message) return res.status(404).json({ message: "Not found" });
    const thread = await storage.getThread(message.threadId);
    if (!thread || thread.userId !== req.user!.id) return res.status(404).json({ message: "Not found" });
    const emoji = typeof req.body.emoji === "string" ? req.body.emoji.trim() : "";
    if (!emoji) return res.status(400).json({ message: "emoji is required" });
    const result = await storage.setMessageReaction(message.id, req.user!.id, req.user!.name, emoji);
    res.json({ emoji: result });
  });

  // Cross-chat search: find matching messages across ALL of this partner/
  // student's own threads at once, not just the one currently open.
  app.get("/api/chat/search", requireAuth, requireRole("partner", "student"), async (req: AuthedRequest, res) => {
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    if (!q) return res.json([]);
    const myThreads = await storage.listThreadsForUser(req.user!.id);
    const results = await storage.searchMessages(q, myThreads.map((t) => t.id));
    res.json(results);
  });

  app.get("/api/admin/chat/threads", requireAuth, requireRole("admin"), async (_req, res) => {
    const threads = await storage.listThreads();
    const withUser = await Promise.all(
      threads.map(async (t) => {
        const user = await storage.getUser(t.userId);
        const messages = await storage.listMessagesForThread(t.id);
        const last = messages[messages.length - 1];
        // Unread-for-admin (Item 10): most recent message came from the
        // partner/student owner and is newer than any admin's last open of
        // this thread. Any admin opening it clears it for the whole team.
        const unread = !!last && last.senderRole !== "admin" && last.createdAt > (t.adminLastReadAt ?? 0);
        return {
          ...t,
          userName: user?.name,
          userEmail: user?.email,
          lastMessage: last?.body,
          lastMessageAt: last?.createdAt,
          messageCount: messages.length,
          unread,
        };
      })
    );
    res.json(withUser);
  });

  // Admin-side equivalent of the partner "New chat" flow, driven from the
  // @-mention composer: either a bare topic-only chat (`topic`) or a
  // referral that doesn't have its own dedicated thread yet (`referralId`),
  // for a partner the admin is already viewing. Mirrors the referralId
  // branch of POST /api/chat/threads above.
  app.post("/api/admin/chat/threads", requireAuth, requireRole("admin"), async (req: AuthedRequest, res) => {
    const userId = Number(req.body.userId);
    if (!userId) return res.status(400).json({ message: "userId is required" });
    const targetUser = await storage.getUser(userId);
    if (!targetUser) return res.status(404).json({ message: "User not found" });

    const referralId = req.body.referralId != null ? Number(req.body.referralId) : null;
    if (referralId) {
      const referral = await storage.getReferral(referralId);
      if (!referral || referral.partnerId !== userId) {
        return res.status(404).json({ message: "Referral not found" });
      }
      const existing = await storage.getThreadByReferralId(referralId);
      if (existing) return res.json(existing);
      const patientTopic = `Patient: ${referral.patientFirstName} ${referral.patientLastName}`;
      const thread = await storage.createThread(userId, targetUser.role, patientTopic, {
        kind: "referral",
        referralId,
      });
      return res.json(thread);
    }

    const topic = typeof req.body.topic === "string" ? req.body.topic.trim() : "";
    const thread = await storage.createThread(userId, targetUser.role, topic || "New chat");
    res.json(thread);
  });

  app.get("/api/admin/chat/threads/:id/messages", requireAuth, requireRole("admin"), async (req: AuthedRequest, res) => {
    const threadId = Number(req.params.id);
    const thread = await storage.getThread(threadId);
    if (!thread) return res.status(404).json({ message: "Not found" });
    const messages = await storage.listMessagesForThread(threadId);
    const flaggedIds = new Set(await storage.getFlaggedMessageIdsForUser(req.user!.id, threadId));
    const reactionsByMessage = await reactionSummariesForThread(threadId, req.user!.id);
    // Opening the thread clears the unread marker for the whole admin team (Item 10).
    await storage.updateThread(threadId, { adminLastReadAt: Date.now() });
    res.json(messages.map((m) => redactDeletedMessage({ ...m, flaggedByMe: flaggedIds.has(m.id), reactions: reactionsByMessage.get(m.id) ?? [] })));
  });

  app.post("/api/admin/chat/threads/:id/messages", requireAuth, requireRole("admin"), async (req: AuthedRequest, res) => {
    const threadId = Number(req.params.id);
    const thread = await storage.getThread(threadId);
    if (!thread) return res.status(404).json({ message: "Not found" });
    const bodyText = typeof req.body.body === "string" ? req.body.body : "";
    if (!bodyText.trim() && !req.body.attachmentUrl) {
      return res.status(400).json({ message: "Message can't be empty." });
    }
    const parsed = insertChatMessageSchema.safeParse({
      threadId,
      senderId: req.user!.id,
      senderRole: "admin",
      senderName: req.user!.name,
      body: bodyText,
      attachmentUrl: req.body.attachmentUrl ?? null,
      attachmentType: req.body.attachmentType ?? null,
      attachmentName: req.body.attachmentName ?? null,
    });
    if (!parsed.success) return res.status(400).json({ message: "Invalid input" });
    const msg = await storage.createMessage({ ...parsed.data, createdAt: Date.now() });
    res.json(msg);
  });

  // Admin-initiated: only flags the chat as "referral requested" -- the
  // partner/student fills in the actual form themselves next time they open
  // the chat. Admin never fills in the form on the end-user's behalf.
  app.post("/api/admin/chat/threads/:id/request-referral", requireAuth, requireRole("admin"), async (req, res) => {
    const result = await requestReferralForThread(Number(req.params.id), "admin");
    res.status(result.status).json(result.body);
  });

  app.post("/api/admin/chat/threads/:id/link-referral", requireAuth, requireRole("admin"), async (req, res) => {
    const referralId = Number(req.body.referralId);
    if (!referralId) return res.status(400).json({ message: "referralId is required" });
    const result = await linkThreadToReferralHandler(Number(req.params.id), referralId, !!req.body.confirmMerge);
    res.status(result.status).json(result.body);
  });

  app.post("/api/admin/chat/upload", requireAuth, requireRole("admin"), upload.single("file"), async (req: AuthedRequest, res) => {
    const threadId = Number(req.body.threadId);
    if (!threadId) return res.status(400).json({ message: "threadId is required" });
    const thread = await storage.getThread(threadId);
    if (!thread) return res.status(404).json({ message: "Not found" });
    if (!req.file) return res.status(400).json({ message: "No file uploaded" });
    try {
      const { driveFileId } = await uploadToDrive(req.file.buffer, req.file.originalname, req.file.mimetype);
      await storage.createUploadedFile({
        driveFileId,
        filename: req.file.originalname,
        mimeType: req.file.mimetype,
        size: req.file.size,
        category: "chat",
        ownerId: req.user!.id,
        threadId,
        uploadedAt: Date.now(),
      });
      const type = req.file.mimetype.startsWith("image/") ? "image" : req.file.mimetype.startsWith("video/") ? "video" : req.file.mimetype.startsWith("audio/") ? "audio" : "document";
      res.json({ url: `/api/files/${driveFileId}`, name: req.file.originalname, mimeType: req.file.mimetype, type });
    } catch {
      res.status(502).json({ message: "File storage upload failed" });
    }
  });

  app.patch("/api/admin/chat/messages/:id/flag", requireAuth, requireRole("admin"), async (req: AuthedRequest, res) => {
    const message = await storage.getMessage(Number(req.params.id));
    if (!message) return res.status(404).json({ message: "Not found" });
    const flagged = await storage.toggleMessageFlag(message.id, req.user!.id);
    res.json({ flagged });
  });

  app.patch("/api/admin/chat/messages/:id/react", requireAuth, requireRole("admin"), async (req: AuthedRequest, res) => {
    const message = await storage.getMessage(Number(req.params.id));
    if (!message) return res.status(404).json({ message: "Not found" });
    const emoji = typeof req.body.emoji === "string" ? req.body.emoji.trim() : "";
    if (!emoji) return res.status(400).json({ message: "emoji is required" });
    const result = await storage.setMessageReaction(message.id, req.user!.id, req.user!.name, emoji);
    res.json({ emoji: result });
  });

  // Admin-only message delete. Soft delete: the row stays (so flags,
  // reactions, and any admin to-do linked to this messageId remain valid),
  // but content is blanked out for every viewer via redactDeletedMessage
  // above. Idempotent -- deleting an already-deleted message just returns it.
  app.delete("/api/admin/chat/messages/:id", requireAuth, requireRole("admin"), async (req: AuthedRequest, res) => {
    const message = await storage.getMessage(Number(req.params.id));
    if (!message) return res.status(404).json({ message: "Not found" });
    const updated = message.deletedAt ? message : await storage.deleteMessage(message.id, req.user!.name);
    res.json(redactDeletedMessage(updated));
  });

  // Cross-chat search: find matching messages across EVERY partner/student
  // thread at once, so the admin doesn't have to open each conversation.
  app.get("/api/admin/chat/search", requireAuth, requireRole("admin"), async (req, res) => {
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    if (!q) return res.json([]);
    const results = await storage.searchMessages(q);
    const withOwner = await Promise.all(
      results.map(async (m) => {
        const thread = await storage.getThread(m.threadId);
        const owner = thread ? await storage.getUser(thread.userId) : undefined;
        return { ...m, ownerName: owner?.name ?? null };
      })
    );
    res.json(withOwner);
  });

  // ---------- ADMIN TO-DOS (message-linked handoff between admins) ----------
  // One admin marks a specific chat message and hands it to another admin
  // with a short note. Fires an email to the assignee in addition to
  // showing up in the shared /api/admin/todos list.
  app.post("/api/admin/chat/messages/:id/todo", requireAuth, requireRole("admin"), async (req: AuthedRequest, res) => {
    const message = await storage.getMessage(Number(req.params.id));
    if (!message) return res.status(404).json({ message: "Not found" });
    const note = typeof req.body.note === "string" ? req.body.note.trim() : "";
    const assignedToAdminId = Number(req.body.assignedToAdminId);
    if (!note) return res.status(400).json({ message: "note is required" });
    if (!assignedToAdminId) return res.status(400).json({ message: "assignedToAdminId is required" });
    const assignee = await storage.getUser(assignedToAdminId);
    if (!assignee || assignee.role !== "admin") return res.status(400).json({ message: "assignedToAdminId must be an admin" });

    const todo = await storage.createAdminTodo({
      messageId: message.id,
      threadId: message.threadId,
      createdByAdminId: req.user!.id,
      assignedToAdminId,
      note,
    } as any);

    const thread = await storage.getThread(message.threadId);
    sendEmail(
      [assignee.email],
      `New to-do from ${req.user!.name}`,
      buildAdminTodoEmailHtml({
        assigneeName: assignee.name,
        createdByName: req.user!.name,
        note,
        messageSnippet: message.body?.slice(0, 300) || (message.attachmentName ? `[attachment: ${message.attachmentName}]` : "[attachment]"),
        threadTopic: thread?.topic || "chat",
        openUrl: FRONTEND_SIGNIN_URL,
      })
    ).catch((err) => console.error("[admin-todo] email failed:", err));

    res.json(todo);
  });

  app.get("/api/admin/todos", requireAuth, requireRole("admin"), async (_req, res) => {
    const todos = await storage.listAdminTodos();
    const enriched = await Promise.all(
      todos.map(async (t) => {
        const [createdBy, assignedTo, message, thread] = await Promise.all([
          storage.getUser(t.createdByAdminId),
          storage.getUser(t.assignedToAdminId),
          storage.getMessage(t.messageId),
          storage.getThread(t.threadId),
        ]);
        return {
          ...t,
          createdByName: createdBy?.name ?? "Unknown",
          assignedToName: assignedTo?.name ?? "Unknown",
          messageSnippet: message?.body?.slice(0, 200) ?? null,
          threadTopic: thread?.topic ?? null,
        };
      })
    );
    enriched.sort((a, b) => b.createdAt - a.createdAt);
    res.json(enriched);
  });

  app.patch("/api/admin/todos/:id", requireAuth, requireRole("admin"), async (req, res) => {
    const todo = await storage.getAdminTodo(Number(req.params.id));
    if (!todo) return res.status(404).json({ message: "Not found" });
    const status = req.body.status === "done" ? "done" : req.body.status === "open" ? "open" : null;
    if (!status) return res.status(400).json({ message: "status must be 'open' or 'done'" });
    const updated = await storage.setAdminTodoStatus(todo.id, status, status === "done" ? Date.now() : null);
    res.json(updated);
  });

  // ---------- HOME SUMMARY ----------
  app.get("/api/partner/home-summary", requireAuth, requireRole("partner", "student"), async (req: AuthedRequest, res) => {
    const referrals = await storage.listReferralsForPartner(req.user!.id);
    const orders = await storage.listOrdersForPartner(req.user!.id);
    const threads = await storage.listThreadsForUser(req.user!.id);
    const messagesByThread = await Promise.all(threads.map((t) => storage.listMessagesForThread(t.id)));
    const recentMessages = messagesByThread
      .flat()
      .sort((a, b) => a.createdAt - b.createdAt)
      .slice(-3);
    res.json({
      openReferrals: referrals.filter((r) => r.status !== "Closed").length,
      openOrders: orders.filter((o) => o.status !== "Fulfilled" && o.status !== "Cancelled").length,
      recentMessages,
      totalReferrals: referrals.length,
      totalOrders: orders.length,
    });
  });

  // ---------- NOTIFICATION HOOK (for parent-agent email sending) ----------
  app.get("/api/admin/pending-notifications", requireNotifyKey, async (_req, res) => {
    const referrals = await storage.listUnnotifiedReferrals();
    const orders = await storage.listUnnotifiedOrders();

    const referralsDetailed = await Promise.all(
      referrals.map(async (r) => {
        const partner = await storage.getUser(r.partnerId);
        return {
          id: r.id,
          type: "referral",
          partnerName: partner?.name,
          partnerEmail: partner?.email,
          partnerPhone: partner?.phone,
          patientFirstName: r.patientFirstName,
          patientLastName: r.patientLastName,
          patientContact: r.patientContact,
          caseDescription: r.caseDescription,
          urgency: r.urgency,
          notes: r.notes,
          createdAt: r.createdAt,
        };
      })
    );

    const ordersDetailed = await Promise.all(
      orders.map(async (o) => {
        const partner = await storage.getUser(o.partnerId);
        const items = await storage.listItemsForOrder(o.id);
        const itemsDetailed = await Promise.all(
          items.map(async (it) => {
            const product = await storage.getProduct(it.productId);
            return { productName: product?.name, quantity: it.quantity, unitPriceAtOrder: it.unitPriceAtOrder };
          })
        );
        return {
          id: o.id,
          type: "order",
          partnerName: partner?.name,
          partnerEmail: partner?.email,
          partnerPhone: partner?.phone,
          status: o.status,
          items: itemsDetailed,
          createdAt: o.createdAt,
        };
      })
    );

    res.json({ referrals: referralsDetailed, orders: ordersDetailed });
  });

  app.post("/api/admin/mark-notified", requireNotifyKey, async (req, res) => {
    const { referralIds = [], orderIds = [] } = req.body as { referralIds: number[]; orderIds: number[] };
    const ts = Date.now();
    if (referralIds.length) await storage.markReferralsNotified(referralIds, ts);
    if (orderIds.length) await storage.markOrdersNotified(orderIds, ts);
    res.json({ ok: true });
  });

  // ---------- PUSH NOTIFICATIONS ----------
  app.get("/api/push/vapid-public-key", (_req, res) => {
    const key = getVapidPublicKey();
    if (!key) return res.status(503).json({ message: "Push not configured" });
    res.json({ publicKey: key });
  });

  app.post("/api/push/subscribe", requireAuth, async (req: AuthedRequest, res) => {
    const parsed = pushSubscribeSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid subscription" });
    const sub = await storage.upsertPushSubscription({
      userId: req.user!.id,
      endpoint: parsed.data.endpoint,
      p256dh: parsed.data.keys.p256dh,
      auth: parsed.data.keys.auth,
      createdAt: Date.now(),
    });
    res.json({ ok: true, id: sub.id });
  });

  app.post("/api/push/unsubscribe", requireAuth, async (req: AuthedRequest, res) => {
    const endpoint = typeof req.body?.endpoint === "string" ? req.body.endpoint : null;
    if (!endpoint) return res.status(400).json({ message: "Missing endpoint" });
    await storage.deletePushSubscriptionByEndpoint(endpoint);
    res.json({ ok: true });
  });

  // ---------- ANNOUNCEMENTS ----------
  app.post("/api/admin/announcements", requireAuth, requireRole("admin"), async (req: AuthedRequest, res) => {
    const parsed = createAnnouncementSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid input" });
    const url = parsed.data.url && parsed.data.url.length > 0 ? parsed.data.url : null;

    const subs = await storage.listPushSubscriptionsForAudience(parsed.data.audience);
    const result = await sendToSubscriptions(subs, {
      title: parsed.data.title,
      body: parsed.data.body,
      url,
    });
    if (result.removedEndpoints.length) {
      await storage.deletePushSubscriptionsByEndpoints(result.removedEndpoints);
    }

    const announcement = await storage.createAnnouncement({
      title: parsed.data.title,
      body: parsed.data.body,
      url,
      audience: parsed.data.audience,
      sentByUserId: req.user!.id,
      recipientCount: result.sent,
      sentAt: Date.now(),
    });

    res.json({
      announcement,
      sent: result.sent,
      failed: result.failed,
      removed: result.removedEndpoints.length,
    });
  });

  app.get("/api/admin/announcements", requireAuth, requireRole("admin"), async (_req, res) => {
    res.json(await storage.listAnnouncements());
  });

  // ---------- CASE DISCUSSIONS (partner-facing) ----------
  app.get("/api/case-discussions", requireAuth, requireRole("partner", "student", "admin"), async (req: AuthedRequest, res) => {
    res.json(await storage.listUpcomingCaseDiscussions(req.user!.id));
  });

  app.post("/api/case-discussions/:id/rsvp", requireAuth, requireRole("partner", "student", "admin"), async (req: AuthedRequest, res) => {
    const discussion = await storage.getCaseDiscussionById(Number(req.params.id));
    if (!discussion) return res.status(404).json({ message: "Not found" });
    await storage.rsvpToCaseDiscussion(discussion.id, req.user!.id);
    res.json({ ok: true });
  });

  app.delete("/api/case-discussions/:id/rsvp", requireAuth, requireRole("partner", "student", "admin"), async (req: AuthedRequest, res) => {
    await storage.cancelCaseDiscussionRsvp(Number(req.params.id), req.user!.id);
    res.json({ ok: true });
  });

  app.get("/api/case-discussions/:id/ical", requireAuth, requireRole("partner", "student", "admin"), async (req: AuthedRequest, res) => {
    const discussion = await storage.getCaseDiscussionById(Number(req.params.id));
    if (!discussion) return res.status(404).json({ message: "Not found" });
    const ics = buildCaseDiscussionIcs(discussion);
    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="case-discussion-${discussion.id}.ics"`);
    res.send(ics);
  });

  // ---------- CASE DISCUSSIONS (admin) ----------
  app.get("/api/admin/case-discussions", requireAuth, requireRole("admin"), async (_req, res) => {
    res.json(await storage.listAllCaseDiscussionsForAdmin());
  });

  app.post("/api/admin/case-discussions", requireAuth, requireRole("admin"), async (req, res) => {
    const parsed = insertCaseDiscussionSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid input" });
    res.json(await storage.createCaseDiscussion(parsed.data));
  });

  app.patch("/api/admin/case-discussions/:id", requireAuth, requireRole("admin"), async (req, res) => {
    const existing = await storage.getCaseDiscussionById(Number(req.params.id));
    if (!existing) return res.status(404).json({ message: "Not found" });
    const updated = await storage.updateCaseDiscussion(Number(req.params.id), req.body);
    res.json(updated);
  });

  app.delete("/api/admin/case-discussions/:id", requireAuth, requireRole("admin"), async (req, res) => {
    await storage.deleteCaseDiscussion(Number(req.params.id));
    res.json({ ok: true });
  });

  app.get("/api/admin/case-discussions/:id/attendees", requireAuth, requireRole("admin"), async (req, res) => {
    res.json(await storage.listCaseDiscussionAttendees(Number(req.params.id)));
  });

  // ---------- DATA BACKUPS (admin) ----------
  // Reports the most recent backup outcome (from the in-process scheduler) plus
  // the total number of backups currently stored in the Drive backup folder.
  app.get("/api/admin/backups/status", requireAuth, requireRole("admin"), async (_req, res) => {
    const last = getLastBackupStatus();
    let totalBackups = 0;
    try {
      const folderId = await getOrCreateBackupFolderId();
      const files = await listFolderFiles(folderId);
      totalBackups = files.filter((f) => f.name.startsWith("maha-backup-")).length;
    } catch (err) {
      console.error("[backup] status: failed to list Drive backups:", err);
    }
    res.json({
      lastBackupAt: last ? last.at : null,
      lastBackupOk: last ? last.ok : null,
      lastBackupError: last && !last.ok ? last.error : null,
      totalBackups,
    });
  });

  // Trigger an immediate manual backup and update the scheduler's in-memory
  // status so GET .../status reflects it right away.
  app.post("/api/admin/backups/run", requireAuth, requireRole("admin"), async (_req, res) => {
    const result = await backupDatabaseToDrive(sqliteDb);
    if (result.ok) {
      setLastBackupStatus({ at: Date.now(), ok: true, filename: result.filename });
    } else {
      setLastBackupStatus({ at: Date.now(), ok: false, error: result.error });
    }
    res.json(result);
  });

  return httpServer;
}
