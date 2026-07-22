import { test, expect, request as pwRequest, APIRequestContext } from "@playwright/test";

// End-to-end verification that Drive storage works via the OAuth refresh-token
// flow: real file content is uploaded through the app's own endpoints, persisted
// to Drive, recorded in uploaded_files, and served back through the authorized
// proxy with correct per-category access control.

const ADMIN = { email: "elisabeth.madden.medical@gmail.com", password: "MahaAdmin2026!" };
const STUDENT = { email: "student.demo@maha.clinic", password: "StudentDemo2026!" };
const PARTNER = { email: "partner.demo@maha.clinic", password: "PartnerDemo2026!" };

// A tiny but non-empty PNG (1x1 red pixel) so uploads carry real content.
const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

async function login(ctx: APIRequestContext, creds: { email: string; password: string }) {
  const res = await ctx.post("/api/auth/login", { data: creds });
  expect(res.ok(), `login ${creds.email}`).toBeTruthy();
  const body = await res.json();
  return { token: body.token as string, user: body.user as { id: number; role: string } };
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

test.describe("Drive OAuth refresh-token — real end-to-end uploads", () => {
  test("homework upload persists real content, fetchable by owner + admin, 403 for other student", async ({ baseURL }) => {
    const ctx = await pwRequest.newContext({ baseURL: baseURL! });
    const student = await login(ctx, STUDENT);
    const admin = await login(ctx, ADMIN);

    // Upload through the app's own student endpoint with real bytes.
    const up = await ctx.post("/api/homework/upload", {
      headers: auth(student.token),
      multipart: {
        file: { name: "hw-oauth-test.png", mimeType: "image/png", buffer: PNG_1x1 },
      },
    });
    expect(up.ok(), `homework upload status ${up.status()}`).toBeTruthy();
    const upBody = await up.json();
    // url is /api/files/<driveFileId>
    const driveFileId = upBody.url.split("/").pop() as string;
    expect(driveFileId, "drive file id returned").toBeTruthy();
    expect(driveFileId.length).toBeGreaterThan(10);
    console.log("HOMEWORK_DRIVE_FILE_ID=" + driveFileId);

    // Owner (student) can fetch real content back.
    const asOwner = await ctx.get(`/api/files/${driveFileId}`, { headers: auth(student.token) });
    expect(asOwner.status(), "owner fetch").toBe(200);
    const ownerBytes = await asOwner.body();
    expect(ownerBytes.length, "owner content non-empty").toBeGreaterThan(0);
    expect(ownerBytes.equals(PNG_1x1), "owner content matches uploaded bytes").toBeTruthy();

    // Admin can fetch it too.
    const asAdmin = await ctx.get(`/api/files/${driveFileId}`, { headers: auth(admin.token) });
    expect(asAdmin.status(), "admin fetch").toBe(200);
    expect((await asAdmin.body()).length).toBeGreaterThan(0);

    // A different student must be forbidden. Create + approve one.
    const otherEmail = `other.student.${Date.now()}@maha.clinic`;
    const reg = await ctx.post("/api/auth/register", {
      data: { role: "student", name: "Other Student", email: otherEmail, password: "OtherPass123", phone: "+386 40 000 000" },
    });
    expect(reg.ok(), "register other student").toBeTruthy();
    const otherId = (await reg.json()).id as number;
    const approve = await ctx.patch(`/api/admin/users/${otherId}/status`, {
      headers: auth(admin.token),
      data: { status: "approved" },
    });
    expect(approve.ok(), "approve other student").toBeTruthy();
    const other = await login(ctx, { email: otherEmail, password: "OtherPass123" });

    const asOther = await ctx.get(`/api/files/${driveFileId}`, { headers: auth(other.token) });
    expect(asOther.status(), "other student forbidden").toBe(403);

    await ctx.dispose();
  });

  test("registration document upload persists real content (admin-only access)", async ({ baseURL }) => {
    const ctx = await pwRequest.newContext({ baseURL: baseURL! });
    const admin = await login(ctx, ADMIN);
    const student = await login(ctx, STUDENT);

    // Registration docs are uploaded pre-auth (no token) via the shared endpoint.
    const up = await ctx.post("/api/auth/upload-document", {
      multipart: {
        file: { name: "degree-oauth-test.txt", mimeType: "text/plain", buffer: Buffer.from("MAHA degree document — real content") },
      },
    });
    expect(up.ok(), `registration upload status ${up.status()}`).toBeTruthy();
    const driveFileId = (await up.json()).url.split("/").pop() as string;
    expect(driveFileId.length).toBeGreaterThan(10);
    console.log("REGISTRATION_DRIVE_FILE_ID=" + driveFileId);

    // Admin can read it; content matches.
    const asAdmin = await ctx.get(`/api/files/${driveFileId}`, { headers: auth(admin.token) });
    expect(asAdmin.status()).toBe(200);
    expect((await asAdmin.text())).toContain("real content");

    // A student must not (registration = admin-only).
    const asStudent = await ctx.get(`/api/files/${driveFileId}`, { headers: auth(student.token) });
    expect(asStudent.status()).toBe(403);

    await ctx.dispose();
  });

  test("referral attachment upload persists real content, fetchable by owning partner + admin", async ({ baseURL }) => {
    const ctx = await pwRequest.newContext({ baseURL: baseURL! });
    const partner = await login(ctx, PARTNER);
    const admin = await login(ctx, ADMIN);

    // Referral attachments are uploaded authenticated with context=referral.
    const up = await ctx.post("/api/auth/upload-document", {
      headers: auth(partner.token),
      multipart: {
        context: "referral",
        file: { name: "referral-oauth-test.txt", mimeType: "text/plain", buffer: Buffer.from("Patient case notes — real referral content") },
      },
    });
    expect(up.ok(), `referral upload status ${up.status()}`).toBeTruthy();
    const driveFileId = (await up.json()).url.split("/").pop() as string;
    expect(driveFileId.length).toBeGreaterThan(10);
    console.log("REFERRAL_DRIVE_FILE_ID=" + driveFileId);

    // Owning partner can read the real content back.
    const asPartner = await ctx.get(`/api/files/${driveFileId}`, { headers: auth(partner.token) });
    expect(asPartner.status()).toBe(200);
    expect(await asPartner.text()).toContain("real referral content");

    // Admin can read it too.
    const asAdmin = await ctx.get(`/api/files/${driveFileId}`, { headers: auth(admin.token) });
    expect(asAdmin.status()).toBe(200);

    await ctx.dispose();
  });
});
