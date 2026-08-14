// Transactional email via Resend (https://resend.com). Sends one request per
// recipient — Resend's sandbox mode (no verified sending domain yet) rejects
// the ENTIRE call if any recipient isn't the account owner's own address, so
// per-recipient sending lets the addresses that ARE allowed still go through
// instead of failing everything. Once a domain is verified in Resend, every
// recipient below will start delivering automatically with no code changes.
//
// Auth: in local/dev (started via the platform's credential-proxy tooling)
// requests to api.resend.com are transparently authenticated. In production
// (published site), CUSTOM_CRED_API_RESEND_COM_TOKEN is injected as a literal
// env var, so we set the Authorization header explicitly when it's present.

const RESEND_BASE_URL = process.env.CUSTOM_CRED_API_RESEND_COM_URL || "https://api.resend.com";
const RESEND_TOKEN = process.env.CUSTOM_CRED_API_RESEND_COM_TOKEN;

// Resend's sandbox (unverified domain) only allows sending FROM the
// resend.dev test domain. Once a custom domain (e.g. maha.clinic) is
// verified in Resend, update this to an address on that domain.
const FROM_ADDRESS = process.env.EMAIL_FROM_ADDRESS || "MAHA Partner Portal <onboarding@resend.dev>";

export type EmailResult = { to: string; ok: boolean; error?: string };

async function sendOne(to: string, subject: string, html: string): Promise<EmailResult> {
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (RESEND_TOKEN) headers.Authorization = `Bearer ${RESEND_TOKEN}`;
    const res = await fetch(`${RESEND_BASE_URL}/emails`, {
      method: "POST",
      headers,
      body: JSON.stringify({ from: FROM_ADDRESS, to: [to], subject, html }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { to, ok: false, error: `HTTP ${res.status}: ${body}` };
    }
    return { to, ok: true };
  } catch (err: any) {
    return { to, ok: false, error: err?.message || "Unknown error" };
  }
}

// Sends the same email to each recipient independently (see file header for
// why). Logs failures but never throws — callers should not let an email
// hiccup break the request that triggered it. Recipients are sent to
// sequentially with a small delay to stay well under Resend's per-second
// rate limit when a catch-up run has several notifications queued up.
export async function sendEmail(to: string[], subject: string, html: string): Promise<EmailResult[]> {
  const results: EmailResult[] = [];
  for (const addr of to) {
    const r = await sendOne(addr, subject, html);
    if (!r.ok) console.error(`[email] failed to send "${subject}" to ${r.to}:`, r.error);
    else console.log(`[email] sent "${subject}" to ${r.to}`);
    results.push(r);
    if (to.length > 1) await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return results;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

function row(label: string, value: string | null | undefined): string {
  if (!value) return "";
  return `<tr><td style="padding:4px 12px 4px 0;color:#666;font-size:13px;white-space:nowrap;vertical-align:top;">${escapeHtml(label)}</td><td style="padding:4px 0;font-size:13px;">${escapeHtml(value)}</td></tr>`;
}

export interface RegistrationEmailInput {
  fullName: string;
  role: string;
  email: string;
  phone: string;
  username: string;
  businessName?: string | null;
  vatNumber?: string | null;
  profession?: string | null;
  homepageUrl?: string | null;
  city?: string | null;
  address?: string | null;
  country?: string | null;
  additionalInfo: string;
  degreeFileUrl?: string | null;
  approveUrl: string;
  declineUrl: string;
}

export function buildRegistrationEmailHtml(r: RegistrationEmailInput): string {
  const btn = (href: string, label: string, bg: string) =>
    `<a href="${href}" style="display:inline-block;padding:10px 22px;margin-right:10px;border-radius:6px;background:${bg};color:#111;font-weight:600;text-decoration:none;font-size:14px;">${label}</a>`;
  return `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;">
    <h2 style="color:#111;">New ${escapeHtml(r.role)} registration request</h2>
    <p style="color:#444;font-size:14px;">Someone just requested access to the MAHA Partner Portal. Review the details below and approve or decline.</p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0;border-top:1px solid #eee;border-bottom:1px solid #eee;padding:8px 0;">
      ${row("Name", r.fullName)}
      ${row("Role requested", r.role)}
      ${row("Email", r.email)}
      ${row("Phone", r.phone)}
      ${row("Username", r.username)}
      ${row("Business / clinic", r.businessName)}
      ${row("VAT number", r.vatNumber)}
      ${row("Profession", r.profession)}
      ${row("Homepage", r.homepageUrl)}
      ${row("City", r.city)}
      ${row("Address", r.address)}
      ${row("Country", r.country)}
      ${row("Specialty / qualification", r.additionalInfo)}
    </table>
    ${r.degreeFileUrl ? `<p style="font-size:14px;"><a href="${r.degreeFileUrl}" style="color:#b8860b;">View uploaded degree / license document &rarr;</a></p>` : `<p style="font-size:13px;color:#999;">No degree/license document was uploaded.</p>`}
    <div style="margin:24px 0;">
      ${btn(r.approveUrl, "Approve access", "#ffbf42")}
      ${btn(r.declineUrl, "Decline", "#eee")}
    </div>
    <p style="font-size:12px;color:#999;">These links are single-use and only work once. You can also review this and all other pending requests any time from the Admin panel.</p>
  </div>`;
}
