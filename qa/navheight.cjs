const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:5050', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(300);
  await page.fill('input[type="email"], input[name="email"]', 'partner.demo@maha.clinic');
  await page.fill('input[type="password"], input[name="password"]', 'PartnerDemo2026!');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(1000);
  const info = await page.evaluate(() => {
    const desktopNav = document.querySelector('div.hidden.md\\:flex.fixed.bottom-0');
    const rect = desktopNav ? desktopNav.getBoundingClientRect() : null;
    return { rect };
  });
  console.log(JSON.stringify(info));
  await browser.close();
})();
