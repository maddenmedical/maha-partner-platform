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

  await page.goto(BASE + '/#/refer', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);

  const mainInfo = await page.evaluate(() => {
    const main = document.querySelector('main');
    if (!main) return null;
    return {
      scrollHeight: main.scrollHeight,
      clientHeight: main.clientHeight,
      scrollTop: main.scrollTop,
    };
  });
  console.log('main info before scroll', mainInfo);

  await page.evaluate(() => {
    const main = document.querySelector('main');
    if (main) main.scrollTop = main.scrollHeight;
  });
  await page.waitForTimeout(300);

  const mainInfoAfter = await page.evaluate(() => {
    const main = document.querySelector('main');
    return { scrollTop: main.scrollTop, scrollHeight: main.scrollHeight, clientHeight: main.clientHeight };
  });
  console.log('main info after scroll', mainInfoAfter);

  await page.screenshot({ path: '/home/user/workspace/qa_screenshots/05_refer_scrolled_bottom.png' });

  // Get bounding rect of "YOUR REFERRAL HISTORY" heading and any history list container
  const rects = await page.evaluate(() => {
    const heading = [...document.querySelectorAll('*')].find(el => el.textContent?.trim() === 'YOUR REFERRAL HISTORY' && el.children.length === 0);
    const nav = document.querySelector('nav[aria-label="Primary"]');
    const desktopNav = document.querySelectorAll('div.hidden.md\\:flex')[0];
    return {
      heading: heading ? heading.getBoundingClientRect() : null,
      mobileNav: nav ? nav.getBoundingClientRect() : null,
    };
  });
  console.log('rects', JSON.stringify(rects));

  await browser.close();
})();
