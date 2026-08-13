const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const BASE = 'http://127.0.0.1:5050';

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);

  // Login as Dr. Sara Novak
  const emailInput = await page.$('input[type="email"], input[name="email"]');
  if (emailInput) {
    await page.fill('input[type="email"], input[name="email"]', 'partner.demo@maha.clinic');
    await page.fill('input[type="password"], input[name="password"]', 'PartnerDemo2026!');
    await page.click('button[type="submit"]');
    await page.waitForTimeout(1500);
  }

  await page.screenshot({ path: '/home/user/workspace/qa_screenshots/01_partner_home.png', fullPage: true });
  console.log('URL after login:', page.url());
  console.log('Title:', await page.title());

  // Print greeting text
  const bodyText = await page.evaluate(() => document.body.innerText);
  console.log('--- BODY TEXT SNIPPET ---');
  console.log(bodyText.slice(0, 1500));

  await browser.close();
})();
