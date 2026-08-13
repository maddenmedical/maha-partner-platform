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

  await page.goto(BASE + '/#/chat', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: '/home/user/workspace/qa_screenshots/14_chat_thread_list.png' });

  const bodyText = await page.evaluate(() => document.body.innerText);
  console.log('--- CHAT PAGE TEXT ---');
  console.log(bodyText.slice(0, 800));

  // Click "New chat" button
  const newChatBtn = await page.locator('button:has-text("New chat")').first();
  await newChatBtn.click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: '/home/user/workspace/qa_screenshots/15_chat_new_dialog.png' });

  // Fill topic and create
  const topicInput = await page.locator('input').last();
  await topicInput.fill('Question about shipping to Germany');
  await page.waitForTimeout(200);
  const createBtn = await page.locator('button:has-text("Create"), button:has-text("Start")').first();
  await createBtn.click();
  await page.waitForTimeout(1000);
  await page.screenshot({ path: '/home/user/workspace/qa_screenshots/16_chat_new_thread_created.png' });

  console.log('URL after create:', page.url());

  // send a message in this thread
  const msgInput = page.locator('[data-testid="textarea-chat-message"]:visible').first();
  await msgInput.waitFor({ state: 'visible', timeout: 5000 });
  await msgInput.fill('Hi, I have a question about shipping costs to Germany for the Detoxarcanum order.');
  await page.waitForTimeout(300);

  const sendBtn = page.locator('[data-testid="button-send-chat-message"]:visible, button[type="submit"]:visible').first();
  await sendBtn.click().catch(async (e) => { console.log('send click err', e.message); });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: '/home/user/workspace/qa_screenshots/17_chat_message_sent.png' });

  // Go back to thread list and verify 2 threads now shown
  await page.goto(BASE + '/#/chat', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: '/home/user/workspace/qa_screenshots/18_chat_thread_list_after.png' });
  const bodyText2 = await page.evaluate(() => document.body.innerText);
  console.log('--- CHAT LIST AFTER ---');
  console.log(bodyText2.slice(0, 1000));

  await browser.close();
})();
