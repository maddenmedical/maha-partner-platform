const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const BASE = 'http://127.0.0.1:5050';

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(300);
  await page.fill('input[type="email"], input[name="email"]', 'elisabeth.madden.medical@gmail.com');
  await page.fill('input[type="password"], input[name="password"]', 'MahaAdmin2026!');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(1500);
  console.log('URL after admin login:', page.url());

  await page.goto(BASE + '/#/admin/chat', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: '/home/user/workspace/qa_screenshots/19_admin_chat_inbox.png' });

  const bodyText = await page.evaluate(() => document.body.innerText);
  console.log('--- ADMIN CHAT TEXT ---');
  console.log(bodyText.slice(0, 1200));

  await browser.close();
})();
