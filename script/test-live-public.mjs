// Read-only checks. Does not register, sign in, submit forms or send messages.
import { chromium, firefox, webkit } from "playwright";
import { writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
const base = "https://maha-partner-platform.onrender.com";
const results = [];
for (const [engineName, engine] of Object.entries({ chromium, firefox, webkit })) {
  const browser = await engine.launch({ headless: true });
  try {
    for (const width of [375, 1440]) {
      const context = await browser.newContext({ viewport: { width, height: 812 } });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", e => errors.push(e.message));
      for (const path of ["/login", "/register", "/forgot-password", "/install", "/legal/privacy", "/legal/terms"]) {
        const response = await page.goto(`${base}/#${path}`, { waitUntil: "networkidle", timeout: 60000 });
        assert.ok(response === null || response.ok());
        assert.ok((await page.locator("body").innerText()).length > 100);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
        const broken = await page.locator("img").evaluateAll(images => images.filter(i => !i.complete || i.naturalWidth === 0).map(i => i.src));
        assert.deepEqual(broken, []);
        results.push({ engine: engineName, width, path, passed: true });
      }
      assert.deepEqual(errors, []);
      await context.close();
    }
    console.log(`${engineName} live public read-only checks passed`);
  } finally { await browser.close(); }
}
await writeFile("/home/user/workspace/maha-live-public-results.json", JSON.stringify(results, null, 2));
console.log(`PASS ${results.length} live public layout checks; no live mutations.`);
