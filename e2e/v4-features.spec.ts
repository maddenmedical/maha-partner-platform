import { test, expect, request as pwRequest, Page } from "@playwright/test";

const ADMIN = { email: "elisabeth.madden.medical@gmail.com", password: "MahaAdmin2026!" };
const PARTNER = { email: "partner.demo@maha.clinic", password: "PartnerDemo2026!" };
const STUDENT = { email: "student.demo@maha.clinic", password: "StudentDemo2026!" };

async function apiLogin(baseURL: string, creds: { email: string; password: string }) {
  const ctx = await pwRequest.newContext({ baseURL });
  const res = await ctx.post("/api/auth/login", { data: creds });
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  await ctx.dispose();
  return body.token as string;
}

async function uiLogin(page: Page, creds: { email: string; password: string }) {
  await page.goto("/");
  await page.getByTestId("input-email").fill(creds.email);
  await page.getByTestId("input-password").fill(creds.password);
  await page.getByTestId("button-submit-login").click();
  await page.waitForURL(/#\/(admin.*)?$/, { timeout: 15_000 });
}

// ---------------------------------------------------------------------------
// Part 1 — Login branding + photo crop
// ---------------------------------------------------------------------------
test.describe("Login page — branding + hero photo", () => {
  for (const vp of [
    { name: "desktop", width: 1280, height: 900 },
    { name: "mobile", width: 375, height: 812 },
  ]) {
    test(`renders on ${vp.name} with Partner Plattform branding, no "Institute" tagline`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto("/");
      await expect(page.getByTestId("button-submit-login")).toBeVisible();
      await expect(page.getByText("Partner Plattform — sign in to your account")).toBeVisible();
      // "Institute" must not appear as a top-level tagline on login.
      const bodyText = await page.locator("body").innerText();
      expect(bodyText).not.toMatch(/Institute/);

      // Photo side-panel only renders from md up.
      if (vp.width >= 768) {
        const panel = page.getByTestId("panel-login-photo");
        await expect(panel).toBeVisible();
        const img = panel.locator("img");
        // Image loaded with real dimensions (not broken).
        const natural = await img.evaluate((el: HTMLImageElement) => el.naturalWidth);
        expect(natural).toBeGreaterThan(0);
      }
      // No horizontal overflow at either size.
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(2);
    });
  }
});

// ---------------------------------------------------------------------------
// Part 2 — Hero photo crops render without overflow (partner home + classes)
// ---------------------------------------------------------------------------
test.describe("Brand hero banners render", () => {
  test("partner home banner image loads", async ({ page }) => {
    await uiLogin(page, PARTNER);
    await page.goto("/#/");
    const banner = page.getByTestId("banner-partner-home-photo");
    await expect(banner).toBeVisible();
    const natural = await banner.locator("img").evaluate((el: HTMLImageElement) => el.naturalWidth);
    expect(natural).toBeGreaterThan(0);
  });

  test("student classes banner image loads", async ({ page }) => {
    await uiLogin(page, STUDENT);
    await page.goto("/#/classes");
    const banner = page.getByTestId("banner-institute-photo");
    await expect(banner).toBeVisible();
    const natural = await banner.locator("img").evaluate((el: HTMLImageElement) => el.naturalWidth);
    expect(natural).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Part 3 + 4 — Shop product detail view + corrected tiered pricing
// ---------------------------------------------------------------------------
test.describe("Shop product detail + tiered pricing", () => {
  test("product detail sheet opens with description, package/use, and full tier table", async ({ page, baseURL }) => {
    // Find OMNI EM Ferment id via API.
    const ctx = await pwRequest.newContext({ baseURL: baseURL! });
    const products = await (await ctx.get("/api/products")).json();
    const omni = products.find((p: any) => p.name === "OMNI EM Ferment");
    expect(omni).toBeTruthy();
    await ctx.dispose();

    await uiLogin(page, PARTNER);
    await page.goto("/#/shop");
    await page.getByTestId(`button-product-detail-${omni.id}`).click();

    await expect(page.getByTestId("text-detail-name")).toHaveText("OMNI EM Ferment");
    await expect(page.getByTestId("text-detail-description")).toContainText("31 strains");
    await expect(page.getByTestId("text-detail-package-size")).toContainText("20ml");

    // Base row (1–4 units) shows the base unit price €39.27.
    await expect(page.getByTestId("row-detail-base-price")).toContainText("€39.27");
    // All four tiers rendered.
    const tierRows = page.locator('[data-testid^="row-detail-tier-"]');
    await expect(tierRows).toHaveCount(4);
    await expect(tierRows.filter({ hasText: "€31.42/u" })).toHaveCount(1);
    await expect(tierRows.filter({ hasText: "€27.49/u" })).toHaveCount(1);

    // Add to cart from within the detail view.
    await page.getByTestId("button-detail-add-to-cart").click();
    await expect(page.getByTestId("text-detail-qty")).toHaveText("1");
  });

  test("each product applies its own tier table via API", async ({ baseURL }) => {
    const ctx = await pwRequest.newContext({ baseURL: baseURL! });
    const products = await (await ctx.get("/api/products")).json();

    const expectations: Record<string, { base: number; tiers: number }> = {
      "OMNI EM Ferment": { base: 3927, tiers: 4 },
      "Entralisol": { base: 10959, tiers: 4 },
      "Detoxarcanum": { base: 5479, tiers: 4 },
      "Imunonovum": { base: 35616, tiers: 2 },
      "Liposomal Kurkumin & Resveratrol": { base: 6849, tiers: 3 },
      "MAHA 40": { base: 5388, tiers: 4 },
      "MAHA Mineral Care": { base: 1361, tiers: 2 },
      "Clarified Ghee": { base: 1130, tiers: 2 },
      "Shatavari Ghee": { base: 2183, tiers: 2 },
      "Triphala Ghee": { base: 2082, tiers: 2 },
      "Brahmi Ghee": { base: 2082, tiers: 2 },
    };

    for (const [name, exp] of Object.entries(expectations)) {
      const p = products.find((x: any) => x.name === name);
      expect(p, `product ${name} exists`).toBeTruthy();
      expect(p.unitPrice, `${name} base price`).toBe(exp.base);
      expect(p.tiers.length, `${name} tier count`).toBe(exp.tiers);
      // Tiers strictly cheaper than base and descending.
      let prev = p.unitPrice;
      for (const t of p.tiers) {
        expect(t.pricePerUnit).toBeLessThan(prev);
        prev = t.pricePerUnit;
      }
    }
    await ctx.dispose();
  });

  test("card-level quick add-to-cart still works (additive)", async ({ page, baseURL }) => {
    const ctx = await pwRequest.newContext({ baseURL: baseURL! });
    const products = await (await ctx.get("/api/products")).json();
    const p = products.find((x: any) => x.name === "MAHA 40");
    await ctx.dispose();

    await uiLogin(page, PARTNER);
    await page.goto("/#/shop");
    await page.getByTestId(`button-add-to-cart-${p.id}`).click();
    await expect(page.getByTestId(`text-qty-${p.id}`)).toHaveText("1");
  });
});

// ---------------------------------------------------------------------------
// Part 5 — Announcements page + push backend / audience targeting
// ---------------------------------------------------------------------------
test.describe("Admin Announcements", () => {
  test("page renders form and submits, appears in history", async ({ page }) => {
    await uiLogin(page, ADMIN);
    await page.goto("/#/admin/announcements");

    await expect(page.getByTestId("input-announcement-title")).toBeVisible();
    const title = `Test discount ${Date.now()}`;
    await page.getByTestId("input-announcement-title").fill(title);
    await page.getByTestId("input-announcement-body").fill("Order this month for 15% off.");
    await page.getByTestId("button-send-announcement").click();

    // History card appears with the sent title.
    await expect(page.getByText(title)).toBeVisible({ timeout: 10_000 });
  });

  test("VAPID public key endpoint is available without auth", async ({ baseURL }) => {
    const ctx = await pwRequest.newContext({ baseURL: baseURL! });
    const res = await ctx.get("/api/push/vapid-public-key");
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(typeof body.publicKey).toBe("string");
    expect(body.publicKey.length).toBeGreaterThan(20);
    await ctx.dispose();
  });

  test("announcement API enforces admin-only + records audience and recipient count", async ({ baseURL }) => {
    const base = baseURL!;
    const adminTok = await apiLogin(base, ADMIN);
    const partnerTok = await apiLogin(base, PARTNER);
    const ctx = await pwRequest.newContext({ baseURL: base });

    // Partner cannot create announcements.
    const forbidden = await ctx.post("/api/admin/announcements", {
      headers: { Authorization: `Bearer ${partnerTok}` },
      data: { title: "x", body: "y", audience: "all" },
    });
    expect(forbidden.status()).toBe(403);

    // Admin can, targeting partners. No push subs seeded, so sent=0 but record persists.
    const title = `Audience test ${Date.now()}`;
    const created = await ctx.post("/api/admin/announcements", {
      headers: { Authorization: `Bearer ${adminTok}` },
      data: { title, body: "hello partners", audience: "partners" },
    });
    expect(created.ok()).toBeTruthy();
    const payload = await created.json();
    expect(payload.announcement.audience).toBe("partners");
    expect(payload.announcement.recipientCount).toBe(payload.sent);
    expect(typeof payload.sent).toBe("number");

    // Shows up in admin history newest-first.
    const history = await (await ctx.get("/api/admin/announcements", {
      headers: { Authorization: `Bearer ${adminTok}` },
    })).json();
    expect(history[0].title).toBe(title);

    // Invalid audience rejected.
    const bad = await ctx.post("/api/admin/announcements", {
      headers: { Authorization: `Bearer ${adminTok}` },
      data: { title: "z", body: "z", audience: "everyone" },
    });
    expect(bad.status()).toBe(400);

    await ctx.dispose();
  });

  test("push subscribe requires auth and validates payload", async ({ baseURL }) => {
    const base = baseURL!;
    const ctx = await pwRequest.newContext({ baseURL: base });
    const partnerTok = await apiLogin(base, PARTNER);

    const noAuth = await ctx.post("/api/push/subscribe", {
      data: { endpoint: "https://example.com/x", keys: { p256dh: "a", auth: "b" } },
    });
    expect(noAuth.status()).toBe(401);

    const badPayload = await ctx.post("/api/push/subscribe", {
      headers: { Authorization: `Bearer ${partnerTok}` },
      data: { endpoint: "not-a-url" },
    });
    expect(badPayload.status()).toBe(400);

    const ok = await ctx.post("/api/push/subscribe", {
      headers: { Authorization: `Bearer ${partnerTok}` },
      data: { endpoint: `https://push.example.com/${Date.now()}`, keys: { p256dh: "key123", auth: "auth123" } },
    });
    expect(ok.ok()).toBeTruthy();
    await ctx.dispose();
  });
});
