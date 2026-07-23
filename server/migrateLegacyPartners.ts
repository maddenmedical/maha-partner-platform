// One-time (but safely re-runnable) import of existing partner.maha.clinic
// WordPress/WooCommerce/LearnDash accounts into this app's local database.
//
// What it does, silently (no emails, no push notifications, no admin-review
// queue entries):
//   1. Pulls every WP user with role subscriber/customer (i.e. every existing
//      partner-registration account, excluding administrators).
//   2. Enriches each with WooCommerce customer meta (billing address, VAT,
//      qualification, business name, country) where available.
//   3. Creates a local `users` row per account: role="partner",
//      status="approved" (pre-vetted, bypasses the pending-approval queue),
//      a freshly generated random password (hashed for login; the plaintext
//      is stored in migratedPasswordPlain purely so an admin can retrieve and
//      hand it out later — see /api/admin/migrated-users).
//   4. Mirrors LearnDash course access: for the 3 courses in our catalog that
//      are linked to a LearnDash course id (learndashCourseId), any WP user
//      enrolled in the matching LearnDash course gets a courseAccessGrant —
//      i.e. instant free access reflecting what they already had.
//   5. Mirrors WooCommerce order history into `legacyOrders` (read-only
//      reference records, not live orders).
//
// Idempotent: matches existing local accounts by wpUserId (and falls back to
// email) so re-running this script only fills in gaps / never duplicates.
//
// Callable both from the CLI script (server/scripts/importLegacyPartners.ts)
// and from the admin-only POST /api/admin/migrate-legacy-partners route, so
// it can be run once against the live production database without shell
// access to that sandbox.
import bcrypt from "bcryptjs";
import { storage } from "./storage";
import { db } from "./storage";
import { courses as coursesTable } from "@shared/schema";

export type LegacyImportSummary = {
  wpUsersTotal: number;
  partnerUsersTotal: number;
  usersCreated: number;
  usersAlreadyPresent: number;
  courseGrantsCreated: number;
  legacyOrdersImported: number;
  newlyCreatedEmails: string[];
};

function getBaseUrl(): string {
  const url = process.env.LEARNDASH_WP_URL;
  if (!url) throw new Error("LEARNDASH_WP_URL is not configured");
  return url.replace(/\/$/, "");
}

function authHeader(): string {
  const username = process.env.LEARNDASH_WP_USERNAME || "";
  const password = process.env.LEARNDASH_WP_APP_PASSWORD || "";
  return "Basic " + Buffer.from(`${username}:${password}`).toString("base64");
}

async function wpFetch(path: string): Promise<any> {
  const res = await fetch(`${getBaseUrl()}${path}`, {
    headers: { Authorization: authHeader(), "Content-Type": "application/json" },
  });
  if (!res.ok) {
    throw new Error(`WP request failed: ${path} -> ${res.status} ${await res.text().catch(() => "")}`);
  }
  return res.json();
}

type WpUser = {
  id: number;
  username: string;
  name: string;
  first_name: string;
  last_name: string;
  email: string;
  roles: string[];
  registered_date: string;
};

// Known dynamic "User Registration" plugin meta keys on partner.maha.clinic —
// discovered by inspecting several real customer records. Stable across users.
const META_KEYS = {
  prefix: "user_registration_input_box_1757500950",
  phone: "user_registration_input_box_1757500993",
  vatNumber: "user_registration_input_box_1757501038",
  city: "user_registration_input_box_1757501073",
  suffix: "user_registration_input_box_1757500963514",
  businessName: "user_registration_input_box_1757501026",
  address: "user_registration_input_box_1757501056",
  country: "user_registration_country_1757501096",
  profession: "user_qualification",
};

function parseCountry(raw: string | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed);
      return parsed.country || null;
    } catch {
      return null;
    }
  }
  return trimmed;
}

function randomPassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
  let out = "";
  for (let i = 0; i < 14; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function uniqueUsername(base: string, taken: Set<string>): string {
  let candidate = base || "partner";
  let i = 1;
  while (taken.has(candidate.toLowerCase())) {
    candidate = `${base}${i}`;
    i++;
  }
  taken.add(candidate.toLowerCase());
  return candidate;
}

export async function runLegacyPartnerImport(): Promise<LegacyImportSummary> {
  console.log("=== Legacy partner import (partner.maha.clinic -> Partner Portal) ===\n");

  console.log("Fetching WordPress users...");
  const wpUsers: WpUser[] = await wpFetch("/wp-json/wp/v2/users?per_page=100&context=edit");
  const partnerUsers = wpUsers.filter((u) => !u.roles.includes("administrator"));
  console.log(`Found ${wpUsers.length} WP users total, ${partnerUsers.length} non-admin (partner) accounts.\n`);

  // Track usernames/emails already used locally so we don't collide.
  const existingEmails = new Set<string>();
  const existingUsernames = new Set<string>();
  {
    // crude full scan is fine at this scale (a few dozen rows)
    const anyStorage = storage as any;
    const rows = await db.select().from((await import("@shared/schema")).users).all();
    for (const r of rows) {
      existingEmails.add(r.email.toLowerCase());
      if (r.username) existingUsernames.add(r.username.toLowerCase());
    }
  }

  const wpIdToLocalUserId = new Map<number, number>();
  let created = 0;
  let skippedExisting = 0;
  const newlyCreatedCreds: { email: string; name: string; password: string }[] = [];

  for (const wu of partnerUsers) {
    // Idempotency: already migrated by wpUserId, or a real account already
    // exists locally with this email (don't clobber demo/admin/test accounts).
    const byWpId = await storage.getUserByWpUserId(wu.id);
    if (byWpId) {
      wpIdToLocalUserId.set(wu.id, byWpId.id);
      skippedExisting++;
      continue;
    }
    if (existingEmails.has(wu.email.toLowerCase())) {
      const existing = await storage.getUserByEmail(wu.email);
      if (existing) wpIdToLocalUserId.set(wu.id, existing.id);
      skippedExisting++;
      continue;
    }

    // Best-effort WooCommerce customer enrichment — never fatal.
    let meta: Record<string, string> = {};
    try {
      const customer = await wpFetch(`/wp-json/wc/v3/customers/${wu.id}`);
      for (const m of customer.meta_data || []) {
        if (typeof m.value === "string") meta[m.key] = m.value;
      }
    } catch {
      // no WooCommerce customer record for this user — fine, proceed with WP fields only
    }

    const firstName = wu.first_name || wu.name || wu.username;
    const lastName = wu.last_name || "";
    const fullName = [firstName, lastName].filter(Boolean).join(" ") || wu.username;
    const username = uniqueUsername(wu.username || wu.email.split("@")[0], existingUsernames);
    const plainPassword = randomPassword();
    const passwordHash = await bcrypt.hash(plainPassword, 10);
    const registeredAtMs = wu.registered_date ? new Date(wu.registered_date).getTime() : Date.now();

    const user = await storage.createUser({
      role: "partner",
      name: fullName,
      email: wu.email,
      passwordHash,
      status: "approved",
      phone: meta[META_KEYS.phone] || null,
      businessName: meta[META_KEYS.businessName] || null,
      vatNumber: meta[META_KEYS.vatNumber] || null,
      profession: meta[META_KEYS.profession] || null,
      homepageUrl: null,
      degreeFileUrl: null,
      firstName,
      lastName,
      prefix: meta[META_KEYS.prefix] || null,
      suffix: meta[META_KEYS.suffix] || null,
      username,
      city: meta[META_KEYS.city] || null,
      address: meta[META_KEYS.address] || null,
      country: parseCountry(meta[META_KEYS.country]),
      additionalInfo: "Migrated from the existing partner.maha.clinic account. Not yet contacted — credentials pending handout.",
      wpUserId: wu.id,
      migratedFromWp: true,
      migratedPasswordPlain: plainPassword,
      credentialsIssuedAt: null,
    } as any);
    // createUser sets createdAt=Date.now() internally; backfill with the real
    // WP registration date so ordering/history reflects reality.
    await db.update((await import("@shared/schema")).users)
      .set({ createdAt: registeredAtMs })
      .where((await import("drizzle-orm")).eq((await import("@shared/schema")).users.id, user.id))
      .run();

    wpIdToLocalUserId.set(wu.id, user.id);
    existingEmails.add(wu.email.toLowerCase());
    created++;
    newlyCreatedCreds.push({ email: wu.email, name: fullName, password: plainPassword });
    console.log(`  + created local user #${user.id} for WP #${wu.id} (${wu.email})`);
  }

  console.log(`\nUsers: ${created} created, ${skippedExisting} already present.\n`);

  // ---- LearnDash course-access mirroring ----
  console.log("Mirroring LearnDash course access...");
  const ourCourses = await db.select().from(coursesTable).all();
  const coursesByLdId = new Map<number, { id: number; name: string }>();
  for (const c of ourCourses) {
    if (c.learndashCourseId) coursesByLdId.set(c.learndashCourseId, { id: c.id, name: c.name });
  }

  let grantsCreated = 0;
  for (const [ldCourseId, localCourse] of Array.from(coursesByLdId.entries())) {
    let enrolledWpUsers: { id: number }[] = [];
    try {
      enrolledWpUsers = await wpFetch(`/wp-json/ldlms/v2/sfwd-courses/${ldCourseId}/users?per_page=100`);
    } catch (e) {
      console.log(`  ! could not fetch enrollment for LD course ${ldCourseId}: ${(e as Error).message}`);
      continue;
    }
    for (const eu of enrolledWpUsers) {
      const localUserId = wpIdToLocalUserId.get(eu.id);
      if (!localUserId) continue; // admin accounts, or not a migrated partner
      const existingGrant = await storage.getGrant(localCourse.id, localUserId);
      if (existingGrant) continue;
      await storage.createGrant({ courseId: localCourse.id, partnerId: localUserId });
      grantsCreated++;
    }
    console.log(`  course "${localCourse.name}" (LD #${ldCourseId}): ${enrolledWpUsers.length} WP enrollees checked`);
  }
  console.log(`Course access grants created: ${grantsCreated}\n`);

  // ---- WooCommerce order history mirroring (read-only reference) ----
  console.log("Mirroring WooCommerce order history...");
  let ordersImported = 0;
  try {
    const wcOrders: any[] = await wpFetch("/wp-json/wc/v3/orders?status=any&per_page=100");
    for (const o of wcOrders) {
      const localUserId = wpIdToLocalUserId.get(o.customer_id);
      if (!localUserId) continue;
      const existing = await storage.getLegacyOrderByWpOrderId(o.id);
      if (existing) continue;
      const items = (o.line_items || []).map((li: any) => ({
        name: li.name,
        quantity: li.quantity,
        total: li.total,
        sku: li.sku || null,
      }));
      const totalCents = Math.round(parseFloat(o.total || "0") * 100);
      await storage.createLegacyOrder({
        userId: localUserId,
        wpOrderId: o.id,
        orderNumber: String(o.number || o.id),
        status: o.status,
        currency: (o.currency || "EUR").toLowerCase(),
        totalCents,
        itemsJson: JSON.stringify(items),
        wpCreatedAt: o.date_created ? new Date(o.date_created).getTime() : Date.now(),
        createdAt: Date.now(),
      });
      ordersImported++;
    }
  } catch (e) {
    console.log(`  ! could not fetch WooCommerce orders: ${(e as Error).message}`);
  }
  console.log(`Legacy orders imported: ${ordersImported}\n`);

  console.log("=== Done. No emails or notifications were sent. ===");
  if (newlyCreatedCreds.length) {
    console.log(`\n${newlyCreatedCreds.length} new accounts created this run. Retrieve credentials any time via`);
    console.log("the admin \"Migrated Partners\" view, or GET /api/admin/migrated-users.");
  }

  return {
    wpUsersTotal: wpUsers.length,
    partnerUsersTotal: partnerUsers.length,
    usersCreated: created,
    usersAlreadyPresent: skippedExisting,
    courseGrantsCreated: grantsCreated,
    legacyOrdersImported: ordersImported,
    newlyCreatedEmails: newlyCreatedCreds.map((c) => c.email),
  };
}
