const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const URL = process.argv[2];

  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: '/home/user/workspace/qa_screenshots/40_deployed_login.png' });

  await page.fill('input[type="email"], input[name="email"]', 'partner.demo@maha.clinic');
  await page.fill('input[type="password"], input[name="password"]', 'PartnerDemo2026!');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(2500);
  await page.screenshot({ path: '/home/user/workspace/qa_screenshots/41_deployed_home.png' });

  const bodyText = await page.textContent('body');
  console.log('Contains Welcome back:', bodyText.includes('Welcome back'));
  console.log('Contains Open referrals:', bodyText.includes('Open referrals'));

  await browser.close();
})();
