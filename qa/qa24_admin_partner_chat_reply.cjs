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

  const admin = await loginAs('second-admin@example.com', 'QaTest2026!');
  await admin.page.goto(BASE + '/#/admin/chat', { waitUntil: 'domcontentloaded' });
  await admin.page.waitForTimeout(1200);

  // find and open the "QA admin-reply visual test" thread
  await admin.page.click('text=QA admin-reply visual test');
  await admin.page.waitForTimeout(1000);
  await admin.page.screenshot({ path: '/home/user/workspace/qa_screenshots/adminreply_2_thread_open.png' });

  const textContentBefore = await admin.page.evaluate(() => document.body.innerText);
  console.log('Contains original message:', textContentBefore.includes('Original message from partner for visual QA'));

  // hover the original message bubble to reveal the reply button
  await admin.page.hover('text=Original message from partner for visual QA');
  await admin.page.waitForTimeout(300);
  const replyBtn = await admin.page.$('[data-testid^="button-reply-"]');
  console.log('Reply button found:', !!replyBtn);
  if (replyBtn) {
    await replyBtn.click();
  }
  await admin.page.waitForTimeout(500);

  const composerPreviewVisible = await admin.page.evaluate(() => {
    const el = document.querySelector('[data-testid="admin-chat-reply-preview-name"]');
    return el ? el.outerHTML : null;
  });
  console.log('Composer reply preview element:', composerPreviewVisible);
  await admin.page.screenshot({ path: '/home/user/workspace/qa_screenshots/adminreply_3_composer_reply_preview.png' });

  // send the reply
  await admin.page.fill('textarea', 'This is the admin reply to that message.');
  const sendBtn = await admin.page.$('[data-testid="admin-chat-send"]') || await admin.page.$('button[data-testid$="-send"]');
  if (sendBtn) await sendBtn.click();
  await admin.page.waitForTimeout(1200);
  await admin.page.screenshot({ path: '/home/user/workspace/qa_screenshots/adminreply_4_sent.png', fullPage: true });

  const finalText = await admin.page.evaluate(() => document.body.innerText);
  console.log('Sent reply text present:', finalText.includes('This is the admin reply to that message.'));
  console.log('Quoted original snippet visible in sent view:', finalText.includes('Original message from partner for visual QA'));

  // count how many times the quoted preview data-testid appears (should be for the newly sent message)
  const quotedCount = await admin.page.evaluate(() => document.querySelectorAll('[data-testid^="quoted-message-"]').length);
  console.log('Quoted-message elements rendered on page:', quotedCount);

  await browser.close();
  console.log('DONE');
})().catch((e) => { console.error('QA SCRIPT ERROR:', e); process.exit(1); });
