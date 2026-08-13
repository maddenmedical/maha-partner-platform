const { chromium } = require('playwright');

async function loginAndGoto(context, base, path) {
  const page = await context.newPage();
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(300);
  await page.fill('input[type="email"], input[name="email"]', 'partner.demo@maha.clinic');
  await page.fill('input[type="password"], input[name="password"]', 'PartnerDemo2026!');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(1000);
  await page.goto(base + path, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    const main = document.querySelector('main');
    if (main) main.scrollTop = main.scrollHeight;
  });
  await page.waitForTimeout(300);
  return page;
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const BASE = 'http://127.0.0.1:5050';

  // MacBook laptop viewport
  const laptopCtx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const laptopPage = await loginAndGoto(laptopCtx, BASE, '/#/videos');
  await laptopPage.screenshot({ path: '/home/user/workspace/qa_screenshots/11_learn_laptop_bottom.png' });
  await laptopCtx.close();

  // iPhone mobile viewport
  const mobileCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const mobilePage = await loginAndGoto(mobileCtx, BASE, '/#/videos');
  await mobilePage.screenshot({ path: '/home/user/workspace/qa_screenshots/12_learn_mobile_bottom.png' });
  await mobileCtx.close();

  // Small MacBook Air viewport (1366x768 common)
  const airCtx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const airPage = await loginAndGoto(airCtx, BASE, '/#/refer');
  await airPage.screenshot({ path: '/home/user/workspace/qa_screenshots/13_refer_air_bottom.png' });
  await airCtx.close();

  await browser.close();
})();
