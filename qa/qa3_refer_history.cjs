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

  await page.goto(BASE + '/#/refer', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);

  // Submit a test referral so history has content
  await page.fill('input[placeholder], input', '').catch(() => {});
  const inputs = await page.$$('input[type="text"], input:not([type])');
  console.log('num text inputs:', inputs.length);

  // Fill fields by label proximity using name attr fallback - inspect field names
  const html = await page.content();
  require('fs').writeFileSync('/home/user/workspace/qa_screenshots/refer_page.html', html);

  // fullpage screenshot
  await page.screenshot({ path: '/home/user/workspace/qa_screenshots/04_refer_fullpage.png', fullPage: true });

  const scrollInfo = await page.evaluate(() => ({
    scrollHeight: document.documentElement.scrollHeight,
    clientHeight: document.documentElement.clientHeight,
    innerHeight: window.innerHeight,
  }));
  console.log('scrollInfo', scrollInfo);

  await browser.close();
})();
