import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
// @ffmpeg-installer bundles a static ffmpeg binary per-platform as an npm
// dependency (no system package or separate download step), so this works
// the same in the dev sandbox and in the published-site production sandbox.
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import { streamFromDrive } from "./googleDrive";

// Converts a Drive-stored audio attachment (voice notes are recorded via
// MediaRecorder as webm/opus or m4a -- browsers can't record straight to
// mp3) into a standalone mp3 file on local disk, purely for admin download.
// This never transcribes or reads the audio content -- it only repackages
// the same bytes into a more portable/universal container+codec.
export async function convertDriveAudioToMp3(
  driveFileId: string,
): Promise<{ inputPath: string; outputPath: string }> {
  const tmpDir = os.tmpdir();
  const token = crypto.randomBytes(8).toString("hex");
  const inputPath = path.join(tmpDir, `voice-${token}.src`);
  const outputPath = path.join(tmpDir, `voice-${token}.mp3`);

  const stream = await streamFromDrive(driveFileId);
  await new Promise<void>((resolve, reject) => {
    const writeStream = fs.createWriteStream(inputPath);
    stream.on("error", reject);
    writeStream.on("error", reject);
    writeStream.on("finish", () => resolve());
    stream.pipe(writeStream);
  });

  await new Promise<void>((resolve, reject) => {
    const proc = spawn(ffmpegInstaller.path, [
      "-y",
      "-i", inputPath,
      "-vn",
      "-acodec", "libmp3lame",
      "-b:a", "128k",
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

  return { inputPath, outputPath };
}

export function cleanupTempFiles(...paths: string[]): void {
  for (const p of paths) {
    fs.unlink(p, () => { /* best-effort cleanup */ });
  }
}
