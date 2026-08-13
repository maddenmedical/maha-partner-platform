const { webkit } = require('playwright');

(async () => {
  const browser = await webkit.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const BASE = 'http://127.0.0.1:5050';

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  await page.screenshot({ path: '/home/user/workspace/qa_screenshots/33_webkit_login.png' });

  await page.fill('input[type="email"], input[name="email"]', 'partner.demo@maha.clinic');
  await page.fill('input[type="password"], input[name="password"]', 'PartnerDemo2026!');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: '/home/user/workspace/qa_screenshots/34_webkit_home.png' });

  await page.goto(BASE + '/#/refer', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: '/home/user/workspace/qa_screenshots/35_webkit_refer.png' });
  // scroll to bottom
  await page.evaluate(() => {
    const main = document.querySelector('main');
    if (main) main.scrollTop = main.scrollHeight;
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: '/home/user/workspace/qa_screenshots/36_webkit_refer_bottom.png' });

  await page.goto(BASE + '/#/videos', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  await page.evaluate(() => {
    const main = document.querySelector('main');
    if (main) main.scrollTop = main.scrollHeight;
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: '/home/user/workspace/qa_screenshots/37_webkit_learn_bottom.png' });

  await page.goto(BASE + '/#/chat', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: '/home/user/workspace/qa_screenshots/38_webkit_chat.png' });

  await browser.close();
  console.log('webkit qa done');
})();
