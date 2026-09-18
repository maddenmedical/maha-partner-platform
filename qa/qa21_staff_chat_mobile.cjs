const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const BASE = 'http://127.0.0.1:5055';
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(300);
  await page.fill('input[type="email"], input[name="email"]', 'elisabeth.madden.medical@gmail.com');
  await page.fill('input[type="password"], input[name="password"]', 'QaTest2026!');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(1200);

  await page.goto(BASE + '/#/admin/chat', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: '/home/user/workspace/qa_screenshots/staff_m1_inbox.png' });

  await page.click('[data-testid="button-tab-team-chat"]');
  await page.waitForTimeout(700);
  await page.screenshot({ path: '/home/user/workspace/qa_screenshots/staff_m2_team_tab.png' });

  await page.click('[data-testid="button-staff-chat-room"]');
  await page.waitForTimeout(800);
  await page.screenshot({ path: '/home/user/workspace/qa_screenshots/staff_m3_room_overlay.png' });

  await browser.close();
  console.log('MOBILE QA DONE');
})().catch((e) => { console.error('MOBILE QA ERROR:', e); process.exit(1); });
