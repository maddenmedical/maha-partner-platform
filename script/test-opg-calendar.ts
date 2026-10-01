// Production static-handler test, no database or external services.
// Run after npm run build: npx tsx script/test-opg-calendar.ts
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { chromium, firefox, webkit } from "playwright";
import { serveStatic } from "../server/static";

const file = await readFile("client/public/calendar/maha-opg-2026-10-22.ics", "utf8");
assert.equal(file.replace(/\r\n/g, "").includes("\n"), false, "ICS must use CRLF");
for (const line of file.split("\r\n")) assert.ok(Buffer.byteLength(line, "utf8") <= 75, `Long ICS line: ${line}`);
const unfolded = file.replace(/\r\n[ \t]/g, "");
assert.equal((unfolded.match(/BEGIN:VEVENT/g) || []).length, 1);
assert.match(unfolded, /DTSTART:20261022T180000Z\r\n/);
assert.match(unfolded, /DTEND:20261022T184500Z\r\n/);
assert.match(unfolded, /UID:maha-opg-20261022@maha.clinic/);
const zoom = "https://us06web.zoom.us/j/83383880209?pwd=bdiEW7lCSY75uaXxoQbQdYDJ26dVE0.1";
assert.ok(unfolded.includes(`URL:${zoom}\r\n`));
assert.ok(unfolded.includes(`Join via Zoom: ${zoom}`));
assert.doesNotMatch(unfolded, /^(ATTENDEE|ORGANIZER|METHOD):/m);
for (const timeZone of ["Europe/Vienna", "Europe/Ljubljana"]) {
  const format = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false });
  assert.equal(format.format(new Date("2026-10-22T18:00:00Z")), "20:00");
  assert.equal(format.format(new Date("2026-10-22T18:45:00Z")), "20:45");
}
assert.equal((Date.parse("2026-10-22T18:45:00Z") - Date.parse("2026-10-22T18:00:00Z")) / 60000, 45);

const app = express();
serveStatic(app, path.resolve("dist/public"));
const server = createServer(app);
await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${(server.address() as any).port}/calendar/maha-opg-2026-10-22.ics`;
try {
  const response = await fetch(url);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") || "", /^text\/calendar/);
  assert.equal(response.headers.get("content-disposition"), 'attachment; filename="MAHA-OPG-22-October-2026.ics"');
  assert.match(response.headers.get("cache-control") || "", /no-store/);
  assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow");
  assert.equal(response.headers.get("set-cookie"), null);
  assert.equal(await response.text(), file);
  const head = await fetch(url, { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.match(head.headers.get("content-type") || "", /^text\/calendar/);
  assert.equal(await head.text(), "");
  let downloads = 0;
  for (const [name, engine] of Object.entries({ chromium, firefox, webkit })) {
    const browser = await engine.launch({ headless: true });
    try {
      for (const width of [375, 1440]) {
        const context = await browser.newContext({ acceptDownloads: true, viewport: { width, height: 812 } });
        const page = await context.newPage();
        await page.setContent(`<a href="${url}">Add to calendar (.ics)</a>`);
        const downloaded = page.waitForEvent("download");
        await page.getByRole("link", { name: "Add to calendar (.ics)" }).click();
        const download = await downloaded;
        assert.equal(download.suggestedFilename(), "MAHA-OPG-22-October-2026.ics");
        assert.equal(await download.failure(), null);
        assert.equal(await readFile((await download.path())!, "utf8"), file);
        downloads++;
        await context.close();
      }
      console.log(`${name}: mobile/desktop unauthenticated calendar downloads passed`);
    } finally { await browser.close(); }
  }
  console.log(`PASS: ICS content, CRLF/folding, correct local times, 45-minute duration, Zoom URL, unauthenticated GET/HEAD and ${downloads} browser downloads.`);
} finally {
  await new Promise<void>(resolve => server.close(() => resolve()));
}
