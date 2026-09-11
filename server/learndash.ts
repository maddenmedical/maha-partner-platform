// Integration with LearnDash running on partner.maha.clinic (WordPress + LearnDash + WooCommerce).
// This lets a course purchase/enroll/grant inside the Partner Plattform automatically
// enroll the same person on the LearnDash site, so lesson progress/tracking lives
// there. Every function here is best-effort: if LearnDash isn't configured, or the
// WordPress site is briefly unreachable, callers must not let that block the
// Portal's own purchase/enroll flow (see syncLearnDashEnrollment below).

function getBaseUrl(): string | null {
  const url = process.env.LEARNDASH_WP_URL;
  return url ? url.replace(/\/$/, "") : null;
}

export function isLearnDashConfigured(): boolean {
  return !!(process.env.LEARNDASH_WP_URL && process.env.LEARNDASH_WP_USERNAME && process.env.LEARNDASH_WP_APP_PASSWORD);
}

function authHeader(): string {
  const username = process.env.LEARNDASH_WP_USERNAME || "";
  const password = process.env.LEARNDASH_WP_APP_PASSWORD || "";
  return "Basic " + Buffer.from(`${username}:${password}`).toString("base64");
}

async function wpFetch(path: string, init?: RequestInit): Promise<Response> {
  const base = getBaseUrl();
  if (!base) throw new Error("LearnDash is not configured");
  return fetch(`${base}${path}`, {
    ...init,
    headers: {
      Authorization: authHeader(),
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
}

export type LearnDashCourseSummary = { id: number; title: string; link: string };

// Lists LearnDash courses for the admin "link this course" dropdown.
export async function fetchLearnDashCourses(): Promise<LearnDashCourseSummary[]> {
  const res = await wpFetch("/wp-json/ldlms/v2/sfwd-courses?per_page=100");
  if (!res.ok) throw new Error(`LearnDash course list failed: ${res.status}`);
  const rows = (await res.json()) as Array<{ id: number; title?: { rendered?: string }; link?: string }>;
  return rows.map((r) => ({
    id: r.id,
    title: r.title?.rendered || `Course ${r.id}`,
    link: r.link || "",
  }));
}

// Finds a WordPress user by exact email match, or creates a new subscriber
// account for them (no login flow needed on our side — this account exists
// purely so LearnDash has someone to attach progress/enrollment to).
async function findOrCreateWpUser(email: string, name: string): Promise<number> {
  const searchRes = await wpFetch(`/wp-json/wp/v2/users?search=${encodeURIComponent(email)}&context=edit`);
  if (!searchRes.ok) throw new Error(`WP user search failed: ${searchRes.status}`);
  const matches = (await searchRes.json()) as Array<{ id: number; email?: string }>;
  const exact = matches.find((m) => (m.email || "").toLowerCase() === email.toLowerCase());
  if (exact) return exact.id;

  // No existing WP account for this email — create one so LearnDash can track them.
  const usernameBase = email.split("@")[0].replace(/[^a-zA-Z0-9._-]/g, "").toLowerCase() || "partner";
  const username = `${usernameBase}-${Math.random().toString(36).slice(2, 7)}`;
  const randomPassword = Math.random().toString(36).slice(2, 12) + Math.random().toString(36).slice(2, 12).toUpperCase() + "!9";
  const createRes = await wpFetch("/wp-json/wp/v2/users", {
    method: "POST",
    body: JSON.stringify({
      username,
      email,
      name: name || username,
      password: randomPassword,
      roles: ["subscriber"],
    }),
  });
  if (!createRes.ok) {
    const body = await createRes.text().catch(() => "");
    throw new Error(`WP user create failed: ${createRes.status} ${body}`);
  }
  const created = (await createRes.json()) as { id: number };
  return created.id;
}

// Enrolls the given WordPress user in the given LearnDash course.
// Uses the documented ldlms/v1 "Update a Course User" endpoint
// (POST /ldlms/v1/sfwd-courses/{course_id}/users {user_ids:[...]}).
// The v2 users/{id}/courses/{course} path looks symmetric with the read
// endpoint but is not a valid write target on this WordPress install — it
// returned 403 learndash_rest_user_not_enrolled instead of enrolling.
async function enrollWpUserInCourse(wpUserId: number, learndashCourseId: number): Promise<void> {
  const res = await wpFetch(`/wp-json/ldlms/v1/sfwd-courses/${learndashCourseId}/users`, {
    method: "POST",
    body: JSON.stringify({ user_ids: [wpUserId] }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`LearnDash enroll failed: ${res.status} ${body}`);
  }
}

// Best-effort entry point called from the purchase / free-enroll / manual-grant
// routes. Never throws — logs and returns a result the caller can optionally
// surface, but a LearnDash outage must never block a partner's own purchase.
export async function syncLearnDashEnrollment(
  partner: { email: string; name: string },
  learndashCourseId: number | null | undefined,
): Promise<{ ok: boolean; reason?: string }> {
  if (!learndashCourseId) return { ok: false, reason: "not_linked" };
  if (!isLearnDashConfigured()) return { ok: false, reason: "not_configured" };
  try {
    const wpUserId = await findOrCreateWpUser(partner.email, partner.name);
    await enrollWpUserInCourse(wpUserId, learndashCourseId);
    return { ok: true };
  } catch (err) {
    console.error("[learndash] enrollment sync failed:", err);
    return { ok: false, reason: "error" };
  }
}
