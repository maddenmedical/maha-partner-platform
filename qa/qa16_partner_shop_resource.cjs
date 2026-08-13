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

  await page.goto(BASE + '/#/shop', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);

  await page.locator('text=Detoxarcanum').first().click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: '/home/user/workspace/qa_screenshots/27_partner_product_detail.png', fullPage: true });

  const bodyText = await page.evaluate(() => document.body.innerText);
  console.log('--- PARTNER PRODUCT DETAIL ---');
  console.log(bodyText.slice(0, 1500));

  await browser.close();
})();
