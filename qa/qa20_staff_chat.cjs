const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const BASE = 'http://127.0.0.1:5055';

  async function loginAs(email, password) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(300);
    await page.fill('input[type="email"], input[name="email"]', email);
    await page.fill('input[type="password"], input[name="password"]', password);
    await page.click('button[type="submit"]');
    await page.waitForTimeout(1200);
    return { context, page };
  }

  // --- Admin 1 (QA Admin) ---
  const a1 = await loginAs('elisabeth.madden.medical@gmail.com', 'QaTest2026!');
  console.log('Admin1 URL after login:', a1.page.url());
  await a1.page.goto(BASE + '/#/admin/chat', { waitUntil: 'domcontentloaded' });
  await a1.page.waitForTimeout(1000);
  await a1.page.screenshot({ path: '/home/user/workspace/qa_screenshots/staff_1_inbox.png' });

  // Click Team tab
  await a1.page.click('[data-testid="button-tab-team-chat"]');
  await a1.page.waitForTimeout(700);
  await a1.page.screenshot({ path: '/home/user/workspace/qa_screenshots/staff_2_team_tab.png' });

  // Click Staff Room
  await a1.page.click('[data-testid="button-staff-chat-room"]');
  await a1.page.waitForTimeout(700);
  await a1.page.screenshot({ path: '/home/user/workspace/qa_screenshots/staff_3_room.png' });

  // Send a message in Staff Room
  const composerSelector = 'textarea';
  await a1.page.fill(composerSelector, 'Hello team, this is a Staff Room test message from Admin1.');
  await a1.page.click('[data-testid="button-staff-chat-send"]');
  await a1.page.waitForTimeout(1000);
  await a1.page.screenshot({ path: '/home/user/workspace/qa_screenshots/staff_4_room_sent.png' });

  const roomText1 = await a1.page.evaluate(() => document.body.innerText);
  console.log('--- ROOM TEXT (admin1) contains test msg:', roomText1.includes('Hello team, this is a Staff Room test message from Admin1.'));

  // Start a new DM with Second Admin
  await a1.page.click('[data-testid="button-new-staff-dm"]');
  await a1.page.waitForTimeout(500);
  await a1.page.screenshot({ path: '/home/user/workspace/qa_screenshots/staff_5_dm_picker.png' });
  const pickButtons = await a1.page.$$('[data-testid^="button-pick-admin-"]');
  console.log('Pickable admins count:', pickButtons.length);
  if (pickButtons.length > 0) {
    await pickButtons[0].click();
    await a1.page.waitForTimeout(1000);
    await a1.page.screenshot({ path: '/home/user/workspace/qa_screenshots/staff_6_dm_opened.png' });
    await a1.page.fill(composerSelector, 'Hi Second Admin, this is a private DM test from Admin1.');
    await a1.page.click('[data-testid="button-staff-chat-send"]');
    await a1.page.waitForTimeout(1000);
    await a1.page.screenshot({ path: '/home/user/workspace/qa_screenshots/staff_7_dm_sent.png' });
  }

  const dmText1 = await a1.page.evaluate(() => document.body.innerText);
  console.log('--- DM TEXT (admin1) contains test msg:', dmText1.includes('Hi Second Admin, this is a private DM test from Admin1.'));

  // --- Admin 2 (Second Admin) ---
  const a2 = await loginAs('second-admin@example.com', 'QaTest2026!');
  console.log('Admin2 URL after login:', a2.page.url());
  await a2.page.goto(BASE + '/#/admin/chat', { waitUntil: 'domcontentloaded' });
  await a2.page.waitForTimeout(1000);
  await a2.page.click('[data-testid="button-tab-team-chat"]');
  await a2.page.waitForTimeout(700);
  await a2.page.screenshot({ path: '/home/user/workspace/qa_screenshots/staff_8_admin2_team_tab.png' });

  const teamTabText2 = await a2.page.evaluate(() => document.body.innerText);
  console.log('--- Admin2 sees DM thread from QA Admin in sidebar:', teamTabText2.includes('QA Admin'));

  // Open Staff Room as admin2, verify message from admin1 is visible
  await a2.page.click('[data-testid="button-staff-chat-room"]');
  await a2.page.waitForTimeout(700);
  const roomText2 = await a2.page.evaluate(() => document.body.innerText);
  console.log('--- Admin2 sees room message from admin1:', roomText2.includes('Hello team, this is a Staff Room test message from Admin1.'));
  await a2.page.screenshot({ path: '/home/user/workspace/qa_screenshots/staff_9_admin2_room.png' });

  // Open the DM thread as admin2, verify message + reply
  const dmThreadButtons2 = await a2.page.$$('[data-testid^="button-staff-dm-thread-"]');
  console.log('Admin2 DM threads count:', dmThreadButtons2.length);
  if (dmThreadButtons2.length > 0) {
    await dmThreadButtons2[0].click();
    await a2.page.waitForTimeout(700);
    const dmText2 = await a2.page.evaluate(() => document.body.innerText);
    console.log('--- Admin2 sees DM message from admin1:', dmText2.includes('Hi Second Admin, this is a private DM test from Admin1.'));
    await a2.page.fill(composerSelector, 'Reply from Second Admin, DM test.');
    await a2.page.click('[data-testid="button-staff-chat-send"]');
    await a2.page.waitForTimeout(1000);
    await a2.page.screenshot({ path: '/home/user/workspace/qa_screenshots/staff_10_admin2_dm_reply.png' });
  }

  await browser.close();
  console.log('DONE');
})().catch((e) => { console.error('QA SCRIPT ERROR:', e); process.exit(1); });
