const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const BASE = 'http://127.0.0.1:5050';

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(300);
  await page.fill('input[type="email"], input[name="email"]', 'elisabeth.madden.medical@gmail.com');
  await page.fill('input[type="password"], input[name="password"]', 'MahaAdmin2026!');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(1200);

  await page.goto(BASE + '/#/admin/products', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);

  // click edit pencil on Detoxarcanum card
  const card = page.locator('text=Detoxarcanum').first().locator('xpath=ancestor::*[self::div][.//button][1]');
  // fallback: find the pencil button near text Detoxarcanum
  const editButtons = await page.locator('button:has(svg)').all();
  // Simplify: click the pencil icon that is a sibling in the same card as "Detoxarcanum" heading
  const detoxCard = page.locator('div', { has: page.getByText('Detoxarcanum', { exact: true }) }).first();

  // More robust: find all product card containers and locate the one with Detoxarcanum
  const cards = page.locator('.rounded-lg, .rounded-xl, [class*="card"]');
  let clicked = false;
  const count = await page.locator('text=Detoxarcanum').count();
  console.log('Detoxarcanum text matches:', count);

  // Try clicking pencil icon that's positioned right after the Detoxarcanum title in DOM
  const titleEl = page.getByText('Detoxarcanum', { exact: true }).first();
  const container = titleEl.locator('xpath=ancestor::div[position()<=4][.//button]').first();
  await container.locator('button').first().click({ timeout: 5000 }).then(() => { clicked = true; }).catch(e => console.log('click err', e.message));

  await page.waitForTimeout(800);
  await page.screenshot({ path: '/home/user/workspace/qa_screenshots/24_admin_product_edit_dialog.png' });
  const bodyText = await page.evaluate(() => document.body.innerText);
  console.log('--- AFTER EDIT CLICK ---');
  console.log(bodyText.slice(0, 1500));

  await browser.close();
})();
