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

  await page.goto(BASE + '/#/videos', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);

  await page.screenshot({ path: '/home/user/workspace/qa_screenshots/09_learn_top.png' });

  const mainInfo = await page.evaluate(() => {
    const main = document.querySelector('main');
    return main ? { scrollHeight: main.scrollHeight, clientHeight: main.clientHeight } : null;
  });
  console.log('mainInfo', mainInfo);

  await page.evaluate(() => {
    const main = document.querySelector('main');
    if (main) main.scrollTop = main.scrollHeight;
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: '/home/user/workspace/qa_screenshots/10_learn_bottom.png' });

  await browser.close();
})();
