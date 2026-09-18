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

  const a1 = await loginAs('elisabeth.madden.medical@gmail.com', 'QaTest2026!');
  await a1.page.goto(BASE + '/#/admin/chat', { waitUntil: 'domcontentloaded' });
  await a1.page.waitForTimeout(1000);
  await a1.page.click('[data-testid="button-tab-team-chat"]');
  await a1.page.waitForTimeout(500);
  await a1.page.click('[data-testid="button-staff-chat-room"]');
  await a1.page.waitForTimeout(500);

  // Send the original message
  await a1.page.fill('textarea', 'Original message to be replied to.');
  await a1.page.click('[data-testid="button-staff-chat-send"]');
  await a1.page.waitForTimeout(1000);

  // Hover to reveal the reply button, then click it
  const bubbles = await a1.page.$$('[data-testid^="button-reply-"]');
  console.log('Reply buttons found:', bubbles.length);
  if (bubbles.length === 0) {
    // try long-press action sheet fallback (mobile pattern) -- but we're desktop, so hover first
    await a1.page.hover('text=Original message to be replied to.');
    await a1.page.waitForTimeout(300);
  }
  const replyBtn = await a1.page.$('[data-testid^="button-reply-"]');
  if (replyBtn) {
    await replyBtn.click();
  } else {
    console.log('ERROR: no reply button found even after hover');
  }
  await a1.page.waitForTimeout(500);
  await a1.page.screenshot({ path: '/home/user/workspace/qa_screenshots/staff_reply_1_composer_preview.png' });

  const composerPreviewVisible = await a1.page.evaluate(() => {
    const el = document.querySelector('[data-testid="staff-chat-reply-preview-name"]');
    return !!el;
  });
  console.log('Composer reply preview visible:', composerPreviewVisible);

  // Send the reply
  await a1.page.fill('textarea', 'This is the reply.');
  await a1.page.click('[data-testid="button-staff-chat-send"]');
  await a1.page.waitForTimeout(1000);
  await a1.page.screenshot({ path: '/home/user/workspace/qa_screenshots/staff_reply_2_sent.png' });

  const pageText = await a1.page.evaluate(() => document.body.innerText);
  console.log('Page contains reply text:', pageText.includes('This is the reply.'));
  console.log('Page contains original quoted snippet:', pageText.includes('Original message to be replied to.'));

  await browser.close();
  console.log('DONE');
})().catch((e) => { console.error('QA SCRIPT ERROR:', e); process.exit(1); });
