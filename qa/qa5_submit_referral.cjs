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
  await page.waitForTimeout(800);

  // Submit multiple referrals to build a real history list
  for (let i = 1; i <= 4; i++) {
    const textInputs = await page.$$('main input');
    // Fallback generic fill by order: firstName, lastName, contact
    await textInputs[0].fill(`Test${i}`);
    await textInputs[1].fill(`Patient${i}`);
    await textInputs[2].fill(`test${i}@example.com`);
    const textarea = await page.$('main textarea');
    await textarea.fill(`Case description for referral ${i} - needs review by MAHA clinical team regarding ongoing treatment plan and follow-up scheduling.`);
    await page.click('button:has-text("Send referral")');
    await page.waitForTimeout(1000);
  }

  await page.screenshot({ path: '/home/user/workspace/qa_screenshots/06_referrals_submitted.png' });

  // scroll to bottom of history
  await page.evaluate(() => {
    const main = document.querySelector('main');
    if (main) main.scrollTop = main.scrollHeight;
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: '/home/user/workspace/qa_screenshots/07_referral_history_bottom.png' });

  const mainInfo = await page.evaluate(() => {
    const main = document.querySelector('main');
    return { scrollHeight: main.scrollHeight, clientHeight: main.clientHeight, scrollTop: main.scrollTop };
  });
  console.log('mainInfo', mainInfo);

  await browser.close();
})();
