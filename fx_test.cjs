const { firefox } = require('playwright');

(async () => {
  const browser = await firefox.launch();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();

  const logs = [];
  page.on('console', (msg) => logs.push(`[console:${msg.type()}] ${msg.text()}`));
  page.on('pageerror', (err) => logs.push(`[pageerror] ${err.message}`));
  page.on('requestfailed', (req) => logs.push(`[requestfailed] ${req.url()} ${req.failure()?.errorText}`));

  await page.goto('https://maha-partner-portal.pplx.app/#/register', { waitUntil: 'load', timeout: 30000 });
  await page.waitForSelector('#firstName', { timeout: 15000 });
  await page.waitForTimeout(500);

  const uniq = Date.now();
  await page.fill('#firstName', 'FirefoxTest');
  await page.fill('#lastName', 'Playwright');
  await page.fill('#email', `fxtest${uniq}@example.com`);
  await page.fill('#username', `fxtest${uniq}`);
  await page.fill('#phone', '1234567890');
  await page.fill('#password', 'testpass123');
  await page.fill('#confirmPassword', 'testpass123');
  await page.fill('#businessName', 'Firefox Test Clinic');

  await page.screenshot({ path: '/home/user/workspace/qa_shots/firefox_before_submit.png', fullPage: true });

  // check submit button state
  const btn = page.locator('[data-testid="button-submit-register"]');
  const btnInfo = await btn.evaluate((el) => ({
    disabled: el.disabled,
    tag: el.tagName,
    type: el.getAttribute('type'),
    text: el.textContent,
    pointerEvents: getComputedStyle(el).pointerEvents,
    visibility: getComputedStyle(el).visibility,
    rect: el.getBoundingClientRect(),
  }));
  console.log('BUTTON_INFO', JSON.stringify(btnInfo));

  // check for any invalid form fields
  const invalidFields = await page.evaluate(() => {
    const form = document.querySelector('form');
    if (!form) return 'NO_FORM_FOUND';
    const invalid = [];
    form.querySelectorAll('*').forEach((el) => {
      if (el.matches && el.matches(':invalid')) {
        invalid.push({ id: el.id, tag: el.tagName, name: el.name, validationMessage: el.validationMessage, willValidate: el.willValidate });
      }
    });
    return invalid;
  });
  console.log('INVALID_FIELDS', JSON.stringify(invalidFields));

  await btn.click();
  await page.waitForTimeout(3000);

  await page.screenshot({ path: '/home/user/workspace/qa_shots/firefox_after_submit.png', fullPage: true });

  const urlAfter = page.url();
  const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 500));
  console.log('URL_AFTER', urlAfter);
  console.log('BODY_AFTER', bodyText);
  console.log('LOGS', JSON.stringify(logs, null, 2));

  await browser.close();
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
