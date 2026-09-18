import {
  users, sessions, products, priceTiers, orders, orderItems, referrals,
  videos, courses, courseAccessGrants, coursePurchases, modules, cohorts, cohortEnrollments,
  classSessions, homeworkSubmissions, chatThreads, chatMessages, chatMessageFlags, chatMessageReactions, uploadedFiles,
  pushSubscriptions, announcements, caseDiscussions, caseDiscussionRsvps, legacyOrders,
  webauthnCredentials, productResources, adminTodos,
  appSettings, communityTopics, communityMessages, communityMessageReads,
  standingEntries, standingRewards, clinics, adminPinnedMembers, impersonationLog,
} from "@shared/schema";
import type {
  User, InsertUser, Session, InsertSession, Product, InsertProduct, PriceTier, InsertPriceTier,
  Order, InsertOrder, OrderItem, InsertOrderItem, Referral, InsertReferral,
  Video, InsertVideo, Course, InsertCourse, CourseAccessGrant, InsertCourseAccessGrant,
  CoursePurchase, InsertCoursePurchase, Module, InsertModule,
  Cohort, InsertCohort, CohortEnrollment, InsertCohortEnrollment, ClassSession,
  InsertClassSession, HomeworkSubmission, InsertHomeworkSubmission, ChatThread,
  InsertChatThread, ChatMessage, InsertChatMessage, UploadedFile, InsertUploadedFile,
  PushSubscriptionRow, InsertPushSubscription, Announcement, InsertAnnouncement,
  CaseDiscussion, InsertCaseDiscussion, LegacyOrder, InsertLegacyOrder,
  WebauthnCredential, InsertWebauthnCredential, ProductResource, InsertProductResource,
  AdminTodo, InsertAdminTodo,
  AppSetting, CommunityTopic, InsertCommunityTopic, CommunityMessage, CommunityMessageRead,
  StandingEntry, StandingReward, Clinic, AdminPinnedMember, ImpersonationLogEntry,
} from "@shared/schema";
import { STANDING_TIERS, standingTierForPoints } from "@shared/schema";
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { eq, and, desc, asc, gte, gt, lte, isNull, inArray, like } from "drizzle-orm";
import { autoMigrate } from "./autoMigrate";

// Opening the database, setting WAL mode, and self-healing the schema all
// run at module load time (before Express even exists), so any throw here
// kills the whole Node process before it ever calls httpServer.listen() --
// every request then 503s with an empty body until restart, which crashes
// again immediately. WAL mode in particular requires shared-memory (mmap)
// support from the underlying filesystem, which network- or overlay-backed
// persistent volumes (needed to preserve data.db across redeploys) don't
// always provide -- so it's a plausible unguarded crash point on top of the
// schema-drift one autoMigrate.ts already documents. Wrap all of it so a
// storage-layer problem is loud in the logs instead of silently taking down
// every route in production.
// Exported so other modules (e.g. the admin backup-transfer routes) can
// locate the live database file on disk without duplicating the fallback.
export const DB_FILE_PATH = process.env.SQLITE_DB_PATH || "data.db";

let sqlite: Database.Database;
try {
  // SQLITE_DB_PATH lets a deployment point at a mounted persistent disk
  // (e.g. Render: "/var/data/data.db") instead of the ephemeral local
  // filesystem. Defaults to the project-root "data.db" used locally and
  // in the pplx.app sandbox.
  sqlite = new Database(DB_FILE_PATH);
  try {
    sqlite.pragma("journal_mode = WAL");
  } catch (e: any) {
    console.error("[storage] WAL journal mode unsupported on this filesystem, falling back to DELETE:", e?.message || e);
    try {
      sqlite.pragma("journal_mode = DELETE");
    } catch (e2: any) {
      console.error("[storage] journal_mode fallback also failed, continuing with SQLite defaults:", e2?.message || e2);
    }
  }

  // Self-heal any schema drift between this build's shared/schema.ts and the
  // persisted data.db file before any query runs against it. See
  // autoMigrate.ts for why this matters.
  autoMigrate(sqlite);
} catch (e: any) {
  console.error("[storage] FATAL: could not open or migrate data.db -- every /api route will fail:", e);
  throw e;
}

export const db = drizzle(sqlite);

// Raw better-sqlite3 connection exported so the backup routine can run
// `VACUUM INTO` against the SAME open connection/file the app uses, rather than
// opening a second connection. Day-to-day reads/writes still go through `db`.
export const sqliteDb = sqlite;

export interface IStorage {
  // users
  getUser(id: number): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  getUserByWpUserId(wpUserId: number): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUserStatus(id: number, status: string): Promise<User | undefined>;
  updateUserPassword(id: number, passwordHash: string): Promise<User | undefined>;
  setUserApprovalToken(id: number, token: string | null): Promise<void>;
  getUserByApprovalToken(token: string): Promise<User | undefined>;
  setUserApprovalEmailNotified(id: number, notified: boolean): Promise<void>;
  dismissInstallBanner(id: number): Promise<User | undefined>;
  setPasswordResetToken(id: number, token: string | null, expiresAt: number | null): Promise<void>;
  getUserByPasswordResetToken(token: string): Promise<User | undefined>;
  listUsersByRoleStatus(role?: string, status?: string): Promise<User[]>;
  updateUserRole(id: number, role: string): Promise<User | undefined>;
  updateUserProfile(id: number, patch: Record<string, any>): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  listAdmins(): Promise<User[]>;
  // migration (bulk-imported legacy partner.maha.clinic accounts)
  listMigratedUsersAwaitingCredentials(): Promise<User[]>;
  markCredentialsIssued(id: number): Promise<User | undefined>;

  // legacy orders (read-only reference, migrated from WooCommerce)
  createLegacyOrder(o: InsertLegacyOrder & { createdAt: number }): Promise<LegacyOrder>;
  listLegacyOrdersForUser(userId: number): Promise<LegacyOrder[]>;
  getLegacyOrderByWpOrderId(wpOrderId: number): Promise<LegacyOrder | undefined>;

  // sessions
  createSession(session: InsertSession): Promise<Session>;
  getSession(token: string): Promise<Session | undefined>;
  updateSessionExpiry(token: string, expiresAt: number): Promise<void>;
  deleteSession(token: string): Promise<void>;
  // "View Platform as Member" -- swaps which user a session resolves to,
  // without disturbing the real admin's own session row.
  setSessionImpersonation(token: string, impersonatingUserId: number | null, impersonationLogId: number | null): Promise<void>;

  // admin pinned members ("View as" favorites)
  listPinnedMembers(adminUserId: number): Promise<User[]>;
  pinMember(adminUserId: number, memberUserId: number): Promise<void>;
  unpinMember(adminUserId: number, memberUserId: number): Promise<void>;

  // impersonation audit log
  startImpersonationLog(adminUserId: number, targetUserId: number): Promise<ImpersonationLogEntry>;
  endImpersonationLog(id: number): Promise<void>;

  // webauthn credentials (Face ID / Fingerprint login)
  createWebauthnCredential(c: InsertWebauthnCredential & { createdAt: number }): Promise<WebauthnCredential>;
  getWebauthnCredentialByCredentialId(credentialId: string): Promise<WebauthnCredential | undefined>;
  listWebauthnCredentialsForUser(userId: number): Promise<WebauthnCredential[]>;
  updateWebauthnCredentialCounter(id: number, counter: number, lastUsedAt: number): Promise<void>;
  deleteWebauthnCredential(id: number, userId: number): Promise<boolean>;

  // products
  listProducts(): Promise<Product[]>;
  getProduct(id: number): Promise<Product | undefined>;
  createProduct(p: InsertProduct): Promise<Product>;
  updateProduct(id: number, p: Partial<InsertProduct>): Promise<Product | undefined>;
  deleteProduct(id: number): Promise<void>;

  // price tiers
  listTiersForProduct(productId: number): Promise<PriceTier[]>;
  createTier(t: InsertPriceTier): Promise<PriceTier>;
  deleteTier(id: number): Promise<void>;
  deleteTiersForProduct(productId: number): Promise<void>;

  // orders
  createOrder(o: InsertOrder & { status?: string; emailNotified?: boolean; notifiedAt?: number | null; destinationCountry?: string | null; estimatedShippingCost?: number | null; createdAt: number }): Promise<Order>;
  listOrdersForPartner(partnerId: number): Promise<Order[]>;
  listAllOrders(): Promise<Order[]>;
  getOrder(id: number): Promise<Order | undefined>;
  updateOrderStatus(id: number, status: string): Promise<Order | undefined>;
  markOrdersNotified(ids: number[], ts: number): Promise<void>;
  listUnnotifiedOrders(): Promise<Order[]>;

  // order items
  createOrderItem(oi: InsertOrderItem): Promise<OrderItem>;
  listItemsForOrder(orderId: number): Promise<OrderItem[]>;

  // referrals
  createReferral(r: InsertReferral & { createdAt: number; patientConsentAttestedAt?: number | null }): Promise<Referral>;
  listReferralsForPartner(partnerId: number): Promise<Referral[]>;
  listAllReferrals(): Promise<Referral[]>;
  getReferral(id: number): Promise<Referral | undefined>;
  updateReferralStatus(id: number, status: string): Promise<Referral | undefined>;
  setReferralArchived(id: number, archived: boolean): Promise<Referral | undefined>;
  deleteReferral(id: number): Promise<void>;
  markReferralsNotified(ids: number[], ts: number): Promise<void>;
  listUnnotifiedReferrals(): Promise<Referral[]>;

  // courses
  listCourses(): Promise<Course[]>;
  getCourse(id: number): Promise<Course | undefined>;
  getCourseByName(name: string): Promise<Course | undefined>;
  createCourse(c: InsertCourse): Promise<Course>;
  updateCourse(id: number, c: Partial<InsertCourse>): Promise<Course | undefined>;
  deleteCourse(id: number): Promise<void>;

  // videos (lessons)
  listVideos(): Promise<Video[]>;
  listVideosForCourse(courseId: number): Promise<Video[]>;
  getVideo(id: number): Promise<Video | undefined>;
  createVideo(v: InsertVideo): Promise<Video>;
  updateVideo(id: number, v: Partial<InsertVideo>): Promise<Video | undefined>;
  deleteVideo(id: number): Promise<void>;

  // course access grants (manual admin comps)
  listGrantsForCourse(courseId: number): Promise<CourseAccessGrant[]>;
  listGrantsForPartner(partnerId: number): Promise<CourseAccessGrant[]>;
  getGrant(courseId: number, partnerId: number): Promise<CourseAccessGrant | undefined>;
  createGrant(g: InsertCourseAccessGrant): Promise<CourseAccessGrant>;
  deleteGrant(id: number): Promise<void>;

  // course purchases
  createCoursePurchase(p: InsertCoursePurchase): Promise<CoursePurchase>;
  updateCoursePurchaseStatus(id: number, status: string): Promise<CoursePurchase | undefined>;
  getCoursePurchaseBySession(stripeSessionId: string): Promise<CoursePurchase | undefined>;
  getCompletedPurchase(userId: number, courseId: number): Promise<CoursePurchase | undefined>;
  listCompletedPurchasesForUser(userId: number): Promise<CoursePurchase[]>;
  listAllCoursePurchases(): Promise<CoursePurchase[]>;

  // modules
  listModules(): Promise<Module[]>;
  createModule(m: InsertModule): Promise<Module>;
  updateModule(id: number, m: Partial<InsertModule>): Promise<Module | undefined>;
  deleteModule(id: number): Promise<void>;

  // cohorts
  listCohorts(): Promise<Cohort[]>;
  listCohortsForModule(moduleId: number): Promise<Cohort[]>;
  createCohort(c: InsertCohort): Promise<Cohort>;
  deleteCohort(id: number): Promise<void>;

  // enrollments
  listEnrollmentsForCohort(cohortId: number): Promise<CohortEnrollment[]>;
  listEnrollmentsForStudent(studentId: number): Promise<CohortEnrollment[]>;
  createEnrollment(e: InsertCohortEnrollment): Promise<CohortEnrollment>;
  deleteEnrollment(id: number): Promise<void>;

  // class sessions
  listClassSessions(): Promise<ClassSession[]>;
  listClassSessionsForCohort(cohortId: number): Promise<ClassSession[]>;
  getClassSession(id: number): Promise<ClassSession | undefined>;
  createClassSession(c: InsertClassSession): Promise<ClassSession>;
  updateClassSession(id: number, c: Partial<InsertClassSession>): Promise<ClassSession | undefined>;
  deleteClassSession(id: number): Promise<void>;

  // homework
  createHomework(h: InsertHomeworkSubmission & { createdAt: number }): Promise<HomeworkSubmission>;
  listHomeworkForStudent(studentId: number): Promise<HomeworkSubmission[]>;
  listHomeworkForSession(sessionId: number): Promise<HomeworkSubmission[]>;
  listAllHomework(): Promise<HomeworkSubmission[]>;

  // uploaded files
  createUploadedFile(f: InsertUploadedFile): Promise<UploadedFile>;
  getUploadedFileByDriveId(driveFileId: string): Promise<UploadedFile | undefined>;

  // product resources
  createProductResource(r: InsertProductResource): Promise<ProductResource>;
  listResourcesForProduct(productId: number): Promise<ProductResource[]>;
  getProductResource(id: number): Promise<ProductResource | undefined>;
  deleteProductResource(id: number): Promise<void>;

  // chat
  createThread(userId: number, userRole: string, topic: string, opts?: { kind?: string; referralId?: number }): Promise<ChatThread>;
  listThreadsForUser(userId: number): Promise<ChatThread[]>;
  listThreads(): Promise<ChatThread[]>;
  getThread(id: number): Promise<ChatThread | undefined>;
  getThreadByReferralId(referralId: number): Promise<ChatThread | undefined>;
  updateThread(id: number, patch: Partial<{ kind: string; referralId: number | null; topic: string; pendingReferralRequestedAt: number | null; pendingReferralRequestedByRole: string | null; ownerLastReadAt: number | null; adminLastReadAt: number | null; escalationSentForMessageId: number | null; archivedAt: number | null; reactivationRequestedAt: number | null }>): Promise<ChatThread | undefined>;
  deleteThread(id: number): Promise<void>;
  reassignMessages(sourceThreadId: number, targetThreadId: number): Promise<void>;
  countMessagesForThread(threadId: number): Promise<number>;
  createMessage(m: InsertChatMessage & { createdAt: number }): Promise<ChatMessage>;
  listMessagesForThread(threadId: number): Promise<(ChatMessage & { senderPhotoUrl: string | null })[]>;
  getLastMessageForThread(threadId: number): Promise<ChatMessage | undefined>;
  getMessage(id: number): Promise<ChatMessage | undefined>;
  deleteMessage(id: number, deletedByName: string): Promise<ChatMessage>;
  editMessage(id: number, body: string): Promise<ChatMessage>;
  markChatThreadsNotified(ids: number[], ts: number): Promise<void>;
  listUnnotifiedChatThreads(): Promise<ChatThread[]>;

  // chat message flags (per-user star/flag)
  toggleMessageFlag(messageId: number, userId: number): Promise<boolean>;
  getFlaggedMessageIdsForUser(userId: number, threadId: number): Promise<number[]>;
  // Cross-chat search. `threadIds` scopes the search (e.g. one user's own
  // threads); omit to search across every thread (admin-wide).
  searchMessages(query: string, threadIds?: number[]): Promise<(ChatMessage & { threadTopic: string; threadKind: string })[]>;

  // chat message reactions (one emoji per user per message, WhatsApp-style)
  setMessageReaction(messageId: number, userId: number, userName: string, emoji: string): Promise<string | null>;
  getReactionsForThread(threadId: number): Promise<{ messageId: number; userId: number; userName: string; emoji: string }[]>;

  // admin to-dos (message-linked handoff between admins)
  createAdminTodo(t: InsertAdminTodo): Promise<AdminTodo>;
  listAdminTodos(): Promise<AdminTodo[]>;
  getAdminTodo(id: number): Promise<AdminTodo | undefined>;
  setAdminTodoStatus(id: number, status: string, completedAt: number | null): Promise<AdminTodo | undefined>;

  // push subscriptions
  upsertPushSubscription(s: InsertPushSubscription): Promise<PushSubscriptionRow>;
  deletePushSubscriptionByEndpoint(endpoint: string): Promise<void>;
  deletePushSubscriptionsByEndpoints(endpoints: string[]): Promise<void>;
  listPushSubscriptionsForAudience(audience: string): Promise<PushSubscriptionRow[]>;

  // announcements
  createAnnouncement(a: InsertAnnouncement): Promise<Announcement>;
  listAnnouncements(): Promise<Announcement[]>;

  // push subscriptions (targeted lookup)
  getPushSubscriptionsForUserIds(userIds: number[]): Promise<PushSubscriptionRow[]>;

  // case discussions
  listUpcomingCaseDiscussions(forUserId: number): Promise<(CaseDiscussion & { rsvpCount: number; iAmAttending: boolean })[]>;
  listAllCaseDiscussionsForAdmin(): Promise<(CaseDiscussion & { rsvpCount: number })[]>;
  getCaseDiscussionById(id: number): Promise<CaseDiscussion | undefined>;
  createCaseDiscussion(input: InsertCaseDiscussion): Promise<CaseDiscussion>;
  updateCaseDiscussion(id: number, patch: Partial<InsertCaseDiscussion>): Promise<CaseDiscussion>;
  deleteCaseDiscussion(id: number): Promise<void>;
  rsvpToCaseDiscussion(discussionId: number, userId: number): Promise<void>;
  cancelCaseDiscussionRsvp(discussionId: number, userId: number): Promise<void>;
  listCaseDiscussionAttendees(discussionId: number): Promise<{ userId: number; name: string; email: string; clinicName: string | null }[]>;
  findCaseDiscussionsNeedingNotification(windowStartMs: number, nowMs: number): Promise<CaseDiscussion[]>;
  markCaseDiscussionNotified(id: number, whenMs: number): Promise<void>;
  updateAdminNavOrder(userId: number, order: string[]): Promise<User | undefined>;

  // ---------- app settings (feature flags) ----------
  getAppSetting(key: string): Promise<string | undefined>;
  setAppSetting(key: string, value: string): Promise<void>;

  // ---------- notification preferences (stored directly on users) ----------
  updateNotificationPreference(userId: number, category: string, patch: { enabled?: boolean; style?: string }): Promise<User | undefined>;

  // ---------- community visibility ----------
  updateCommunityVisibility(userId: number, patch: { communityShowPhone?: boolean; communityShowEmail?: boolean }): Promise<User | undefined>;
  setCommunityBlocked(userId: number, blocked: boolean): Promise<User | undefined>;

  // ---------- community topics ----------
  createCommunityTopic(t: InsertCommunityTopic & { createdAt: number; lastMessageAt: number }): Promise<CommunityTopic>;
  listCommunityTopics(includeArchived?: boolean): Promise<CommunityTopic[]>;
  getCommunityTopic(id: number): Promise<CommunityTopic | undefined>;
  updateCommunityTopic(id: number, patch: Partial<{ archivedAt: number | null; pinnedAt: number | null; lastMessageAt: number }>): Promise<CommunityTopic | undefined>;
  deleteCommunityTopic(id: number): Promise<void>;
  // Cross-topic search, same shape as searchMessages but scoped to
  // community_messages/community_topics. Non-admins never search into
  // archived topics they wouldn't otherwise see in the topic list.
  searchCommunityMessages(query: string, opts?: { includeArchived?: boolean }): Promise<{
    id: number;
    threadId: number;
    senderId: number;
    senderRole: string;
    senderName: string;
    body: string;
    attachmentUrl: string | null;
    attachmentType: string | null;
    attachmentName: string | null;
    replyToMessageId: number | null;
    createdAt: number;
    deletedAt: number | null;
    deletedByName: string | null;
    editedAt: number | null;
    threadTopic: string;
  }[]>;

  // ---------- community messages ----------
  createCommunityMessage(m: { topicId: number; senderId: number; senderRole: string; senderName: string; body: string; attachmentUrl?: string | null; attachmentType?: string | null; attachmentName?: string | null; replyToMessageId?: number | null; createdAt: number }): Promise<CommunityMessage>;
  // senderTierKey/senderTierLabel: the sender's current MAHA Standing tier
  // (see shared/schema.ts) -- null for admin senders, since the reward
  // program is partner/student-facing only. Never includes raw points.
  listCommunityMessagesForTopic(topicId: number): Promise<(CommunityMessage & { senderPhotoUrl: string | null; senderTierKey: string | null; senderTierLabel: string | null })[]>;
  getCommunityMessage(id: number): Promise<CommunityMessage | undefined>;
  deleteCommunityMessage(id: number, deletedByName: string): Promise<CommunityMessage>;
  countCommunityMessagesForTopic(topicId: number): Promise<number>;

  // ---------- community read receipts (admin-only visibility) ----------
  markCommunityMessagesRead(messageIds: number[], userId: number, userName: string): Promise<void>;
  getCommunityReadsForMessages(messageIds: number[]): Promise<CommunityMessageRead[]>;
  getUnreadCommunityMessageIds(topicId: number, userId: number): Promise<number[]>;
  countUnreadCommunityTopicsForUser(userId: number): Promise<number>;

  // ---------- MAHA Standing (internal engagement scoring) ----------
  // Awards points, appends a ledger row, and keeps users.standingPoints in
  // sync -- the one place point totals ever change. Returns the ledger row
  // and whether this award crossed the user into a new tier (so the caller
  // can enqueue a reward). category='app_activity' entries must never carry
  // a sourceId tied to a specific referral -- see shared/schema.ts note.
  awardStandingPoints(args: { userId: number; category: string; points: number; sourceType?: string; sourceId?: number }): Promise<{ entry: StandingEntry; newTierKey: string | null; clinicId: number | null }>;
  countStandingEntriesToday(userId: number, sourceType: string): Promise<number>;
  hasStandingEntry(userId: number, sourceType: string, sourceId?: number): Promise<boolean>;
  getStandingSummaryForUser(userId: number): Promise<{ points: number; tier: (typeof STANDING_TIERS)[number] }>;
  listStandingSummaries(): Promise<{ userId: number; userName: string; userRole: string; points: number; tierKey: string; tierLabel: string }[]>;
  listStandingEntriesForUser(userId: number): Promise<StandingEntry[]>;

  // ---------- Clinics (shared standing pooling) ----------
  findOrCreateClinicByName(name: string): Promise<Clinic>;
  getClinic(id: number): Promise<Clinic | undefined>;
  listClinics(): Promise<Clinic[]>;
  getClinicAggregatePoints(clinicId: number): Promise<number>;
  setUserClinic(userId: number, clinicId: number | null): Promise<User | undefined>;
  listClinicsWithStats(): Promise<
    {
      id: number;
      name: string;
      points: number;
      tierKey: string;
      tierLabel: string;
      members: { id: number; name: string; role: string; email: string; standingPoints: number }[];
    }[]
  >;
  createStandingReward(r: { userId: number; tierKey: string; rewardDescription: string; createdAt: number; clinicId?: number | null }): Promise<StandingReward>;
  listStandingRewards(status?: string): Promise<(StandingReward & { userName: string })[]>;
  fulfillStandingReward(id: number, fulfilledByName: string, note?: string): Promise<StandingReward | undefined>;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: number) {
    return db.select().from(users).where(eq(users.id, id)).get();
  }
  async getUserByEmail(email: string) {
    return db.select().from(users).where(eq(users.email, email)).get();
  }
  async createUser(user: InsertUser) {
    return db.insert(users).values({ ...user, createdAt: Date.now() }).returning().get();
  }
  async updateUserStatus(id: number, status: string) {
    return db.update(users).set({ status }).where(eq(users.id, id)).returning().get();
  }
  // Admin-initiated role switch between partner <-> student (reversible). All
  // of a user's history (referrals, orders, course purchases, homework, class
  // enrollments) is keyed by userId, not role, so flipping this field alone
  // is safe and preserves everything.
  async updateUserRole(id: number, role: string) {
    return db.update(users).set({ role }).where(eq(users.id, id)).returning().get();
  }
  async updateUserPassword(id: number, passwordHash: string) {
    return db.update(users).set({ passwordHash }).where(eq(users.id, id)).returning().get();
  }
  async getUserByUsername(username: string) {
    return db.select().from(users).where(eq(users.username, username)).get();
  }
  // Self-service profile edits (name parts, contact info, email, username,
  // degree file, etc). Caller has already checked email/username
  // uniqueness -- this just persists the patch and keeps the combined
  // `name` field (used for greetings, admin lists, chat sender names, ...)
  // in sync whenever any of its source parts change.
  async updateUserProfile(id: number, patch: Record<string, any>) {
    const current = await this.getUser(id);
    if (!current) return undefined;
    const next = { ...patch };
    const namePartsChanged = ["prefix", "firstName", "lastName", "suffix"].some((k) => k in patch);
    if (namePartsChanged) {
      const prefix = "prefix" in patch ? patch.prefix : current.prefix;
      const firstName = "firstName" in patch ? patch.firstName : current.firstName;
      const lastName = "lastName" in patch ? patch.lastName : current.lastName;
      const suffix = "suffix" in patch ? patch.suffix : current.suffix;
      next.name = [prefix, firstName, lastName, suffix].filter(Boolean).join(" ");
    }
    return db.update(users).set(next).where(eq(users.id, id)).returning().get();
  }
  async setUserApprovalToken(id: number, token: string | null) {
    db.update(users).set({ approvalToken: token }).where(eq(users.id, id)).run();
  }
  async getUserByApprovalToken(token: string) {
    return db.select().from(users).where(eq(users.approvalToken, token)).get();
  }
  async setUserApprovalEmailNotified(id: number, notified: boolean) {
    db.update(users).set({ approvalEmailNotified: notified }).where(eq(users.id, id)).run();
  }
  async dismissInstallBanner(id: number) {
    return db.update(users).set({ installBannerDismissedAt: Date.now() }).where(eq(users.id, id)).returning().get();
  }
  async setPasswordResetToken(id: number, token: string | null, expiresAt: number | null) {
    db.update(users).set({ passwordResetToken: token, passwordResetExpiresAt: expiresAt }).where(eq(users.id, id)).run();
  }
  async getUserByPasswordResetToken(token: string) {
    return db.select().from(users).where(eq(users.passwordResetToken, token)).get();
  }
  async listUsersByRoleStatus(role?: string, status?: string) {
    let rows = db.select().from(users).all();
    if (role) rows = rows.filter((u) => u.role === role);
    if (status) rows = rows.filter((u) => u.status === status);
    return rows;
  }
  async listAdmins() {
    return db.select().from(users).where(eq(users.role, "admin")).all();
  }
  async getUserByWpUserId(wpUserId: number) {
    return db.select().from(users).where(eq(users.wpUserId, wpUserId)).get();
  }
  async listMigratedUsersAwaitingCredentials() {
    return db.select().from(users)
      .where(and(eq(users.migratedFromWp, true), isNull(users.credentialsIssuedAt)))
      .all();
  }
  async markCredentialsIssued(id: number) {
    return db.update(users)
      .set({ credentialsIssuedAt: Date.now(), migratedPasswordPlain: null })
      .where(eq(users.id, id))
      .returning()
      .get();
  }
  async createLegacyOrder(o: InsertLegacyOrder & { createdAt: number }) {
    return db.insert(legacyOrders).values(o).returning().get();
  }
  async listLegacyOrdersForUser(userId: number) {
    return db.select().from(legacyOrders).where(eq(legacyOrders.userId, userId)).all();
  }
  async getLegacyOrderByWpOrderId(wpOrderId: number) {
    return db.select().from(legacyOrders).where(eq(legacyOrders.wpOrderId, wpOrderId)).get();
  }

  async createSession(session: InsertSession) {
    return db.insert(sessions).values(session).returning().get();
  }
  async getSession(token: string) {
    return db.select().from(sessions).where(eq(sessions.token, token)).get();
  }
  async updateSessionExpiry(token: string, expiresAt: number) {
    db.update(sessions).set({ expiresAt }).where(eq(sessions.token, token)).run();
  }
  async deleteSession(token: string) {
    db.delete(sessions).where(eq(sessions.token, token)).run();
  }
  async setSessionImpersonation(token: string, impersonatingUserId: number | null, impersonationLogId: number | null) {
    db.update(sessions).set({ impersonatingUserId, impersonationLogId }).where(eq(sessions.token, token)).run();
  }

  async listPinnedMembers(adminUserId: number) {
    const rows = db.select().from(adminPinnedMembers)
      .where(eq(adminPinnedMembers.adminUserId, adminUserId))
      .orderBy(desc(adminPinnedMembers.createdAt))
      .all();
    if (rows.length === 0) return [];
    const memberIds = rows.map((r) => r.memberUserId);
    const members = db.select().from(users).where(inArray(users.id, memberIds)).all();
    const byId = new Map(members.map((m) => [m.id, m]));
    // Preserve pin order (most-recently-pinned first); drop any pin whose
    // target account was since deleted rather than surfacing a gap.
    return rows.map((r) => byId.get(r.memberUserId)).filter((u): u is User => !!u);
  }
  async pinMember(adminUserId: number, memberUserId: number) {
    const existing = db.select().from(adminPinnedMembers)
      .where(and(eq(adminPinnedMembers.adminUserId, adminUserId), eq(adminPinnedMembers.memberUserId, memberUserId)))
      .get();
    if (existing) return;
    db.insert(adminPinnedMembers).values({ adminUserId, memberUserId, createdAt: Date.now() }).run();
  }
  async unpinMember(adminUserId: number, memberUserId: number) {
    db.delete(adminPinnedMembers)
      .where(and(eq(adminPinnedMembers.adminUserId, adminUserId), eq(adminPinnedMembers.memberUserId, memberUserId)))
      .run();
  }

  async startImpersonationLog(adminUserId: number, targetUserId: number) {
    return db.insert(impersonationLog).values({ adminUserId, targetUserId, startedAt: Date.now(), endedAt: null }).returning().get();
  }
  async endImpersonationLog(id: number) {
    db.update(impersonationLog).set({ endedAt: Date.now() }).where(eq(impersonationLog.id, id)).run();
  }

  async createWebauthnCredential(c: InsertWebauthnCredential & { createdAt: number }) {
    return db.insert(webauthnCredentials).values(c).returning().get();
  }
  async getWebauthnCredentialByCredentialId(credentialId: string) {
    return db.select().from(webauthnCredentials).where(eq(webauthnCredentials.credentialId, credentialId)).get();
  }
  async listWebauthnCredentialsForUser(userId: number) {
    return db.select().from(webauthnCredentials).where(eq(webauthnCredentials.userId, userId)).all();
  }
  async updateWebauthnCredentialCounter(id: number, counter: number, lastUsedAt: number) {
    db.update(webauthnCredentials).set({ counter, lastUsedAt }).where(eq(webauthnCredentials.id, id)).run();
  }
  async deleteWebauthnCredential(id: number, userId: number) {
    const result = db
      .delete(webauthnCredentials)
      .where(and(eq(webauthnCredentials.id, id), eq(webauthnCredentials.userId, userId)))
      .run();
    return result.changes > 0;
  }

  async listProducts() {
    return db.select().from(products).all();
  }
  async getProduct(id: number) {
    return db.select().from(products).where(eq(products.id, id)).get();
  }
  async createProduct(p: InsertProduct) {
    return db.insert(products).values(p).returning().get();
  }
  async updateProduct(id: number, p: Partial<InsertProduct>) {
    return db.update(products).set(p).where(eq(products.id, id)).returning().get();
  }
  async deleteProduct(id: number) {
    db.delete(products).where(eq(products.id, id)).run();
  }

  async listTiersForProduct(productId: number) {
    return db.select().from(priceTiers).where(eq(priceTiers.productId, productId)).all();
  }
  async createTier(t: InsertPriceTier) {
    return db.insert(priceTiers).values(t).returning().get();
  }
  async deleteTier(id: number) {
    db.delete(priceTiers).where(eq(priceTiers.id, id)).run();
  }
  async deleteTiersForProduct(productId: number) {
    db.delete(priceTiers).where(eq(priceTiers.productId, productId)).run();
  }

  async createOrder(o: any) {
    return db.insert(orders).values({
      partnerId: o.partnerId,
      status: o.status ?? "Requested",
      emailNotified: o.emailNotified ?? false,
      notifiedAt: o.notifiedAt ?? null,
      destinationCountry: o.destinationCountry ?? null,
      estimatedShippingCost: o.estimatedShippingCost ?? null,
      createdAt: o.createdAt,
    }).returning().get();
  }
  async listOrdersForPartner(partnerId: number) {
    return db.select().from(orders).where(eq(orders.partnerId, partnerId)).orderBy(desc(orders.createdAt)).all();
  }
  async listAllOrders() {
    return db.select().from(orders).orderBy(desc(orders.createdAt)).all();
  }
  async getOrder(id: number) {
    return db.select().from(orders).where(eq(orders.id, id)).get();
  }
  async updateOrderStatus(id: number, status: string) {
    return db.update(orders).set({ status }).where(eq(orders.id, id)).returning().get();
  }
  async markOrdersNotified(ids: number[], ts: number) {
    for (const id of ids) {
      db.update(orders).set({ emailNotified: true, notifiedAt: ts }).where(eq(orders.id, id)).run();
    }
  }
  async listUnnotifiedOrders() {
    return db.select().from(orders).where(eq(orders.emailNotified, false)).all();
  }

  async createOrderItem(oi: InsertOrderItem) {
    return db.insert(orderItems).values(oi).returning().get();
  }
  async listItemsForOrder(orderId: number) {
    return db.select().from(orderItems).where(eq(orderItems.orderId, orderId)).all();
  }

  async createReferral(r: any) {
    return db.insert(referrals).values({
      partnerId: r.partnerId,
      patientFirstName: r.patientFirstName,
      patientLastName: r.patientLastName,
      patientContact: r.patientContact,
      caseDescription: r.caseDescription,
      urgency: r.urgency ?? "Normal",
      notes: r.notes ?? null,
      attachmentUrl: r.attachmentUrl ?? null,
      status: "New",
      emailNotified: false,
      notifiedAt: null,
      patientConsentAttestedAt: r.patientConsentAttestedAt ?? null,
      createdAt: r.createdAt,
    }).returning().get();
  }
  async listReferralsForPartner(partnerId: number) {
    return db.select().from(referrals).where(eq(referrals.partnerId, partnerId)).orderBy(desc(referrals.createdAt)).all();
  }
  async listAllReferrals() {
    return db.select().from(referrals).orderBy(desc(referrals.createdAt)).all();
  }
  async getReferral(id: number) {
    return db.select().from(referrals).where(eq(referrals.id, id)).get();
  }
  async updateReferralStatus(id: number, status: string) {
    return db.update(referrals).set({ status }).where(eq(referrals.id, id)).returning().get();
  }
  async setReferralArchived(id: number, archived: boolean) {
    return db.update(referrals)
      .set({ archivedAt: archived ? Date.now() : null })
      .where(eq(referrals.id, id))
      .returning().get();
  }
  // Permanently remove a referral row. Any patient chat thread linked to
  // it is intentionally kept -- we clear its referralId so it survives as
  // a general chat, preserving the conversation history. Files, flags,
  // reactions, and to-dos on that chat are untouched.
  async deleteReferral(id: number) {
    db.update(chatThreads)
      .set({ referralId: null, kind: "general" })
      .where(eq(chatThreads.referralId, id))
      .run();
    db.delete(referrals).where(eq(referrals.id, id)).run();
  }
  async markReferralsNotified(ids: number[], ts: number) {
    for (const id of ids) {
      db.update(referrals).set({ emailNotified: true, notifiedAt: ts }).where(eq(referrals.id, id)).run();
    }
  }
  async listUnnotifiedReferrals() {
    return db.select().from(referrals).where(eq(referrals.emailNotified, false)).all();
  }

  async listCourses() {
    return db.select().from(courses).all();
  }
  async getCourse(id: number) {
    return db.select().from(courses).where(eq(courses.id, id)).get();
  }
  async getCourseByName(name: string) {
    return db.select().from(courses).where(eq(courses.name, name)).get();
  }
  async createCourse(c: InsertCourse) {
    return db.insert(courses).values(c).returning().get();
  }
  async updateCourse(id: number, c: Partial<InsertCourse>) {
    return db.update(courses).set(c).where(eq(courses.id, id)).returning().get();
  }
  async deleteCourse(id: number) {
    db.delete(courses).where(eq(courses.id, id)).run();
  }

  async listVideos() {
    return db.select().from(videos).all();
  }
  async listVideosForCourse(courseId: number) {
    return db.select().from(videos).where(eq(videos.courseId, courseId)).all();
  }
  async getVideo(id: number) {
    return db.select().from(videos).where(eq(videos.id, id)).get();
  }
  async createVideo(v: InsertVideo) {
    return db.insert(videos).values(v).returning().get();
  }
  async updateVideo(id: number, v: Partial<InsertVideo>) {
    return db.update(videos).set(v).where(eq(videos.id, id)).returning().get();
  }
  async deleteVideo(id: number) {
    db.delete(videos).where(eq(videos.id, id)).run();
  }

  async listGrantsForCourse(courseId: number) {
    return db.select().from(courseAccessGrants).where(eq(courseAccessGrants.courseId, courseId)).all();
  }
  async listGrantsForPartner(partnerId: number) {
    return db.select().from(courseAccessGrants).where(eq(courseAccessGrants.partnerId, partnerId)).all();
  }
  async getGrant(courseId: number, partnerId: number) {
    return db.select().from(courseAccessGrants)
      .where(and(eq(courseAccessGrants.courseId, courseId), eq(courseAccessGrants.partnerId, partnerId)))
      .get();
  }
  async createGrant(g: InsertCourseAccessGrant) {
    return db.insert(courseAccessGrants).values(g).returning().get();
  }
  async deleteGrant(id: number) {
    db.delete(courseAccessGrants).where(eq(courseAccessGrants.id, id)).run();
  }

  async createCoursePurchase(p: InsertCoursePurchase) {
    return db.insert(coursePurchases).values(p).returning().get();
  }
  async updateCoursePurchaseStatus(id: number, status: string) {
    return db.update(coursePurchases).set({ status }).where(eq(coursePurchases.id, id)).returning().get();
  }
  async getCoursePurchaseBySession(stripeSessionId: string) {
    return db.select().from(coursePurchases).where(eq(coursePurchases.stripeSessionId, stripeSessionId)).get();
  }
  async getCompletedPurchase(userId: number, courseId: number) {
    return db.select().from(coursePurchases)
      .where(and(
        eq(coursePurchases.userId, userId),
        eq(coursePurchases.courseId, courseId),
        eq(coursePurchases.status, "completed"),
      ))
      .get();
  }
  async listCompletedPurchasesForUser(userId: number) {
    return db.select().from(coursePurchases)
      .where(and(eq(coursePurchases.userId, userId), eq(coursePurchases.status, "completed")))
      .all();
  }
  async listAllCoursePurchases() {
    return db.select().from(coursePurchases).orderBy(desc(coursePurchases.createdAt)).all();
  }

  async listModules() {
    return db.select().from(modules).all();
  }
  async createModule(m: InsertModule) {
    return db.insert(modules).values(m).returning().get();
  }
  async updateModule(id: number, m: Partial<InsertModule>) {
    return db.update(modules).set(m).where(eq(modules.id, id)).returning().get();
  }
  async deleteModule(id: number) {
    db.delete(modules).where(eq(modules.id, id)).run();
  }

  async listCohorts() {
    return db.select().from(cohorts).all();
  }
  async listCohortsForModule(moduleId: number) {
    return db.select().from(cohorts).where(eq(cohorts.moduleId, moduleId)).all();
  }
  async createCohort(c: InsertCohort) {
    return db.insert(cohorts).values(c).returning().get();
  }
  async deleteCohort(id: number) {
    db.delete(cohorts).where(eq(cohorts.id, id)).run();
  }

  async listEnrollmentsForCohort(cohortId: number) {
    return db.select().from(cohortEnrollments).where(eq(cohortEnrollments.cohortId, cohortId)).all();
  }
  async listEnrollmentsForStudent(studentId: number) {
    return db.select().from(cohortEnrollments).where(eq(cohortEnrollments.studentId, studentId)).all();
  }
  async createEnrollment(e: InsertCohortEnrollment) {
    return db.insert(cohortEnrollments).values(e).returning().get();
  }
  async deleteEnrollment(id: number) {
    db.delete(cohortEnrollments).where(eq(cohortEnrollments.id, id)).run();
  }

  async listClassSessions() {
    return db.select().from(classSessions).all();
  }
  async listClassSessionsForCohort(cohortId: number) {
    return db.select().from(classSessions).where(eq(classSessions.cohortId, cohortId)).all();
  }
  async getClassSession(id: number) {
    return db.select().from(classSessions).where(eq(classSessions.id, id)).get();
  }
  async createClassSession(c: InsertClassSession) {
    return db.insert(classSessions).values(c).returning().get();
  }
  async updateClassSession(id: number, c: Partial<InsertClassSession>) {
    return db.update(classSessions).set(c).where(eq(classSessions.id, id)).returning().get();
  }
  async deleteClassSession(id: number) {
    db.delete(classSessions).where(eq(classSessions.id, id)).run();
  }

  async createHomework(h: any) {
    return db.insert(homeworkSubmissions).values({
      classSessionId: h.classSessionId,
      studentId: h.studentId,
      fileUrl: h.fileUrl,
      fileType: h.fileType,
      comment: h.comment ?? null,
      createdAt: h.createdAt,
    }).returning().get();
  }
  async listHomeworkForStudent(studentId: number) {
    return db.select().from(homeworkSubmissions).where(eq(homeworkSubmissions.studentId, studentId)).orderBy(desc(homeworkSubmissions.createdAt)).all();
  }
  async listHomeworkForSession(sessionId: number) {
    return db.select().from(homeworkSubmissions).where(eq(homeworkSubmissions.classSessionId, sessionId)).all();
  }
  async listAllHomework() {
    return db.select().from(homeworkSubmissions).orderBy(desc(homeworkSubmissions.createdAt)).all();
  }

  async createUploadedFile(f: InsertUploadedFile) {
    return db.insert(uploadedFiles).values(f).returning().get();
  }
  async getUploadedFileByDriveId(driveFileId: string) {
    return db.select().from(uploadedFiles).where(eq(uploadedFiles.driveFileId, driveFileId)).get();
  }

  async createProductResource(r: InsertProductResource) {
    return db.insert(productResources).values({ ...r, createdAt: Date.now() }).returning().get();
  }
  async listResourcesForProduct(productId: number) {
    return db.select().from(productResources).where(eq(productResources.productId, productId)).orderBy(desc(productResources.createdAt)).all();
  }
  async getProductResource(id: number) {
    return db.select().from(productResources).where(eq(productResources.id, id)).get();
  }
  async deleteProductResource(id: number) {
    db.delete(productResources).where(eq(productResources.id, id)).run();
  }

  async createThread(userId: number, userRole: string, topic: string, opts?: { kind?: string; referralId?: number }) {
    return db.insert(chatThreads).values({
      userId, userRole, topic,
      kind: opts?.kind ?? "general",
      referralId: opts?.referralId ?? null,
      pendingReferralRequestedAt: null,
      pendingReferralRequestedByRole: null,
      emailNotified: false, notifiedAt: null, createdAt: Date.now(),
    }).returning().get();
  }
  async listThreadsForUser(userId: number) {
    return db.select().from(chatThreads).where(eq(chatThreads.userId, userId)).orderBy(desc(chatThreads.createdAt)).all();
  }
  async listThreads() {
    return db.select().from(chatThreads).orderBy(desc(chatThreads.createdAt)).all();
  }
  async getThread(id: number) {
    return db.select().from(chatThreads).where(eq(chatThreads.id, id)).get();
  }
  async getThreadByReferralId(referralId: number) {
    return db.select().from(chatThreads).where(eq(chatThreads.referralId, referralId)).get();
  }
  async updateThread(id: number, patch: Partial<{ kind: string; referralId: number | null; topic: string; pendingReferralRequestedAt: number | null; pendingReferralRequestedByRole: string | null; ownerLastReadAt: number | null; adminLastReadAt: number | null; escalationSentForMessageId: number | null; archivedAt: number | null; reactivationRequestedAt: number | null }>) {
    return db.update(chatThreads).set(patch).where(eq(chatThreads.id, id)).returning().get();
  }
  async deleteThread(id: number) {
    const msgIds = db.select({ id: chatMessages.id }).from(chatMessages).where(eq(chatMessages.threadId, id)).all().map((r) => r.id);
    if (msgIds.length > 0) {
      db.delete(chatMessageFlags).where(inArray(chatMessageFlags.messageId, msgIds)).run();
      db.delete(chatMessageReactions).where(inArray(chatMessageReactions.messageId, msgIds)).run();
    }
    db.delete(adminTodos).where(eq(adminTodos.threadId, id)).run();
    db.delete(chatMessages).where(eq(chatMessages.threadId, id)).run();
    db.delete(chatThreads).where(eq(chatThreads.id, id)).run();
  }
  async reassignMessages(sourceThreadId: number, targetThreadId: number) {
    db.update(chatMessages).set({ threadId: targetThreadId }).where(eq(chatMessages.threadId, sourceThreadId)).run();
  }
  async countMessagesForThread(threadId: number) {
    return db.select().from(chatMessages).where(eq(chatMessages.threadId, threadId)).all().length;
  }
  async markChatThreadsNotified(ids: number[], ts: number) {
    for (const id of ids) {
      db.update(chatThreads).set({ emailNotified: true, notifiedAt: ts }).where(eq(chatThreads.id, id)).run();
    }
  }
  async listUnnotifiedChatThreads() {
    return db.select().from(chatThreads).where(eq(chatThreads.emailNotified, false)).all();
  }
  async createMessage(m: any) {
    return db.insert(chatMessages).values({
      threadId: m.threadId,
      senderId: m.senderId,
      senderRole: m.senderRole,
      senderName: m.senderName,
      body: m.body,
      attachmentUrl: m.attachmentUrl ?? null,
      attachmentType: m.attachmentType ?? null,
      attachmentName: m.attachmentName ?? null,
      createdAt: m.createdAt,
    }).returning().get();
  }
  async getMessage(id: number) {
    return db.select().from(chatMessages).where(eq(chatMessages.id, id)).get();
  }
  async editMessage(id: number, body: string) {
    return db.update(chatMessages)
      .set({ body, editedAt: Date.now() })
      .where(eq(chatMessages.id, id))
      .returning()
      .get();
  }
  async deleteMessage(id: number, deletedByName: string) {
    return db.update(chatMessages)
      .set({ deletedAt: Date.now(), deletedByName })
      .where(eq(chatMessages.id, id))
      .returning()
      .get();
  }
  async toggleMessageFlag(messageId: number, userId: number) {
    const existing = db.select().from(chatMessageFlags)
      .where(and(eq(chatMessageFlags.messageId, messageId), eq(chatMessageFlags.userId, userId)))
      .get();
    if (existing) {
      db.delete(chatMessageFlags).where(eq(chatMessageFlags.id, existing.id)).run();
      return false;
    }
    db.insert(chatMessageFlags).values({ messageId, userId, createdAt: Date.now() }).run();
    return true;
  }
  async getFlaggedMessageIdsForUser(userId: number, threadId: number) {
    const rows = db.select({ messageId: chatMessageFlags.messageId })
      .from(chatMessageFlags)
      .innerJoin(chatMessages, eq(chatMessages.id, chatMessageFlags.messageId))
      .where(and(eq(chatMessageFlags.userId, userId), eq(chatMessages.threadId, threadId)))
      .all();
    return rows.map((r) => r.messageId);
  }
  async createAdminTodo(t: any) {
    return db.insert(adminTodos).values({
      messageId: t.messageId,
      threadId: t.threadId,
      createdByAdminId: t.createdByAdminId,
      assignedToAdminId: t.assignedToAdminId,
      note: t.note,
      createdAt: Date.now(),
    }).returning().get();
  }
  async listAdminTodos() {
    return db.select().from(adminTodos).all();
  }
  async getAdminTodo(id: number) {
    return db.select().from(adminTodos).where(eq(adminTodos.id, id)).get();
  }
  async setAdminTodoStatus(id: number, status: string, completedAt: number | null) {
    return db.update(adminTodos).set({ status, completedAt }).where(eq(adminTodos.id, id)).returning().get();
  }
  async searchCommunityMessages(query: string, opts?: { includeArchived?: boolean }) {
    const q = `%${query.toLowerCase()}%`;
    // Deleted messages keep their row for audit purposes but must never
    // surface through search -- same pattern as searchMessages above.
    const notDeleted = isNull(communityMessages.deletedAt);
    // Non-admins never see archived topics in the plain topic list, so a
    // cross-topic search must not let them search into one either.
    const scopeClause = opts?.includeArchived ? notDeleted : and(notDeleted, isNull(communityTopics.archivedAt));
    const whereClause = and(scopeClause, like(communityMessages.body, q));
    const rows = db
      .select({
        id: communityMessages.id,
        threadId: communityMessages.topicId,
        senderId: communityMessages.senderId,
        senderRole: communityMessages.senderRole,
        senderName: communityMessages.senderName,
        body: communityMessages.body,
        attachmentUrl: communityMessages.attachmentUrl,
        attachmentType: communityMessages.attachmentType,
        attachmentName: communityMessages.attachmentName,
        replyToMessageId: communityMessages.replyToMessageId,
        createdAt: communityMessages.createdAt,
        deletedAt: communityMessages.deletedAt,
        deletedByName: communityMessages.deletedByName,
        editedAt: communityMessages.editedAt,
        threadTopic: communityTopics.title,
      })
      .from(communityMessages)
      .innerJoin(communityTopics, eq(communityTopics.id, communityMessages.topicId))
      .where(whereClause)
      .orderBy(desc(communityMessages.createdAt))
      .limit(50)
      .all();
    return rows;
  }
  async searchMessages(query: string, threadIds?: number[]) {
    const q = `%${query.toLowerCase()}%`;
    // Deleted messages keep their row (and original body) for audit purposes,
    // but must never surface through search -- exclude them here.
    const notDeleted = isNull(chatMessages.deletedAt);
    const scopeClause = threadIds ? and(notDeleted, inArray(chatMessages.threadId, threadIds)) : notDeleted;
    const whereClause = and(scopeClause, like(chatMessages.body, q));
    const rows = db
      .select({
        id: chatMessages.id,
        threadId: chatMessages.threadId,
        senderId: chatMessages.senderId,
        senderRole: chatMessages.senderRole,
        senderName: chatMessages.senderName,
        body: chatMessages.body,
        attachmentUrl: chatMessages.attachmentUrl,
        attachmentType: chatMessages.attachmentType,
        attachmentName: chatMessages.attachmentName,
        replyToMessageId: chatMessages.replyToMessageId,
        createdAt: chatMessages.createdAt,
        deletedAt: chatMessages.deletedAt,
        deletedByName: chatMessages.deletedByName,
        editedAt: chatMessages.editedAt,
        threadTopic: chatThreads.topic,
        threadKind: chatThreads.kind,
      })
      .from(chatMessages)
      .innerJoin(chatThreads, eq(chatThreads.id, chatMessages.threadId))
      .where(whereClause)
      .orderBy(desc(chatMessages.createdAt))
      .limit(50)
      .all();
    return rows;
  }
  // Left-joins the sender's *current* photoUrl (rather than denormalizing a
  // photo onto each message row) so avatars in chat always reflect the
  // sender's latest uploaded photo, including for messages sent before they
  // had one set.
  async listMessagesForThread(threadId: number) {
    const rows = db
      .select({
        id: chatMessages.id,
        threadId: chatMessages.threadId,
        senderId: chatMessages.senderId,
        senderRole: chatMessages.senderRole,
        senderName: chatMessages.senderName,
        body: chatMessages.body,
        attachmentUrl: chatMessages.attachmentUrl,
        attachmentType: chatMessages.attachmentType,
        attachmentName: chatMessages.attachmentName,
        replyToMessageId: chatMessages.replyToMessageId,
        createdAt: chatMessages.createdAt,
        deletedAt: chatMessages.deletedAt,
        deletedByName: chatMessages.deletedByName,
        editedAt: chatMessages.editedAt,
        senderPhotoUrl: users.photoUrl,
      })
      .from(chatMessages)
      .leftJoin(users, eq(chatMessages.senderId, users.id))
      .where(eq(chatMessages.threadId, threadId))
      .orderBy(chatMessages.createdAt)
      .all();
    return rows;
  }
  async getLastMessageForThread(threadId: number) {
    return db.select().from(chatMessages).where(eq(chatMessages.threadId, threadId)).orderBy(desc(chatMessages.createdAt)).limit(1).get();
  }
  async setMessageReaction(messageId: number, userId: number, userName: string, emoji: string) {
    const existing = db.select().from(chatMessageReactions)
      .where(and(eq(chatMessageReactions.messageId, messageId), eq(chatMessageReactions.userId, userId)))
      .get();
    if (existing) {
      db.delete(chatMessageReactions).where(eq(chatMessageReactions.id, existing.id)).run();
      if (existing.emoji === emoji) return null; // tapping the same emoji again removes it
    }
    db.insert(chatMessageReactions).values({ messageId, userId, userName, emoji, createdAt: Date.now() }).run();
    return emoji;
  }
  async getReactionsForThread(threadId: number) {
    return db.select({
      messageId: chatMessageReactions.messageId,
      userId: chatMessageReactions.userId,
      userName: chatMessageReactions.userName,
      emoji: chatMessageReactions.emoji,
    })
      .from(chatMessageReactions)
      .innerJoin(chatMessages, eq(chatMessages.id, chatMessageReactions.messageId))
      .where(eq(chatMessages.threadId, threadId))
      .all();
  }

  async upsertPushSubscription(s: InsertPushSubscription) {
    const existing = db.select().from(pushSubscriptions).where(eq(pushSubscriptions.endpoint, s.endpoint)).get();
    if (existing) {
      return db.update(pushSubscriptions)
        .set({ userId: s.userId ?? null, p256dh: s.p256dh, auth: s.auth })
        .where(eq(pushSubscriptions.endpoint, s.endpoint))
        .returning().get();
    }
    return db.insert(pushSubscriptions).values(s).returning().get();
  }
  async deletePushSubscriptionByEndpoint(endpoint: string) {
    db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint)).run();
  }
  async deletePushSubscriptionsByEndpoints(endpoints: string[]) {
    if (endpoints.length === 0) return;
    db.delete(pushSubscriptions).where(inArray(pushSubscriptions.endpoint, endpoints)).run();
  }
  async listPushSubscriptionsForAudience(audience: string) {
    const subs = db.select().from(pushSubscriptions).all();
    if (audience === "all") return subs;
    const role = audience === "partners" ? "partner" : "student";
    const roleUserIds = new Set(
      db.select().from(users).where(eq(users.role, role)).all().map((u) => u.id)
    );
    return subs.filter((s) => s.userId != null && roleUserIds.has(s.userId));
  }

  async createAnnouncement(a: InsertAnnouncement) {
    return db.insert(announcements).values(a).returning().get();
  }
  async listAnnouncements() {
    return db.select().from(announcements).orderBy(desc(announcements.sentAt)).all();
  }

  async getPushSubscriptionsForUserIds(userIds: number[]) {
    if (userIds.length === 0) return [];
    return db.select().from(pushSubscriptions).where(inArray(pushSubscriptions.userId, userIds)).all();
  }

  // ---------- case discussions ----------
  async listUpcomingCaseDiscussions(forUserId: number) {
    const now = Date.now();
    const rows = db.select().from(caseDiscussions)
      .where(gte(caseDiscussions.scheduledAt, now))
      .orderBy(asc(caseDiscussions.scheduledAt))
      .all();
    return rows.map((d) => {
      const rsvps = db.select().from(caseDiscussionRsvps).where(eq(caseDiscussionRsvps.discussionId, d.id)).all();
      // Names only (no email) so fellow partners can see who else is
      // attending without exposing contact details — that stays admin-only
      // via listCaseDiscussionAttendees.
      const attendeeNames = rsvps.map((r) => {
        const u = db.select().from(users).where(eq(users.id, r.userId)).get();
        return u?.name ?? "Unknown";
      });
      return {
        ...d,
        rsvpCount: rsvps.length,
        iAmAttending: rsvps.some((r) => r.userId === forUserId),
        attendeeNames,
      };
    });
  }
  async listAllCaseDiscussionsForAdmin() {
    const rows = db.select().from(caseDiscussions).orderBy(desc(caseDiscussions.scheduledAt)).all();
    return rows.map((d) => {
      const rsvps = db.select().from(caseDiscussionRsvps).where(eq(caseDiscussionRsvps.discussionId, d.id)).all();
      return { ...d, rsvpCount: rsvps.length };
    });
  }
  async getCaseDiscussionById(id: number) {
    return db.select().from(caseDiscussions).where(eq(caseDiscussions.id, id)).get();
  }
  async createCaseDiscussion(input: InsertCaseDiscussion) {
    return db.insert(caseDiscussions).values({
      topic: input.topic,
      presenterName: input.presenterName ?? null,
      scheduledAt: input.scheduledAt,
      zoomLink: input.zoomLink,
      notes: input.notes ?? null,
      notifiedAt: null,
      createdAt: Date.now(),
    }).returning().get();
  }
  async updateCaseDiscussion(id: number, patch: Partial<InsertCaseDiscussion>) {
    return db.update(caseDiscussions).set(patch).where(eq(caseDiscussions.id, id)).returning().get();
  }
  async deleteCaseDiscussion(id: number) {
    db.delete(caseDiscussionRsvps).where(eq(caseDiscussionRsvps.discussionId, id)).run();
    db.delete(caseDiscussions).where(eq(caseDiscussions.id, id)).run();
  }
  async rsvpToCaseDiscussion(discussionId: number, userId: number) {
    // Idempotent: no-op if this user has already RSVP'd (SELECT-before-INSERT,
    // matching the cohort-enrollment / grant convention in this repo).
    const existing = db.select().from(caseDiscussionRsvps)
      .where(and(eq(caseDiscussionRsvps.discussionId, discussionId), eq(caseDiscussionRsvps.userId, userId)))
      .get();
    if (existing) return;
    db.insert(caseDiscussionRsvps).values({ discussionId, userId, createdAt: Date.now() }).run();
  }
  async cancelCaseDiscussionRsvp(discussionId: number, userId: number) {
    db.delete(caseDiscussionRsvps)
      .where(and(eq(caseDiscussionRsvps.discussionId, discussionId), eq(caseDiscussionRsvps.userId, userId)))
      .run();
  }
  async listCaseDiscussionAttendees(discussionId: number) {
    const rsvps = db.select().from(caseDiscussionRsvps).where(eq(caseDiscussionRsvps.discussionId, discussionId)).all();
    return rsvps.map((r) => {
      const u = db.select().from(users).where(eq(users.id, r.userId)).get();
      return {
        userId: r.userId,
        name: u?.name ?? "Unknown",
        email: u?.email ?? "",
        clinicName: u?.businessName ?? null,
      };
    });
  }
  async findCaseDiscussionsNeedingNotification(windowStartMs: number, nowMs: number) {
    return db.select().from(caseDiscussions)
      .where(and(
        lte(caseDiscussions.scheduledAt, nowMs),
        gt(caseDiscussions.scheduledAt, windowStartMs),
        isNull(caseDiscussions.notifiedAt),
      ))
      .all();
  }
  async markCaseDiscussionNotified(id: number, whenMs: number) {
    db.update(caseDiscussions).set({ notifiedAt: whenMs }).where(eq(caseDiscussions.id, id)).run();
  }

  // ---------- admin nav order (drag-and-drop sidebar reorder) ----------
  async updateAdminNavOrder(userId: number, order: string[]) {
    return db.update(users).set({ adminNavOrder: JSON.stringify(order) }).where(eq(users.id, userId)).returning().get();
  }

  // ---------- app settings (feature flags) ----------
  async getAppSetting(key: string) {
    return db.select().from(appSettings).where(eq(appSettings.key, key)).get()?.value;
  }
  async setAppSetting(key: string, value: string) {
    const existing = db.select().from(appSettings).where(eq(appSettings.key, key)).get();
    if (existing) {
      db.update(appSettings).set({ value }).where(eq(appSettings.key, key)).run();
    } else {
      db.insert(appSettings).values({ key, value }).run();
    }
  }

  // ---------- notification preferences ----------
  async updateNotificationPreference(userId: number, category: string, patch: { enabled?: boolean; style?: string }) {
    const colMap: Record<string, { enabled: keyof typeof users.$inferInsert; style: keyof typeof users.$inferInsert }> = {
      community: { enabled: "notifyCommunityEnabled", style: "notifyCommunityStyle" },
      chat: { enabled: "notifyChatEnabled", style: "notifyChatStyle" },
      orders: { enabled: "notifyOrdersEnabled", style: "notifyOrdersStyle" },
      offers: { enabled: "notifyOffersEnabled", style: "notifyOffersStyle" },
    };
    const cols = colMap[category];
    if (!cols) return this.getUser(userId);
    const set: Record<string, any> = {};
    if (patch.enabled !== undefined) set[cols.enabled] = patch.enabled;
    if (patch.style !== undefined) set[cols.style] = patch.style;
    if (Object.keys(set).length === 0) return this.getUser(userId);
    return db.update(users).set(set).where(eq(users.id, userId)).returning().get();
  }

  // ---------- community visibility ----------
  async updateCommunityVisibility(userId: number, patch: { communityShowPhone?: boolean; communityShowEmail?: boolean }) {
    return db.update(users).set(patch).where(eq(users.id, userId)).returning().get();
  }
  async setCommunityBlocked(userId: number, blocked: boolean) {
    return db.update(users).set({ communityBlockedAt: blocked ? Date.now() : null }).where(eq(users.id, userId)).returning().get();
  }

  // ---------- community topics ----------
  async createCommunityTopic(t: any) {
    return db.insert(communityTopics).values(t).returning().get();
  }
  async listCommunityTopics(includeArchived = false) {
    const q = db.select().from(communityTopics);
    const rows = includeArchived
      ? q.orderBy(desc(communityTopics.lastMessageAt)).all()
      : db.select().from(communityTopics).where(isNull(communityTopics.archivedAt)).orderBy(desc(communityTopics.lastMessageAt)).all();
    return rows;
  }
  async getCommunityTopic(id: number) {
    return db.select().from(communityTopics).where(eq(communityTopics.id, id)).get();
  }
  async updateCommunityTopic(id: number, patch: any) {
    return db.update(communityTopics).set(patch).where(eq(communityTopics.id, id)).returning().get();
  }
  async deleteCommunityTopic(id: number) {
    const msgIds = db.select({ id: communityMessages.id }).from(communityMessages).where(eq(communityMessages.topicId, id)).all().map((r) => r.id);
    if (msgIds.length > 0) {
      db.delete(communityMessageReads).where(inArray(communityMessageReads.messageId, msgIds)).run();
    }
    db.delete(communityMessages).where(eq(communityMessages.topicId, id)).run();
    db.delete(communityTopics).where(eq(communityTopics.id, id)).run();
  }

  // ---------- community messages ----------
  async createCommunityMessage(m: any) {
    const row = await db.insert(communityMessages).values({
      topicId: m.topicId,
      senderId: m.senderId,
      senderRole: m.senderRole,
      senderName: m.senderName,
      body: m.body,
      attachmentUrl: m.attachmentUrl ?? null,
      attachmentType: m.attachmentType ?? null,
      attachmentName: m.attachmentName ?? null,
      replyToMessageId: m.replyToMessageId ?? null,
      createdAt: m.createdAt,
    }).returning().get();
    db.update(communityTopics).set({ lastMessageAt: m.createdAt }).where(eq(communityTopics.id, m.topicId)).run();
    return row;
  }
  async listCommunityMessagesForTopic(topicId: number) {
    const rows = db
      .select({
        id: communityMessages.id,
        topicId: communityMessages.topicId,
        senderId: communityMessages.senderId,
        senderRole: communityMessages.senderRole,
        senderName: communityMessages.senderName,
        body: communityMessages.body,
        attachmentUrl: communityMessages.attachmentUrl,
        attachmentType: communityMessages.attachmentType,
        attachmentName: communityMessages.attachmentName,
        replyToMessageId: communityMessages.replyToMessageId,
        createdAt: communityMessages.createdAt,
        deletedAt: communityMessages.deletedAt,
        deletedByName: communityMessages.deletedByName,
        editedAt: communityMessages.editedAt,
        senderPhotoUrl: users.photoUrl,
        senderStandingPoints: users.standingPoints,
        senderClinicId: users.clinicId,
      })
      .from(communityMessages)
      .leftJoin(users, eq(communityMessages.senderId, users.id))
      .where(eq(communityMessages.topicId, topicId))
      .orderBy(communityMessages.createdAt)
      .all();
    // Batch clinic aggregates once per distinct clinic instead of a query per
    // message, so a pooled clinic's tier badge reflects the shared total.
    const clinicIds = Array.from(new Set(rows.map((r) => r.senderClinicId).filter((id): id is number => id != null)));
    const clinicPoints = new Map<number, number>();
    for (const clinicId of clinicIds) {
      clinicPoints.set(clinicId, await this.getClinicAggregatePoints(clinicId));
    }
    return rows.map((r) => {
      const { senderStandingPoints, senderClinicId, ...rest } = r;
      const effectivePoints = senderClinicId != null ? (clinicPoints.get(senderClinicId) ?? 0) : (senderStandingPoints ?? 0);
      // Reward program is partner/student-facing only -- admins never get a
      // tier badge, regardless of any points their account has accrued.
      const tier = rest.senderRole === "admin" ? null : standingTierForPoints(effectivePoints);
      return { ...rest, senderTierKey: tier?.key ?? null, senderTierLabel: tier?.label ?? null };
    });
  }
  async getCommunityMessage(id: number) {
    return db.select().from(communityMessages).where(eq(communityMessages.id, id)).get();
  }
  async deleteCommunityMessage(id: number, deletedByName: string) {
    return db.update(communityMessages)
      .set({ deletedAt: Date.now(), deletedByName })
      .where(eq(communityMessages.id, id))
      .returning()
      .get();
  }
  async countCommunityMessagesForTopic(topicId: number) {
    return db.select().from(communityMessages).where(eq(communityMessages.topicId, topicId)).all().length;
  }

  // ---------- community read receipts ----------
  async markCommunityMessagesRead(messageIds: number[], userId: number, userName: string) {
    if (messageIds.length === 0) return;
    const already = new Set(
      db.select({ messageId: communityMessageReads.messageId }).from(communityMessageReads)
        .where(and(inArray(communityMessageReads.messageId, messageIds), eq(communityMessageReads.userId, userId)))
        .all().map((r) => r.messageId)
    );
    const now = Date.now();
    for (const messageId of messageIds) {
      if (already.has(messageId)) continue;
      db.insert(communityMessageReads).values({ messageId, userId, userName, readAt: now }).run();
    }
  }
  async getCommunityReadsForMessages(messageIds: number[]) {
    if (messageIds.length === 0) return [];
    return db.select().from(communityMessageReads).where(inArray(communityMessageReads.messageId, messageIds)).all();
  }
  async getUnreadCommunityMessageIds(topicId: number, userId: number) {
    const msgIds = db.select({ id: communityMessages.id }).from(communityMessages).where(eq(communityMessages.topicId, topicId)).all().map((r) => r.id);
    if (msgIds.length === 0) return [];
    const readIds = new Set(
      db.select({ messageId: communityMessageReads.messageId }).from(communityMessageReads)
        .where(and(inArray(communityMessageReads.messageId, msgIds), eq(communityMessageReads.userId, userId)))
        .all().map((r) => r.messageId)
    );
    return msgIds.filter((id) => !readIds.has(id));
  }
  async countUnreadCommunityTopicsForUser(userId: number) {
    const topics = db.select().from(communityTopics).where(isNull(communityTopics.archivedAt)).all();
    let count = 0;
    for (const t of topics) {
      const unread = await this.getUnreadCommunityMessageIds(t.id, userId);
      // Don't count a topic as unread solely because of the current user's
      // own messages within it.
      const unreadFromOthers = unread.filter((id) => {
        const msg = db.select().from(communityMessages).where(eq(communityMessages.id, id)).get();
        return msg && msg.senderId !== userId;
      });
      if (unreadFromOthers.length > 0) count++;
    }
    return count;
  }

  // ---------- MAHA Standing (internal engagement scoring) ----------
  async awardStandingPoints(args: { userId: number; category: string; points: number; sourceType?: string; sourceId?: number }) {
    const now = Date.now();
    const user = db.select().from(users).where(eq(users.id, args.userId)).get();
    if (!user) throw new Error("User not found for standing award");
    // Tier-up detection is based on whatever pool this user's points count
    // toward: their own total normally, or the CLINIC's pooled total when
    // clinicId is set -- "it should all be one status of that clinic", so a
    // nurse's referral can tip the whole practice into a new tier even
    // though her own points alone wouldn't.
    const prevPoolPoints = user.clinicId ? await this.getClinicAggregatePoints(user.clinicId) : user.standingPoints;
    const prevTier = standingTierForPoints(prevPoolPoints);
    const entry = db.insert(standingEntries).values({
      userId: args.userId,
      category: args.category,
      points: args.points,
      sourceType: args.sourceType ?? null,
      sourceId: args.sourceId ?? null,
      createdAt: now,
    }).returning().get();
    const newTotal = user.standingPoints + args.points;
    db.update(users).set({ standingPoints: newTotal }).where(eq(users.id, args.userId)).run();
    // Pooled clinics: the aggregate only changed by this same award amount
    // (only one member's row changed), so add the increment rather than
    // re-querying -- equivalent to prevPoolPoints + args.points.
    const newPoolPoints = user.clinicId ? prevPoolPoints + args.points : newTotal;
    const newTier = standingTierForPoints(newPoolPoints);
    return {
      entry,
      newTierKey: newTier.key !== prevTier.key ? newTier.key : null,
      clinicId: user.clinicId ?? null,
    };
  }

  async countStandingEntriesToday(userId: number, sourceType: string) {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const rows = db.select().from(standingEntries)
      .where(and(eq(standingEntries.userId, userId), eq(standingEntries.sourceType, sourceType), gte(standingEntries.createdAt, startOfDay.getTime())))
      .all();
    return rows.length;
  }

  async hasStandingEntry(userId: number, sourceType: string, sourceId?: number) {
    const conditions = [eq(standingEntries.userId, userId), eq(standingEntries.sourceType, sourceType)];
    if (sourceId !== undefined) conditions.push(eq(standingEntries.sourceId, sourceId));
    const row = db.select().from(standingEntries).where(and(...conditions)).get();
    return !!row;
  }

  async getStandingSummaryForUser(userId: number) {
    const user = db.select().from(users).where(eq(users.id, userId)).get();
    if (!user) return { points: 0, tier: standingTierForPoints(0) };
    const points = user.clinicId ? await this.getClinicAggregatePoints(user.clinicId) : user.standingPoints;
    return { points, tier: standingTierForPoints(points) };
  }

  // ---------- Clinics (shared MAHA Standing pooling) ----------
  private normalizeClinicName(name: string) {
    return name.trim().toLowerCase();
  }

  async findOrCreateClinicByName(name: string) {
    const trimmed = name.trim();
    const normalized = this.normalizeClinicName(trimmed);
    const existing = db.select().from(clinics).where(eq(clinics.normalizedName, normalized)).get();
    if (existing) return existing;
    try {
      return db.insert(clinics).values({ name: trimmed, normalizedName: normalized, createdAt: Date.now() }).returning().get();
    } catch {
      // Race: another request created the same clinic between our lookup and
      // insert (unique index on normalizedName). Re-read instead of erroring.
      const row = db.select().from(clinics).where(eq(clinics.normalizedName, normalized)).get();
      if (row) return row;
      throw new Error(`Failed to find or create clinic "${trimmed}"`);
    }
  }

  async getClinic(id: number) {
    return db.select().from(clinics).where(eq(clinics.id, id)).get();
  }

  async listClinics() {
    return db.select().from(clinics).orderBy(asc(clinics.name)).all();
  }

  async getClinicAggregatePoints(clinicId: number) {
    const members = db.select().from(users).where(eq(users.clinicId, clinicId)).all();
    return members.reduce((sum, m) => sum + m.standingPoints, 0);
  }

  async setUserClinic(userId: number, clinicId: number | null) {
    return db.update(users).set({ clinicId }).where(eq(users.id, userId)).returning().get();
  }

  async listClinicsWithStats() {
    const allClinics = db.select().from(clinics).orderBy(asc(clinics.name)).all();
    const allUsers = db.select().from(users).all();
    return allClinics.map((c) => {
      const members = allUsers.filter((u) => u.clinicId === c.id);
      const points = members.reduce((sum, m) => sum + m.standingPoints, 0);
      const tier = standingTierForPoints(points);
      return {
        id: c.id,
        name: c.name,
        points,
        tierKey: tier.key,
        tierLabel: tier.label,
        members: members
          .map((m) => ({ id: m.id, name: m.name, role: m.role, email: m.email, standingPoints: m.standingPoints }))
          .sort((a, b) => b.standingPoints - a.standingPoints),
      };
    }).sort((a, b) => b.points - a.points);
  }

  async listStandingSummaries() {
    const rows = db.select().from(users).all();
    const clinicIds = Array.from(new Set(rows.map((u) => u.clinicId).filter((id): id is number => id != null)));
    const clinicPoints = new Map<number, number>();
    for (const clinicId of clinicIds) {
      clinicPoints.set(clinicId, await this.getClinicAggregatePoints(clinicId));
    }
    return rows.map((u) => {
      const effectivePoints = u.clinicId != null ? (clinicPoints.get(u.clinicId) ?? 0) : u.standingPoints;
      const tier = standingTierForPoints(effectivePoints);
      return { userId: u.id, userName: u.name, userRole: u.role, points: effectivePoints, tierKey: tier.key, tierLabel: tier.label };
    }).sort((a, b) => b.points - a.points);
  }

  async listStandingEntriesForUser(userId: number) {
    return db.select().from(standingEntries).where(eq(standingEntries.userId, userId)).orderBy(desc(standingEntries.createdAt)).all();
  }

  async createStandingReward(r: { userId: number; tierKey: string; rewardDescription: string; createdAt: number; clinicId?: number | null }) {
    return db.insert(standingRewards).values({ ...r, clinicId: r.clinicId ?? null, status: "pending" }).returning().get();
  }

  async listStandingRewards(status?: string) {
    const rows = status
      ? db.select().from(standingRewards).where(eq(standingRewards.status, status)).orderBy(desc(standingRewards.createdAt)).all()
      : db.select().from(standingRewards).orderBy(desc(standingRewards.createdAt)).all();
    return rows.map((r) => {
      const user = db.select().from(users).where(eq(users.id, r.userId)).get();
      return { ...r, userName: user?.name ?? "Unknown" };
    });
  }

  async fulfillStandingReward(id: number, fulfilledByName: string, note?: string) {
    return db.update(standingRewards)
      .set({ status: "fulfilled", fulfilledAt: Date.now(), fulfilledByName, fulfillmentNote: note ?? null })
      .where(eq(standingRewards.id, id))
      .returning().get();
  }
}

export const storage = new DatabaseStorage();
