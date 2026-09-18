import type { Express, Request, Response, NextFunction } from "express";
import { createServer } from "node:http";
import type { Server } from "node:http";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import multer from "multer";
import { parse as parseCookie, serialize as serializeCookie } from "cookie";
import { storage, sqliteDb, DB_FILE_PATH } from "./storage";
import { uploadToDrive, streamFromDrive, listFolderFiles, getOrCreateBackupFolderId } from "./googleDrive";
import { convertDriveAudioToMp3, cleanupTempFiles } from "./audioConvert";
import { backupDatabaseToDrive } from "./backup";
import { getLastBackupStatus, setLastBackupStatus } from "./backupScheduler";
import {
  sendEmail, buildRegistrationEmailHtml, buildApprovalEmailHtml, buildDeclineEmailHtml,
  buildAdminTodoEmailHtml, buildPasswordResetEmailHtml, buildLevelUpEmailHtml,
} from "./email";
import {
  registerSchema, loginSchema, changePasswordSchema, forgotPasswordSchema, resetPasswordSchema, updateProfileSchema, adminEditUserSchema, insertProductSchema, insertPriceTierSchema,
  createOrderSchema, insertReferralSchema, courseInputSchema, lessonInputSchema,
  insertModuleSchema, insertCohortSchema, insertCohortEnrollmentSchema, insertClassSessionSchema,
  insertHomeworkSubmissionSchema, insertChatMessageSchema, insertUserSchema,
  estimateShippingCostCents, pushSubscribeSchema, createAnnouncementSchema,
  insertCaseDiscussionSchema, createCommunityTopicSchema, postCommunityMessageSchema,
  communityVisibilitySchema, updateNotificationPreferenceSchema, COMMUNITY_ENABLED_KEY,
  STANDING_POINTS, STANDING_TIERS,
  WELCOME_INTRO_TOPIC_ID_KEY, WELCOME_INTRO_REMIND_EVERY_N_VISITS, WELCOME_INTRO_MAX_REMINDERS,
} from "@shared/schema";
import type { Course, Video } from "@shared/schema";
import { CURRENT_LEGAL_VERSION } from "@shared/legalVersion";
import { getVapidPublicKey, notifyUsers } from "./push";
import { buildCaseDiscussionIcs } from "./ical";
import { getStripe, isStripeConfigured } from "./stripe";
import { syncLearnDashEnrollment, fetchLearnDashCourses, isLearnDashConfigured } from "./learndash";
import { runLegacyPartnerImport } from "./migrateLegacyPartners";
import { runLegacyReferralImport } from "./migrateLegacyReferrals";
import {
  buildRegistrationOptions, verifyRegistration, buildAuthenticationOptions, verifyAuthentication,
  labelFromUserAgent,
} from "./webauthn";
import type { RegistrationResponseJSON, AuthenticationResponseJSON } from "@simplewebauthn/server";

// ---------- MAHA Standing (internal engagement scoring) ----------
// Thin wrapper around storage.awardStandingPoints: also enqueues a pending
// reward the moment a user crosses into a new tier. Never surfaced to the
// user beyond their own tier name elsewhere -- this only logs internally.
async function awardStanding(userId: number, activityKey: keyof typeof STANDING_POINTS, category: string, opts?: { sourceType?: string; sourceId?: number; points?: number }) {
  try {
    const points = opts?.points ?? STANDING_POINTS[activityKey];
    const { newTierKey, clinicId } = await storage.awardStandingPoints({
      userId,
      category,
      points,
      sourceType: opts?.sourceType,
      sourceId: opts?.sourceId,
    });
    if (newTierKey) {
      const tier = STANDING_TIERS.find((t) => t.key === newTierKey);
      if (tier?.reward) {
        // Pooled clinics: one reward record for the practice as a whole
        // (clinicId set), so admins reach out to the clinic rather than
        // crediting whichever individual member's action tipped it over.
        await storage.createStandingReward({
          userId,
          tierKey: tier.key,
          rewardDescription: tier.reward,
          createdAt: Date.now(),
          clinicId,
        });
      }
      if (tier) {
        // Admin-only alert -- never surfaced to the member. Email always
        // fires; push respects each admin's own "offers" preference (see
        // notifyAdminsOfLevelUp), same as every other admin push alert.
        notifyAdminsOfLevelUp(userId, tier.label, !!clinicId).catch((e) =>
          console.error("[standing] level-up admin notify failed:", e)
        );
      }
    }
  } catch (e) {
    // Standing is a side-effect, never a reason to fail the primary action.
    console.error("awardStanding failed", e);
  }
}

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
// correctly on the live site. Other hosts (e.g. Render) serve the API
// directly with no proxy prefix, so this is overridable via
// APP_API_PATH_PREFIX (set it to an empty string on non-pplx.app hosts).
// Defaults to the pplx.app prefix unchanged when unset.
const API_PATH_PREFIX = process.env.APP_API_PATH_PREFIX ?? "/port/5001";
const APP_BASE_URL = `${SITE_ORIGIN}${API_PATH_PREFIX}`;
// Frontend (non-API) links, e.g. the "Sign in now" button in the approval
// email, must NOT include the /port/5001 API prefix — the SPA is served from
// the plain site origin.
const FRONTEND_SIGNIN_URL = `${SITE_ORIGIN}/`;

// Admin-only alert for a Partner Level level-up -- fires on both email (to
// every admin's own address, always) and push (respecting each admin's own
// "offers" push preference, the closest existing category). Deliberately
// never touches the member's own notification preferences or channels --
// see "Do NOT proactively communicate to partners" in project rules.
async function notifyAdminsOfLevelUp(userId: number, tierLabel: string, pooled: boolean) {
  const [user, admins] = await Promise.all([storage.getUser(userId), storage.listAdmins()]);
  if (!user || admins.length === 0) return;
  const openUrl = `${FRONTEND_SIGNIN_URL}#/admin/partners`;
  await Promise.all([
    sendEmail(
      admins.map((a) => a.email),
      `${user.name} reached ${tierLabel} Partner Level`,
      buildLevelUpEmailHtml({ userName: user.name, userEmail: user.email, tierLabel, pooled, openUrl })
    ),
    notifyUsers(admins.map((a) => a.id), "standing", {
      previewTitle: "Partner Level up",
      previewBody: `${user.name} reached ${tierLabel}`,
      genericTitle: "Partner Level up",
      genericBody: "A partner reached a new level",
      url: "/admin/partners",
    }),
  ]);
}

// Hash-routed client page (see client/src/App.tsx) that reads the token from
// the query string and lets the user set a new password.
const FRONTEND_RESET_PASSWORD_URL = `${SITE_ORIGIN}/#/reset-password`;

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
  const bodyPreview = (msg.body || "[attachment]").slice(0, 120);
  await notifyUsers(adminIds, "chat", {
    previewTitle: `${msg.senderName}: ${thread.topic}`,
    previewBody: bodyPreview,
    genericTitle: "New chat message",
    genericBody: `${thread.topic}`,
    url: "/admin/chat",
  });
}

// Item: partner/student-facing push when an admin replies in their 1:1
// chat -- previously missing entirely (partners only found out about admin
// replies by opening the app). Respects the recipient's own "chat" category
// preference via notifyUsers.
async function notifyOwnerOfAdminReply(thread: { id: number; userId: number; topic: string }, msg: { senderName: string; body: string | null }) {
  const bodyPreview = (msg.body || "[attachment]").slice(0, 120);
  await notifyUsers([thread.userId], "chat", {
    previewTitle: `${msg.senderName} replied in ${thread.topic}`,
    previewBody: bodyPreview,
    genericTitle: "New reply in your chat",
    genericBody: thread.topic,
    url: "/chat",
  });
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
  // Set only while an admin is using "View Platform as Member" -- the real
  // admin identity behind the session, kept alongside the effective
  // (impersonated) `user` above so routes/logging can tell the two apart.
  impersonatedBy?: PublicUser;
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
  photoUrl: string | null;
  city: string | null;
  address: string | null;
  country: string | null;
  legalAcceptedVersion: string | null;
  adminNavOrder: string | null;
  communityShowPhone: boolean;
  communityShowEmail: boolean;
  notifyCommunityEnabled: boolean;
  notifyCommunityStyle: string;
  notifyChatEnabled: boolean;
  notifyChatStyle: string;
  notifyOrdersEnabled: boolean;
  notifyOrdersStyle: string;
  notifyOffersEnabled: boolean;
  notifyOffersStyle: string;
  unreadBadgeCount: number;
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
  photoUrl?: string | null;
  city?: string | null;
  address?: string | null;
  country?: string | null;
  legalAcceptedVersion?: string | null;
  adminNavOrder?: string | null;
  communityShowPhone?: boolean | null;
  communityShowEmail?: boolean | null;
  notifyCommunityEnabled?: boolean | null;
  notifyCommunityStyle?: string | null;
  notifyChatEnabled?: boolean | null;
  notifyChatStyle?: string | null;
  notifyOrdersEnabled?: boolean | null;
  notifyOrdersStyle?: string | null;
  notifyOffersEnabled?: boolean | null;
  notifyOffersStyle?: string | null;
  unreadBadgeCount?: number | null;
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
    photoUrl: user.photoUrl ?? null,
    city: user.city ?? null,
    address: user.address ?? null,
    country: user.country ?? null,
    legalAcceptedVersion: user.legalAcceptedVersion ?? null,
    adminNavOrder: user.adminNavOrder ?? null,
    communityShowPhone: user.communityShowPhone ?? false,
    communityShowEmail: user.communityShowEmail ?? false,
    notifyCommunityEnabled: user.notifyCommunityEnabled ?? true,
    notifyCommunityStyle: user.notifyCommunityStyle ?? "preview",
    notifyChatEnabled: user.notifyChatEnabled ?? true,
    notifyChatStyle: user.notifyChatStyle ?? "preview",
    notifyOrdersEnabled: user.notifyOrdersEnabled ?? true,
    notifyOrdersStyle: user.notifyOrdersStyle ?? "preview",
    notifyOffersEnabled: user.notifyOffersEnabled ?? true,
    notifyOffersStyle: user.notifyOffersStyle ?? "preview",
    unreadBadgeCount: user.unreadBadgeCount ?? 0,
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
  if (!user || user.status !== "approved" || user.archivedAt) {
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

  // "View Platform as Member": the session row belongs to the admin, but
  // resolves every downstream check (role, ownership, req.user.id) to the
  // target partner/student instead -- fully functional, not read-only. If
  // the target became invalid since impersonation started (deleted,
  // un-approved), silently fall back to the admin rather than 401ing them
  // out of their own account.
  if (session.impersonatingUserId) {
    const target = await storage.getUser(session.impersonatingUserId);
    if (target && target.status === "approved" && !target.archivedAt && (target.role === "partner" || target.role === "student")) {
      req.user = toPublicUser(target);
      req.impersonatedBy = toPublicUser(user);
      return next();
    }
    await storage.setSessionImpersonation(token, null, null);
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
  if (!user || user.status !== "approved" || user.archivedAt) return undefined;
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
      case "community":
        // Community attachments are visible to any signed-in partner,
        // student, or admin -- the Community tab itself has no per-topic
        // access restriction beyond being enabled, so this mirrors "product".
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

    // Clinic status pooling: reuse the businessName they already entered as
    // the clinic-matching key. Exact normalized match auto-joins an existing
    // clinic; no match auto-creates one -- every partner naturally ends up
    // in a clinic (even a "clinic of one" for solo practices), so the
    // pooled-tier math is uniform everywhere. No approval step, per spec.
    if (data.businessName && data.businessName.trim()) {
      try {
        const clinic = await storage.findOrCreateClinicByName(data.businessName.trim());
        await storage.setUserClinic(user.id, clinic.id);
      } catch (err) {
        console.error("[register] failed to auto-join/create clinic:", err);
      }
    }

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
    if (user.archivedAt) {
      return res.status(403).json({ message: "archived", status: "archived" });
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
    res.json({
      ...req.user,
      impersonating: req.impersonatedBy ? { adminId: req.impersonatedBy.id, adminName: req.impersonatedBy.name } : null,
    });
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

  // Persists the admin's own drag-and-drop sidebar reorder (Item: admin nav
  // customization). Admin-only and always scoped to the caller's own row --
  // this is a personal display preference, never a setting for other admins.
  app.patch("/api/admin/nav-order", requireAuth, requireRole("admin"), async (req: AuthedRequest, res) => {
    const order = req.body?.order;
    if (!Array.isArray(order) || !order.every((h) => typeof h === "string")) {
      return res.status(400).json({ message: "order must be an array of strings" });
    }
    const updated = await storage.updateAdminNavOrder(req.user!.id, order);
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

  // Self-service "forgot password" flow. Always returns the same generic
  // message whether or not the email matches an account, so this endpoint
  // can't be used to probe which addresses are registered. Admins can still
  // reset a partner's password directly (see /api/admin/users/:id/reset-password
  // below) as a fallback if email delivery is ever unreliable for someone.
  const GENERIC_FORGOT_PASSWORD_MESSAGE = "If that email is registered, we've sent a link to reset your password.";
  app.post("/api/auth/forgot-password", async (req, res) => {
    const parsed = forgotPasswordSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.errors[0]?.message || "Invalid input" });
    const user = await storage.getUserByEmail(parsed.data.email);
    if (user) {
      const token = crypto.randomBytes(32).toString("hex");
      const expiresAt = Date.now() + 60 * 60 * 1000; // 1 hour
      await storage.setPasswordResetToken(user.id, token, expiresAt);
      const resetUrl = `${FRONTEND_RESET_PASSWORD_URL}?token=${token}`;
      const html = buildPasswordResetEmailHtml({ fullName: user.name, resetUrl });
      await sendEmail([user.email], "Reset your MAHA Partner Platform password", html);
    }
    res.json({ message: GENERIC_FORGOT_PASSWORD_MESSAGE });
  });

  app.post("/api/auth/reset-password", async (req, res) => {
    const parsed = resetPasswordSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.errors[0]?.message || "Invalid input" });
    const user = await storage.getUserByPasswordResetToken(parsed.data.token);
    if (!user || !user.passwordResetExpiresAt || user.passwordResetExpiresAt < Date.now()) {
      return res.status(400).json({ message: "This reset link is invalid or has expired. Please request a new one." });
    }
    const passwordHash = await bcrypt.hash(parsed.data.newPassword, 10);
    await storage.updateUserPassword(user.id, passwordHash);
    await storage.setPasswordResetToken(user.id, null, null);
    res.json({ message: "Your password has been reset. You can now sign in." });
  });

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
    if (!user || user.status !== "approved" || user.archivedAt) {
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
    // Logged as generic "app_activity" with no sourceId back to this
    // referral -- flat, one-time credit for using the feature, not tied to
    // referral outcome. See shared/schema.ts STANDING note for why.
    awardStanding(req.user!.id, "referral_submitted", "app_activity").catch(console.error);
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
  // `?archived=true` returns only archived referrals, `?archived=all` returns
  // both. Default (omitted / anything else) returns only active referrals so
  // the main inbox and sidebar unread badge naturally exclude archived rows.
  app.get("/api/admin/referrals", requireAuth, requireRole("admin"), async (req, res) => {
    const rows = await storage.listAllReferrals();
    const scope = typeof req.query.archived === "string" ? req.query.archived : "false";
    const filtered = rows.filter((r) => {
      const isArchived = r.archivedAt != null;
      if (scope === "all") return true;
      if (scope === "true") return isArchived;
      return !isArchived;
    });
    const withPartner = await Promise.all(
      filtered.map(async (r) => {
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

  // Admin-only, reversible: hide a referral from the default admin list and
  // the "New" sidebar badge without touching the row or its linked patient
  // chat. Partner-side "My referrals" is intentionally unaffected -- the
  // submitting partner still sees their referral regardless of archive state.
  app.patch("/api/admin/referrals/:id/archive", requireAuth, requireRole("admin"), async (req, res) => {
    const archived = !!req.body.archived;
    const updated = await storage.setReferralArchived(Number(req.params.id), archived);
    if (!updated) return res.status(404).json({ message: "Not found" });
    res.json(updated);
  });

  // Admin-only, destructive: permanently removes the referral row. Any
  // linked patient chat thread is kept but unlinked (referralId cleared,
  // kind reset to "general"), preserving the conversation history. The
  // frontend confirms with the admin before calling this.
  app.delete("/api/admin/referrals/:id", requireAuth, requireRole("admin"), async (req, res) => {
    const referral = await storage.getReferral(Number(req.params.id));
    if (!referral) return res.status(404).json({ message: "Not found" });
    await storage.deleteReferral(referral.id);
    res.json({ ok: true });
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
    const previous = await storage.getOrder(Number(req.params.id));
    const updated = await storage.updateOrderStatus(Number(req.params.id), status);
    if (!updated) return res.status(404).json({ message: "Not found" });
    if (status === "Confirmed" && previous?.status !== "Confirmed") {
      const items = await storage.listItemsForOrder(updated.id);
      const totalCents = items.reduce((sum, i) => sum + i.unitPriceAtOrder * i.quantity, 0);
      const points = Math.floor(totalCents / 500); // 1 pt per €5 (500 cents)
      if (points > 0) {
        awardStanding(updated.partnerId, "order_confirmed_per_5_eur", "shop", { sourceType: "order", sourceId: updated.id, points }).catch(console.error);
      }
    }
    notifyUsers([updated.partnerId], "orders", {
      previewTitle: "Order update",
      previewBody: `Your order #${updated.id} is now "${updated.status}".`,
      genericTitle: "Order update",
      genericBody: "One of your orders has a status update.",
      url: "/shop",
    }).catch((err) => console.error("[push] order-status notify failed:", err));
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
    awardStanding(req.user!.id, "homework_submitted", "education", { sourceType: "homework", sourceId: hw.id }).catch(console.error);
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
    const previousUser = await storage.getUser(Number(req.params.id));
    const updated = await storage.updateUserStatus(Number(req.params.id), status);
    if (!updated) return res.status(404).json({ message: "Not found" });
    // Mirror the one-click email link's notification behavior here too, so
    // registrants reviewed from the admin dashboard also hear back.
    if (status === "approved" || status === "rejected") {
      await storage.setUserApprovalToken(updated.id, null);
      await sendDecisionEmail(updated, status);
    }
    if (status === "approved" && previousUser?.status !== "approved" && updated.role === "student") {
      awardStanding(updated.id, "student_approved", "education", { sourceType: "student_approval", sourceId: updated.id }).catch(console.error);
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
    const partners = await storage.listUsersByRoleStatus("partner", undefined, true);
    const students = await storage.listUsersByRoleStatus("student", undefined, true);
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
  // client). Kept as a manual fallback alongside the self-service emailed
  // reset-link flow above (/api/auth/forgot-password), for cases where an
  // admin wants to set a password directly without waiting on email.
  app.post("/api/admin/users/:id/reset-password", requireAuth, requireRole("admin"), async (req, res) => {
    const user = await storage.getUser(Number(req.params.id));
    if (!user) return res.status(404).json({ message: "Not found" });
    const newPassword = crypto.randomBytes(9).toString("base64url"); // 12-char random password
    const passwordHash = await bcrypt.hash(newPassword, 10);
    await storage.updateUserPassword(user.id, passwordHash);
    await storage.setPasswordResetToken(user.id, null, null);
    res.json({ id: user.id, name: user.name, email: user.email, newPassword });
  });

  // Reversible hide: an archived partner/student disappears from the
  // default Admin Partners & Students list and can no longer log in, but
  // every row of their history is untouched and un-archiving restores full
  // access immediately. Toggle, not two separate routes -- body decides.
  app.patch("/api/admin/users/:id/archive", requireAuth, requireRole("admin"), async (req, res) => {
    const user = await storage.getUser(Number(req.params.id));
    if (!user) return res.status(404).json({ message: "Not found" });
    if (user.role !== "partner" && user.role !== "student") {
      return res.status(400).json({ message: "Only partner/student accounts can be archived" });
    }
    const archived = req.body?.archived !== false;
    const updated = await storage.archiveUser(user.id, archived);
    res.json(updated);
  });

  // Preview of dependent-row counts, shown in the admin's delete
  // confirmation dialog before they commit to a permanent delete.
  app.get("/api/admin/users/:id/delete-preview", requireAuth, requireRole("admin"), async (req, res) => {
    const user = await storage.getUser(Number(req.params.id));
    if (!user) return res.status(404).json({ message: "Not found" });
    if (user.role !== "partner" && user.role !== "student") {
      return res.status(400).json({ message: "Only partner/student accounts can be deleted" });
    }
    const counts = await storage.getUserDeletionPreview(user.id);
    res.json({ id: user.id, name: user.name, email: user.email, counts });
  });

  // Permanent, irreversible delete -- restricted to partner/student
  // accounts only (never admin), cascades every dependent row in a single
  // transaction. Intended for cleaning up test accounts. Client is expected
  // to have already shown a destructive confirmation dialog.
  app.delete("/api/admin/users/:id", requireAuth, requireRole("admin"), async (req, res) => {
    const user = await storage.getUser(Number(req.params.id));
    if (!user) return res.status(404).json({ message: "Not found" });
    if (user.role !== "partner" && user.role !== "student") {
      return res.status(400).json({ message: "Only partner/student accounts can be deleted" });
    }
    await storage.deleteUserCascade(user.id);
    res.json({ ok: true });
  });

  // Ends "View Platform as Member" and restores the admin's own identity on
  // this same session/cookie. Deliberately not gated by requireRole("admin")
  // -- while impersonating, req.user *is* the partner/student, so the only
  // thing that matters is whether this exact session has an open
  // impersonation to close.
  //
  // Registered BEFORE the parameterized "/api/admin/impersonate/:id" route
  // below -- Express matches routes in registration order, and ":id" would
  // otherwise greedily match the literal path segment "exit" (id="exit"),
  // routing this call through requireRole("admin") instead and 403ing every
  // exit attempt, since req.user is the impersonated partner/student at that
  // point, not an admin.
  app.post("/api/admin/impersonate/exit", requireAuth, async (req: AuthedRequest, res) => {
    const token = getSessionToken(req)!;
    const session = await storage.getSession(token);
    if (!session?.impersonatingUserId) {
      return res.status(400).json({ message: "Not currently viewing as a member" });
    }
    const admin = await storage.getUser(session.userId);
    if (!admin) return res.status(401).json({ message: "Session invalid" });
    if (session.impersonationLogId) await storage.endImpersonationLog(session.impersonationLogId);
    await storage.setSessionImpersonation(token, null, null);
    res.json({ user: toPublicUser(admin) });
  });

  // "View Platform as Member" -- lets an admin become a specific partner or
  // student for real (fully functional, not read-only) without a second app
  // or login. Only ever swaps the CURRENT session's effective identity; the
  // admin's own login is untouched and restored on exit. See requireAuth for
  // how session.impersonatingUserId is resolved on every request.
  app.post("/api/admin/impersonate/:id", requireAuth, requireRole("admin"), async (req: AuthedRequest, res) => {
    const target = await storage.getUser(Number(req.params.id));
    if (!target) return res.status(404).json({ message: "Not found" });
    if (target.role !== "partner" && target.role !== "student") {
      return res.status(400).json({ message: "Can only view the platform as a partner or student" });
    }
    if (target.status !== "approved") {
      return res.status(400).json({ message: "That account isn't approved yet" });
    }
    if (target.archivedAt) {
      return res.status(400).json({ message: "That account is archived" });
    }
    const token = getSessionToken(req)!; // requireAuth guarantees a valid token here
    const log = await storage.startImpersonationLog(req.user!.id, target.id);
    await storage.setSessionImpersonation(token, target.id, log.id);
    res.json({
      user: toPublicUser(target),
      impersonating: { adminId: req.user!.id, adminName: req.user!.name },
    });
  });

  // Per-admin favorites so "View as" doesn't require re-searching the same
  // handful of accounts every time -- scoped to req.user!.id, never shared
  // across admins.
  app.get("/api/admin/pinned-members", requireAuth, requireRole("admin"), async (req: AuthedRequest, res) => {
    const members = await storage.listPinnedMembers(req.user!.id);
    res.json(members.map(toPublicUser));
  });
  app.post("/api/admin/pinned-members/:id", requireAuth, requireRole("admin"), async (req: AuthedRequest, res) => {
    const target = await storage.getUser(Number(req.params.id));
    if (!target) return res.status(404).json({ message: "Not found" });
    await storage.pinMember(req.user!.id, target.id);
    res.json({ ok: true });
  });
  app.delete("/api/admin/pinned-members/:id", requireAuth, requireRole("admin"), async (req: AuthedRequest, res) => {
    await storage.unpinMember(req.user!.id, Number(req.params.id));
    res.json({ ok: true });
  });

  // Admin-initiated edit of a user's core contact details -- works for ANY
  // account, including other admins (not just partners/students). Scope is
  // deliberately limited to name/email/phone/photo; role, status, and
  // password changes each go through their own dedicated endpoints above.
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

  // One-time (safely re-runnable) import of the patient referrals already
  // sitting in the old portal's "Patient Referral Form" before this app
  // existed. Opens the usual dedicated referral chat and awards the usual
  // flat referral credit per row -- see migrateLegacyReferrals.ts. Never
  // sends any email/notification for these historical rows.
  app.post("/api/admin/migrate-legacy-referrals", requireAuth, requireRole("admin"), async (_req, res) => {
    try {
      const summary = await runLegacyReferralImport();
      res.json({ ok: true, summary });
    } catch (err) {
      console.error("Legacy referral import failed:", err);
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

  // MAHA Institute application: instead of a mailto link, the partner-side
  // Institute page runs an in-app chat-style questionnaire. On completion it
  // posts the full Q&A here in one call, which creates a dedicated chat
  // thread (kind: "institute") with the answers as the opening message --
  // this reuses the existing createThread/emailNotified flow, so admins get
  // the normal "New chat started" email automatically with no extra code.
  // An admin then continues the conversation with the partner from the
  // regular chat inbox.
  app.post("/api/chat/institute-application", requireAuth, requireRole("partner", "student"), async (req: AuthedRequest, res) => {
    const specialty = req.body.specialty === "Medical" || req.body.specialty === "Dental" ? req.body.specialty : null;
    const answers = Array.isArray(req.body.answers) ? req.body.answers : [];
    if (!specialty || answers.length === 0) {
      return res.status(400).json({ message: "Missing specialty or answers." });
    }
    const cleanAnswers: { question: string; answer: string }[] = answers
      .map((a: any) => ({
        question: typeof a?.question === "string" ? a.question.trim() : "",
        answer: typeof a?.answer === "string" ? a.answer.trim() : "",
      }))
      .filter((a: { question: string; answer: string }) => a.question && a.answer);
    if (cleanAnswers.length === 0) {
      return res.status(400).json({ message: "Missing specialty or answers." });
    }
    const topic = `MAHA Institute Application — ${req.user!.name} (${specialty})`;
    const thread = await storage.createThread(req.user!.id, req.user!.role, topic, { kind: "institute" });
    const body =
      `New MAHA Institute application from ${req.user!.name} (${specialty}).\n\n` +
      cleanAnswers.map((a) => `${a.question}\n${a.answer}`).join("\n\n");
    const message = await storage.createMessage({
      threadId: thread.id,
      senderId: req.user!.id,
      senderRole: req.user!.role,
      senderName: req.user!.name,
      body,
      createdAt: Date.now(),
    });
    awardStanding(req.user!.id, "institute_application_submitted", "education", { sourceType: "institute_application", sourceId: thread.id }).catch(console.error);
    res.json({ threadId: thread.id, messageId: message.id });
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
    const replyToMessageId =
      typeof req.body.replyToMessageId === "number" && Number.isFinite(req.body.replyToMessageId)
        ? req.body.replyToMessageId
        : null;
    const parsed = insertChatMessageSchema.safeParse({
      threadId: thread.id,
      senderId: req.user!.id,
      senderRole: req.user!.role,
      senderName: req.user!.name,
      body: bodyText,
      attachmentUrl: req.body.attachmentUrl ?? null,
      attachmentType: req.body.attachmentType ?? null,
      attachmentName: req.body.attachmentName ?? null,
      replyToMessageId,
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

  // Owner-only: from an archived thread, ask an admin to reopen it. Notifies
  // admins by push (mirrors notifyAdminsOfNewMessage). Re-archiving or
  // unarchiving the thread clears this flag, so it never lingers past the
  // request it describes.
  app.post("/api/chat/threads/:id/request-reactivation", requireAuth, requireRole("partner", "student"), async (req: AuthedRequest, res) => {
    const thread = await storage.getThread(Number(req.params.id));
    if (!thread || thread.userId !== req.user!.id) return res.status(404).json({ message: "Not found" });
    if (!thread.archivedAt) return res.status(400).json({ message: "Chat isn't archived" });
    const updated = await storage.updateThread(thread.id, { reactivationRequestedAt: Date.now() });
    const admins = await storage.listAdmins();
    const adminIds = admins.map((a) => a.id);
    if (adminIds.length) {
      await notifyUsers(adminIds, "chat", {
        previewTitle: `${req.user!.name} requested to reopen a chat`,
        previewBody: thread.topic,
        genericTitle: "Chat reopen request",
        genericBody: "A partner asked to reopen an archived chat.",
        url: "/admin/chat",
      });
    }
    res.json(updated);
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
          userPhotoUrl: user?.photoUrl,
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

  // Admin-only, reversible: hide a chat from the main inbox without deleting
  // anything. Unarchiving (archived: false) also clears any pending
  // reactivation request, since the thread is now open again anyway.
  app.patch("/api/admin/chat/threads/:id/archive", requireAuth, requireRole("admin"), async (req: AuthedRequest, res) => {
    const thread = await storage.getThread(Number(req.params.id));
    if (!thread) return res.status(404).json({ message: "Not found" });
    const archived = !!req.body.archived;
    const updated = await storage.updateThread(thread.id, {
      archivedAt: archived ? Date.now() : null,
      reactivationRequestedAt: null,
    });
    res.json(updated);
  });

  // Admin-only, destructive: permanently removes the thread, its messages,
  // and any linked flags/reactions/to-dos. Unlike archive, this cannot be
  // undone -- the frontend confirms with the admin before calling this.
  app.delete("/api/admin/chat/threads/:id", requireAuth, requireRole("admin"), async (req: AuthedRequest, res) => {
    const thread = await storage.getThread(Number(req.params.id));
    if (!thread) return res.status(404).json({ message: "Not found" });
    await storage.deleteThread(thread.id);
    res.json({ ok: true });
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
    const replyToMessageId =
      typeof req.body.replyToMessageId === "number" && Number.isFinite(req.body.replyToMessageId)
        ? req.body.replyToMessageId
        : null;
    const parsed = insertChatMessageSchema.safeParse({
      threadId,
      senderId: req.user!.id,
      senderRole: "admin",
      senderName: req.user!.name,
      body: bodyText,
      attachmentUrl: req.body.attachmentUrl ?? null,
      attachmentType: req.body.attachmentType ?? null,
      attachmentName: req.body.attachmentName ?? null,
      replyToMessageId,
    });
    if (!parsed.success) return res.status(400).json({ message: "Invalid input" });
    const msg = await storage.createMessage({ ...parsed.data, createdAt: Date.now() });
    // Previously missing: the partner/student never got pushed when an admin
    // replied in their 1:1 chat. Respects their own "chat" preference.
    notifyOwnerOfAdminReply(thread, msg).catch((err) => console.error("[push] admin-reply notify failed:", err));
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

  // Admin can edit the text of their OWN messages only (not a partner's/
  // student's, and not another admin's). Marks editedAt so every viewer sees
  // a small "(edited)" indicator; the previous body is not retained.
  app.patch("/api/admin/chat/messages/:id", requireAuth, requireRole("admin"), async (req: AuthedRequest, res) => {
    const message = await storage.getMessage(Number(req.params.id));
    if (!message) return res.status(404).json({ message: "Not found" });
    if (message.senderId !== req.user!.id) return res.status(403).json({ message: "You can only edit your own messages" });
    if (message.deletedAt) return res.status(400).json({ message: "Can't edit a deleted message" });
    const body = typeof req.body.body === "string" ? req.body.body.trim() : "";
    if (!body) return res.status(400).json({ message: "Message can't be empty." });
    const updated = await storage.editMessage(message.id, body);
    res.json(updated);
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


  // ---------- COMMUNITY CHAT (topic-threaded partner/student/admin forum) ----------
  // Feature-flagged via appSettings[COMMUNITY_ENABLED_KEY] so it can be
  // switched off instantly without losing data if it isn't ready to launch.
  async function isCommunityEnabled(): Promise<boolean> {
    const v = await storage.getAppSetting(COMMUNITY_ENABLED_KEY);
    return v === "true";
  }

  async function requireCommunityEnabled(_req: AuthedRequest, res: Response, next: NextFunction) {
    if (!(await isCommunityEnabled())) {
      return res.status(404).json({ message: "Community Chat is not available" });
    }
    next();
  }

  // Everyone who can see the Community tab (partner/student/admin) who is
  // not currently blocked from it -- used to resolve the audience for
  // "new topic" / "new reply" pushes.
  async function communityAudienceUserIds(excludeUserId?: number): Promise<number[]> {
    const rows = await storage.listUsersByRoleStatus(undefined, "approved");
    return rows
      .filter((u) => ["partner", "student", "admin"].includes(u.role))
      .filter((u) => !u.communityBlockedAt)
      .filter((u) => u.id !== excludeUserId)
      .map((u) => u.id);
  }

  app.get("/api/community/enabled", requireAuth, async (_req, res) => {
    res.json({ enabled: await isCommunityEnabled() });
  });

  app.patch("/api/admin/community/enabled", requireAuth, requireRole("admin"), async (req, res) => {
    const enabled = !!req.body.enabled;
    await storage.setAppSetting(COMMUNITY_ENABLED_KEY, enabled ? "true" : "false");
    res.json({ enabled });
  });

  app.get(
    "/api/community/topics",
    requireAuth,
    requireRole("partner", "student", "admin"),
    requireCommunityEnabled,
    async (req: AuthedRequest, res) => {
      const includeArchived = req.user!.role === "admin" && req.query.includeArchived === "true";
      const topics = await storage.listCommunityTopics(includeArchived);
      const withPreview = await Promise.all(
        topics.map(async (t) => {
          const messages = await storage.listCommunityMessagesForTopic(t.id);
          const last = messages[messages.length - 1];
          const unreadIds = await storage.getUnreadCommunityMessageIds(t.id, req.user!.id);
          const unreadFromOthers = unreadIds.filter((id) => {
            const msg = messages.find((m) => m.id === id);
            return !!msg && msg.senderId !== req.user!.id;
          });
          const lastVisible = last ? redactDeletedMessage(last) : undefined;
          return {
            ...t,
            messageCount: messages.length,
            lastMessagePreview: lastVisible ? lastVisible.body.slice(0, 140) : "",
            lastMessageSenderName: last?.senderName ?? null,
            lastMessageSenderTierKey: last?.senderTierKey ?? null,
            lastMessageSenderTierLabel: last?.senderTierLabel ?? null,
            unread: unreadFromOthers.length > 0,
          };
        }),
      );
      res.json(withPreview);
    },
  );

  app.get(
    "/api/community/unread-count",
    requireAuth,
    requireRole("partner", "student", "admin"),
    requireCommunityEnabled,
    async (req: AuthedRequest, res) => {
      const count = await storage.countUnreadCommunityTopicsForUser(req.user!.id);
      res.json({ count });
    },
  );

  // Cross-topic search (the "outside" search vs. the per-topic "Search
  // messages..." box that only filters the currently open topic). Mirrors
  // GET /api/chat/search's response shape so the frontend can reuse the same
  // CrossChatSearch component for both. Admins additionally search archived
  // topics, since those still show up in the admin console.
  app.get(
    "/api/community/search",
    requireAuth,
    requireRole("partner", "student", "admin"),
    requireCommunityEnabled,
    async (req: AuthedRequest, res) => {
      const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
      if (!q) return res.json([]);
      const results = await storage.searchCommunityMessages(q, { includeArchived: req.user!.role === "admin" });
      res.json(results.map((r) => ({ ...r, threadKind: "community" })));
    },
  );

  app.post(
    "/api/community/topics",
    requireAuth,
    requireRole("partner", "student", "admin"),
    requireCommunityEnabled,
    async (req: AuthedRequest, res) => {
      const fullUser = await storage.getUser(req.user!.id);
      if (fullUser?.communityBlockedAt) {
        return res.status(403).json({ message: "You've been restricted from posting in the Community." });
      }
      const parsed = createCommunityTopicSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: parsed.error.errors[0]?.message ?? "Invalid input" });
      const now = Date.now();
      const topic = await storage.createCommunityTopic({
        title: parsed.data.title,
        createdByUserId: req.user!.id,
        createdByName: req.user!.name,
        createdByRole: req.user!.role,
        createdAt: now,
        lastMessageAt: now,
      });
      let firstMessage = null;
      if (parsed.data.body.trim() || parsed.data.attachmentUrl) {
        firstMessage = await storage.createCommunityMessage({
          topicId: topic.id,
          senderId: req.user!.id,
          senderRole: req.user!.role,
          senderName: req.user!.name,
          body: parsed.data.body,
          attachmentUrl: parsed.data.attachmentUrl,
          attachmentType: parsed.data.attachmentType,
          attachmentName: parsed.data.attachmentName,
          createdAt: now,
        });
      }
      awardStanding(req.user!.id, "community_topic_created", "community", { sourceType: "community_topic", sourceId: topic.id }).catch(console.error);
      const audience = await communityAudienceUserIds(req.user!.id);
      notifyUsers(audience, "community", {
        genericTitle: "New Community topic",
        genericBody: `${req.user!.name} started a new Community topic.`,
        previewTitle: "New Community topic",
        previewBody: `${req.user!.name} just opened a new Community thread called "${topic.title}"`,
        url: "/community",
      }).catch(console.error);
      res.status(201).json({ topic, firstMessage });
    },
  );

  app.get(
    "/api/community/topics/:id/messages",
    requireAuth,
    requireRole("partner", "student", "admin"),
    requireCommunityEnabled,
    async (req: AuthedRequest, res) => {
      const topic = await storage.getCommunityTopic(Number(req.params.id));
      if (!topic) return res.status(404).json({ message: "Not found" });
      const messages = await storage.listCommunityMessagesForTopic(topic.id);
      // Bulk-mark everything currently visible as read for this viewer --
      // WhatsApp-style "opened the thread" receipt, not per-message scroll tracking.
      await storage.markCommunityMessagesRead(messages.map((m) => m.id), req.user!.id, req.user!.name);
      res.json({ topic, messages: messages.map(redactDeletedMessage) });
    },
  );

  app.post(
    "/api/community/topics/:id/messages",
    requireAuth,
    requireRole("partner", "student", "admin"),
    requireCommunityEnabled,
    async (req: AuthedRequest, res) => {
      const topic = await storage.getCommunityTopic(Number(req.params.id));
      if (!topic) return res.status(404).json({ message: "Not found" });
      const fullUser = await storage.getUser(req.user!.id);
      if (fullUser?.communityBlockedAt) {
        return res.status(403).json({ message: "You've been restricted from posting in the Community." });
      }
      const parsed = postCommunityMessageSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: parsed.error.errors[0]?.message ?? "Invalid input" });
      if (!parsed.data.body.trim() && !parsed.data.attachmentUrl) {
        return res.status(400).json({ message: "Message can't be empty" });
      }
      const now = Date.now();
      const msg = await storage.createCommunityMessage({
        topicId: topic.id,
        senderId: req.user!.id,
        senderRole: req.user!.role,
        senderName: req.user!.name,
        body: parsed.data.body,
        attachmentUrl: parsed.data.attachmentUrl,
        attachmentType: parsed.data.attachmentType,
        attachmentName: parsed.data.attachmentName,
        replyToMessageId: parsed.data.replyToMessageId,
        createdAt: now,
      });
      // Capped so message spam can't be used to farm points -- see
      // STANDING_POINTS note (5/day).
      storage.countStandingEntriesToday(req.user!.id, "community_message").then((countToday) => {
        if (countToday < 5) {
          return awardStanding(req.user!.id, "community_message_posted", "community", { sourceType: "community_message", sourceId: msg.id });
        }
      }).catch(console.error);
      // Notify everyone who has posted in this topic before (the thread's
      // participants), not the whole audience -- replies are scoped to who's
      // actually in the conversation.
      const priorMessages = await storage.listCommunityMessagesForTopic(topic.id);
      const participantIds = Array.from(new Set(priorMessages.map((m) => m.senderId))).filter(
        (id) => id !== req.user!.id,
      );
      notifyUsers(participantIds, "community", {
        genericTitle: "New Community reply",
        genericBody: `${req.user!.name} replied in "${topic.title}"`,
        previewTitle: `New reply in "${topic.title}"`,
        previewBody: `${req.user!.name}: ${parsed.data.body.slice(0, 140)}`,
        url: "/community",
      }).catch(console.error);
      res.status(201).json(msg);
    },
  );

  app.get(
    "/api/admin/community/topics/:id/reads",
    requireAuth,
    requireRole("admin"),
    async (req, res) => {
      const messages = await storage.listCommunityMessagesForTopic(Number(req.params.id));
      const reads = await storage.getCommunityReadsForMessages(messages.map((m) => m.id));
      res.json(reads);
    },
  );

  // ChatComposer (shared with 1:1 chat) always appends the form field as
  // "threadId" -- see ChatComposer.uploadFile(). For Community we reuse the
  // same composer with threadId={topic.id}, so this route deliberately
  // reads req.body.threadId as the topic id rather than renaming the shared
  // component's field.
  app.post(
    "/api/community/upload",
    requireAuth,
    requireRole("partner", "student", "admin"),
    requireCommunityEnabled,
    upload.single("file"),
    async (req: AuthedRequest, res) => {
      const topicId = Number(req.body.threadId);
      if (!topicId) return res.status(400).json({ message: "threadId is required" });
      const topic = await storage.getCommunityTopic(topicId);
      if (!topic) return res.status(404).json({ message: "Not found" });
      if (!req.file) return res.status(400).json({ message: "No file uploaded" });
      try {
        const { driveFileId } = await uploadToDrive(req.file.buffer, req.file.originalname, req.file.mimetype);
        await storage.createUploadedFile({
          driveFileId,
          filename: req.file.originalname,
          mimeType: req.file.mimetype,
          size: req.file.size,
          category: "community",
          ownerId: req.user!.id,
          uploadedAt: Date.now(),
        });
        const type = req.file.mimetype.startsWith("image/") ? "image" : req.file.mimetype.startsWith("video/") ? "video" : req.file.mimetype.startsWith("audio/") ? "audio" : "document";
        res.json({ url: `/api/files/${driveFileId}`, name: req.file.originalname, mimeType: req.file.mimetype, type });
      } catch {
        res.status(502).json({ message: "File storage upload failed" });
      }
    },
  );

  // ---------- WELCOME/INTRO FLOW ----------
  // "Fully skippable, remind every 5th Community entry, 3 reminders total,
  // then leave a persistent manual entry point. Posted AS the new member
  // themselves. Video via file upload (not in-browser recording)."
  // Scoped to partner/student -- admins are established staff, not "new
  // members" being welcomed into the Community.

  // Called once per Community page visit. Bumps the visit counter and tells
  // the client whether to pop the reminder modal this time. Never touches
  // anything once welcomeIntroPostedAt is set -- a member who already
  // posted never gets counted or reminded again.
  app.post(
    "/api/community/welcome-intro/visit",
    requireAuth,
    requireRole("partner", "student"),
    requireCommunityEnabled,
    async (req: AuthedRequest, res) => {
      const fullUser = await storage.getUser(req.user!.id);
      if (!fullUser) return res.status(404).json({ message: "Not found" });
      if (fullUser.welcomeIntroPostedAt) {
        return res.json({
          communityVisitCount: fullUser.communityVisitCount,
          welcomeIntroReminderCount: fullUser.welcomeIntroReminderCount,
          welcomeIntroPostedAt: fullUser.welcomeIntroPostedAt,
          shouldShowReminder: false,
        });
      }
      const nextVisitCount = fullUser.communityVisitCount + 1;
      const canStillRemind = fullUser.welcomeIntroReminderCount < WELCOME_INTRO_MAX_REMINDERS;
      const shouldShowReminder = canStillRemind && nextVisitCount % WELCOME_INTRO_REMIND_EVERY_N_VISITS === 0;
      const nextReminderCount = shouldShowReminder ? fullUser.welcomeIntroReminderCount + 1 : fullUser.welcomeIntroReminderCount;
      await storage.updateUserProfile(fullUser.id, {
        communityVisitCount: nextVisitCount,
        welcomeIntroReminderCount: nextReminderCount,
      });
      res.json({
        communityVisitCount: nextVisitCount,
        welcomeIntroReminderCount: nextReminderCount,
        welcomeIntroPostedAt: null,
        shouldShowReminder,
      });
    },
  );

  // Posts the member's welcome-intro video, authored AS the member, into a
  // lazily-created shared "Introductions" topic. One-time -- once posted,
  // welcomeIntroPostedAt is set and this route refuses a second submission.
  app.post(
    "/api/community/welcome-intro",
    requireAuth,
    requireRole("partner", "student"),
    requireCommunityEnabled,
    upload.single("file"),
    async (req: AuthedRequest, res) => {
      const fullUser = await storage.getUser(req.user!.id);
      if (!fullUser) return res.status(404).json({ message: "Not found" });
      if (fullUser.communityBlockedAt) {
        return res.status(403).json({ message: "You've been restricted from posting in the Community." });
      }
      if (fullUser.welcomeIntroPostedAt) {
        return res.status(409).json({ message: "You've already posted your welcome intro." });
      }
      if (!req.file) return res.status(400).json({ message: "No video uploaded" });
      if (!req.file.mimetype.startsWith("video/")) {
        return res.status(400).json({ message: "Please upload a video file" });
      }
      try {
        const { driveFileId } = await uploadToDrive(req.file.buffer, req.file.originalname, req.file.mimetype);
        await storage.createUploadedFile({
          driveFileId,
          filename: req.file.originalname,
          mimeType: req.file.mimetype,
          size: req.file.size,
          category: "community",
          ownerId: req.user!.id,
          uploadedAt: Date.now(),
        });
        const attachmentUrl = `/api/files/${driveFileId}`;
        const now = Date.now();

        // Lazily create the shared Introductions topic once, ever. Stored
        // by id in appSettings so it survives a rename and is never
        // recreated even if the setting lookup races.
        let topic;
        const storedTopicId = await storage.getAppSetting(WELCOME_INTRO_TOPIC_ID_KEY);
        if (storedTopicId) topic = await storage.getCommunityTopic(Number(storedTopicId));
        const isNewTopic = !topic;
        if (!topic) {
          topic = await storage.createCommunityTopic({
            title: "👋 Introductions",
            createdByUserId: req.user!.id,
            createdByName: req.user!.name,
            createdByRole: req.user!.role,
            createdAt: now,
            lastMessageAt: now,
          });
          await storage.setAppSetting(WELCOME_INTRO_TOPIC_ID_KEY, String(topic.id));
        }

        const message = await storage.createCommunityMessage({
          topicId: topic.id,
          senderId: req.user!.id,
          senderRole: req.user!.role,
          senderName: req.user!.name,
          body: req.body.body?.trim() || "👋 Say hello!",
          attachmentUrl,
          attachmentType: "video",
          attachmentName: req.file.originalname,
          createdAt: now,
        });

        await storage.updateUserProfile(fullUser.id, { welcomeIntroPostedAt: now });
        awardStanding(req.user!.id, "community_welcome_posted", "community", { sourceType: "community_message", sourceId: message.id }).catch(console.error);

        const audience = await communityAudienceUserIds(req.user!.id);
        notifyUsers(audience, "community", isNewTopic
          ? {
              genericTitle: "New Community topic",
              genericBody: `${req.user!.name} started a new Community topic.`,
              previewTitle: "New Community topic",
              previewBody: `${req.user!.name} just posted a welcome video in "${topic.title}"`,
              url: "/community",
            }
          : {
              genericTitle: "New Community reply",
              genericBody: `${req.user!.name} posted in "${topic.title}"`,
              previewTitle: `New reply in "${topic.title}"`,
              previewBody: `${req.user!.name} just posted their welcome video`,
              url: "/community",
            },
        ).catch(console.error);

        res.status(201).json({ topic, message });
      } catch (e) {
        console.error(e);
        res.status(502).json({ message: "File storage upload failed" });
      }
    },
  );

  app.patch(
    "/api/admin/community/topics/:id/archive",
    requireAuth,
    requireRole("admin"),
    async (req, res) => {
      const archived = !!req.body.archived;
      const updated = await storage.updateCommunityTopic(Number(req.params.id), {
        archivedAt: archived ? Date.now() : null,
      });
      if (!updated) return res.status(404).json({ message: "Not found" });
      res.json(updated);
    },
  );

  app.patch(
    "/api/admin/community/topics/:id/pin",
    requireAuth,
    requireRole("admin"),
    async (req, res) => {
      const pinned = !!req.body.pinned;
      const updated = await storage.updateCommunityTopic(Number(req.params.id), {
        pinnedAt: pinned ? Date.now() : null,
      });
      if (!updated) return res.status(404).json({ message: "Not found" });
      res.json(updated);
    },
  );

  app.delete("/api/admin/community/topics/:id", requireAuth, requireRole("admin"), async (req, res) => {
    await storage.deleteCommunityTopic(Number(req.params.id));
    res.json({ ok: true });
  });

  app.delete("/api/admin/community/messages/:id", requireAuth, requireRole("admin"), async (req: AuthedRequest, res) => {
    const msg = await storage.deleteCommunityMessage(Number(req.params.id), req.user!.name);
    res.json(msg);
  });

  app.post("/api/admin/community/users/:id/block", requireAuth, requireRole("admin"), async (req, res) => {
    const blocked = !!req.body.blocked;
    const updated = await storage.setCommunityBlocked(Number(req.params.id), blocked);
    if (!updated) return res.status(404).json({ message: "Not found" });
    res.json(toPublicUser(updated));
  });

  app.patch(
    "/api/community/visibility",
    requireAuth,
    requireRole("partner", "student", "admin"),
    async (req: AuthedRequest, res) => {
      const parsed = communityVisibilitySchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: "Invalid input" });
      const updated = await storage.updateCommunityVisibility(req.user!.id, parsed.data);
      if (!updated) return res.status(404).json({ message: "Not found" });
      res.json(toPublicUser(updated));
    },
  );

  // ---------- MAHA STANDING (internal engagement scoring) ----------
  // Member-facing: tier name + soft progress ONLY -- never raw points or
  // how they're earned (see shared/schema.ts note).
  app.get("/api/standing/mine", requireAuth, requireRole("partner", "student", "admin"), async (req: AuthedRequest, res) => {
    const { points, tier } = await storage.getStandingSummaryForUser(req.user!.id);
    const tierIndex = STANDING_TIERS.findIndex((t) => t.key === tier.key);
    const nextTier = STANDING_TIERS[tierIndex + 1] ?? null;
    // Soft 0-100 progress toward the next tier, with no numbers disclosed.
    let progressPercent = 100;
    if (nextTier) {
      const span = nextTier.minPoints - tier.minPoints;
      progressPercent = span > 0 ? Math.min(100, Math.round(((points - tier.minPoints) / span) * 100)) : 0;
    }
    res.json({ tierKey: tier.key, tierLabel: tier.label, hasNextTier: !!nextTier, progressPercent });
  });

  // Member-facing: the full tier ladder so members can see what levels exist
  // and are called. Names + point thresholds only -- reward field is
  // deliberately stripped before this ever leaves the server (rewards stay
  // fully internal; see standingRewards queue and project rules).
  app.get("/api/standing/tiers", requireAuth, requireRole("partner", "student", "admin"), async (_req, res) => {
    res.json(STANDING_TIERS.map((t) => ({ key: t.key, label: t.label, minPoints: t.minPoints })));
  });

  // Admin-only: exact points, full breakdown per user, and the tier ladder.
  app.get("/api/admin/standing", requireAuth, requireRole("admin"), async (_req, res) => {
    const summaries = await storage.listStandingSummaries();
    res.json(summaries);
  });

  app.get("/api/admin/standing/:userId/entries", requireAuth, requireRole("admin"), async (req, res) => {
    const entries = await storage.listStandingEntriesForUser(Number(req.params.userId));
    res.json(entries);
  });

  app.get("/api/admin/standing/rewards", requireAuth, requireRole("admin"), async (req, res) => {
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const rewards = await storage.listStandingRewards(status);
    res.json(rewards);
  });

  app.patch("/api/admin/standing/rewards/:id/fulfill", requireAuth, requireRole("admin"), async (req: AuthedRequest, res) => {
    const note = typeof req.body?.note === "string" ? req.body.note : undefined;
    const updated = await storage.fulfillStandingReward(Number(req.params.id), req.user!.name, note);
    if (!updated) return res.status(404).json({ message: "Not found" });
    res.json(updated);
  });

  // ---------- CLINICS (shared MAHA Standing pooling, admin-managed) ----------
  // Every clinic and its pooled point total + member roster. Members join
  // automatically at registration (businessName exact match); this is the
  // admin's view of the result plus the manual regroup tool for accounts
  // whose businessName strings didn't match exactly (typos/variations).
  app.get("/api/admin/clinics", requireAuth, requireRole("admin"), async (_req, res) => {
    res.json(await storage.listClinicsWithStats());
  });

  app.post("/api/admin/clinics", requireAuth, requireRole("admin"), async (req, res) => {
    const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    if (!name) return res.status(400).json({ message: "Clinic name is required" });
    const clinic = await storage.findOrCreateClinicByName(name);
    res.json(clinic);
  });

  // Assign, move, or remove (clinicId: null) a single account's clinic
  // pool membership. Retroactive grouping (e.g. 6 doctors + 3 nurses + 5
  // admins at one practice whose businessName strings vary) is admin-tool
  // only -- there is no self-service request path for this, per spec.
  app.patch("/api/admin/users/:id/clinic", requireAuth, requireRole("admin"), async (req, res) => {
    const user = await storage.getUser(Number(req.params.id));
    if (!user) return res.status(404).json({ message: "Not found" });
    const { clinicId, clinicName } = req.body as { clinicId?: number | null; clinicName?: string };
    let targetClinicId: number | null = null;
    if (clinicName && clinicName.trim()) {
      const clinic = await storage.findOrCreateClinicByName(clinicName.trim());
      targetClinicId = clinic.id;
    } else if (clinicId === null) {
      targetClinicId = null;
    } else if (typeof clinicId === "number") {
      const clinic = await storage.getClinic(clinicId);
      if (!clinic) return res.status(404).json({ message: "Clinic not found" });
      targetClinicId = clinicId;
    } else {
      return res.status(400).json({ message: "Provide clinicId (number or null) or clinicName" });
    }
    const updated = await storage.setUserClinic(user.id, targetClinicId);
    res.json(toPublicUser(updated!));
  });

  // ---------- NOTIFICATION PREFERENCES (self-service, all roles) ----------
  app.patch("/api/notifications/preferences", requireAuth, async (req: AuthedRequest, res) => {
    const parsed = updateNotificationPreferenceSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.errors[0]?.message ?? "Invalid input" });
    const updated = await storage.updateNotificationPreference(req.user!.id, parsed.data.category, {
      enabled: parsed.data.enabled,
      style: parsed.data.style,
    });
    if (!updated) return res.status(404).json({ message: "Not found" });
    res.json(toPublicUser(updated));
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

    // Special offers respect each recipient's own "offers" notification
    // preference (enabled + style) via notifyUsers -- no raw unconditional
    // send here anymore, since that would double-push everyone who is
    // subscribed AND opted in.
    const subs = await storage.listPushSubscriptionsForAudience(parsed.data.audience);
    const audienceRole = parsed.data.audience === "partners" ? "partner" : parsed.data.audience === "students" ? "student" : undefined;
    const audienceUsers = await storage.listUsersByRoleStatus(audienceRole);
    const audienceUserIds = audienceUsers.filter((u) => u.role !== "admin").map((u) => u.id);
    await notifyUsers(audienceUserIds, "offers", {
      previewTitle: parsed.data.title,
      previewBody: parsed.data.body,
      genericTitle: "New announcement",
      genericBody: "MAHA has a new announcement for you.",
      url,
    });
    // Approximate recipient count for the admin's sent log: how many
    // devices in this audience were subscribed at send time. (The exact
    // enabled/style breakdown per user isn't tracked at delivery time.)
    const result = { sent: subs.length, failed: 0, removedEndpoints: [] as string[] };

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

  // ---------- CROSS-DEPLOYMENT DATABASE TRANSFER (admin) ----------
  // One-off migration helper: lets an admin pull the latest Drive backup
  // from one deployment (e.g. the pplx.app instance) and load it into
  // another (e.g. a fresh Render instance). Guarded by normal admin session
  // auth OR a shared-secret header, since the two deployments don't share a
  // login session. The header path only activates when BACKUP_ADMIN_TOKEN
  // is explicitly set — leave it unset to disable entirely once migration
  // is done.
  function hasValidBackupToken(req: Request): boolean {
    const expected = process.env.BACKUP_ADMIN_TOKEN;
    if (!expected) return false;
    const provided = req.headers["x-backup-token"];
    if (typeof provided !== "string" || provided.length !== expected.length) return false;
    try {
      return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
    } catch {
      return false;
    }
  }
  function requireAdminOrBackupToken(req: Request, res: Response, next: NextFunction) {
    if (hasValidBackupToken(req)) return next();
    return requireAuth(req as AuthedRequest, res, () =>
      requireRole("admin")(req as AuthedRequest, res, next),
    );
  }

  // Streams the most recent Drive backup file as a raw .db download.
  app.get("/api/admin/backups/download/latest", requireAdminOrBackupToken, async (_req, res) => {
    try {
      const folderId = await getOrCreateBackupFolderId();
      const files = await listFolderFiles(folderId);
      const backups = files
        .filter((f) => f.name.startsWith("maha-backup-"))
        .sort((a, b) => b.name.localeCompare(a.name));
      const latest = backups[0];
      if (!latest) return res.status(404).json({ message: "No backups found in Drive" });
      res.setHeader("Content-Type", "application/x-sqlite3");
      res.setHeader("Content-Disposition", `attachment; filename="${latest.name}"`);
      const stream = await streamFromDrive(latest.id);
      (stream as any).pipe(res);
    } catch (err: any) {
      console.error("[backup-transfer] download/latest failed:", err);
      res.status(500).json({ message: err?.message || "Failed to download latest backup" });
    }
  });

  // Accepts an uploaded .db file and atomically swaps it in as the live
  // database, after safety-backing-up the current file. Exits the process
  // afterward so the platform's process manager restarts with a clean,
  // freshly-opened connection to the restored file (swapping the file out
  // from under the currently-open connection is not safe to do in place).
  app.post(
    "/api/admin/backups/restore",
    requireAdminOrBackupToken,
    upload.single("file"),
    async (req, res) => {
      try {
        const file = (req as any).file as Express.Multer.File | undefined;
        if (!file || !file.buffer || file.buffer.length < 16) {
          return res.status(400).json({ message: "No file uploaded" });
        }
        const magic = file.buffer.subarray(0, 16).toString("utf8");
        if (!magic.startsWith("SQLite format 3")) {
          return res.status(400).json({ message: "Uploaded file is not a SQLite database" });
        }
        const incomingPath = `${DB_FILE_PATH}.incoming`;
        fs.writeFileSync(incomingPath, file.buffer);

        // Checkpoint and close the live connection FIRST. If we swap the
        // main db file while a stale -wal/-shm pair for the OLD database
        // still sits next to it, the next boot's SQLite connection replays
        // those old WAL frames onto the newly-restored file by page number
        // and silently wipes the restore back toward the old (often empty)
        // state -- the file on disk looks right, but every row disappears.
        try {
          sqliteDb.pragma("wal_checkpoint(TRUNCATE)");
        } catch {
          /* ignore */
        }
        try {
          sqliteDb.close();
        } catch {
          /* ignore */
        }

        if (fs.existsSync(DB_FILE_PATH)) {
          const backupPath = `${DB_FILE_PATH}.pre-restore-${Date.now()}.bak`;
          fs.copyFileSync(DB_FILE_PATH, backupPath);
        }
        fs.renameSync(incomingPath, DB_FILE_PATH);
        // Defensively remove any leftover WAL/SHM sidecars for the OLD
        // database so the next boot opens the restored file clean.
        for (const suffix of ["-wal", "-shm"]) {
          try {
            fs.unlinkSync(`${DB_FILE_PATH}${suffix}`);
          } catch {
            /* ignore, may not exist */
          }
        }

        res.json({ ok: true, message: "Database restored. Restarting to load it." });
        setTimeout(() => process.exit(0), 500);
      } catch (err: any) {
        console.error("[backup-transfer] restore failed:", err);
        res.status(500).json({ message: err?.message || "Failed to restore database" });
      }
    },
  );

  // Temporary diagnostic for the pplx.app -> Render data migration: reports
  // exactly what path/file the LIVE in-process connection is reading, so a
  // restore that reports success but doesn't show up can be root-caused.
  // Token/admin gated like the transfer routes above; safe to remove once
  // migration is confirmed done.
  app.get("/api/admin/backups/diag", requireAdminOrBackupToken, async (_req, res) => {
    try {
      const userCount = (sqliteDb.prepare("SELECT COUNT(*) as c FROM users").get() as any)?.c ?? null;
      let stat: any = null;
      try {
        const s = fs.statSync(DB_FILE_PATH);
        stat = { sizeBytes: s.size, mtime: s.mtime };
      } catch (e: any) {
        stat = { error: e?.message || String(e) };
      }
      const dir = path.dirname(DB_FILE_PATH);
      let dirListing: string[] = [];
      try {
        dirListing = fs.readdirSync(dir);
      } catch (e: any) {
        dirListing = [`error: ${e?.message || e}`];
      }
      res.json({
        resolvedDbFilePath: DB_FILE_PATH,
        envSqliteDbPath: process.env.SQLITE_DB_PATH ?? null,
        liveUserCountFromMemory: userCount,
        fileStat: stat,
        dirListing,
      });
    } catch (err: any) {
      res.status(500).json({ message: err?.message || String(err) });
    }
  });

  // Temporary cross-deployment case-discussion sync helper: lets a single
  // event added on one deployment (pplx.app or Render) get mirrored onto
  // the other, since each keeps its own SQLite file. Token/admin gated,
  // like the transfer routes above. Insert is idempotent by (topic,
  // scheduledAt) so re-running never duplicates. Safe to remove once both
  // deployments' event lists are confirmed in sync.
  app.get("/api/admin/backups/case-discussions-diag", requireAdminOrBackupToken, async (_req, res) => {
    try {
      const rows = sqliteDb
        .prepare("SELECT id, topic, presenter_name, scheduled_at, zoom_link, notes FROM case_discussions ORDER BY scheduled_at ASC")
        .all();
      res.json({ rows });
    } catch (err: any) {
      res.status(500).json({ message: err?.message || String(err) });
    }
  });

  app.post("/api/admin/backups/case-discussions-sync", requireAdminOrBackupToken, async (req, res) => {
    try {
      const { topic, presenterName, scheduledAt, zoomLink, notes } = req.body || {};
      if (!topic || !scheduledAt || !zoomLink) {
        return res.status(400).json({ message: "topic, scheduledAt and zoomLink are required" });
      }
      const existing = sqliteDb
        .prepare("SELECT id FROM case_discussions WHERE topic = ? AND scheduled_at = ?")
        .get(topic, scheduledAt);
      if (existing) {
        return res.json({ status: "already_present", existing });
      }
      const created = await storage.createCaseDiscussion({
        topic,
        presenterName: presenterName ?? null,
        scheduledAt,
        zoomLink,
        notes: notes ?? null,
      } as any);
      res.json({ status: "created", created });
    } catch (err: any) {
      res.status(500).json({ message: err?.message || String(err) });
    }
  });

  return httpServer;
}
