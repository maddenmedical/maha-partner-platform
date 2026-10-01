// Use the synthetic fixture server: QA_PORT=5058 npx tsx script/test-admin-controls.ts --serve
// Browser install events are simulated; this does not certify native OS installation.
import assert from "node:assert/strict";
import { chromium, firefox, webkit } from "playwright";
const base = "http://127.0.0.1:5058";
const browser = await chromium.launch({ headless: true });
let checks = 0;
const errors = [];
async function pageFor(options = {}) {
  const context = await browser.newContext({ viewport: { width: 375, height: 812 }, serviceWorkers: "block", ...options });
  const page = await context.newPage();
  page.on("pageerror", e => errors.push(e.message));
  await page.goto(`${base}/#/install`);
  await page.getByTestId("card-install-guide").waitFor();
  return { context, page };
}
async function injectPrompt(page, outcome) {
  await page.evaluate(outcome => {
    window.qaPromptCalls = 0;
    const event = new Event("beforeinstallprompt", { cancelable: true });
    event.prompt = async () => {
      window.qaPromptCalls++;
      if (outcome === "error") throw new Error("Synthetic prompt failure");
      if (outcome === "installed-race") window.dispatchEvent(new Event("appinstalled"));
    };
    event.userChoice = Promise.resolve({ outcome: outcome === "dismissed" ? "dismissed" : "accepted" });
    window.dispatchEvent(event);
  }, outcome);
}
try {
  // Initial priority, viewport fit, help disclosure and platform switching.
  for (const width of [320, 375, 1440]) {
    const { context, page } = await pageFor({ viewport: { width, height: 812 } });
    const install = page.getByTestId("button-install-maha");
    assert.equal(await page.locator("main button").first().innerText(), "Install MAHA");
    assert.equal(await page.locator("#install-help").isVisible(), false);
    const box = await install.boundingBox();
    assert.ok(box && box.y + box.height < 812);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.getByTestId("button-install-help").click();
    for (const platform of ["iphone", "android", "windows", "mac"]) {
      await page.getByTestId(`tab-platform-${platform}`).click();
      assert.equal(await page.getByTestId(`tab-platform-${platform}`).getAttribute("aria-selected"), "true");
      assert.ok(await page.locator('[role="tabpanel"][data-state="active"]').innerText());
    }
    await page.getByTestId("button-install-help").click();
    assert.equal(await page.locator("#install-help").isVisible(), false);
    await page.getByTestId("button-open-browser").click();
    await page.getByTestId("input-email").waitFor();
    checks++;
    await context.close();
  }
  // Supported prompt, dismissal, failure and appinstalled/prompt race.
  for (const outcome of ["accepted", "dismissed", "error", "installed-race"]) {
    const { context, page } = await pageFor();
    await injectPrompt(page, outcome);
    await page.getByTestId("text-install-explanation").filter({ hasText: "confirm installation" }).waitFor();
    await page.getByTestId("button-install-maha").click();
    if (outcome === "installed-race") {
      await page.getByTestId("text-already-installed").waitFor();
      assert.equal(await page.getByTestId("button-install-maha").count(), 0);
    } else if (outcome === "accepted") {
      await page.getByTestId("text-install-requested").waitFor();
      assert.equal(await page.getByTestId("button-install-maha").count(), 0);
    } else {
      await page.getByTestId("text-install-notice").waitFor();
      assert.equal(await page.locator("#install-help").isVisible(), true);
      assert.equal(await page.getByTestId("button-install-maha").isEnabled(), true);
      await page.getByTestId("button-install-maha").click();
    }
    assert.equal(await page.evaluate(() => window.qaPromptCalls), 1);
    checks++;
    await context.close();
  }
  // No prompt on iPhone, including opening from an email browser.
  const { context, page } = await pageFor({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1" });
  await page.getByTestId("button-install-maha").click();
  await page.getByTestId("text-install-notice").filter({ hasText: "Share menu" }).waitFor();
  assert.equal(await page.getByTestId("tab-platform-iphone").getAttribute("aria-selected"), "true");
  assert.match(await page.locator('[role="tabpanel"][data-state="active"]').innerText(), /email app/);
  checks++;
  await context.close();

  // Standalone app launch must not offer to install again.
  const standalone = await browser.newContext({ serviceWorkers: "block" });
  await standalone.addInitScript(() => Object.defineProperty(navigator, "standalone", { value: true }));
  const installedPage = await standalone.newPage();
  await installedPage.goto(`${base}/#/install`);
  await installedPage.getByTestId("text-already-installed").waitFor();
  assert.equal(await installedPage.getByTestId("button-install-maha").count(), 0);
  await installedPage.getByTestId("button-open-browser").click();
  await installedPage.getByTestId("input-email").waitFor();
  checks++;
  await standalone.close();
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
for (const [name, engine] of Object.entries({ firefox, webkit })) {
  const b = await engine.launch({ headless: true });
  try {
    const p = await b.newPage({ viewport: { width: 375, height: 812 } });
    p.on("pageerror", e => errors.push(e.message));
    await p.goto(`${base}/#/install`);
    await p.getByTestId("button-install-maha").click();
    await p.getByTestId("text-install-notice").waitFor();
    assert.ok(await p.locator("#install-help").isVisible());
    assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await p.getByTestId("button-open-browser").click();
    await p.getByTestId("input-email").waitFor();
    checks++;
    console.log(`${name}: fallback and browser access passed`);
  } finally { await b.close(); }
}
assert.deepEqual(errors, []);
console.log(`PASS: ${checks} install-page scenarios with viewport, control and prompt lifecycle assertions; no page errors. Native installation events simulated.`);
