import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
// Same bundled static ffmpeg binary already used for voice-note mp3
// conversion (see audioConvert.ts) -- no extra dependency needed.
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";

// iPhones save recorded/shared videos as .mov ("video/quicktime"). Safari
// plays that container natively, but Chrome/Firefox/Edge refuse to play a
// resource labeled video/quicktime at all -- even when the underlying
// H.264/AAC codec inside is one they fully support. This remuxes the file
// into a standard .mp4 container (fast container-only rewrite, no
// re-encoding, so there's no quality loss and it takes well under a
// second even for a full 50MB attachment) so it plays everywhere.
//
// Returns the original buffer/filename/mimeType unchanged for anything
// that isn't a .mov upload. Still used by the upload routes that were not
// part of the WhatsApp-style chat video fix (Staff Room, Community,
// product resources) -- see `reencodeVideoForUpload` below for the fuller
// re-encode + thumbnail pipeline used by the 1:1 partner/admin chat.
export async function normalizeVideoForUpload(
  buffer: Buffer,
  originalname: string,
  mimetype: string,
): Promise<{ buffer: Buffer; filename: string; mimeType: string }> {
  if (mimetype !== "video/quicktime") {
    return { buffer, filename: originalname, mimeType: mimetype };
  }

  const tmpDir = os.tmpdir();
  const token = crypto.randomBytes(8).toString("hex");
  const inputPath = path.join(tmpDir, `vid-${token}.mov`);
  const outputPath = path.join(tmpDir, `vid-${token}.mp4`);

  try {
    fs.writeFileSync(inputPath, buffer);
    await runFfmpeg([
      "-y",
      "-i", inputPath,
      // Stream copy -- just rewrites the container, doesn't touch the
      // encoded video/audio data. If the source codec truly can't live in
      // an mp4 box (rare), ffmpeg exits non-zero and we fall back below.
      "-c", "copy",
      "-movflags", "+faststart",
      outputPath,
    ]);
    const outBuffer = fs.readFileSync(outputPath);
    const newName = originalname.replace(/\.[^.]+$/, "") + ".mp4";
    return { buffer: outBuffer, filename: newName, mimeType: "video/mp4" };
  } catch {
    // Remux failed (unsupported codec, corrupt file, etc.) -- fall back to
    // storing the original .mov. The serving route still relabels
    // video/quicktime as video/mp4 on the way out, which covers many cases.
    return { buffer, filename: originalname, mimeType: mimetype };
  } finally {
    fs.unlink(inputPath, () => { /* best-effort cleanup */ });
    fs.unlink(outputPath, () => { /* best-effort cleanup */ });
  }
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const proc = spawn(ffmpegInstaller.path, args);
    let stderr = "";
    proc.stderr.on("data", (d) => { stderr += d.toString(); });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-500)}`));
    });
  });
}

// Real re-encode (not just a container remux) to the single most broadly
// compatible combination there is: H.264 Baseline profile + AAC audio in an
// mp4 container with a leading moov atom. This is deliberately the same
// target format messaging apps like WhatsApp normalize to -- it plays on
// every browser/engine we care about (desktop Chrome/Firefox/Edge, mobile
// Safari, and -- the case that actually motivated this -- WKWebView inside an
// installed iOS "Add to Home Screen" PWA, which is stricter about codecs/
// profiles than Safari itself and is where a same-device HEVC or exotic-
// profile recording can still fail to decode even though Safari plays it
// fine). Runs on every video upload, regardless of source container/codec.
export async function reencodeVideoForUpload(
  buffer: Buffer,
  originalname: string,
): Promise<{ buffer: Buffer; filename: string; mimeType: string; thumbnailDataUrl: string | null }> {
  const tmpDir = os.tmpdir();
  const token = crypto.randomBytes(8).toString("hex");
  const ext = path.extname(originalname) || ".mov";
  const inputPath = path.join(tmpDir, `vid-in-${token}${ext}`);
  const outputPath = path.join(tmpDir, `vid-out-${token}.mp4`);
  const thumbPath = path.join(tmpDir, `vid-thumb-${token}.jpg`);

  try {
    fs.writeFileSync(inputPath, buffer);

    await runFfmpeg([
      "-y",
      "-i", inputPath,
      "-c:v", "libx264",
      "-profile:v", "baseline",
      "-level", "3.0",
      "-pix_fmt", "yuv420p",
      // Keeps huge phone videos from ballooning re-encode time on a small
      // CPU -- 720p is plenty for chat playback and still looks sharp.
      "-vf", "scale='min(1280,iw)':-2",
      "-preset", "veryfast",
      "-crf", "26",
      "-c:a", "aac",
      "-b:a", "128k",
      "-movflags", "+faststart",
      outputPath,
    ]);

    const outBuffer = fs.readFileSync(outputPath);
    const newName = originalname.replace(/\.[^.]+$/, "") + ".mp4";

    let thumbnailDataUrl: string | null = null;
    try {
      await runFfmpeg([
        "-y",
        "-i", outputPath,
        "-ss", "0.1",
        "-vframes", "1",
        "-vf", "scale=320:-2",
        thumbPath,
      ]);
      const thumbBuffer = fs.readFileSync(thumbPath);
      thumbnailDataUrl = `data:image/jpeg;base64,${thumbBuffer.toString("base64")}`;
    } catch {
      // Thumbnail is a nice-to-have -- a missing poster still leaves a
      // playable video, so don't fail the whole upload over it.
    }

    return { buffer: outBuffer, filename: newName, mimeType: "video/mp4", thumbnailDataUrl };
  } finally {
    fs.unlink(inputPath, () => { /* best-effort cleanup */ });
    fs.unlink(outputPath, () => { /* best-effort cleanup */ });
    fs.unlink(thumbPath, () => { /* best-effort cleanup */ });
  }
}
