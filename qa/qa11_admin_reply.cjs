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
  await page.waitForTimeout(1200);

  await page.goto(BASE + '/#/admin/chat', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);

  // click the thread with the shipping topic
  await page.locator('text=Question about shipping to Germany').first().click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: '/home/user/workspace/qa_screenshots/20_admin_chat_thread_open.png' });

  const msgInput = page.locator('textarea:visible, input[placeholder*="message" i]:visible').first();
  await msgInput.fill('Hi Dr. Novak, shipping to Germany is 5-7 business days, cost included in your order total.');
  await page.waitForTimeout(300);
  const sendBtn = page.locator('button[type="submit"]:visible').first();
  await sendBtn.click().catch(()=>{});
  await page.waitForTimeout(1000);
  await page.screenshot({ path: '/home/user/workspace/qa_screenshots/21_admin_chat_replied.png' });

  await browser.close();
})();
