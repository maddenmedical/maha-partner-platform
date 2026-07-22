import { test, expect, request as pwRequest, Page } from "@playwright/test";

const ADMIN = { email: "elisabeth.madden.medical@gmail.com", password: "MahaAdmin2026!" };
const STUDENT = { email: "student.demo@maha.clinic", password: "StudentDemo2026!" };
const PARTNER = { email: "partner.demo@maha.clinic", password: "PartnerDemo2026!" };

async function apiLogin(baseURL: string, creds: { email: string; password: string }) {
  const ctx = await pwRequest.newContext({ baseURL });
  const res = await ctx.post("/api/auth/login", { data: creds });
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  await ctx.dispose();
  return body.token as string;
}

// Log in through the real UI so the in-memory auth token is set in the app.
async function uiLogin(page: Page, creds: { email: string; password: string }) {
  await page.goto("/login");
  await page.getByTestId("input-email").fill(creds.email);
  await page.getByTestId("input-password").fill(creds.password);
  await page.getByTestId("button-submit-login").click();
  await page.waitForURL(/\/admin|\/app|\/$/, { timeout: 15_000 });
}

test.describe("Authenticated Drive file proxy — authorization", () => {
  test("enforces per-file access rules (401/403/owner/admin/404)", async ({ baseURL }) => {
    const base = baseURL!;
    const adminTok = await apiLogin(base, ADMIN);
    const studentTok = await apiLogin(base, STUDENT);
    const partnerTok = await apiLogin(base, PARTNER);

    // Identify the demo student id.
    const ctx = await pwRequest.newContext({ baseURL: base });
    const meRes = await ctx.get("/api/auth/me", { headers: { Authorization: `Bearer ${studentTok}` } });
    const studentId = (await meRes.json()).id as number;

    // Seed a homework file record owned by the demo student via the running server's DB
    // is not directly possible from here, so we exercise the proxy against a record
    // created through the normal path is blocked (see report). Instead we verify the
    // access-control decision boundary using a known-seeded record id passed in env.
    const driveFileId = process.env.TEST_DRIVE_FILE_ID;
    test.skip(!driveFileId, "TEST_DRIVE_FILE_ID not provided");

    const noTok = await ctx.get(`/api/files/${driveFileId}`);
    expect(noTok.status()).toBe(401);

    const otherUser = await ctx.get(`/api/files/${driveFileId}`, { headers: { Authorization: `Bearer ${partnerTok}` } });
    expect(otherUser.status()).toBe(403);

    // Owner + admin pass the authorization check (status is not 401/403).
    const owner = await ctx.get(`/api/files/${driveFileId}`, { headers: { Authorization: `Bearer ${studentTok}` } });
    expect([200, 502]).toContain(owner.status());

    const admin = await ctx.get(`/api/files/${driveFileId}`, { headers: { Authorization: `Bearer ${adminTok}` } });
    expect([200, 502]).toContain(admin.status());

    const missing = await ctx.get(`/api/files/DOES_NOT_EXIST_123`, { headers: { Authorization: `Bearer ${adminTok}` } });
    expect(missing.status()).toBe(404);

    expect(studentId).toBeGreaterThan(0);
    await ctx.dispose();
  });
});

test.describe("Admin file-review pages — light/dark + desktop/mobile regression", () => {
  const viewports = [
    { name: "desktop", width: 1280, height: 900 },
    { name: "mobile", width: 390, height: 844 },
  ];
  const routes = [
    { path: "/admin/approvals", ready: "card-pending-user-" },
    { path: "/admin/institute", ready: "tab-homework" },
  ];

  for (const vp of viewports) {
    for (const theme of ["light", "dark"] as const) {
      test(`renders ${vp.name} / ${theme} with no horizontal overflow`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await uiLogin(page, ADMIN);

        if (theme === "dark") {
          await page.evaluate(() => document.documentElement.classList.add("dark"));
        }

        for (const r of routes) {
          await page.goto(r.path);
          await page.waitForLoadState("networkidle");
          // Guard against layout regressions: no horizontal scroll.
          const overflow = await page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
          );
          expect(overflow, `horizontal overflow on ${r.path}`).toBeLessThanOrEqual(2);
        }
      });
    }
  }
});
