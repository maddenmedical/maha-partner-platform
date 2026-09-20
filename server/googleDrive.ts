import { google } from "googleapis";
import { Readable } from "node:stream";

function getFolderId(): string {
  const id = process.env.GOOGLE_DRIVE_FOLDER_ID;
  if (!id) throw new Error("GOOGLE_DRIVE_FOLDER_ID is not set");
  return id;
}

function getDrive() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("Google OAuth credentials are not configured");
  }
  // OAuth 2.0 refresh-token flow: uploads use the real storage quota of the
  // account that authorized the token (unlike a service account, which has no
  // quota on a personal Drive folder). googleapis mints and refreshes the
  // short-lived access token automatically from the refresh token.
  const auth = new google.auth.OAuth2(clientId, clientSecret);
  auth.setCredentials({ refresh_token: refreshToken });
  return google.drive({ version: "v3", auth });
}

export async function uploadToDrive(
  buffer: Buffer,
  filename: string,
  mimeType: string,
  folderId?: string,
): Promise<{ driveFileId: string; webViewLink: string }> {
  const drive = getDrive();
  const res = await drive.files.create({
    requestBody: {
      name: filename,
      // Uploads default to the main folder; callers (e.g. the backup routine)
      // can pass an explicit subfolder id to keep their files separate.
      parents: [folderId || getFolderId()],
    },
    media: {
      mimeType,
      body: Readable.from(buffer),
    },
    fields: "id, webViewLink",
    // Kept private — no permissions are added, so only the service account and
    // the folder owner can access it on the Drive side. All app access is
    // enforced by our own proxy route.
    supportsAllDrives: true,
  });
  const driveFileId = res.data.id;
  if (!driveFileId) throw new Error("Drive upload did not return a file id");
  return { driveFileId, webViewLink: res.data.webViewLink || "" };
}

// Replaces an existing Drive file's bytes/mimeType in place, keeping the
// same `fileId` (and therefore the same public-facing /api/files/:id URL).
// Used by the chat video pipeline: the original upload lands on Drive
// immediately under a stable id so the message can be sent right away, then
// once the background re-encode finishes this swaps in the transcoded
// version without ever changing the URL the message already references.
export async function replaceDriveFileContent(
  fileId: string,
  buffer: Buffer,
  mimeType: string,
): Promise<void> {
  const drive = getDrive();
  await drive.files.update({
    fileId,
    media: {
      mimeType,
      body: Readable.from(buffer),
    },
    supportsAllDrives: true,
  });
}

export async function streamFromDrive(
  driveFileId: string,
): Promise<NodeJS.ReadableStream> {
  const drive = getDrive();
  const res = await drive.files.get(
    { fileId: driveFileId, alt: "media", supportsAllDrives: true },
    { responseType: "stream" },
  );
  return res.data as unknown as NodeJS.ReadableStream;
}

// Range-aware variant used for video/audio playback. Browsers' <video>/<audio>
// elements probe with a Range request and expect a matching 206 Partial
// Content response -- without that they often refuse to play at all, which is
// the actual cause of "videos won't open or play", not the file format.
// Forwards the client's Range header straight through to Drive's media
// endpoint and mirrors back whatever status/headers Drive returns.
export async function streamFromDriveRanged(
  driveFileId: string,
  range?: string,
): Promise<{ stream: NodeJS.ReadableStream; status: number; headers: Record<string, string> }> {
  const drive = getDrive();
  const res = await drive.files.get(
    { fileId: driveFileId, alt: "media", supportsAllDrives: true },
    {
      responseType: "stream",
      headers: range ? { Range: range } : undefined,
    },
  );
  const rawHeaders = (res.headers || {}) as Record<string, unknown>;
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(rawHeaders)) {
    if (typeof value === "string") headers[key.toLowerCase()] = value;
  }
  return {
    stream: res.data as unknown as NodeJS.ReadableStream,
    status: res.status,
    headers,
  };
}

// Used by tests/verification to confirm a file actually landed in the folder.
// Defaults to the main uploads folder, but accepts an explicit folder id so the
// backup routine can list/prune the dedicated "App Backups" subfolder.
export async function listFolderFiles(
  folderId?: string,
): Promise<{ id: string; name: string; mimeType: string; size?: string }[]> {
  const drive = getDrive();
  const res = await drive.files.list({
    q: `'${folderId || getFolderId()}' in parents and trashed = false`,
    fields: "files(id, name, mimeType, size)",
    pageSize: 1000,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  return (res.data.files || []).map((f) => ({
    id: f.id!,
    name: f.name!,
    mimeType: f.mimeType!,
    size: f.size || undefined,
  }));
}

// Permanently delete a file from Drive (used by backup retention pruning).
export async function deleteFromDrive(fileId: string): Promise<void> {
  const drive = getDrive();
  await drive.files.delete({ fileId, supportsAllDrives: true });
}

// Find-or-create a dedicated "App Backups" subfolder inside the main Drive
// folder so database backups don't clutter the uploads folder. The resolved id
// is cached in-process to avoid a lookup on every backup run.
let cachedBackupFolderId: string | null = null;

export async function getOrCreateBackupFolderId(): Promise<string> {
  if (cachedBackupFolderId) return cachedBackupFolderId;
  const drive = getDrive();
  const parentId = getFolderId();
  const existing = await drive.files.list({
    q: `'${parentId}' in parents and name = 'App Backups' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: "files(id, name)",
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  if (existing.data.files && existing.data.files.length > 0) {
    cachedBackupFolderId = existing.data.files[0].id!;
    return cachedBackupFolderId;
  }
  const created = await drive.files.create({
    requestBody: {
      name: "App Backups",
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentId],
    },
    fields: "id",
    supportsAllDrives: true,
  });
  cachedBackupFolderId = created.data.id!;
  return cachedBackupFolderId;
}
