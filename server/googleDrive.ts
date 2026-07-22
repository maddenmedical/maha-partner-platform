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
): Promise<{ driveFileId: string; webViewLink: string }> {
  const drive = getDrive();
  const res = await drive.files.create({
    requestBody: {
      name: filename,
      parents: [getFolderId()],
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

// Used by tests/verification to confirm a file actually landed in the folder.
export async function listFolderFiles(): Promise<
  { id: string; name: string; mimeType: string; size?: string }[]
> {
  const drive = getDrive();
  const res = await drive.files.list({
    q: `'${getFolderId()}' in parents and trashed = false`,
    fields: "files(id, name, mimeType, size)",
    pageSize: 100,
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
