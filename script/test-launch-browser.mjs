// Run only against the isolated fixture server, never against live data.
import { chromium, firefox, webkit } from "playwright";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
const base = "http://127.0.0.1:5059";
const fixture = spawn(process.execPath, ["--import", "tsx", "script/test-admin-controls.ts", "--serve"], {
  env: { ...process.env, QA_PORT: "5059" }, stdio: ["ignore", "ignore", "pipe"],
});
process.on("exit", () => fixture.kill());
let ready = false;
for (let attempt = 0; attempt < 100; attempt++) {
  try { if ((await fetch(`${base}/api/health`)).ok) { ready = true; break; } } catch {}
  await new Promise(resolve => setTimeout(resolve, 100));
}
assert.ok(ready, "Isolated QA server failed to start");
const results = [];
for (const [name, engine] of Object.entries({ chromium, firefox, webkit })) {
  if (process.env.QA_ENGINE && name !== process.env.QA_ENGINE) continue;
  const browser = await engine.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 375, height: 812 }, serviceWorkers: "block" });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", e => errors.push(e.message));
    for (const role of ["partner", "student"]) {
      await context.clearCookies();
      await page.goto(`${base}/#/register`);
      await page.getByTestId(`radio-role-${role}`).click();
      const unique = `${name}-${role}-${Date.now()}`;
      for (const [field, value] of Object.entries({
        "first-name": "Browser", "last-name": "QA", email: `${unique}@example.invalid`,
        username: unique, phone: "+431234567", password: "QA-password-2026", "confirm-password": "different-password",
        ...(role === "partner" ? { "business-name": "Synthetic Clinic" } : { profession: "Dentist" }),
      })) await page.getByTestId(`input-${field}`).fill(value);
      assert.equal(await page.getByTestId("button-submit-register").isDisabled(), true);
      await page.getByTestId("checkbox-accept-legal").click();
      await page.getByTestId("button-submit-register").click();
      await page.getByTestId("text-register-error").filter({ hasText: "Passwords do not match" }).waitFor();
      await page.getByTestId("input-confirm-password").fill("QA-password-2026");
      await page.getByTestId("button-submit-register").click();
      await page.getByTestId("card-registration-success").waitFor();
      await page.getByTestId("button-goto-login").click();
      await page.getByTestId("input-email").fill(`${unique}@example.invalid`);
      await page.getByTestId("input-password").fill("QA-password-2026");
      await page.getByTestId("button-submit-login").click();
      await page.getByTestId("card-pending-approval").waitFor();
      await page.getByTestId("button-back-to-login").click();
      results.push({ engine: name, check: `${role}: legal gate, mismatched passwords, registration, pending login`, passed: true });
    }
    await page.getByTestId("input-email").fill("QA-4@EXAMPLE.INVALID");
    await page.getByTestId("input-password").fill("wrong-password");
    await page.getByTestId("button-submit-login").click();
    await page.getByTestId("text-login-error").waitFor();
    await page.getByTestId("input-password").fill("QA-password-2026");
    await page.route("**/api/auth/login", route => route.fulfill({ status: 502, contentType: "text/html", body: "<html>Bad gateway</html>" }), { times: 1 });
    await page.getByTestId("button-submit-login").click();
    await page.getByTestId("text-login-error").filter({ hasText: "temporarily unavailable" }).waitFor();
    assert.equal(await page.getByTestId("button-submit-login").isEnabled(), true);
    await page.getByTestId("button-submit-login").click();
    await page.getByTestId("button-submit-login").waitFor({ state: "hidden" });
    await page.goto(`${base}/#/refer`);
    for (const [field, value] of Object.entries({ "input-patient-first-name": "Synthetic", "input-patient-last-name": name,
      "input-patient-contact": "QA only", "textarea-case-description": "Automated fixture-only referral" })) await page.getByTestId(field).fill(value);
    await page.getByTestId("checkbox-referral-attestation").click();
    await page.getByTestId("button-submit-referral").click();
    await page.locator('[data-testid^="card-referral-"]').filter({ hasText: name }).first().waitFor();
    results.push({ engine: name, check: "wrong password recovery, case-insensitive login, referral submission", passed: true });
    await page.goto(`${base}/#/shop`);
    await page.getByTestId("button-product-detail-1").click();
    await page.getByTestId("button-detail-add-to-cart").click();
    await page.keyboard.press("Escape");
    await page.getByTestId("button-open-cart").click();
    await page.route("**/api/orders", route => route.fulfill({ status: 502, contentType: "text/html", body: "<html>Bad gateway</html>" }), { times: 1 });
    await page.getByTestId("button-submit-order").click();
    await page.getByText("Network error", { exact: false }).first().waitFor();
    assert.equal(await page.getByTestId("row-cart-item-1").isVisible(), true);
    assert.equal(await page.getByTestId("button-submit-order").isEnabled(), true);
    await page.getByTestId("button-submit-order").click();
    await page.getByTestId("button-submit-order").waitFor({ state: "hidden" });
    await page.getByTestId("tab-order-history").click();
    await page.locator('[data-testid^="card-order-"]').first().waitFor();
    results.push({ engine: name, check: "product detail, cart, checkout failure preserves cart, successful retry, order history", passed: true });
    await context.close();
    for (const width of [320, 375, 768, 1440]) {
      const ctx = await browser.newContext({ viewport: { width, height: width > 1000 ? 900 : 740 }, serviceWorkers: "block" });
      const p = await ctx.newPage();
      let closing = false;
      p.on("pageerror", e => { if (!closing) errors.push({ message: e.message, stack: e.stack, url: p.url() }); });
      for (const route of ["/legal/privacy", "/legal/terms"]) {
        await p.goto(`${base}/#${route}`);
        await p.getByRole("heading").first().waitFor();
        assert.ok((await p.locator("body").innerText()).length > 500);
        const fit = await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
        assert.ok(fit, `${name} ${route} ${width} overflow`);
        results.push({ engine: name, route, width, passed: true });
      }
      await ctx.addCookies([{ name: "sid", value: "qa-1", url: base }]);
      await p.reload();
      for (const route of ["/admin/clinics", "/admin/team", "/admin/orders", "/admin/institute", "/admin/todos"]) {
        await p.goto(`${base}/#${route}`);
        await p.locator('[data-testid="loader-session-restore"]').waitFor({ state: "hidden" });
        await p.waitForFunction(() => document.body.innerText.length > 150);
        await p.locator(".animate-pulse").first().waitFor({ state: "hidden" }).catch(() => {});
        assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${name} ${route} ${width} overflow`);
        results.push({ engine: name, route, width, passed: true });
      }
      // The route loop ends on To-Dos. Do not force a full reload of the
      // same URL while its polling request is still settling.
      await p.getByTestId("manage-todo-1").click();
      await p.getByTestId("record-dialog-todo-1").getByText("cannot rewrite another admin's note", { exact: false }).waitFor();
      assert.equal(await p.getByTestId("record-dialog-todo-1").locator("textarea").count(), 0);
      await p.screenshot({ path: `/home/user/workspace/qa-${name}-${width}.png`, animations: "disabled" });
      if (width === 375) {
        await p.getByRole("button", { name: "Cancel", exact: true }).click();
        await p.goto(`${base}/#/admin/orders`);
        await p.getByTestId("delete-order-2").click();
        const dialog = p.getByTestId("record-dialog-order-2");
        await dialog.getByText("Type DELETE 2 to confirm", { exact: true }).waitFor();
        assert.equal(await p.getByTestId("confirm-record-action").isDisabled(), true);
        await dialog.locator("input").fill("DELETE 2");
        assert.equal(await p.getByTestId("confirm-record-action").isEnabled(), true);
        await p.getByRole("button", { name: "Cancel", exact: true }).click();
        await p.goto(`${base}/#/admin/todos`);
        await p.getByTestId("button-theme-toggle").click();
        await p.setViewportSize({ width: 812, height: 375 });
        await p.getByTestId("manage-todo-1").click();
        await p.getByTestId("record-dialog-todo-1").getByText("Assigned admin", { exact: true }).waitFor();
        await p.getByRole("button", { name: "Save changes", exact: true }).scrollIntoViewIfNeeded();
        assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
        await p.screenshot({ path: `/home/user/workspace/qa-${name}-landscape-dark.png`, animations: "disabled" });
        results.push({ engine: name, check: "typed deletion confirmation/cancel; dark landscape dialog scroll and button access", passed: true });
      }
      closing = true; // WebKit reports aborted polling requests while closing.
      await ctx.close();
    }
    assert.deepEqual(errors, []);
    console.log(`${name} passed`);
  } finally { await browser.close(); }
}
await writeFile("/home/user/workspace/maha-launch-browser-results.json", JSON.stringify(results, null, 2));
console.log(`PASS ${results.length} browser scenarios`);
fixture.kill();
