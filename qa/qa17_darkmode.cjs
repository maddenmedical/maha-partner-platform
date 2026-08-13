const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const BASE = 'http://127.0.0.1:5050';

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(300);
  await page.fill('input[type="email"], input[name="email"]', 'partner.demo@maha.clinic');
  await page.fill('input[type="password"], input[name="password"]', 'PartnerDemo2026!');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(1200);

  // toggle dark mode
  await page.locator('[data-testid="button-theme-toggle"]').click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: '/home/user/workspace/qa_screenshots/28_dark_home.png' });

  await page.goto(BASE + '/#/refer', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  await page.screenshot({ path: '/home/user/workspace/qa_screenshots/29_dark_refer.png' });

  await page.goto(BASE + '/#/shop', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  await page.screenshot({ path: '/home/user/workspace/qa_screenshots/30_dark_shop.png' });

  await page.goto(BASE + '/#/videos', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  await page.screenshot({ path: '/home/user/workspace/qa_screenshots/31_dark_learn.png' });

  await page.goto(BASE + '/#/chat', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  await page.screenshot({ path: '/home/user/workspace/qa_screenshots/32_dark_chat.png' });

  await browser.close();
})();
