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

  // Click "Open referrals" card
  const referralsCard = await page.getByText('Open referrals').first();
  await referralsCard.click();
  await page.waitForTimeout(800);
  console.log('After clicking Open referrals card, URL:', page.url());
  await page.screenshot({ path: '/home/user/workspace/qa_screenshots/02_after_referrals_click.png' });

  // go back home
  await page.goto(BASE + '/#/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(600);

  const ordersCard = await page.getByText('Open order requests').first();
  await ordersCard.click();
  await page.waitForTimeout(800);
  console.log('After clicking Open order requests card, URL:', page.url());
  await page.screenshot({ path: '/home/user/workspace/qa_screenshots/03_after_orders_click.png' });

  await browser.close();
})();
