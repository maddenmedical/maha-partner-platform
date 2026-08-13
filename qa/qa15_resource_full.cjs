const { chromium } = require('playwright');

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

  await page.locator('[data-testid="button-edit-product-40"]').click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: '/home/user/workspace/qa_screenshots/24_admin_product_edit_dialog.png' });

  // Set kind = Video
  await page.locator('[data-testid="select-resource-kind"]').click();
  await page.waitForTimeout(300);
  await page.locator('[role="option"]:has-text("Video")').click();
  await page.waitForTimeout(300);

  // Set mode = Paste link
  await page.locator('[data-testid="select-resource-mode"]').click();
  await page.waitForTimeout(300);
  await page.locator('[role="option"]:has-text("Paste link")').click();
  await page.waitForTimeout(300);

  await page.locator('[data-testid="input-resource-title"]').fill('How to use Detoxarcanum — 2 min guide');
  await page.locator('[data-testid="input-resource-url"]').fill('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  await page.waitForTimeout(300);
  await page.screenshot({ path: '/home/user/workspace/qa_screenshots/25_resource_form_filled.png' });

  await page.locator('[data-testid="button-add-resource"]').click();
  await page.waitForTimeout(1000);
  await page.screenshot({ path: '/home/user/workspace/qa_screenshots/26_resource_added.png' });

  const bodyText = await page.evaluate(() => document.body.innerText);
  console.log('--- AFTER ADD RESOURCE ---');
  console.log(bodyText.slice(0, 2000));

  // save product
  await page.locator('[data-testid="button-save-product"]').click();
  await page.waitForTimeout(1000);

  await browser.close();
})();
