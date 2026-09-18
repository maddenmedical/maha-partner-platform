const { chromium } = require('playwright');
const Database = require('better-sqlite3');

(async () => {
  const BASE = 'http://127.0.0.1:5055';
  const db = new Database('data.db');

  async function loginAs(browser, email, password, grantNotifications) {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      permissions: grantNotifications ? ['notifications'] : [],
    });
    const page = await context.newPage();
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(300);
    await page.fill('input[type="email"], input[name="email"]', email);
    await page.fill('input[type="password"], input[name="password"]', password);
    await page.click('button[type="submit"]');
    await page.waitForTimeout(1500);
    return { context, page };
  }

  const browser = await chromium.launch({ headless: true });

  const TEST_EMAIL = 'qa-nudge-test@example.com';
  const TEST_PASSWORD = 'QaNudgeTest2026!';

  // ---------- Scenario A: fresh user, never prompted -> first-time "push" ask ----------
  db.prepare('update users set push_nudge_last_prompted_at = NULL where email = ?').run(TEST_EMAIL);
  const a = await loginAs(browser, TEST_EMAIL, TEST_PASSWORD, false);
  await a.page.waitForTimeout(800);
  const notifPermA = await a.page.evaluate(() => (typeof Notification !== 'undefined' ? Notification.permission : 'unsupported'));
  const bannerA = await a.page.$('[data-testid="banner-push-prompt"]');
  const modeTextA = bannerA ? await a.page.textContent('[data-testid="banner-push-prompt"]') : null;
  console.log('Scenario A (fresh, permission=' + notifPermA + '): banner present =', !!bannerA);
  console.log('Scenario A banner text:', modeTextA);
  const stampedA = db.prepare('select push_nudge_last_prompted_at from users where email = ?').get(TEST_EMAIL);
  console.log('Scenario A: push_nudge_last_prompted_at stamped after mount =', stampedA.push_nudge_last_prompted_at);
  await a.context.close();

  // ---------- Scenario B: returning user, prompted >3mo ago, permission still default -> recheck (device reason) ----------
  const fourMonthsAgo = Date.now() - 120 * 24 * 60 * 60 * 1000;
  db.prepare('update users set push_nudge_last_prompted_at = ? where email = ?').run(fourMonthsAgo, TEST_EMAIL);
  const b = await loginAs(browser, TEST_EMAIL, TEST_PASSWORD, false);
  await b.page.waitForTimeout(800);
  const bannerB = await b.page.$('[data-testid="banner-push-prompt"]');
  const textB = bannerB ? await b.page.textContent('[data-testid="banner-push-prompt"]') : null;
  console.log('Scenario B (returning, stale device permission): banner present =', !!bannerB);
  console.log('Scenario B banner text:', textB);
  // Click "Review settings" and confirm navigation to Account page
  const reviewBtn = await b.page.$('[data-testid="button-review-notification-settings"]');
  if (reviewBtn) {
    await b.page.keyboard.press('Escape').catch(() => {});
    await b.page.waitForTimeout(200);
    await reviewBtn.click({ force: true });
    await b.page.waitForTimeout(600);
    console.log('Scenario B: URL after clicking Review settings =', b.page.url());
  } else {
    console.log('Scenario B: Review settings button NOT found');
  }
  await b.context.close();

  // ---------- Scenario C: returning user, prompted >3mo ago, permission GRANTED but a category style is weak -> recheck (style reason) ----------
  db.prepare('update users set push_nudge_last_prompted_at = ?, notify_orders_style = ? where email = ?').run(fourMonthsAgo, 'alert', TEST_EMAIL);
  const c = await loginAs(browser, TEST_EMAIL, TEST_PASSWORD, true);
  await c.page.waitForTimeout(800);
  const notifPermC = await c.page.evaluate(() => (typeof Notification !== 'undefined' ? Notification.permission : 'unsupported'));
  const bannerC = await c.page.$('[data-testid="banner-push-prompt"]');
  const textC = bannerC ? await c.page.textContent('[data-testid="banner-push-prompt"]') : null;
  console.log('Scenario C (returning, permission=' + notifPermC + ', weak category style): banner present =', !!bannerC);
  console.log('Scenario C banner text:', textC);
  await c.context.close();

  // ---------- Scenario D: returning user, recently prompted (<3mo), still weak -> should NOT reappear ----------
  const oneMonthAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  db.prepare('update users set push_nudge_last_prompted_at = ? where email = ?').run(oneMonthAgo, TEST_EMAIL);
  const d = await loginAs(browser, TEST_EMAIL, TEST_PASSWORD, true);
  await d.page.waitForTimeout(800);
  const bannerD = await d.page.$('[data-testid="banner-push-prompt"]');
  console.log('Scenario D (recently prompted, still weak, within 3mo window): banner present (should be false) =', !!bannerD);
  await d.context.close();

  await browser.close();
})();
