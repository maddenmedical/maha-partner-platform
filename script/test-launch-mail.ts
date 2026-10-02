// Synthetic records only; every HTTP request is intercepted. No .env load.
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { hash } from "bcryptjs";
import { readFileSync } from "node:fs";
import { runLaunchMail, parseLaunchConfig, simpleEmail, signInTemplate } from "../server/launchMail";
import type { IStorage } from "../server/storage";

const template = `Dear {{contact.FIRSTNAME}},

## Join me on 22 October

22 October 2026, 20:00–20:45 CEST

**[Join me on Zoom](https://us06web.zoom.us/j/83383880209?pwd=fixture)**

- **Email:** {{contact.PORTAL_EMAIL}}
- **Password:** {{contact.PORTAL_PASSWORD}}

Use these details rather than your old portal password, then change your password in Account Settings.`;
const ids = [28, 44, 45, 53, ...Array.from({ length: 55 }, (_, i) => 1000 + i)];
const recipients = ids.map(id => ({ id, email: `synthetic-${id}@example.invalid`, access: [28,53].includes(id) ? "signin" : "initial" }));
const password = 'Synthetic**<>&"[link](https://evil.invalid)';
const passwordHash = await hash(password, 4);
const members = recipients.map(r => ({ ...r, name: `Person ${r.id}`, firstName: `Name ${r.id}`,
  role: "partner", status: "approved", archivedAt: null, credentialsIssuedAt: null,
  migratedPasswordPlain: password, passwordHash }));
const canary = { ...members[0], id: 55, email: "elisabeth@maha.clinic", firstName: "Elisabeth" };
const storage = { listUsersByRoleStatus: async () => members,
  getUser: async (id: number) => id === 55 ? canary : members.find(u => u.id === id) } as unknown as IStorage;
process.env.NODE_ENV = "production";
process.env.RENDER = "true";
process.env.RESEND_API_KEY = "synthetic-not-a-key";
process.env.MAHA_LAUNCH_CONFIG = JSON.stringify({ recipients, template });
let payloads: any[] = [], logins = 0, logouts = 0, behavior = "ok";
globalThis.fetch = (async (url: string, init: RequestInit) => {
  if (url.endsWith("/api/auth/login")) {
    logins++;
    const data = JSON.parse(init.body as string);
    assert.equal(data.password, password);
    const member = members.find(u => u.email === data.email)!;
    return new Response(JSON.stringify({ user: { id: member.id } }), { headers: { "Set-Cookie": "session=synthetic; Path=/; HttpOnly" } });
  }
  if (url.endsWith("/api/auth/logout")) { logouts++; return new Response("{}"); }
  if (url.startsWith("https://api.resend.com/emails/")) return new Response('{"last_event":"delivered"}');
  assert.equal(url, "https://api.resend.com/emails");
  if (behavior === "timeout") throw new Error("Synthetic timeout");
  const payload = JSON.parse(init.body as string);
  payloads.push(payload);
  assert.equal(payload.from, "MAHA Partner Platform <partner@maha.clinic>");
  assert.equal(payload.reply_to, "partner@maha.clinic");
  assert.equal(payload.to.length, 1);
  assert.ok(!payload.cc && !payload.bcc);
  assert.ok(!payload.text.includes("{{"));
  assert.ok(!payload.html.includes("{{"));
  assert.deepEqual(Buffer.from(payload.attachments[0].content, "base64"), readFileSync("dist/public/calendar/maha-opg-2026-10-22.ics"));
  if (behavior === "reject") return new Response('{"name":"validation_error"}', { status: 401 });
  return new Response(JSON.stringify({ id: `synthetic-${payloads.length}` }));
}) as typeof fetch;
const silentPause = async () => {};
const db = new Database(":memory:");
try {
  assert.throws(() => parseLaunchConfig(JSON.stringify({ recipients: recipients.slice(1), template })));
  assert.throws(() => parseLaunchConfig(JSON.stringify({ recipients: [...recipients.slice(1), recipients[1]], template })));
  assert.ok(!signInTemplate(template).includes("PORTAL_PASSWORD"));
  assert.ok(simpleEmail(template).html.includes("<h3>"));
  process.env.MAHA_LAUNCH_MODE = "preflight";
  await runLaunchMail(storage, db, silentPause);
  assert.equal(payloads.length, 0); assert.equal(logins, 57); assert.equal(logouts, 57);
  process.env.MAHA_LAUNCH_MODE = "send";
  await assert.rejects(runLaunchMail(storage, db, silentPause), /Successful sender test/);
  process.env.MAHA_LAUNCH_MODE = "test";
  await runLaunchMail(storage, db, silentPause);
  assert.equal(payloads.length, 1);
  assert.deepEqual(payloads[0].to, ["elisabeth@maha.clinic"]);
  assert.ok(!payloads[0].text.includes(password));
  assert.ok(payloads[0].text.includes("Forgot password"));
  await runLaunchMail(storage, db, silentPause);
  assert.equal(payloads.length, 1);
  process.env.MAHA_LAUNCH_MODE = "send";
  await runLaunchMail(storage, db, silentPause);
  assert.equal(payloads.length, 60);
  assert.equal(new Set(payloads.map(p => p.to[0])).size, 60);
  const initial = payloads.find(p => p.to[0] === "synthetic-44@example.invalid");
  assert.ok(initial.text.includes(password));
  assert.ok(initial.html.includes("Synthetic**&lt;&gt;&amp;&quot;[link](https://evil.invalid)"));
  for (const id of [28,53]) assert.ok(!payloads.find(p => p.to[0] === `synthetic-${id}@example.invalid`).text.includes(password));
  await runLaunchMail(storage, db, silentPause);
  assert.equal(payloads.length, 60);
  assert.equal(db.prepare("SELECT count(*) n FROM launch_mail_ledger WHERE state='accepted'").get().n, 60);
  for (const fail of ["reject", "timeout"]) {
    db.prepare("DELETE FROM launch_mail_ledger WHERE user_id != 55").run();
    behavior = fail;
    await runLaunchMail(storage, db, silentPause);
    const rows = db.prepare("SELECT state FROM launch_mail_ledger WHERE user_id != 55").all() as { state: string }[];
    assert.equal(rows.length, 1);
    assert.equal(rows[0].state, fail === "reject" ? "rejected" : "uncertain");
  }
  db.prepare("DELETE FROM launch_mail_ledger WHERE user_id != 55").run();
  const changed = members.find(u => u.id === 44)!;
  changed.migratedPasswordPlain = "obsolete";
  await assert.rejects(runLaunchMail(storage, db, silentPause), /not currently valid/);
  changed.migratedPasswordPlain = password;
  changed.email = "changed@example.invalid";
  await assert.rejects(runLaunchMail(storage, db, silentPause), /no longer matches/);
  console.log("PASS: 59 recipients, own credentials, live-login handler/cleanup, sign-in variants, exact sender/calendar, duplicate suppression, errors/unknown delivery, changed-account blocks.");
} finally { db.close(); }
