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
  // Self-service "forgot password" flow. Cleared (both set to null) once the
  // token is used or a new one is issued, so a link can't be reused and only
  // the most recently requested link is ever valid.
  passwordResetToken: text("password_reset_token"),
  passwordResetExpiresAt: integer("password_reset_expires_at"),
  phone: text("phone"),
  businessName: text("business_name"),
  vatNumber: text("vat_number"),
  profession: text("profession"),
  homepageUrl: text("homepage_url"),
  degreeFileUrl: text("degree_file_url"),
  // Small pre-resized (~256px) JPEG stored inline as a base64 data URL —
  // deliberately NOT routed through the Drive-backed upload/streaming path
  // used for documents (see /api/files/:driveFileId), because that path
  // fetches from Drive live on every GET with no caching. An avatar is
  // rendered on every chat message and every admin list row, so a live
  // Drive round-trip per render would be far too slow. Storing the data
  // URL directly means it rides along for free in the same JSON response
  // as the user/message it belongs to, and still gets backed up to Drive
  // as part of the regular SQLite file backup.
  photoUrl: text("photo_url"),
  installBannerDismissedAt: integer("install_banner_dismissed_at"),
  // Proactive push-notification nudge: the last time we showed the
  // "turn on notifications" prompt (first-login ask, or a later 3-month
  // recheck while their setup is still weak -- push off on this device, or
  // any category dialed below "preview"). Null means never prompted yet.
  pushNudgeLastPromptedAt: integer("push_nudge_last_prompted_at"),
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
  // GDPR consent tracking. legalAcceptedVersion is compared against
  // CURRENT_LEGAL_VERSION (see legalContent.ts) to decide whether a signed-in
  // user must acknowledge an updated Privacy Policy/Terms before continuing.
  // New registrations record it immediately (see registerSchema below);
  // existing users get it retroactively via the one-time acknowledgment modal.
  legalAcceptedVersion: text("legal_accepted_version"),
  legalAcceptedAt: integer("legal_accepted_at"),
  // Admin's personally chosen order for their own sidebar nav (drag-and-drop
  // reorder). Stored as a JSON-stringified array of `href` strings; null
  // means "use the default order". Server-managed only — never part of
  // registration or profile-edit payloads.
  adminNavOrder: text("admin_nav_order"),
  // ---- Community Chat visibility (self-chosen) ----
  // Title + name are always shown to fellow Community members and are not
  // configurable. Phone/email are private by default; a member opts in here.
  communityShowPhone: integer("community_show_phone", { mode: "boolean" }).notNull().default(false),
  communityShowEmail: integer("community_show_email", { mode: "boolean" }).notNull().default(false),
  // Admin-only moderation: blocks a member from posting/reading Community
  // Chat without touching their platform account otherwise. Null = not blocked.
  communityBlockedAt: integer("community_blocked_at"),
  // ---- Push notification preferences, per category ----
  // "silent" = app-icon badge count only, no sound/popup. "alert" = tone +
  // popup with generic text (no message content). "preview" = tone + popup
  // with the actual content (default for every category; user-adjustable).
  notifyCommunityEnabled: integer("notify_community_enabled", { mode: "boolean" }).notNull().default(true),
  notifyCommunityStyle: text("notify_community_style").notNull().default("preview"),
  notifyChatEnabled: integer("notify_chat_enabled", { mode: "boolean" }).notNull().default(true),
  notifyChatStyle: text("notify_chat_style").notNull().default("preview"),
  notifyOrdersEnabled: integer("notify_orders_enabled", { mode: "boolean" }).notNull().default(true),
  notifyOrdersStyle: text("notify_orders_style").notNull().default("preview"),
  notifyOffersEnabled: integer("notify_offers_enabled", { mode: "boolean" }).notNull().default(true),
  notifyOffersStyle: text("notify_offers_style").notNull().default("preview"),
  // Admin-only category: messages in the Staff Room or an admin-to-admin
  // DM. Never shown to partners/students (notifyCategoryConfigs on the
  // client only renders it for role='admin'), but the columns still exist
  // on every user row -- harmless unused defaults for non-admins.
  notifyStaffEnabled: integer("notify_staff_enabled", { mode: "boolean" }).notNull().default(true),
  notifyStaffStyle: text("notify_staff_style").notNull().default("preview"),
  // Running count for the "silent" style's app-icon badge (Badging API).
  // Incremented on each qualifying silent-style event, reset to 0 whenever
  // the app confirms the user has opened/focused it.
  unreadBadgeCount: integer("unread_badge_count").notNull().default(0),
  // MAHA Standing (internal engagement scoring) -- denormalized running
  // total kept in sync with standingEntries so admin lists can sort/filter
  // by points without summing the ledger on every request. The member's
  // own tier (derived from this via STANDING_TIERS) is the only thing ever
  // shown to them -- never the raw number or how it was earned.
  standingPoints: integer("standing_points").notNull().default(0),
  // Clinic status pooling: when set, this user's MAHA Standing tier is
  // computed from the SUM of every member's standingPoints in the same
  // clinic (see clinics table below), not this column alone -- "it doesn't
  // matter who referred the patient, it should all be one status of that
  // clinic". Auto-matched at registration from businessName (exact,
  // normalized match) or set retroactively by an admin. Null means the
  // user is unpooled and uses their own standingPoints (legacy behavior).
  clinicId: integer("clinic_id"),
  // ---- Welcome/intro flow (Community Chat onboarding) ----
  // Counts every time this member opens the Community tab. Drives the
  // "remind every 5th entry" cadence below -- purely a visit counter, not
  // tied to messages posted.
  communityVisitCount: integer("community_visit_count").notNull().default(0),
  // How many times the auto-reminder modal has actually been shown (capped
  // at 3 -- see WELCOME_INTRO_MAX_REMINDERS). After the cap, no more
  // pop-ups; only the persistent manual entry point remains.
  welcomeIntroReminderCount: integer("welcome_intro_reminder_count").notNull().default(0),
  // Set once this member posts their welcome intro video. Null forever if
  // they keep skipping -- the flow is fully skippable, never a hard gate.
  welcomeIntroPostedAt: integer("welcome_intro_posted_at"),
  // Admin-only reversible hide, same pattern as chatThreads/communityTopics.
  // An archived partner/student is excluded from the default Admin
  // Partners & Students list and cannot log in, but every row of their
  // history (referrals, orders, chat, standing, etc.) stays intact and
  // fully restored the moment an admin un-archives them.
  archivedAt: integer("archived_at"),
  createdAt: integer("created_at").notNull(),
});

export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  createdAt: true,
  adminNavOrder: true,
  archivedAt: true,
  // Clinic pooling is resolved server-side (auto-join at registration by
  // businessName, or admin assignment) -- never accept a client-supplied
  // clinicId directly on a registration/profile payload.
  clinicId: true,
});
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

// ---------- CLINICS (shared MAHA Standing pooling) ----------
// A clinic pools the standing/tier status of every user whose clinicId
// points here, so a clinic's doctors/nurses/admins rise together instead
// of individually. Deliberately no denormalized total-points column --
// the pooled total is always SUM(users.standingPoints) WHERE clinicId = X
// computed at read time, so there's no drift/merge bookkeeping and a
// user's points count toward the pool the instant clinicId is set.
export const clinics = sqliteTable("clinics", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  // Trimmed + lowercased form of `name`, unique, used for exact-match
  // auto-join/auto-create at registration (matched against the existing
  // businessName field partners already fill in -- no new form field).
  normalizedName: text("normalized_name").notNull().unique(),
  createdAt: integer("created_at").notNull(),
});
export const insertClinicSchema = createInsertSchema(clinics).omit({
  id: true,
  createdAt: true,
});
export type InsertClinic = z.infer<typeof insertClinicSchema>;
export type Clinic = typeof clinics.$inferSelect;

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
  // Applicant may optionally describe their qualification/specialty.
  additionalInfo: z.string().optional(),
  // Required consent to the Platform's own Privacy Policy and Terms of Use
  // (see legalContent.ts) — distinct from the optional homepage/degree
  // fields above, this checkbox must be checked to submit registration.
  acceptedLegal: z.literal(true, {
    errorMap: () => ({ message: "You must accept the Privacy Policy and Terms of Use to register." }),
  }),
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

// Self-service "forgot password" flow -- request an emailed reset link, then
// submit the token + new password from that link.
export const forgotPasswordSchema = z.object({
  email: z.string().email(),
});
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(6),
});
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

// Self-service profile editing -- every field optional so a user can update
// just the ones they touched. Mirrors registerSchema's validation rules for
// any field that is present.
export const updateProfileSchema = z.object({
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  prefix: z.string().optional(),
  suffix: z.string().optional(),
  email: z.string().email().optional(),
  username: z.string().min(3).optional(),
  phone: z.string().min(3).optional(),
  businessName: z.string().optional(),
  vatNumber: z.string().optional(),
  city: z.string().optional(),
  address: z.string().optional(),
  country: z.string().optional(),
  profession: z.string().optional(),
  homepageUrl: z.string().optional(),
  degreeFileUrl: z.string().optional(),
  // A base64 data URL of a client-resized (~256px) JPEG, or null to clear
  // the photo. Size-capped well above what a resized avatar should ever
  // produce, just to keep an oversized upload from bloating the DB.
  photoUrl: z
    .string()
    .max(500_000, "Image is too large")
    .refine((v) => v.startsWith("data:image/"), "Invalid image data")
    .nullable()
    .optional(),
});
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

// Self-service Community Chat visibility toggle -- title + name are always
// shown to fellow members and are not part of this schema; phone/email are
// opt-in only.
export const communityVisibilitySchema = z.object({
  communityShowPhone: z.boolean().optional(),
  communityShowEmail: z.boolean().optional(),
});
export type CommunityVisibilityInput = z.infer<typeof communityVisibilitySchema>;

// Self-service push notification preferences -- one category at a time.
export const NOTIFICATION_CATEGORIES = ["community", "chat", "orders", "offers", "staff"] as const;
export const NOTIFICATION_STYLES = ["silent", "alert", "preview"] as const;
export const updateNotificationPreferenceSchema = z.object({
  category: z.enum(NOTIFICATION_CATEGORIES),
  enabled: z.boolean().optional(),
  style: z.enum(NOTIFICATION_STYLES).optional(),
});
export type UpdateNotificationPreferenceInput = z.infer<typeof updateNotificationPreferenceSchema>;

// Admin-initiated edit of another user's core contact details -- deliberately
// narrower than updateProfileSchema. Scope is name, email, phone, and photo;
// role changes, status changes, and password resets each have their own
// dedicated endpoints already.
export const adminEditUserSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  // Same client-resized (~256px) JPEG data URL contract as
  // updateProfileSchema's photoUrl -- lets an admin set or clear a photo on
  // someone else's behalf (e.g. a partner who can't do it themselves).
  photoUrl: z
    .string()
    .max(500_000, "Image is too large")
    .refine((v) => v.startsWith("data:image/"), "Invalid image data")
    .nullable()
    .optional(),
});
export type AdminEditUserInput = z.infer<typeof adminEditUserSchema>;

// Note: password resets are admin-initiated only (see AdminPartners /
// /api/admin/users/:id/reset-password) — no self-service email-link flow.

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
  // "View Platform as Member" (admin impersonation): when set, requireAuth
  // resolves req.user to THIS user instead of the session's real owner, so
  // the admin sees and acts as exactly what the partner/student sees --
  // fully functional, not a read-only preview. Cleared on exit or if the
  // target account becomes invalid. Never touches the real admin identity
  // stored in `userId` above, so exiting always restores the admin.
  impersonatingUserId: integer("impersonating_user_id"),
  // The open impersonation_log row for the current "View as" session, so
  // exiting can close out that exact row without an ambiguous lookup.
  impersonationLogId: integer("impersonation_log_id"),
});
export type Session = typeof sessions.$inferSelect;
export type InsertSession = typeof sessions.$inferInsert;

// ---------- ADMIN PINNED MEMBERS ----------
// Lets an admin "star" specific partner/student accounts they check often,
// so "View as" doesn't require searching the full partner list every time.
// Per-admin (adminUserId scoped) -- one admin's pins never show up for another.
export const adminPinnedMembers = sqliteTable("admin_pinned_members", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  adminUserId: integer("admin_user_id").notNull(),
  memberUserId: integer("member_user_id").notNull(),
  createdAt: integer("created_at").notNull(),
});
export type AdminPinnedMember = typeof adminPinnedMembers.$inferSelect;

// ---------- IMPERSONATION LOG ----------
// Audit trail of "View as" sessions -- who (admin) viewed as whom (member),
// and for how long. Real partner/patient-adjacent data is touched during
// impersonation, so this exists purely for accountability; nothing here is
// ever shown to partners/students.
export const impersonationLog = sqliteTable("impersonation_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  adminUserId: integer("admin_user_id").notNull(),
  targetUserId: integer("target_user_id").notNull(),
  startedAt: integer("started_at").notNull(),
  endedAt: integer("ended_at"),
});
export type ImpersonationLogEntry = typeof impersonationLog.$inferSelect;

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
  // Set when an admin has viewed this order (distinct from `status` — an
  // order can be seen but still awaiting action). Drives the sidebar
  // unread badge so it clears once opened, instead of staying lit until
  // the workflow status itself changes.
  adminSeenAt: integer("admin_seen_at"),
  createdAt: integer("created_at").notNull(),
});
export const insertOrderSchema = createInsertSchema(orders).omit({
  id: true,
  emailNotified: true,
  notifiedAt: true,
  adminSeenAt: true,
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
  // The referring partner's per-referral attestation that they are entitled
  // to share this patient's data with MAHA/Vidvana d.o.o. for care
  // coordination (see Privacy Policy §5 / Terms §3). Recorded at submission
  // time, not just checked client-side, so there's an audit trail per referral.
  patientConsentAttestedAt: integer("patient_consent_attested_at"),
  // Set when an admin has viewed this referral's detail (distinct from
  // `status` — a referral can be seen but still awaiting triage). Drives
  // the sidebar unread badge so it clears once opened.
  adminSeenAt: integer("admin_seen_at"),
  // Admin-only, reversible hide. When non-null the referral is excluded
  // from the default admin list and "New" sidebar count, but the row
  // (and its linked patient chat) is untouched. Partner-side visibility
  // is intentionally unaffected -- the submitting partner still sees
  // their referral in "My referrals" regardless of archive state.
  archivedAt: integer("archived_at"),
  createdAt: integer("created_at").notNull(),
});
export const insertReferralSchema = createInsertSchema(referrals).omit({
  id: true,
  emailNotified: true,
  notifiedAt: true,
  adminSeenAt: true,
  archivedAt: true,
  createdAt: true,
  status: true,
  patientConsentAttestedAt: true,
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
  // Set when an admin has viewed this purchase in the admin console (via
  // the dashboard's "New enrollments" card or the Videos > Purchases tab).
  // Same pattern as referrals/orders adminSeenAt -- distinct from `status`,
  // and drives the admin home dashboard's unseen-enrollments count.
  adminSeenAt: integer("admin_seen_at"),
});
export const insertCoursePurchaseSchema = createInsertSchema(coursePurchases).omit({ id: true, adminSeenAt: true });
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
  category: text("category").notNull(), // 'homework' | 'registration' | 'referral' | 'product' | 'chat'
  ownerId: integer("owner_id"),
  threadId: integer("thread_id"), // set when category='chat' — enables file-access checks via thread membership
  uploadedAt: integer("uploaded_at").notNull(),
  // Chat video instant-send: the raw video is uploaded to Drive immediately
  // under this same `driveFileId` (so the URL handed to the client never
  // changes), then a background job re-encodes it to H.264/AAC and replaces
  // the Drive file's content in place via `files.update`. `status` is
  // 'ready' | 'processing' | 'failed' ('ready' for every non-video / legacy
  // row). `thumbnailDataUrl` is a small base64 JPEG poster frame, filled in
  // once processing finishes.
  status: text("status").notNull().default("ready"),
  thumbnailDataUrl: text("thumbnail_data_url"),
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
  // 'general' — ordinary chat. 'referral' — dedicated to one patient referral.
  kind: text("kind").notNull().default("general"),
  // 1:1 link to a referral. A referral has at most one linked thread.
  referralId: integer("referral_id"),
  // Set when someone (partner or admin) requests a referral be created for
  // this chat but hasn't filled in the form yet. Cleared once referralId is set.
  pendingReferralRequestedAt: integer("pending_referral_requested_at"),
  pendingReferralRequestedByRole: text("pending_referral_requested_by_role"), // 'partner' | 'student' | 'admin'
  // Notify the MAHA team by email when a new chat thread is started. Mirrors
  // the referrals/orders emailNotified pattern polled by notificationScheduler.
  emailNotified: integer("email_notified", { mode: "boolean" }).notNull().default(false),
  notifiedAt: integer("notified_at"),
  // Unread-marker tracking (Item 10). Set to the current time whenever the
  // owning partner/student, or any admin, opens this thread (fetches its
  // messages). A thread reads as "unread" for a side whenever the most
  // recent message was sent by the OTHER side and is newer than that side's
  // last-read timestamp here.
  ownerLastReadAt: integer("owner_last_read_at"),
  adminLastReadAt: integer("admin_last_read_at"),
  // Item 11 (6-hour escalation): the id of the most recent partner/student
  // message this thread has already sent an "unanswered for 6+ hours" alert
  // for. Compared against the current last message's id on each poll so the
  // alert fires exactly once per unanswered message, and fires again for a
  // later message if the thread goes unanswered again after an admin reply.
  escalationSentForMessageId: integer("escalation_sent_for_message_id"),
  // Admin-only reversible "hide from inbox" toggle. Set to the archive time,
  // null when active/unarchived. Messages, flags, reactions, and to-dos are
  // untouched -- unlike thread delete below, this never removes data.
  archivedAt: integer("archived_at"),
  // Set when the owning partner/student asks (from an archived thread) for
  // an admin to reopen it. Cleared whenever the thread is archived or
  // unarchived again, so it never lingers past the request it describes.
  reactivationRequestedAt: integer("reactivation_requested_at"),
  createdAt: integer("created_at").notNull(),
});
export const insertChatThreadSchema = createInsertSchema(chatThreads).omit({
  id: true, createdAt: true, emailNotified: true, notifiedAt: true,
  kind: true, referralId: true, pendingReferralRequestedAt: true, pendingReferralRequestedByRole: true,
  ownerLastReadAt: true, adminLastReadAt: true, escalationSentForMessageId: true,
  archivedAt: true, reactivationRequestedAt: true,
});
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
  attachmentUrl: text("attachment_url"),
  attachmentType: text("attachment_type"), // 'image' | 'video' | 'document' | 'audio' (voice note)
  attachmentName: text("attachment_name"),
  // Swipe-to-reply: points at the message this one is quoting. Null for an
  // ordinary (non-reply) message. The quoted snippet is resolved at read
  // time from this id -- nothing about the original is duplicated here.
  replyToMessageId: integer("reply_to_message_id"),
  createdAt: integer("created_at").notNull(),
  // Soft delete (admin-only). Kept as a row (not removed) so thread flow,
  // reactions, flags, and admin to-dos linked to this messageId stay valid.
  // Body/attachment are blanked out at the API layer whenever this is set.
  deletedAt: integer("deleted_at"),
  deletedByName: text("deleted_by_name"),
  // Set when an admin edits the body of their own message (see PATCH route).
  // Shown as a small "(edited)" indicator to every viewer; previous body is
  // not retained.
  editedAt: integer("edited_at"),
});
export const insertChatMessageSchema = createInsertSchema(chatMessages).omit({ id: true, createdAt: true, deletedAt: true, deletedByName: true, editedAt: true });
export type InsertChatMessage = z.infer<typeof insertChatMessageSchema>;
export type ChatMessage = typeof chatMessages.$inferSelect;

// ---------- CHAT MESSAGE FLAGS (per-user "star for later") ----------
export const chatMessageFlags = sqliteTable("chat_message_flags", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  messageId: integer("message_id").notNull(),
  userId: integer("user_id").notNull(),
  createdAt: integer("created_at").notNull(),
});
export type ChatMessageFlag = typeof chatMessageFlags.$inferSelect;

// ---------- ADMIN TEAM CHAT (admin-to-admin, internal only) ----------
// Two surfaces, both scoped to role='admin' only -- never visible to
// partners/students: (1) a single shared "Staff Room" every admin sees the
// same feed of, no membership list needed since it's implicitly "all
// admins"; (2) private 1:1 DMs between two specific admins. Deliberately NOT
// built on chatThreads/chatMessages -- that model assumes exactly one
// non-admin "owner" plus the admin team as a single collective side, which
// doesn't fit peer-to-peer admin messaging (a DM must be visible ONLY to its
// two participants, not the whole admin team). Kept as small, separate
// tables instead of overloading an unrelated shape.
export const staffRoomMessages = sqliteTable("staff_room_messages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  senderId: integer("sender_id").notNull(),
  senderName: text("sender_name").notNull(),
  body: text("body").notNull(),
  attachmentUrl: text("attachment_url"),
  attachmentType: text("attachment_type"),
  attachmentName: text("attachment_name"),
  replyToMessageId: integer("reply_to_message_id"),
  createdAt: integer("created_at").notNull(),
  deletedAt: integer("deleted_at"),
  deletedByName: text("deleted_by_name"),
  editedAt: integer("edited_at"),
});
export const insertStaffRoomMessageSchema = createInsertSchema(staffRoomMessages).omit({
  id: true, createdAt: true, deletedAt: true, deletedByName: true, editedAt: true,
});
export type InsertStaffRoomMessage = z.infer<typeof insertStaffRoomMessageSchema>;
export type StaffRoomMessage = typeof staffRoomMessages.$inferSelect;

// One row per admin: when they last opened the Staff Room, so unread state
// can be computed as "any message newer than my lastReadAt" without a
// per-message read-receipt table (WhatsApp-style bulk read, same pattern as
// communityMessageReads but collapsed to one row per admin since there's
// only ever one room).
export const staffRoomReads = sqliteTable("staff_room_reads", {
  adminId: integer("admin_id").primaryKey(),
  lastReadAt: integer("last_read_at").notNull(),
});
export type StaffRoomRead = typeof staffRoomReads.$inferSelect;

// One thread per unordered pair of admins. `pairKey` is the two admin ids
// sorted ascending and joined ("12-89"), giving a single-column UNIQUE
// constraint that auto-migrate already knows how to build -- avoids needing
// a composite-unique-index feature the migration helper doesn't support.
// adminAId is always the smaller id, adminBId the larger, so lookups don't
// need to try both orderings.
export const staffDmThreads = sqliteTable("staff_dm_threads", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  adminAId: integer("admin_a_id").notNull(),
  adminBId: integer("admin_b_id").notNull(),
  pairKey: text("pair_key").notNull().unique(),
  createdAt: integer("created_at").notNull(),
  adminALastReadAt: integer("admin_a_last_read_at"),
  adminBLastReadAt: integer("admin_b_last_read_at"),
});
export type StaffDmThread = typeof staffDmThreads.$inferSelect;

export const staffDmMessages = sqliteTable("staff_dm_messages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  threadId: integer("thread_id").notNull(),
  senderId: integer("sender_id").notNull(),
  senderName: text("sender_name").notNull(),
  body: text("body").notNull(),
  attachmentUrl: text("attachment_url"),
  attachmentType: text("attachment_type"),
  attachmentName: text("attachment_name"),
  replyToMessageId: integer("reply_to_message_id"),
  createdAt: integer("created_at").notNull(),
  deletedAt: integer("deleted_at"),
  deletedByName: text("deleted_by_name"),
  editedAt: integer("edited_at"),
});
export const insertStaffDmMessageSchema = createInsertSchema(staffDmMessages).omit({
  id: true, createdAt: true, deletedAt: true, deletedByName: true, editedAt: true,
});
export type InsertStaffDmMessage = z.infer<typeof insertStaffDmMessageSchema>;
export type StaffDmMessage = typeof staffDmMessages.$inferSelect;

export const postStaffChatMessageSchema = z.object({
  body: z.string().max(5000).optional().default(""),
  attachmentUrl: z.string().optional().nullable(),
  attachmentType: z.string().optional().nullable(),
  attachmentName: z.string().optional().nullable(),
  replyToMessageId: z.number().int().positive().optional().nullable(),
});
export type PostStaffChatMessageInput = z.infer<typeof postStaffChatMessageSchema>;

// ---------- ADMIN TO-DOS (message-linked handoff between admins) ----------
// One admin marks a specific chat message and hands an action item to another
// admin, with a short note describing what they'd like done. Separate from
// chatMessageFlags (a personal "star for later") -- this is an explicit,
// assigned task that also triggers an email to the assignee.
export const adminTodos = sqliteTable("admin_todos", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  messageId: integer("message_id").notNull(),
  threadId: integer("thread_id").notNull(),
  createdByAdminId: integer("created_by_admin_id").notNull(),
  assignedToAdminId: integer("assigned_to_admin_id").notNull(),
  note: text("note").notNull(),
  status: text("status").notNull().default("open"), // open | done
  createdAt: integer("created_at").notNull(),
  completedAt: integer("completed_at"),
});
export const insertAdminTodoSchema = createInsertSchema(adminTodos).omit({
  id: true, status: true, createdAt: true, completedAt: true,
});
export type InsertAdminTodo = z.infer<typeof insertAdminTodoSchema>;
export type AdminTodo = typeof adminTodos.$inferSelect;

// ---------- CHAT MESSAGE REACTIONS (one emoji per user per message, WhatsApp-style) ----------
export const chatMessageReactions = sqliteTable("chat_message_reactions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  messageId: integer("message_id").notNull(),
  userId: integer("user_id").notNull(),
  userName: text("user_name").notNull(),
  emoji: text("emoji").notNull(),
  createdAt: integer("created_at").notNull(),
});
export type ChatMessageReaction = typeof chatMessageReactions.$inferSelect;

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

// ---------- APP SETTINGS (simple key/value flags) ----------
// Minimal global switches, e.g. the Community Chat kill switch. Kept
// separate from any one table since it's not tied to a specific record.
export const appSettings = sqliteTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});
export type AppSetting = typeof appSettings.$inferSelect;
export const COMMUNITY_ENABLED_KEY = "community_enabled";
// Holds the id of the auto-created "Introductions" topic that welcome-intro
// videos are posted into (see WELCOME_INTRO_MAX_REMINDERS below). Stored as
// a setting rather than hardcoded so it survives the topic being renamed and
// is only ever created once, lazily, on the first welcome-intro post.
export const WELCOME_INTRO_TOPIC_ID_KEY = "welcome_intro_topic_id";
// "Remind every 5th Community entry, 3 reminders total, then leave a
// persistent manual entry point." Fully skippable -- these two constants are
// the only thing that gate the pop-up; the manual entry point never expires.
export const WELCOME_INTRO_REMIND_EVERY_N_VISITS = 5;
export const WELCOME_INTRO_MAX_REMINDERS = 3;

// ---------- COMMUNITY CHAT (Partner Community, admin-toggleable) ----------
// Topic-based, forum-like discussion open to partners, students, and admins.
// Deliberately NOT a single scrolling feed -- every discussion lives in its
// own named topic so conversations stay organized (the whole point vs. a
// WhatsApp group). No private messaging exists anywhere in this feature.
// Gated behind appSettings[COMMUNITY_ENABLED_KEY] so it can be switched off
// instantly, without losing any data, if not approved or needs changes.
export const communityTopics = sqliteTable("community_topics", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  createdByUserId: integer("created_by_user_id").notNull(),
  createdByName: text("created_by_name").notNull(),
  createdByRole: text("created_by_role").notNull(), // 'partner' | 'student' | 'admin'
  // Bumped to the newest message's createdAt on every post, so the topic
  // list can sort by recent activity without a join.
  lastMessageAt: integer("last_message_at").notNull(),
  // Admin-only reversible hide, same pattern as chatThreads.archivedAt.
  archivedAt: integer("archived_at"),
  // Admin-only pin -- pinned topics sort first in every topic list
  // (partner-facing Community and the admin console alike). Nullable
  // timestamp rather than a boolean so multiple pins can be ordered by
  // most-recently-pinned if that's ever needed.
  pinnedAt: integer("pinned_at"),
  createdAt: integer("created_at").notNull(),
});
export const insertCommunityTopicSchema = createInsertSchema(communityTopics).omit({
  id: true, lastMessageAt: true, archivedAt: true, pinnedAt: true, createdAt: true,
});
export type InsertCommunityTopic = z.infer<typeof insertCommunityTopicSchema>;
export type CommunityTopic = typeof communityTopics.$inferSelect;

// Payload for creating a topic: a title plus its first message in one call.
export const createCommunityTopicSchema = z.object({
  title: z.string().min(1, "Give the topic a title").max(140, "Keep the title under 140 characters"),
  body: z.string().max(5000).optional().default(""),
  attachmentUrl: z.string().optional().nullable(),
  attachmentType: z.string().optional().nullable(),
  attachmentName: z.string().optional().nullable(),
});
export type CreateCommunityTopicInput = z.infer<typeof createCommunityTopicSchema>;

// ---------- COMMUNITY MESSAGES ----------
export const communityMessages = sqliteTable("community_messages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  topicId: integer("topic_id").notNull(),
  senderId: integer("sender_id").notNull(),
  senderRole: text("sender_role").notNull(), // 'partner' | 'student' | 'admin'
  senderName: text("sender_name").notNull(),
  body: text("body").notNull(),
  attachmentUrl: text("attachment_url"),
  attachmentType: text("attachment_type"),
  attachmentName: text("attachment_name"),
  // Swipe-to-reply, same contract as chatMessages.replyToMessageId.
  replyToMessageId: integer("reply_to_message_id"),
  createdAt: integer("created_at").notNull(),
  // Admin-only soft delete, same pattern as chatMessages.
  deletedAt: integer("deleted_at"),
  deletedByName: text("deleted_by_name"),
  editedAt: integer("edited_at"),
});
export const insertCommunityMessageSchema = createInsertSchema(communityMessages).omit({
  id: true, createdAt: true, deletedAt: true, deletedByName: true, editedAt: true,
});
export type InsertCommunityMessage = z.infer<typeof insertCommunityMessageSchema>;
export type CommunityMessage = typeof communityMessages.$inferSelect;

export const postCommunityMessageSchema = z.object({
  body: z.string().max(5000).optional().default(""),
  attachmentUrl: z.string().optional().nullable(),
  attachmentType: z.string().optional().nullable(),
  attachmentName: z.string().optional().nullable(),
  replyToMessageId: z.number().int().positive().optional().nullable(),
});
export type PostCommunityMessageInput = z.infer<typeof postCommunityMessageSchema>;

// ---------- COMMUNITY MESSAGE READS ----------
// WhatsApp-style bulk read receipts: opening a topic marks every currently
// unread message as read for that user in a single batch stamped with one
// "opened at" time -- not per-message scroll tracking. One row per
// (messageId, userId). Surfaced ONLY to admins (who viewed a message and
// when); regular members never see anyone else's read state.
export const communityMessageReads = sqliteTable("community_message_reads", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  messageId: integer("message_id").notNull(),
  userId: integer("user_id").notNull(),
  userName: text("user_name").notNull(),
  readAt: integer("read_at").notNull(),
});
export type CommunityMessageRead = typeof communityMessageReads.$inferSelect;

// ---------- MAHA STANDING (internal engagement scoring, admin-only) ----------
// Recognizes and rewards genuine app activity -- referrals, purchases,
// education, community participation. Two hard rules drive the design:
//   1. Members only ever see their tier name (e.g. "Connector") and a vague
//      progress indicator -- never the raw point total, never a breakdown
//      of what earns points. This is internal-only, for admin visibility.
//   2. Patient-referral activity is logged under the generic "app_activity"
//      category with NO link back to a specific referral record (sourceId
//      stays null) and NO bonus tied to referral outcome/completion. This
//      keeps the ledger from ever attributing a reward to a specific
//      patient referral -- avoiding anything that could look like a
//      referral commission/kickback for a healthcare professional.
export const STANDING_CATEGORIES = ["app_activity", "shop", "education", "learning", "community"] as const;
export type StandingCategory = (typeof STANDING_CATEGORIES)[number];

export const standingEntries = sqliteTable("standing_entries", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull(),
  category: text("category").notNull(), // one of STANDING_CATEGORIES
  points: integer("points").notNull(),
  // Never populated for category='app_activity' (referral-driven) entries --
  // see note above. Used for shop/education/learning/community entries only,
  // so an admin debugging "why did this user get points on this date" can
  // trace it back to the order/submission/post that earned them.
  sourceType: text("source_type"),
  sourceId: integer("source_id"),
  createdAt: integer("created_at").notNull(),
});
export type StandingEntry = typeof standingEntries.$inferSelect;

// Cumulative lifetime points (never decays). Reward is what's granted the
// moment a member crosses into that tier -- fulfilled by an admin via the
// standingRewards queue below, not automated at checkout (no discount/coupon
// infrastructure exists yet).
export const STANDING_TIERS = [
  { key: "newcomer", label: "Newcomer", minPoints: 0, reward: null as string | null },
  { key: "active_member", label: "Active Member", minPoints: 100, reward: "5% shop discount code" },
  { key: "connector", label: "Connector", minPoints: 350, reward: "10% shop discount code" },
  { key: "mentor", label: "Mentor", minPoints: 800, reward: "\u20ac25 shop credit" },
  { key: "maha_fellow", label: "MAHA Fellow", minPoints: 1500, reward: "Personal outreach from MAHA -- no automated reward" },
] as const;
export type StandingTierKey = (typeof STANDING_TIERS)[number]["key"];

export function standingTierForPoints(points: number): (typeof STANDING_TIERS)[number] {
  let current: (typeof STANDING_TIERS)[number] = STANDING_TIERS[0];
  for (const tier of STANDING_TIERS) {
    if (points >= tier.minPoints) current = tier;
  }
  return current;
}

// One-time-per-activity point values. Referral points are intentionally the
// same order of magnitude as other high-effort activities, not a multiple
// of them -- see the category note above for why no outcome-based bonus
// exists.
export const STANDING_POINTS: Record<string, number> = {
  referral_submitted: 50, // category: app_activity, no sourceId
  order_confirmed_per_5_eur: 1, // category: shop, sourceId = order id
  student_approved: 100, // category: education, sourceId = user id
  institute_application_submitted: 30, // category: education, sourceId = application id
  homework_submitted: 20, // category: education, sourceId = submission id
  video_completed: 5, // category: learning, sourceId = video id, capped 3/day
  community_message_posted: 2, // category: community, sourceId = message id, capped 5/day
  community_topic_created: 10, // category: community, sourceId = topic id
  community_welcome_posted: 20, // category: community, one-time
};

// Pending reward fulfillment queue (Phase 1: manual). An admin marks a
// reward fulfilled once the discount code/credit has actually been issued
// by hand -- see fulfillmentNote for what was sent.
export const standingRewards = sqliteTable("standing_rewards", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull(),
  // Set when the triggering user is pooled into a clinic -- the tier-up
  // that caused this reward was the CLINIC's aggregate crossing a
  // threshold, so admins should read this as "reach out to this clinic",
  // with userId kept only for traceability of which member's action
  // triggered it. Null for unpooled (solo) users -- unchanged behavior.
  clinicId: integer("clinic_id"),
  tierKey: text("tier_key").notNull(),
  rewardDescription: text("reward_description").notNull(),
  status: text("status").notNull().default("pending"), // 'pending' | 'fulfilled'
  createdAt: integer("created_at").notNull(),
  fulfilledAt: integer("fulfilled_at"),
  fulfilledByName: text("fulfilled_by_name"),
  fulfillmentNote: text("fulfillment_note"),
});
export type StandingReward = typeof standingRewards.$inferSelect;
