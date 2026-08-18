import { type NextRequest } from "next/server";
import { spawn } from "child_process";
import { Readable } from "stream";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { createChildLogger } from "@/lib/logger";
import { getBaseArgs } from "@/lib/downloader";

export const dynamic = "force-dynamic";

const log = createChildLogger("api:download");

function getYoutubeFallbackArgs(): string[] {
  return ["--js-runtimes", "node", "--extractor-args", "youtube:player_client=android"];
}

function getYoutubeMwebArgs(): string[] {
  return ["--js-runtimes", "node", "--extractor-args", "youtube:player_client=web,mweb"];
}

function detectPlatform(url: string): "youtube" | "instagram" | "facebook" | "tiktok" | "twitter" | "unknown" {
  const lower = url.toLowerCase();
  if (lower.includes("youtube.com") || lower.includes("youtu.be") || lower.includes("youtube.com/shorts")) return "youtube";
  if (lower.includes("instagram.com")) return "instagram";
  if (lower.includes("facebook.com") || lower.includes("fb.watch") || lower.includes("fb.com")) return "facebook";
  if (lower.includes("tiktok")) return "tiktok";
  if (lower.includes("twitter.com") || lower.includes("x.com")) return "twitter";
  return "unknown";
}

function runFfmpeg(args: string[]): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve) => {
    const child = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on("close", (code) => {
      resolve(code === 0 ? { success: true } : { success: false, error: stderr.slice(-500) });
    });
    child.on("error", (err) => resolve({ success: false, error: err.message }));
  });
}

function isRetryableError(stderr: string): boolean {
  return stderr.includes("Sign in to confirm") ||
    stderr.includes("HTTP Error 403") ||
    stderr.includes("bot") ||
    stderr.includes("Not a bot") ||
    stderr.includes("confirm you") ||
    stderr.includes("Requested format is not available") ||
    stderr.includes("format not available");
}

function runYtdlp(args: string[], platform: string, skipClientRetry = false): Promise<{ success: boolean; outputPath?: string; error?: string }> {
  return new Promise((resolve) => {
    const logCtx = { command: `yt-dlp ${args.join(" ")}`, platform, skipClientRetry };

    const tryRun = (extraArgs: string[], attempt: number) => {
      log.info("yt-dlp attempt", { ...logCtx, attempt, extraArgs });
      const child = spawn("yt-dlp", [...args, ...extraArgs], { stdio: ["ignore", "pipe", "pipe"] });
      let stderr = "";

      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      child.on("close", (code) => {
        if (code === 0) {
          const outputTemplate = args[args.indexOf("-o") + 1];
          const outputDir = join(outputTemplate, "..");
          try {
            const files = readdirSync(outputDir);
            const baseName = outputTemplate.split("/").pop() || "";
            const match = files.find((f) => f.startsWith(baseName));
            if (match) {
              log.info("yt-dlp completed", { ...logCtx, attempt, outputPath: join(outputDir, match) });
              resolve({ success: true, outputPath: join(outputDir, match) });
            } else {
              log.error("yt-dlp OK but output not found", { ...logCtx, attempt });
              resolve({ success: false, error: "Output file not found" });
            }
          } catch {
            log.error("yt-dlp OK but output dir error", { ...logCtx, attempt });
            resolve({ success: false, error: "Output directory error" });
          }
        } else if (!skipClientRetry && platform === "youtube" && attempt === 0 && isRetryableError(stderr)) {
          log.warn("yt-dlp retryable error, falling back to android", { ...logCtx, attempt, stderr: stderr.slice(0, 300) });
          tryRun(getYoutubeFallbackArgs(), 1);
        } else if (!skipClientRetry && platform === "youtube" && attempt === 1 && isRetryableError(stderr)) {
          log.warn("yt-dlp retryable error, falling back to web,mweb", { ...logCtx, attempt, stderr: stderr.slice(0, 300) });
          tryRun(getYoutubeMwebArgs(), 2);
        } else {
          log.error("yt-dlp failed", { ...logCtx, attempt, code, stderr: stderr.slice(-500) });
          resolve({ success: false, error: stderr || `yt-dlp exited with code ${code}` });
        }
      });

      child.on("error", (err) => {
        log.error("yt-dlp spawn error", { ...logCtx, attempt, error: err.message });
        resolve({ success: false, error: err.message });
      });
    };

    tryRun([], 0);
  });
}

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get("url");
  const formatId = request.nextUrl.searchParams.get("format_id");
  const format = request.nextUrl.searchParams.get("format") || "mp4";
  const quality = request.nextUrl.searchParams.get("quality") || "720p";
  const startTime = Date.now();

  log.info("GET /api/download - request received", {
    url: url?.slice(0, 200),
    formatId,
    format,
    quality,
  });

  if (!url) {
    log.warn("GET /api/download - missing URL");
    return Response.json({ error: "URL is required" }, { status: 400 });
  }

  const platform = detectPlatform(url.trim());
  const isAudioOnly = format === "mp3";

  if (formatId) {
    const fileName = `download.${isAudioOnly ? "mp3" : "mp4"}`;
    const contentType = isAudioOnly ? "audio/mpeg" : "video/mp4";

    const isAudioFormat = formatId.startsWith("140") || formatId.startsWith("251") || formatId.startsWith("250") || formatId.startsWith("249") || formatId.includes("audio");

    if (isAudioFormat || isAudioOnly) {
      log.info("Audio download by format_id", { url, formatId, platform });

      const tmpDir = mkdtempSync(join(tmpdir(), "sdl-"));
      const outputTemplate = join(tmpDir, "output");

      const args = [
        ...getBaseArgs(),
        "-f", formatId,
        "-x",
        "--audio-format", "mp3",
        "--audio-quality", "256K",
        "-o", outputTemplate,
        url.trim(),
      ];

      const result = await runYtdlp(args, platform);

      if (!result.success || !result.outputPath) {
        log.error("Audio download failed", { url, formatId, error: result.error, elapsed: Date.now() - startTime });
        try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
        return Response.json({ error: result.error || "Download failed" }, { status: 500 });
      }

      const fileBuffer = readFileSync(result.outputPath);
      try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}

      log.info("Audio download completed", { url, formatId, fileSize: fileBuffer.length, elapsed: Date.now() - startTime });

      return new Response(fileBuffer, {
        status: 200,
        headers: {
          "Content-Disposition": `attachment; filename="${fileName}"`,
          "Content-Type": contentType,
          "Content-Length": fileBuffer.length.toString(),
        },
      });
    }

    log.info("Video download by format_id with merge", { url, formatId, platform });

    const tmpDir = mkdtempSync(join(tmpdir(), "sdl-"));
    const videoPath = join(tmpDir, "video");
    const audioPath = join(tmpDir, "audio");
    const mergedPath = join(tmpDir, "merged.mp4");

    let videoResult = await runYtdlp([
      ...getBaseArgs(),
      "-f", formatId,
      "--merge-output-format", "mp4",
      "-o", videoPath,
      url.trim(),
    ], platform, true);

    if (!videoResult.success) {
      videoResult = await runYtdlp([
        ...getBaseArgs(),
        "-f", "bestvideo[ext=mp4]/bestvideo",
        "--merge-output-format", "mp4",
        "-o", videoPath,
        url.trim(),
      ], platform, false);
    }

    if (!videoResult.success) {
      videoResult = await runYtdlp([
        ...getBaseArgs(),
        "-f", "18/best[ext=mp4]/best",
        "--merge-output-format", "mp4",
        "-o", videoPath,
        url.trim(),
      ], platform, false);
    }

    if (!videoResult.success || !videoResult.outputPath) {
      log.error("Video download failed", { url, formatId, error: videoResult.error, elapsed: Date.now() - startTime });
      try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
      return Response.json({ error: videoResult.error || "Video download failed" }, { status: 500 });
    }

    const audioResult = await runYtdlp([
      ...getBaseArgs(),
      "-f", "bestaudio[ext=m4a]/bestaudio/best",
      "-x", "--audio-format", "m4a", "--audio-quality", "256K",
      "-o", audioPath,
      url.trim(),
    ], platform, false);

    if (audioResult.success && audioResult.outputPath) {
      const ffmpegResult = await runFfmpeg([
        "-y",
        "-i", videoResult.outputPath,
        "-i", audioResult.outputPath,
        "-c:v", "copy",
        "-c:a", "aac",
        "-movflags", "+faststart",
        mergedPath,
      ]);

      try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}

      if (!ffmpegResult.success) {
        log.error("Merge failed", { url, formatId, error: ffmpegResult.error, elapsed: Date.now() - startTime });
        return Response.json({ error: ffmpegResult.error || "Merge failed" }, { status: 500 });
      }

      const mergedBuffer = readFileSync(mergedPath);

      log.info("Video download with merge completed", { url, formatId, fileSize: mergedBuffer.length, elapsed: Date.now() - startTime });

      return new Response(mergedBuffer, {
        status: 200,
        headers: {
          "Content-Disposition": `attachment; filename="${fileName}"`,
          "Content-Type": contentType,
          "Content-Length": mergedBuffer.length.toString(),
        },
      });
    } else {
      const fileBuffer = readFileSync(videoResult.outputPath);
      try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}

      log.info("Video download (muxed) completed", { url, formatId, fileSize: fileBuffer.length, elapsed: Date.now() - startTime });

      return new Response(fileBuffer, {
        status: 200,
        headers: {
          "Content-Disposition": `attachment; filename="${fileName}"`,
          "Content-Type": contentType,
          "Content-Length": fileBuffer.length.toString(),
        },
      });
    }
  }

  if (isAudioOnly) {
    log.info("Audio-only download (no format_id)", { url, platform });

    const tmpDir = mkdtempSync(join(tmpdir(), "sdl-"));
    const outputTemplate = join(tmpDir, "audio");

    const args = [
      ...getBaseArgs(),
      "-f", "bestaudio/best",
      "-x",
      "--audio-format", "mp3",
      "--audio-quality", "256K",
      "-o", outputTemplate,
      url.trim(),
    ];

    const result = await runYtdlp(args, platform);

    if (!result.success || !result.outputPath) {
      log.error("Audio-only download failed", { url, error: result.error, elapsed: Date.now() - startTime });
      try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
      return Response.json({ error: result.error || "Download failed" }, { status: 500 });
    }

    const fileBuffer = readFileSync(result.outputPath);
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}

    log.info("Audio-only download completed", { url, fileSize: fileBuffer.length, elapsed: Date.now() - startTime });

    return new Response(fileBuffer, {
      status: 200,
      headers: {
        "Content-Disposition": `attachment; filename="download.mp3"`,
        "Content-Type": "audio/mpeg",
        "Content-Length": fileBuffer.length.toString(),
      },
    });
  }

  log.info("Streaming download by quality", { url, platform, quality });

  const formatMap: Record<string, string> = {
    "1080p": "bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=1080]+bestaudio/best[height<=1080]/best",
    "720p": "bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=720]+bestaudio/best[height<=720]/best",
    "480p": "bestvideo[height<=480][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=480]+bestaudio/best[height<=480]/best",
  };

  let fmtStr = formatMap[quality] || formatMap["720p"];
  if (platform === "instagram" || platform === "facebook") {
    fmtStr = "best[ext=mp4]/best";
  }

  const args = [
    ...getBaseArgs(),
    "-f", fmtStr,
    "--merge-output-format", "mp4",
    "-o", "-",
    url.trim(),
  ];

  log.info("Streaming yt-dlp started", { command: `yt-dlp ${args.join(" ")}` });

  const child = spawn("yt-dlp", args, { stdio: ["ignore", "pipe", "pipe"] });

  child.stderr.on("data", (chunk: Buffer) => {
    const text = chunk.toString();
    if (text.includes("ERROR") || text.includes("error")) {
      log.warn("yt-dlp stderr", { line: text.trim().slice(0, 300) });
    }
  });

  const webStream = new ReadableStream({
    start(controller) {
      child.stdout.on("data", (chunk: Buffer) => {
        controller.enqueue(new Uint8Array(chunk));
      });
      child.stdout.on("end", () => controller.close());
      child.on("error", (err) => {
        log.error("Stream yt-dlp error", { error: err.message });
        controller.error(err);
      });
      child.stderr.on("data", () => {});
    },
    cancel() {
      child.kill("SIGTERM");
    },
  });

  return new Response(webStream, {
    status: 200,
    headers: {
      "Content-Disposition": `attachment; filename="download.mp4"`,
      "Content-Type": "video/mp4",
      "Transfer-Encoding": "chunked",
      "Cache-Control": "no-cache",
    },
  });
}
