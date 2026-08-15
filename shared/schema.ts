import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ---------- USERS ----------
export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  role: text("role").notNull(), // 'partner' | 'student' | 'admin'
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  status: text("status").notNull().default("pending"), // 'pending' | 'approved' | 'rejected'
  // One-click approve/decline link sent to partner@maha.clinic on signup.
  // Cleared once acted upon so the link can't be reused after a decision.
  approvalToken: text("approval_token"),
  approvalEmailNotified: integer("approval_email_notified", { mode: "boolean" }).notNull().default(false),
  phone: text("phone"),
  businessName: text("business_name"),
  vatNumber: text("vat_number"),
  profession: text("profession"),
  homepageUrl: text("homepage_url"),
  degreeFileUrl: text("degree_file_url"),
  installBannerDismissedAt: integer("install_banner_dismissed_at"),
  // Mirrors the fields collected on the WordPress partner.maha.clinic
  // registration form (partner-registration page), so the Portal's own
  // sign-up asks for the same information.
  firstName: text("first_name"),
  lastName: text("last_name"),
  prefix: text("prefix"), // e.g. "Dr.", "Prof."
  suffix: text("suffix"), // e.g. "PhD", "MD"
  username: text("username"),
  city: text("city"),
  address: text("address"),
  country: text("country"),
  // Eligibility gate: applicants must self-attest to being a medical
  // specialist and describe their qualification/specialty here.
  additionalInfo: text("additional_info"),
  // Set for accounts bulk-migrated from the legacy partner.maha.clinic
  // WordPress site. wpUserId links back to the WP user id (for re-running the
  // import idempotently and for mapping legacy orders/course grants).
  // migratedPasswordPlain holds the freshly generated password only until an
  // admin marks credentials as issued (see credentialsIssuedAt), at which
  // point it is cleared — it is never emailed automatically.
  wpUserId: integer("wp_user_id").unique(),
  migratedFromWp: integer("migrated_from_wp", { mode: "boolean" }).notNull().default(false),
  migratedPasswordPlain: text("migrated_password_plain"),
  credentialsIssuedAt: integer("credentials_issued_at"),
  createdAt: integer("created_at").notNull(),
});

export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  createdAt: true,
});
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

// Public-facing registration schema (subset, with plain password)
export const registerSchema = z.object({
  role: z.enum(["partner", "student"]),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  prefix: z.string().optional(),
  suffix: z.string().optional(),
  email: z.string().email(),
  password: z.string().min(6),
  phone: z.string().min(3),
  username: z.string().min(3),
  businessName: z.string().optional(),
  vatNumber: z.string().optional(),
  city: z.string().optional(),
  address: z.string().optional(),
  country: z.string().optional(),
  profession: z.string().optional(),
  homepageUrl: z.string().optional(),
  degreeFileUrl: z.string().optional(),
  // Applicant must self-attest to being a medical specialist and describe
  // their qualification/specialty.
  additionalInfo: z.string().min(10, "Please provide additional information about your medical specialty or qualification"),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(6),
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

// ---------- WEBAUTHN CREDENTIALS (Face ID / Fingerprint login) ----------
// One row per registered passkey/authenticator (a partner or student may
// register several devices — e.g. an iPhone and a laptop). credentialId and
// publicKey are stored as base64url strings (Node's native encoding); counter
// guards against cloned-authenticator replay. transports is a JSON-encoded
// array of strings (e.g. ["internal"]) or null when the browser didn't report any.
export const webauthnCredentials = sqliteTable("webauthn_credentials", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull(),
  credentialId: text("credential_id").notNull().unique(),
  publicKey: text("public_key").notNull(),
  counter: integer("counter").notNull().default(0),
  deviceType: text("device_type").notNull(), // 'singleDevice' | 'multiDevice'
  backedUp: integer("backed_up", { mode: "boolean" }).notNull().default(false),
  transports: text("transports"),
  // User-friendly label shown in account settings, e.g. "iPhone" — derived from
  // the browser's user agent at registration time, since WebAuthn itself
  // doesn't report a device name.
  label: text("label").notNull().default("Device"),
  createdAt: integer("created_at").notNull(),
  lastUsedAt: integer("last_used_at"),
});
export const insertWebauthnCredentialSchema = createInsertSchema(webauthnCredentials).omit({
  id: true,
  createdAt: true,
  lastUsedAt: true,
});
export type InsertWebauthnCredential = z.infer<typeof insertWebauthnCredentialSchema>;
export type WebauthnCredential = typeof webauthnCredentials.$inferSelect;

// ---------- SESSIONS ----------
export const sessions = sqliteTable("sessions", {
  token: text("token").primaryKey(),
  userId: integer("user_id").notNull(),
  expiresAt: integer("expires_at").notNull(),
});
export type Session = typeof sessions.$inferSelect;

// ---------- PRODUCTS ----------
export const products = sqliteTable("products", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  description: text("description").notNull(),
  // Package size / recommended use, shown in the product detail view. Null when
  // the client's shop did not specify one (never invented).
  packageSize: text("package_size"),
  imageUrl: text("image_url"),
  unitPrice: integer("unit_price").notNull(), // cents
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  // Approximate net weight per unit, in grams. Used only for the checkout shipping
  // estimator — these are estimates for cost calculation, not verified shipping specs.
  weightGrams: integer("weight_grams").notNull().default(300),
});
export const insertProductSchema = createInsertSchema(products).omit({ id: true });
export type InsertProduct = z.infer<typeof insertProductSchema>;
export type Product = typeof products.$inferSelect;

// ---------- PRICE TIERS ----------
export const priceTiers = sqliteTable("price_tiers", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  productId: integer("product_id").notNull(),
  minQty: integer("min_qty").notNull(),
  maxQty: integer("max_qty"), // nullable = no upper bound
  pricePerUnit: integer("price_per_unit").notNull(), // cents
});
export const insertPriceTierSchema = createInsertSchema(priceTiers).omit({ id: true });
export type InsertPriceTier = z.infer<typeof insertPriceTierSchema>;
export type PriceTier = typeof priceTiers.$inferSelect;

// ---------- PRODUCT RESOURCES ----------
// Informational files (spec sheets, certificates) and videos attached to a
// product, shown to partners in the shop's product detail view.
export const productResources = sqliteTable("product_resources", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  productId: integer("product_id").notNull(),
  kind: text("kind").notNull(), // 'file' | 'video'
  title: text("title").notNull(),
  // Set when the asset was uploaded to Drive via the admin panel.
  driveFileId: text("drive_file_id"),
  // Set when the admin pasted an external link (e.g. a YouTube video) instead.
  externalUrl: text("external_url"),
  createdAt: integer("created_at").notNull(),
});
export const insertProductResourceSchema = createInsertSchema(productResources).omit({ id: true, createdAt: true });
export type InsertProductResource = z.infer<typeof insertProductResourceSchema>;
export type ProductResource = typeof productResources.$inferSelect;

// ---------- ORDERS ----------
export const orders = sqliteTable("orders", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  partnerId: integer("partner_id").notNull(),
  status: text("status").notNull().default("Requested"), // Requested/Confirmed/Fulfilled/Cancelled
  emailNotified: integer("email_notified", { mode: "boolean" }).notNull().default(false),
  notifiedAt: integer("notified_at"),
  // Destination country ISO 3166-1 alpha-2 code selected at checkout.
  destinationCountry: text("destination_country"),
  // Estimated (not carrier-integrated) shipping cost in cents, computed at checkout time.
  estimatedShippingCost: integer("estimated_shipping_cost"),
  createdAt: integer("created_at").notNull(),
});
export const insertOrderSchema = createInsertSchema(orders).omit({
  id: true,
  emailNotified: true,
  notifiedAt: true,
  createdAt: true,
  status: true,
});
export type InsertOrder = z.infer<typeof insertOrderSchema>;
export type Order = typeof orders.$inferSelect;

// ---------- ORDER ITEMS ----------
export const orderItems = sqliteTable("order_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  orderId: integer("order_id").notNull(),
  productId: integer("product_id").notNull(),
  quantity: integer("quantity").notNull(),
  unitPriceAtOrder: integer("unit_price_at_order").notNull(), // cents
});
export const insertOrderItemSchema = createInsertSchema(orderItems).omit({ id: true });
export type InsertOrderItem = z.infer<typeof insertOrderItemSchema>;
export type OrderItem = typeof orderItems.$inferSelect;

// ---------- LEGACY ORDERS (migrated from partner.maha.clinic WooCommerce) ----------
// Read-only reference records for purchases made on the old WordPress/WooCommerce
// site before an account was migrated into this app. Not part of the live
// order/inventory flow — purely historical context shown on the user's profile
// and to admins. itemsJson is a JSON-encoded array of { name, quantity, total, sku }.
export const legacyOrders = sqliteTable("legacy_orders", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull(),
  wpOrderId: integer("wp_order_id").notNull().unique(),
  orderNumber: text("order_number").notNull(),
  status: text("status").notNull(),
  currency: text("currency").notNull().default("eur"),
  totalCents: integer("total_cents").notNull(),
  itemsJson: text("items_json").notNull(),
  wpCreatedAt: integer("wp_created_at").notNull(),
  createdAt: integer("created_at").notNull(),
});
export const insertLegacyOrderSchema = createInsertSchema(legacyOrders).omit({ id: true, createdAt: true });
export type InsertLegacyOrder = z.infer<typeof insertLegacyOrderSchema>;
export type LegacyOrder = typeof legacyOrders.$inferSelect;

export const cartItemSchema = z.object({
  productId: z.number(),
  quantity: z.number().min(1),
});
export const createOrderSchema = z.object({
  items: z.array(cartItemSchema).min(1),
  destinationCountry: z.string().length(2, "Select a destination country"),
});
export type CreateOrderInput = z.infer<typeof createOrderSchema>;

// ---------- COUNTRIES & EU MEMBERSHIP ----------
// Hardcoded list of the 27 current EU member states (ISO 3166-1 alpha-2 codes).
export const EU_COUNTRY_CODES = [
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR",
  "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL",
  "PL", "PT", "RO", "SK", "SI", "ES", "SE",
] as const;

export function isEuCountry(code: string): boolean {
  return (EU_COUNTRY_CODES as readonly string[]).includes(code.toUpperCase());
}

// A broad, practical list of countries (name + ISO alpha-2) for the destination-country
// selector. Not exhaustive of every ISO entry, but covers the countries MAHA's partner
// network realistically ships to/from.
export const COUNTRIES: { code: string; name: string }[] = [
  { code: "SI", name: "Slovenia" },
  { code: "AT", name: "Austria" },
  { code: "BE", name: "Belgium" },
  { code: "BG", name: "Bulgaria" },
  { code: "HR", name: "Croatia" },
  { code: "CY", name: "Cyprus" },
  { code: "CZ", name: "Czech Republic" },
  { code: "DK", name: "Denmark" },
  { code: "EE", name: "Estonia" },
  { code: "FI", name: "Finland" },
  { code: "FR", name: "France" },
  { code: "DE", name: "Germany" },
  { code: "GR", name: "Greece" },
  { code: "HU", name: "Hungary" },
  { code: "IE", name: "Ireland" },
  { code: "IT", name: "Italy" },
  { code: "LV", name: "Latvia" },
  { code: "LT", name: "Lithuania" },
  { code: "LU", name: "Luxembourg" },
  { code: "MT", name: "Malta" },
  { code: "NL", name: "Netherlands" },
  { code: "PL", name: "Poland" },
  { code: "PT", name: "Portugal" },
  { code: "RO", name: "Romania" },
  { code: "SK", name: "Slovakia" },
  { code: "ES", name: "Spain" },
  { code: "SE", name: "Sweden" },
  // Non-EU — common partner destinations
  { code: "GB", name: "United Kingdom" },
  { code: "CH", name: "Switzerland" },
  { code: "NO", name: "Norway" },
  { code: "IS", name: "Iceland" },
  { code: "RS", name: "Serbia" },
  { code: "BA", name: "Bosnia and Herzegovina" },
  { code: "ME", name: "Montenegro" },
  { code: "MK", name: "North Macedonia" },
  { code: "AL", name: "Albania" },
  { code: "XK", name: "Kosovo" },
  { code: "TR", name: "Turkey" },
  { code: "UA", name: "Ukraine" },
  { code: "US", name: "United States" },
  { code: "CA", name: "Canada" },
  { code: "AU", name: "Australia" },
  { code: "NZ", name: "New Zealand" },
  { code: "AE", name: "United Arab Emirates" },
  { code: "IL", name: "Israel" },
  { code: "SA", name: "Saudi Arabia" },
  { code: "JP", name: "Japan" },
  { code: "KR", name: "South Korea" },
  { code: "SG", name: "Singapore" },
  { code: "IN", name: "India" },
  { code: "BR", name: "Brazil" },
  { code: "MX", name: "Mexico" },
  { code: "ZA", name: "South Africa" },
];

// ---------- SHIPPING ESTIMATE ----------
// Rough, non-carrier-integrated shipping cost estimator. Rounded to nearest €0.10.
// Domestic = Slovenia (MAHA's home base), Other EU, and Non-EU tiers.
export function estimateShippingCostCents(totalWeightGrams: number, destinationCountry: string): number {
  const kg = totalWeightGrams / 1000;
  let baseFeeEur: number;
  let perKgEur: number;
  if (destinationCountry.toUpperCase() === "SI") {
    baseFeeEur = 4.9;
    perKgEur = 1.5;
  } else if (isEuCountry(destinationCountry)) {
    baseFeeEur = 7.9;
    perKgEur = 3.0;
  } else {
    baseFeeEur = 14.9;
    perKgEur = 6.0;
  }
  const totalEur = baseFeeEur + perKgEur * kg;
  const roundedEur = Math.round(totalEur * 10) / 10; // nearest €0.10
  return Math.round(roundedEur * 100); // cents
}

// ---------- REFERRALS ----------
export const referrals = sqliteTable("referrals", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  partnerId: integer("partner_id").notNull(),
  patientFirstName: text("patient_first_name").notNull(),
  patientLastName: text("patient_last_name").notNull(),
  patientContact: text("patient_contact").notNull(),
  caseDescription: text("case_description").notNull(),
  urgency: text("urgency").notNull().default("Normal"), // Normal | Urgent
  notes: text("notes"),
  attachmentUrl: text("attachment_url"),
  status: text("status").notNull().default("New"), // New/Contacted/Scheduled/Closed
  emailNotified: integer("email_notified", { mode: "boolean" }).notNull().default(false),
  notifiedAt: integer("notified_at"),
  createdAt: integer("created_at").notNull(),
});
export const insertReferralSchema = createInsertSchema(referrals).omit({
  id: true,
  emailNotified: true,
  notifiedAt: true,
  createdAt: true,
  status: true,
});
export type InsertReferral = z.infer<typeof insertReferralSchema>;
export type Referral = typeof referrals.$inferSelect;

// ---------- COURSES ----------
// The MAHA education model is course-based with a single flat unlock per course.
// `accessType` captures the three real access modes:
//   'open'   — free, immediately accessible to everyone (no enrollment gate)
//   'enroll' — free, but requires a one-click self-enroll before lessons unlock
//   'paid'   — requires a completed purchase (priceCents) or a manual admin grant
// `priceCents` is null/0 for free courses and the flat unlock price for paid ones.
export const courses = sqliteTable("courses", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  description: text("description"),
  priceCents: integer("price_cents"), // null/0 = free
  currency: text("currency").notNull().default("eur"),
  accessType: text("access_type").notNull().default("open"), // 'open' | 'enroll' | 'paid'
  // Optional link to a LearnDash course (by WP post ID) on partner.maha.clinic.
  // When set, any purchase/enroll/grant for this course also enrolls the
  // partner's WordPress account in the matching LearnDash course.
  learndashCourseId: integer("learndash_course_id"),
});
export const insertCourseSchema = createInsertSchema(courses).omit({ id: true });
export type InsertCourse = z.infer<typeof insertCourseSchema>;
export type Course = typeof courses.$inferSelect;

// ---------- VIDEOS (course lessons) ----------
// `category` is kept as a denormalized display string (mirrors the course name)
// so existing grouping code keeps working; `courseId` is the real relation.
export const videos = sqliteTable("videos", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  description: text("description"),
  url: text("url").notNull(),
  category: text("category").notNull(),
  courseId: integer("course_id"),
  isPremium: integer("is_premium", { mode: "boolean" }).notNull().default(false),
  thumbnailUrl: text("thumbnail_url"),
});
export const insertVideoSchema = createInsertSchema(videos).omit({ id: true });
export type InsertVideo = z.infer<typeof insertVideoSchema>;
export type Video = typeof videos.$inferSelect;

// Admin lesson create/update payload — scoped to a course, url optional (may be
// filled in later once the real video link exists).
export const lessonInputSchema = z.object({
  courseId: z.number(),
  title: z.string().min(1, "Title is required"),
  description: z.string().optional().or(z.literal("")),
  url: z.string().optional().or(z.literal("")),
});
export type LessonInput = z.infer<typeof lessonInputSchema>;

// Admin course create/update payload.
export const courseInputSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional().or(z.literal("")),
  priceCents: z.number().int().min(0).nullable().optional(),
  currency: z.string().min(1).optional(),
  accessType: z.enum(["open", "enroll", "paid"]),
  learndashCourseId: z.number().int().positive().nullable().optional(),
});
export type CourseInput = z.infer<typeof courseInputSchema>;

// ---------- COURSE ACCESS GRANTS ----------
// A manual admin comp: grants a partner access to an entire course without
// payment (e.g. VIP partners). Repurposed from the old per-video grant table.
export const courseAccessGrants = sqliteTable("course_access_grants", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  courseId: integer("course_id").notNull(),
  partnerId: integer("partner_id").notNull(),
});
export const insertCourseAccessGrantSchema = createInsertSchema(courseAccessGrants).omit({ id: true });
export type InsertCourseAccessGrant = z.infer<typeof insertCourseAccessGrantSchema>;
export type CourseAccessGrant = typeof courseAccessGrants.$inferSelect;

// ---------- COURSE PURCHASES ----------
// One row per purchase attempt. A free self-enroll is recorded as a completed
// purchase with amountCents 0 and no Stripe session; a paid unlock starts as
// 'pending' (with the Stripe session id) and flips to 'completed' on confirm.
export const coursePurchases = sqliteTable("course_purchases", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull(),
  courseId: integer("course_id").notNull(),
  amountCents: integer("amount_cents").notNull(),
  currency: text("currency").notNull().default("eur"),
  stripeSessionId: text("stripe_session_id").unique(),
  status: text("status").notNull().default("pending"), // 'pending' | 'completed' | 'refunded'
  createdAt: integer("created_at").notNull(),
});
export const insertCoursePurchaseSchema = createInsertSchema(coursePurchases).omit({ id: true });
export type InsertCoursePurchase = z.infer<typeof insertCoursePurchaseSchema>;
export type CoursePurchase = typeof coursePurchases.$inferSelect;

// ---------- MODULES ----------
export const modules = sqliteTable("modules", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  description: text("description"),
});
export const insertModuleSchema = createInsertSchema(modules).omit({ id: true });
export type InsertModule = z.infer<typeof insertModuleSchema>;
export type Module = typeof modules.$inferSelect;

// ---------- COHORTS ----------
export const cohorts = sqliteTable("cohorts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  moduleId: integer("module_id").notNull(),
  name: text("name").notNull(),
});
export const insertCohortSchema = createInsertSchema(cohorts).omit({ id: true });
export type InsertCohort = z.infer<typeof insertCohortSchema>;
export type Cohort = typeof cohorts.$inferSelect;

// ---------- COHORT ENROLLMENTS ----------
export const cohortEnrollments = sqliteTable("cohort_enrollments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  cohortId: integer("cohort_id").notNull(),
  studentId: integer("student_id").notNull(),
});
export const insertCohortEnrollmentSchema = createInsertSchema(cohortEnrollments).omit({ id: true });
export type InsertCohortEnrollment = z.infer<typeof insertCohortEnrollmentSchema>;
export type CohortEnrollment = typeof cohortEnrollments.$inferSelect;

// ---------- CLASS SESSIONS ----------
export const classSessions = sqliteTable("class_sessions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  cohortId: integer("cohort_id").notNull(),
  title: text("title").notNull(),
  datetime: integer("datetime").notNull(), // epoch ms
  zoomLink: text("zoom_link").notNull(),
  notes: text("notes"),
});
export const insertClassSessionSchema = createInsertSchema(classSessions).omit({ id: true });
export type InsertClassSession = z.infer<typeof insertClassSessionSchema>;
export type ClassSession = typeof classSessions.$inferSelect;

// ---------- HOMEWORK SUBMISSIONS ----------
export const homeworkSubmissions = sqliteTable("homework_submissions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  classSessionId: integer("class_session_id").notNull(),
  studentId: integer("student_id").notNull(),
  fileUrl: text("file_url").notNull(),
  fileType: text("file_type").notNull(),
  comment: text("comment"),
  createdAt: integer("created_at").notNull(),
});
export const insertHomeworkSubmissionSchema = createInsertSchema(homeworkSubmissions).omit({
  id: true,
  createdAt: true,
});
export type InsertHomeworkSubmission = z.infer<typeof insertHomeworkSubmissionSchema>;
export type HomeworkSubmission = typeof homeworkSubmissions.$inferSelect;

// ---------- UPLOADED FILES (Google Drive backed) ----------
// Every user-uploaded file lives in Google Drive; this table stores the pointer
// (driveFileId) plus the metadata needed to serve it back and re-check access.
// `ownerId` is the user the file belongs to for authorization (null for
// registration documents, which are uploaded before an account exists).
export const uploadedFiles = sqliteTable("uploaded_files", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  driveFileId: text("drive_file_id").notNull().unique(),
  filename: text("filename").notNull(),
  mimeType: text("mime_type").notNull(),
  size: integer("size").notNull(),
  category: text("category").notNull(), // 'homework' | 'registration' | 'referral' | 'product'
  ownerId: integer("owner_id"),
  uploadedAt: integer("uploaded_at").notNull(),
});
export const insertUploadedFileSchema = createInsertSchema(uploadedFiles).omit({ id: true });
export type InsertUploadedFile = z.infer<typeof insertUploadedFileSchema>;
export type UploadedFile = typeof uploadedFiles.$inferSelect;

// ---------- CHAT THREADS ----------
export const chatThreads = sqliteTable("chat_threads", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull(),
  userRole: text("user_role").notNull(), // 'partner' | 'student'
  topic: text("topic").notNull().default("General"),
  // Notify the MAHA team by email when a new chat thread is started. Mirrors
  // the referrals/orders emailNotified pattern polled by notificationScheduler.
  emailNotified: integer("email_notified", { mode: "boolean" }).notNull().default(false),
  notifiedAt: integer("notified_at"),
  createdAt: integer("created_at").notNull(),
});
export const insertChatThreadSchema = createInsertSchema(chatThreads).omit({ id: true, createdAt: true, emailNotified: true, notifiedAt: true });
export type InsertChatThread = z.infer<typeof insertChatThreadSchema>;
export type ChatThread = typeof chatThreads.$inferSelect;

// ---------- CHAT MESSAGES ----------
export const chatMessages = sqliteTable("chat_messages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  threadId: integer("thread_id").notNull(),
  senderId: integer("sender_id").notNull(),
  senderRole: text("sender_role").notNull(), // 'partner' | 'student' | 'admin'
  senderName: text("sender_name").notNull(),
  body: text("body").notNull(),
  createdAt: integer("created_at").notNull(),
});
export const insertChatMessageSchema = createInsertSchema(chatMessages).omit({ id: true, createdAt: true });
export type InsertChatMessage = z.infer<typeof insertChatMessageSchema>;
export type ChatMessage = typeof chatMessages.$inferSelect;

// ---------- PUSH SUBSCRIPTIONS ----------
// One row per browser/device push endpoint. `userId` ties the endpoint to an
// account so announcements can be targeted by role. Deduped by `endpoint`.
export const pushSubscriptions = sqliteTable("push_subscriptions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id"),
  endpoint: text("endpoint").notNull().unique(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  createdAt: integer("created_at").notNull(),
});
export const insertPushSubscriptionSchema = createInsertSchema(pushSubscriptions).omit({ id: true });
export type InsertPushSubscription = z.infer<typeof insertPushSubscriptionSchema>;
export type PushSubscriptionRow = typeof pushSubscriptions.$inferSelect;

// Shape the browser posts from PushSubscription.toJSON().
export const pushSubscribeSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
});
export type PushSubscribeInput = z.infer<typeof pushSubscribeSchema>;

// ---------- ANNOUNCEMENTS ----------
export const announcements = sqliteTable("announcements", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  body: text("body").notNull(),
  url: text("url"),
  audience: text("audience").notNull(), // 'all' | 'partners' | 'students'
  sentByUserId: integer("sent_by_user_id").notNull(),
  recipientCount: integer("recipient_count").notNull().default(0),
  sentAt: integer("sent_at").notNull(),
});
export const insertAnnouncementSchema = createInsertSchema(announcements).omit({ id: true });
export type InsertAnnouncement = z.infer<typeof insertAnnouncementSchema>;
export type Announcement = typeof announcements.$inferSelect;

// ---------- CASE DISCUSSIONS ----------
// Recurring (~every 4 weeks) partner Zoom session where one partner may present
// a patient case for group discussion. Admin creates each occurrence individually
// (no auto-recurrence) since the presenter/topic/link differ each time.
export const caseDiscussions = sqliteTable("case_discussions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  topic: text("topic").notNull(), // e.g. "Partner Case Discussion" or a specific case title
  presenterName: text("presenter_name"), // optional — name of the partner presenting a case
  scheduledAt: integer("scheduled_at").notNull(), // epoch ms
  zoomLink: text("zoom_link").notNull(),
  notes: text("notes"),
  notifiedAt: integer("notified_at"), // epoch ms — set once the auto push notification has fired, to avoid double-sending
  createdAt: integer("created_at").notNull(),
});
export const insertCaseDiscussionSchema = createInsertSchema(caseDiscussions).omit({ id: true, createdAt: true, notifiedAt: true });
export type InsertCaseDiscussion = z.infer<typeof insertCaseDiscussionSchema>;
export type CaseDiscussion = typeof caseDiscussions.$inferSelect;

// ---------- CASE DISCUSSION RSVPS ----------
export const caseDiscussionRsvps = sqliteTable("case_discussion_rsvps", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  discussionId: integer("discussion_id").notNull(),
  userId: integer("user_id").notNull(),
  createdAt: integer("created_at").notNull(),
});
export const insertCaseDiscussionRsvpSchema = createInsertSchema(caseDiscussionRsvps).omit({ id: true, createdAt: true });
export type InsertCaseDiscussionRsvp = z.infer<typeof insertCaseDiscussionRsvpSchema>;
export type CaseDiscussionRsvp = typeof caseDiscussionRsvps.$inferSelect;

// Admin-submitted announcement payload.
export const createAnnouncementSchema = z.object({
  title: z.string().min(1, "Title is required"),
  body: z.string().min(1, "Message is required"),
  url: z.string().url().optional().or(z.literal("")),
  audience: z.enum(["all", "partners", "students"]),
});
export type CreateAnnouncementInput = z.infer<typeof createAnnouncementSchema>;
