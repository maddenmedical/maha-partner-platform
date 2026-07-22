import { test, expect, Page, Locator } from "@playwright/test";

const ADMIN = { email: "elisabeth.madden.medical@gmail.com", password: "MahaAdmin2026!" };
const PARTNER = { email: "partner.demo@maha.clinic", password: "PartnerDemo2026!" };

async function uiLogin(page: Page, creds: { email: string; password: string }) {
  await page.goto("/");
  await page.getByTestId("input-email").fill(creds.email);
  await page.getByTestId("input-password").fill(creds.password);
  await page.getByTestId("button-submit-login").click();
  await page.waitForURL(/#\/(admin.*)?$/, { timeout: 15_000 });
}

// The bottom nav renders two variants: a mobile grid (data-testid `tab-...`,
// visible < md) and a desktop bar (`tab-...-desktop`, visible >= md).
function courseCard(page: Page, name: string): Locator {
  return page.locator('[data-testid^="card-course-"]', { hasText: name });
}

// ---------------------------------------------------------------------------
// Part 1 — Education nav tab present + navigates (desktop + mobile, light + dark)
// ---------------------------------------------------------------------------
test.describe("Partner Education tab", () => {
  for (const vp of [
    { name: "desktop", width: 1280, height: 900, tabId: "tab-education-desktop" },
    { name: "mobile", width: 375, height: 812, tabId: "tab-education" },
  ]) {
    for (const scheme of ["light", "dark"] as const) {
      test(`Education tab visible + navigates — ${vp.name} / ${scheme}`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await uiLogin(page, PARTNER);

        const isDark = await page.evaluate(() => document.documentElement.classList.contains("dark"));
        if ((scheme === "dark") !== isDark) {
          await page.getByTestId("button-theme-toggle").click();
        }
        await expect
          .poll(() => page.evaluate(() => document.documentElement.classList.contains("dark")))
          .toBe(scheme === "dark");

        const tab = page.getByTestId(vp.tabId);
        await expect(tab).toBeVisible();

        // No horizontal overflow of the 5-column tab bar at this viewport.
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow).toBeLessThanOrEqual(2);

        await tab.click();
        await page.waitForURL(/#\/videos/, { timeout: 10_000 });
        await expect(page.getByRole("heading", { name: "Education" })).toBeVisible();
        await expect(page.getByRole("heading", { name: "Free lessons", exact: true })).toBeVisible();
        await expect(page.getByRole("heading", { name: "Maha Symposium public lectures", exact: true })).toBeVisible();
        await expect(page.getByRole("heading", { name: "Maha Symposium lectures", exact: true })).toBeVisible();
      });
    }
  }
});

// ---------------------------------------------------------------------------
// Part 2 — Free course access + free-enroll flow
// ---------------------------------------------------------------------------
test.describe("Partner course access", () => {
  test("free open course shows lessons without enrolling", async ({ page }) => {
    await uiLogin(page, PARTNER);
    await page.goto("/#/videos");
    const free = courseCard(page, "Free lessons");
    await expect(free).toBeVisible();
    await expect(free.getByText("You have access")).toBeVisible();
    await expect(free.getByText("F-01 – Biological dentistry fundamentals and effective methods")).toBeVisible();
  });

  test("free-enroll course grants access without payment", async ({ page }) => {
    await uiLogin(page, PARTNER);
    await page.goto("/#/videos");
    const course = courseCard(page, "Maha Symposium public lectures");
    await expect(course).toBeVisible();

    const enrollBtn = course.getByRole("button", { name: /Enroll/i });
    if (await enrollBtn.isVisible().catch(() => false)) {
      await enrollBtn.click();
    }
    await expect(course.getByText("You have access")).toBeVisible({ timeout: 10_000 });
    await expect(course.getByText("SP-2026 – dr. Sebastjano Perko")).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Part 3 — Paid checkout gracefully degrades when Stripe is not configured
// ---------------------------------------------------------------------------
test.describe("Paid course checkout (no Stripe key)", () => {
  test("Buy access triggers checkout and shows 'not configured' toast, no crash", async ({ page }) => {
    await uiLogin(page, PARTNER);
    await page.goto("/#/videos");

    const paid = courseCard(page, "Maha Symposium lectures");
    await expect(paid).toBeVisible();
    const buyBtn = paid.getByRole("button", { name: /Buy access/i });
    await expect(buyBtn).toBeVisible();
    await expect(buyBtn).toBeEnabled();

    const [resp] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/checkout"), { timeout: 10_000 }),
      buyBtn.click(),
    ]);
    expect(resp.status()).toBe(503);

    await expect(page.getByText(/Online payment isn't set up yet/i)).toBeVisible({ timeout: 10_000 });
    // Button stays visible + enabled (not hidden/disabled) and page did not crash.
    await expect(buyBtn).toBeVisible();
    await expect(buyBtn).toBeEnabled();
    await expect(paid).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Part 4 — Admin course management + purchase history
// ---------------------------------------------------------------------------
test.describe("Admin course management", () => {
  test("admin can create a course, add a lesson, and see purchase history table", async ({ page }) => {
    await uiLogin(page, ADMIN);
    await page.goto("/#/admin/videos");

    await expect(page.getByTestId("table-purchases")).toBeVisible();

    const unique = `E2E Course ${Date.now()}`;
    await page.getByTestId("button-add-course").click();
    await expect(page.getByTestId("dialog-course-form")).toBeVisible();
    await page.getByTestId("input-course-name").fill(unique);
    await page.getByTestId("textarea-course-description").fill("Created by Playwright.");
    await page.getByTestId("button-save-course").click();
    await expect(page.getByTestId("dialog-course-form")).toBeHidden({ timeout: 10_000 });

    const card = page.locator('[data-testid^="card-admin-course-"]', { hasText: unique });
    await expect(card).toBeVisible();

    await card.getByRole("button", { name: /Add lesson/i }).click();
    await expect(page.getByTestId("dialog-lesson-form")).toBeVisible();
    await page.getByTestId("input-lesson-title").fill("E2E Lesson 1");
    await page.getByTestId("button-save-lesson").click();
    await expect(page.getByTestId("dialog-lesson-form")).toBeHidden({ timeout: 10_000 });
    await expect(card.getByText("E2E Lesson 1")).toBeVisible();
    // Empty-url lessons show the "no video link yet" hint.
    await expect(card.getByText(/No video link yet — add one/i)).toBeVisible();
  });
});
