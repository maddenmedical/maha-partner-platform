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
// that isn't a .mov upload.
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

    await new Promise<void>((resolve, reject) => {
      const proc = spawn(ffmpegInstaller.path, [
        "-y",
        "-i", inputPath,
        // Stream copy -- just rewrites the container, doesn't touch the
        // encoded video/audio data. If the source codec truly can't live in
        // an mp4 box (rare), ffmpeg exits non-zero and we fall back below.
        "-c", "copy",
        "-movflags", "+faststart",
        outputPath,
      ]);
      let stderr = "";
      proc.stderr.on("data", (d) => { stderr += d.toString(); });
      proc.on("error", reject);
      proc.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-500)}`));
      });
    });

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
