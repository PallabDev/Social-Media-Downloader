import { type NextRequest } from "next/server";
import { spawn } from "child_process";
import { mkdtempSync, readFileSync, rmSync, mkdirSync, existsSync, readdirSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { getBaseArgs, detectPlatform } from "@/lib/downloader";
import { createChildLogger } from "@/lib/logger";

export const dynamic = "force-dynamic";

const log = createChildLogger("api:download-merged");
const MERGED_DIR = join(tmpdir(), "sdl-merged");

function runFfmpeg(args: string[]): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve) => {
    log.info("ffmpeg started", { args: args.join(" ") });
    const child = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on("close", (code) => {
      if (code === 0) {
        log.info("ffmpeg completed successfully");
        resolve({ success: true });
      } else {
        log.error("ffmpeg failed", { code, stderr: stderr.slice(-500) });
        resolve({ success: false, error: stderr.slice(-500) });
      }
    });
    child.on("error", (err) => {
      log.error("ffmpeg spawn error", { error: err.message });
      resolve({ success: false, error: err.message });
    });
  });
}

function findOutputFile(dir: string, baseName: string): string | null {
  try {
    const files = readdirSync(dir);
    const match = files.find((f) => f.startsWith(baseName));
    return match ? join(dir, match) : null;
  } catch {
    return null;
  }
}

function runYtdlpWithProgress(
  args: string[],
  onProgress: (percent: number) => void,
  logContext: Record<string, unknown>
): Promise<{ success: boolean; outputPath?: string; error?: string }> {
  return new Promise((resolve) => {
    const cmdStr = `yt-dlp ${args.join(" ")}`;
    log.info("yt-dlp download started", { ...logContext, command: cmdStr });

    const child = spawn("yt-dlp", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    let outputTemplate = "";
    const oIdx = args.indexOf("-o");
    if (oIdx !== -1 && oIdx + 1 < args.length) {
      outputTemplate = args[oIdx + 1];
    }

    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;

      const match = text.match(/\[download\]\s+([\d.]+)%/);
      if (match) {
        onProgress(parseFloat(match[1]));
      }
      if (text.includes("[Merger]")) {
        onProgress(95);
      }
      if (text.includes("ERROR") || text.includes("error")) {
        log.warn("yt-dlp stderr line", { ...logContext, line: text.trim().slice(0, 300) });
      }
    });

    child.on("close", (code) => {
      if (code === 0 && outputTemplate) {
        const outputDir = join(outputTemplate, "..");
        const baseName = outputTemplate.split("/").pop() || "";
        const found = findOutputFile(outputDir, baseName);
        if (found) {
          log.info("yt-dlp download completed", { ...logContext, outputPath: found });
          resolve({ success: true, outputPath: found });
        } else {
          log.error("yt-dlp download OK but output file not found", { ...logContext, outputDir, baseName });
          resolve({ success: false, error: "Output file not found" });
        }
      } else if (code === 0) {
        log.info("yt-dlp download completed (no output path)", logContext);
        resolve({ success: true });
      } else {
        log.error("yt-dlp download failed", { ...logContext, code, stderr: stderr.slice(-500) });
        resolve({ success: false, error: stderr.slice(-500) || `yt-dlp exited with code ${code}` });
      }
    });

    child.on("error", (err) => {
      log.error("yt-dlp spawn error", { ...logContext, error: err.message });
      resolve({ success: false, error: err.message });
    });
  });
}

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get("url");
  const height = request.nextUrl.searchParams.get("height");
  const format = request.nextUrl.searchParams.get("format") || "mp4";
  const startTime = Date.now();

  log.info("GET /api/download-merged - request received", {
    url: url?.slice(0, 200),
    height,
    format,
    hasCookies: existsSync(join(tmpdir(), "cookies.txt")),
  });

  if (!url) {
    log.warn("GET /api/download-merged - missing URL");
    return Response.json({ error: "URL is required" }, { status: 400 });
  }

  const platform = detectPlatform(url.trim());
  const isAudioOnly = format === "mp3";
  const isAudioFormat = !height && !isAudioOnly;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: Record<string, unknown>) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {}
      };

      try {
        const tmpDir = mkdtempSync(join(tmpdir(), "sdl-"));
        const outputPath = join(tmpDir, "output");

        if (isAudioFormat || isAudioOnly) {
          log.info("Starting audio-only download", { url, platform });

          const args = [
            ...getBaseArgs(),
            "-f", "bestaudio[ext=m4a]/bestaudio/best",
            "-x",
            "--audio-format", "mp3",
            "--audio-quality", "256K",
            "-o", outputPath,
            url.trim(),
          ];

          send("status", { step: "downloading", percent: 0 });

          const result = await runYtdlpWithProgress(
            args,
            (p) => send("status", { step: "downloading", percent: Math.min(p, 90) }),
            { url, platform, type: "audio" }
          );

          if (!result.success || !result.outputPath) {
            log.error("Audio download failed", { url, error: result.error, elapsed: Date.now() - startTime });
            try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
            send("error", { message: result.error || "Download failed" });
            controller.close();
            return;
          }

          send("status", { step: "finalizing", percent: 95 });
          const fileBuffer = readFileSync(result.outputPath);
          const fileId = Date.now().toString(36);

          try { rmSync(MERGED_DIR, { recursive: true, force: true }); } catch {}
          mkdirSync(MERGED_DIR, { recursive: true });
          const savePath = join(MERGED_DIR, `${fileId}.mp3`);
          writeFileSync(savePath, fileBuffer);
          try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}

          log.info("Audio download completed", { url, fileSize: fileBuffer.length, elapsed: Date.now() - startTime });

          send("status", { step: "done", percent: 100 });
          send("done", { fileUrl: `/api/download-merged/file?id=${fileId}&ext=mp3`, fileName: "download.mp3" });
          controller.close();
          return;
        }

        if (height) {
          const h = parseInt(height, 10);
          const fmtSelector = `bestvideo[height=${h}][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height=${h}]+bestaudio/bestvideo[height<=${h}]+bestaudio/best[height<=${h}]`;

          log.info("Starting video download (height-based)", { url, platform, height: h, formatSelector: fmtSelector });

          // Attempt 1: With cookies + height selector
          send("status", { step: "downloading", percent: 0 });

          const args = [
            ...getBaseArgs(),
            "-f", fmtSelector,
            "--merge-output-format", "mp4",
            "-o", outputPath,
            url.trim(),
          ];

          const result = await runYtdlpWithProgress(
            args,
            (p) => send("status", { step: "downloading", percent: Math.min(p, 85) }),
            { url, platform, height: h, attempt: "primary" }
          );

          if (result.success && result.outputPath) {
            await handleH264Conversion(result.outputPath, tmpDir, send, controller, MERGED_DIR, url, startTime);
            return;
          }

          log.warn("Primary download failed, trying without cookies", { url, error: result.error, height: h });

          // Attempt 2: Without cookies, android player_client + height selector
          send("status", { step: "downloading", percent: 0 });
          const noCookieArgs = [
            "--no-warnings", "--no-playlist",
            "--js-runtimes", "node",
            "--extractor-args", "youtube:player_client=android_vr,android,web,mweb",
            "--user-agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
            "-f", fmtSelector,
            "--merge-output-format", "mp4",
            "-o", outputPath,
            url.trim(),
          ];

          const noCookieResult = await runYtdlpWithProgress(
            noCookieArgs,
            (p) => send("status", { step: "downloading", percent: Math.min(p, 85) }),
            { url, platform, height: h, attempt: "no-cookies" }
          );

          if (noCookieResult.success && noCookieResult.outputPath) {
            await handleH264Conversion(noCookieResult.outputPath, tmpDir, send, controller, MERGED_DIR, url, startTime);
            return;
          }

          log.warn("No-cookies download failed, trying muxed fallback", { url, error: noCookieResult.error });

          // Attempt 3: With cookies, muxed fallback (format 18 or best[ext=mp4])
          send("status", { step: "downloading", percent: 0 });
          const muxedArgs = [
            ...getBaseArgs(),
            "-f", "best[ext=mp4]/best",
            "--merge-output-format", "mp4",
            "-o", outputPath,
            url.trim(),
          ];

          const muxedResult = await runYtdlpWithProgress(
            muxedArgs,
            (p) => send("status", { step: "downloading", percent: Math.min(p, 85) }),
            { url, platform, height: h, attempt: "muxed-fallback" }
          );

          if (muxedResult.success && muxedResult.outputPath) {
            await handleH264Conversion(muxedResult.outputPath, tmpDir, send, controller, MERGED_DIR, url, startTime);
            return;
          }

          // Attempt 4: Muxed without cookies
          log.warn("Muxed fallback failed, trying muxed without cookies", { url, error: muxedResult.error });
          send("status", { step: "downloading", percent: 0 });
          const muxedNoCookieArgs = [
            "--no-warnings", "--no-playlist",
            "--js-runtimes", "node",
            "--extractor-args", "youtube:player_client=android_vr,android,web,mweb",
            "--user-agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
            "-f", "18/best[ext=mp4]/best",
            "--merge-output-format", "mp4",
            "-o", outputPath,
            url.trim(),
          ];

          const muxedNoCookieResult = await runYtdlpWithProgress(
            muxedNoCookieArgs,
            (p) => send("status", { step: "downloading", percent: Math.min(p, 85) }),
            { url, platform, height: h, attempt: "muxed-no-cookies" }
          );

          if (muxedNoCookieResult.success && muxedNoCookieResult.outputPath) {
            log.info("Muxed no-cookies succeeded (360p fallback)", { url, height: h });
            send("status", { step: "warning", percent: 0, message: "Requested resolution not available. Downloading 360p instead." });
            await handleH264Conversion(muxedNoCookieResult.outputPath, tmpDir, send, controller, MERGED_DIR, url, startTime);
            return;
          }

          log.error("All download attempts failed", {
            url,
            primaryError: result.error,
            noCookieError: noCookieResult.error,
            muxedError: muxedResult.error,
            muxedNoCookieError: muxedNoCookieResult.error,
            elapsed: Date.now() - startTime,
          });
          try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
          send("error", { message: "All download methods failed. Your cookies may be expired — try re-uploading fresh cookies." });
          controller.close();
          return;
        }

        const fmtStr = platform === "instagram" || platform === "facebook"
          ? "best[ext=mp4]/best"
          : "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best";

        log.info("Starting video download (no height)", { url, platform, formatSelector: fmtStr });

        send("status", { step: "downloading", percent: 0 });

        const args = [
          ...getBaseArgs(),
          "-f", fmtStr,
          "--merge-output-format", "mp4",
          "-o", outputPath,
          url.trim(),
        ];

        const result = await runYtdlpWithProgress(
          args,
          (p) => send("status", { step: "downloading", percent: Math.min(p, 85) }),
          { url, platform, attempt: "no-height" }
        );

        if (!result.success || !result.outputPath) {
          log.error("Download failed (no height)", { url, error: result.error, elapsed: Date.now() - startTime });
          try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
          send("error", { message: result.error || "Download failed" });
          controller.close();
          return;
        }

        await handleH264Conversion(result.outputPath, tmpDir, send, controller, MERGED_DIR, url, startTime);

      } catch (err) {
        log.error("Unhandled error in download-merged", {
          url,
          error: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined,
          elapsed: Date.now() - startTime,
        });
        send("error", { message: err instanceof Error ? err.message : "Unknown error" });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}

async function handleH264Conversion(
  downloadedPath: string,
  tmpDir: string,
  send: (event: string, data: Record<string, unknown>) => void,
  controller: ReadableStreamDefaultController<Uint8Array>,
  mergedDir: string,
  url: string,
  startTime: number
) {
  log.info("Checking codec of downloaded file", { downloadedPath });

  send("status", { step: "converting", percent: 88 });

  let isH264 = false;
  try {
    const probe = await new Promise<string>((resolve) => {
      const child = spawn("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name", "-of", "csv=p=0", downloadedPath], { stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      child.stdout.on("data", (c: Buffer) => { stdout += c.toString(); });
      child.on("close", () => resolve(stdout.trim()));
      child.on("error", () => resolve(""));
    });
    isH264 = probe === "h264";
    log.info("Codec detected", { codec: probe, isH264, downloadedPath });
  } catch (err) {
    log.warn("ffprobe failed, assuming not h264", { error: err instanceof Error ? err.message : String(err) });
  }

  let finalPath = downloadedPath;

  if (!isH264) {
    log.info("Re-encoding to H.264", { downloadedPath });
    send("status", { step: "converting to mp4", percent: 90 });
    const h264Path = join(tmpDir, "h264_output.mp4");
    const ffmpegResult = await runFfmpeg([
      "-y",
      "-i", downloadedPath,
      "-c:v", "libx264",
      "-preset", "fast",
      "-crf", "23",
      "-c:a", "aac",
      "-b:a", "192k",
      "-movflags", "+faststart",
      h264Path,
    ]);

    if (ffmpegResult.success) {
      finalPath = h264Path;
      log.info("H.264 re-encode succeeded", { h264Path });
    } else {
      log.warn("H.264 re-encode failed, using original", { error: ffmpegResult.error });
    }
  }

  send("status", { step: "finalizing", percent: 98 });
  const fileBuffer = readFileSync(finalPath);
  const fileId = Date.now().toString(36);

  try { rmSync(mergedDir, { recursive: true, force: true }); } catch {}
  mkdirSync(mergedDir, { recursive: true });
  const savePath = join(mergedDir, `${fileId}.mp4`);
  writeFileSync(savePath, fileBuffer);
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}

  const elapsed = Date.now() - startTime;
  log.info("Download completed successfully", {
    url,
    fileSize: fileBuffer.length,
    isH264,
    elapsed,
    elapsedSec: (elapsed / 1000).toFixed(1),
  });

  send("status", { step: "done", percent: 100 });
  send("done", { fileUrl: `/api/download-merged/file?id=${fileId}&ext=mp4`, fileName: "download.mp4" });
  controller.close();
}
