import type Database from "better-sqlite3";
import { compare } from "bcryptjs";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { IStorage } from "./storage";

// An explicit, short-lived operator command, not a recurring campaign.
// Recipient manifest is supplied privately through Render, never bundled
// into the public client. Passwords never leave the server except in their
// own recipient's email.
const CAMPAIGN = "maha-partner-launch-20261002-v1";
const SUBJECT = "Let’s take our MAHA collaboration further";
const FROM = "MAHA Partner Platform <partner@maha.clinic>";
type Recipient = { id: number; email: string; access: "initial" | "signin" };
type LedgerRow = { state: string; provider_id: string | null };
type Config = { recipients: Recipient[]; template: string };

export function parseLaunchConfig(raw: string): Config {
  const config = JSON.parse(raw) as Config;
  if (!Array.isArray(config.recipients) || config.recipients.length !== 59)
    throw new Error("Expected exactly 59 approved recipients");
  const excluded = new Set([48, 105, 55, 43, 99]);
  const ids = new Set<number>(), emails = new Set<string>();
  for (const r of config.recipients) {
    const email = r.email?.trim().toLowerCase();
    if (!Number.isInteger(r.id) || excluded.has(r.id) || ids.has(r.id) ||
        !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || emails.has(email) ||
        !["initial", "signin"].includes(r.access)) throw new Error("Invalid approved recipient manifest");
    if (([28, 53].includes(r.id)) !== (r.access === "signin"))
      throw new Error("Unexpected sign-in-only recipient");
    ids.add(r.id); emails.add(email);
  }
  if (![28, 44, 45, 53].every(id => ids.has(id))) throw new Error("Approved staff or sign-in recipients missing");
  if (typeof config.template !== "string" || config.template.includes("Internal review") ||
      !config.template.includes("{{contact.PORTAL_PASSWORD}}") ||
      !config.template.includes("2026, 20:00–20:45 CEST") ||
      !config.template.includes("https://us06web.zoom.us/j/83383880209?pwd="))
    throw new Error("Invalid approved email template");
  return config;
}

export function signInTemplate(template: string): string {
  const text = template.replace("- **Password:** {{contact.PORTAL_PASSWORD}}\n\nUse these details rather than your old portal password, then change your password in Account Settings.",
      "Sign in with the email address above and the password you currently use for the new MAHA Partner Platform. If you cannot sign in or do not remember it, choose “Forgot password” on the sign-in page to request a secure reset link. You do not need to create another account.");
  if (text.includes("{{contact.PORTAL_PASSWORD}}")) throw new Error("Sign-in template replacement failed");
  return text;
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
export function simpleEmail(markdown: string) {
  // Format before interpolation, so a password containing Markdown characters
  // cannot be interpreted as layout or a link.
  const blocks = markdown.trim().split(/\n\n+/);
  const inline = (s: string) => escapeHtml(s)
    .replace(/\[([^\]]+)\]\((https:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\n/g, "<br>");
  const html = blocks.map(block => block.startsWith("## ") ? `<h3>${inline(block.slice(3))}</h3>` :
    block.startsWith("- ") ? `<ul>${block.split("\n").map(line => `<li>${inline(line.replace(/^- /, ""))}</li>`).join("")}</ul>` :
      `<p>${inline(block)}</p>`).join("\n");
  const text = markdown.replace(/^## /gm, "").replaceAll("**", "")
    .replace(/\[([^\]]+)\]\((https:\/\/[^)]+)\)/g, "$1 ($2)")
    .replace(/^- /gm, "• ");
  return { html, text };
}

export async function runLaunchMail(storage: IStorage, db: Database.Database,
  pause: () => Promise<void> = () => new Promise(resolve => setTimeout(resolve, 1100))) {
  const mode = process.env.MAHA_LAUNCH_MODE;
  if (!["preflight", "test", "send", "status"].includes(mode ?? "")) return;
  if (process.env.RENDER !== "true" || process.env.NODE_ENV !== "production")
    throw new Error("Launch command is only available on Render production");
  if (Date.now() >= Date.parse("2026-10-03T00:00:00Z")) throw new Error("Launch authorization window expired");
  const config = parseLaunchConfig(process.env.MAHA_LAUNCH_CONFIG || "");
  const log = (event: string, detail: object = {}) =>
    console.log("[launch-mail] " + JSON.stringify({ campaign: CAMPAIGN, event, ...detail }));
  const token = process.env.RESEND_API_KEY || process.env.CUSTOM_CRED_API_RESEND_COM_TOKEN;
  if (!token) throw new Error("Render email credential is not configured");
  // Metadata only. Never store payloads, passwords or password-derived hashes.
  db.exec(`CREATE TABLE IF NOT EXISTS launch_mail_ledger (
    campaign TEXT NOT NULL, user_id INTEGER NOT NULL, email TEXT NOT NULL,
    state TEXT NOT NULL, provider_id TEXT, delivery_event TEXT, created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL, PRIMARY KEY(campaign,user_id))`);
  const get = (id: number) => db.prepare("SELECT state,provider_id FROM launch_mail_ledger WHERE campaign=? AND user_id=?").get(CAMPAIGN, id) as LedgerRow | undefined;
  const report = () => log("ledger", { rows: db.prepare("SELECT user_id,email,state,provider_id,delivery_event FROM launch_mail_ledger WHERE campaign=? ORDER BY user_id").all(CAMPAIGN) });
  const deliveryStatus = async () => {
    const sent = db.prepare("SELECT user_id,provider_id FROM launch_mail_ledger WHERE campaign=? AND state='accepted'").all(CAMPAIGN) as { user_id: number; provider_id: string }[];
    for (const row of sent) {
      try {
        const response = await fetch(`https://api.resend.com/emails/${encodeURIComponent(row.provider_id)}`, {
          headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000),
        });
        if (!response.ok) { log("delivery-status-unavailable", { http: response.status }); break; }
        const result = await response.json() as { last_event?: string };
        const event = typeof result.last_event === "string" ? result.last_event : "unknown";
        db.prepare("UPDATE launch_mail_ledger SET delivery_event=?,updated_at=? WHERE campaign=? AND user_id=?")
          .run(event, Date.now(), CAMPAIGN, row.user_id);
        log("delivery", { userId: row.user_id, event });
      } catch { log("delivery-status-unavailable"); break; }
      await pause();
    }
  };
  if (mode === "status") { await deliveryStatus(); report(); return; }
  const members = await storage.listUsersByRoleStatus("partner", "approved");
  for (const r of config.recipients) {
    const user = members.find(u => u.id === r.id);
    if (!user || user.email.trim().toLowerCase() !== r.email.trim().toLowerCase() || !user.firstName?.trim())
      throw new Error(`Recipient ${r.id} no longer matches approved active account`);
    if (r.access === "initial" && !get(r.id)) {
      if (user.credentialsIssuedAt || !user.migratedPasswordPlain ||
          !await compare(user.migratedPasswordPlain, user.passwordHash))
        throw new Error(`Recipient ${r.id} initial password is not currently valid`);
      // Exercise the actual login handler without opening partners' records or
      // retaining a session. The credential stays on this host.
      const origin = `http://127.0.0.1:${process.env.PORT || "5000"}`;
      const login = await fetch(`${origin}/api/auth/login`, {
        method: "POST", signal: AbortSignal.timeout(15_000),
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: user.email, password: user.migratedPasswordPlain }),
      });
      const auth = await login.json() as { user?: { id?: number } };
      const cookie = login.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
      if (cookie) {
        const logout = await fetch(`${origin}/api/auth/logout`, {
          method: "POST", headers: { Cookie: cookie }, signal: AbortSignal.timeout(10_000),
        });
        if (!logout.ok) throw new Error(`Login test session cleanup failed for recipient ${r.id}`);
      }
      if (!login.ok || auth.user?.id !== user.id || !cookie)
        throw new Error(`Production login failed for recipient ${r.id}`);
    }
  }
  const calendar = readFileSync("dist/public/calendar/maha-opg-2026-10-22.ics");
  if (!calendar.includes("DTSTART:20261022T180000Z\r\n") || !calendar.includes("DTEND:20261022T184500Z\r\n"))
    throw new Error("Unexpected calendar content");
  log("preflight-ok", { recipients: 59, initial: 57, signin: 2, loginHandlerChecked: true, calendarBytes: calendar.length,
    templateSha256: createHash("sha256").update(config.template).digest("hex"), from: FROM });
  if (mode === "preflight") { report(); return; }
  if (mode === "send" && get(55)?.state !== "accepted") throw new Error("Successful sender test required before partner release");
  if (mode === "send" && db.prepare("SELECT 1 FROM launch_mail_ledger WHERE campaign=? AND state!='accepted' LIMIT 1").get(CAMPAIGN))
    throw new Error("Prior rejected or uncertain send requires review; nothing further sent");
  const targets: Recipient[] = mode === "test" ? [{ id: 55, email: "elisabeth@maha.clinic", access: "signin" }] : config.recipients;
  const formatted = simpleEmail(config.template);
  for (const r of targets) {
    if (get(r.id)) { log("already-recorded", { userId: r.id, state: get(r.id)!.state }); continue; }
    const user = await storage.getUser(r.id);
    if (!user || user.archivedAt || user.role !== "partner" || user.status !== "approved" ||
        user.email.trim().toLowerCase() !== r.email.trim().toLowerCase()) throw new Error(`Recipient ${r.id} changed before send`);
    const password = r.access === "initial" ? user.migratedPasswordPlain : null;
    if (r.access === "initial" && (!password || user.credentialsIssuedAt || !await compare(password, user.passwordHash)))
      throw new Error(`Recipient ${r.id} password changed before send`);
    // Sign-in variant is selected before rendering; interpolate secrets last.
    const variant = r.access === "signin" ? simpleEmail(signInTemplate(config.template)) : formatted;
    const replace = (s: string, html: boolean) => {
      const encode = html ? escapeHtml : (v: string) => v;
      const result = s.replaceAll("{{contact.FIRSTNAME}}", encode(user.firstName?.trim() || user.name))
        .replaceAll("{{contact.PORTAL_EMAIL}}", encode(user.email))
        .replaceAll("{{contact.PORTAL_PASSWORD}}", encode(password || ""));
      if (result.includes("{{contact.")) throw new Error("Unresolved personalization");
      return result;
    };
    const payload = { from: FROM, to: [user.email], reply_to: "partner@maha.clinic",
      subject: (mode === "test" ? "FINAL TEST: " : "") + SUBJECT,
      text: replace(variant.text, false), html: replace(variant.html, true),
      attachments: [{ filename: "MAHA-OPG-22-October-2026.ics", content_type: "text/calendar", content: calendar.toString("base64") }] };
    const now = Date.now();
    const claimed = db.prepare("INSERT OR IGNORE INTO launch_mail_ledger(campaign,user_id,email,state,created_at,updated_at) VALUES(?,?,?,'reserved',?,?)")
      .run(CAMPAIGN, r.id, user.email, now, now);
    if (claimed.changes !== 1) continue;
    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST", signal: AbortSignal.timeout(30_000),
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "Idempotency-Key": `${CAMPAIGN}-${r.id}` },
        body: JSON.stringify(payload),
      });
      const result = await response.json() as { id?: string; name?: string };
      if (!response.ok || !result.id) {
        db.prepare("UPDATE launch_mail_ledger SET state='rejected',updated_at=? WHERE campaign=? AND user_id=?").run(Date.now(), CAMPAIGN, r.id);
        log("rejected", { userId: r.id, http: response.status, code: result.name });
        break;
      }
      db.prepare("UPDATE launch_mail_ledger SET state='accepted',provider_id=?,updated_at=? WHERE campaign=? AND user_id=?")
        .run(result.id, Date.now(), CAMPAIGN, r.id);
      log("accepted", { userId: r.id, email: user.email, providerId: result.id });
    } catch {
      // A timeout may follow a successful provider send. Never auto-resend.
      db.prepare("UPDATE launch_mail_ledger SET state='uncertain',updated_at=? WHERE campaign=? AND user_id=?").run(Date.now(), CAMPAIGN, r.id);
      log("uncertain", { userId: r.id }); break;
    }
    await pause();
  }
  await deliveryStatus();
  report();
}
