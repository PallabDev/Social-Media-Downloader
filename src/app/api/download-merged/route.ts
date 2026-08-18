import { type NextRequest } from "next/server";
import { spawn } from "child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

export const dynamic = "force-dynamic";

const COOKIE_FILE = join(process.cwd(), "cookies.txt");

function getCookieArgs(): string[] {
  if (existsSync(COOKIE_FILE)) {
    return ["--cookies", COOKIE_FILE];
  }
  return [];
}

const BASE_ARGS = [
  "--no-warnings",
  "--no-playlist",
  "--user-agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "--extractor-args", "youtube:player_client=android_vr,android,web,mweb",
  ...getCookieArgs(),
];

const YOUTUBE_FALLBACK_ARGS = [
  "--extractor-args", "youtube:player_client=android",
];

const YOUTUBE_MWEB_ARGS = [
  "--extractor-args", "youtube:player_client=web,mweb",
];

const MERGED_DIR = join(tmpdir(), "sdl-merged");

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
    const tryRun = (extraArgs: string[], attempt: number) => {
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
              resolve({ success: true, outputPath: join(outputDir, match) });
            } else {
              resolve({ success: false, error: "Output file not found" });
            }
          } catch {
            resolve({ success: false, error: "Output directory error" });
          }
        } else if (!skipClientRetry && platform === "youtube" && attempt === 0 && isRetryableError(stderr)) {
          tryRun(YOUTUBE_FALLBACK_ARGS, 1);
        } else if (!skipClientRetry && platform === "youtube" && attempt === 1 && isRetryableError(stderr)) {
          tryRun(YOUTUBE_MWEB_ARGS, 2);
        } else {
          resolve({ success: false, error: stderr || `yt-dlp exited with code ${code}` });
        }
      });

      child.on("error", (err) => {
        resolve({ success: false, error: err.message });
      });
    };

    tryRun([], 0);
  });
}

function cleanupMergedDir() {
  try {
    rmSync(MERGED_DIR, { recursive: true, force: true });
  } catch {}
}

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get("url");
  const formatId = request.nextUrl.searchParams.get("format_id");
  const format = request.nextUrl.searchParams.get("format") || "mp4";

  if (!url) {
    return Response.json({ error: "URL is required" }, { status: 400 });
  }

  const platform = detectPlatform(url.trim());
  const isAudioOnly = format === "mp3";

  const isAudioFormat = formatId
    ? formatId.startsWith("140") || formatId.startsWith("251") || formatId.startsWith("250") || formatId.startsWith("249") || formatId.includes("audio")
    : false;

  const needsMerge = formatId && !isAudioFormat && !isAudioOnly;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      try {
        if (isAudioFormat || isAudioOnly) {
          send("status", { step: "downloading_audio", percent: 10 });

          const tmpDir = mkdtempSync(join(tmpdir(), "sdl-"));
          const outputTemplate = join(tmpDir, "output");

          const args = [
            ...BASE_ARGS,
            "-f", formatId || "bestaudio/best",
            "-x",
            "--audio-format", "mp3",
            "--audio-quality", "256K",
            "-o", outputTemplate,
            url.trim(),
          ];

          send("status", { step: "downloading", percent: 30 });
          const result = await runYtdlp(args, platform);

          if (!result.success || !result.outputPath) {
            try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
            send("error", { message: result.error || "Download failed" });
            controller.close();
            return;
          }

          send("status", { step: "finalizing", percent: 90 });
          const fileBuffer = readFileSync(result.outputPath);
          const fileId = Date.now().toString(36);

          try { rmSync(MERGED_DIR, { recursive: true, force: true }); } catch {}
          mkdirSync(MERGED_DIR, { recursive: true });
          const savePath = join(MERGED_DIR, `${fileId}.mp3`);
          const { writeFileSync } = await import("fs");
          writeFileSync(savePath, fileBuffer);

          try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}

          send("done", { fileUrl: `/api/download-merged/file?id=${fileId}&ext=mp3`, fileName: "download.mp3" });
          controller.close();
          return;
        }

        if (needsMerge) {
          send("status", { step: "downloading_video", percent: 5 });

          const tmpDir = mkdtempSync(join(tmpdir(), "sdl-"));
          const videoPath = join(tmpDir, "video");
          const audioPath = join(tmpDir, "audio");
          const mergedPath = join(tmpDir, "merged.mp4");

          // Try specific format first (no client retry - let caller handle fallback)
          let videoArgs = [
            ...BASE_ARGS,
            "-f", formatId,
            "--merge-output-format", "mp4",
            "-o", videoPath,
            url.trim(),
          ];

          send("status", { step: "downloading_video", percent: 15 });
          let videoResult = await runYtdlp(videoArgs, platform, true);

          // If specific format failed, try bestvideo with full client retry
          if (!videoResult.success) {
            const bestVideoArgs = [
              ...BASE_ARGS,
              "-f", "bestvideo[ext=mp4]/bestvideo",
              "--merge-output-format", "mp4",
              "-o", videoPath,
              url.trim(),
            ];
            videoResult = await runYtdlp(bestVideoArgs, platform, false);
          }

          // If bestvideo also failed, try muxed format (360p with audio)
          if (!videoResult.success) {
            const muxedArgs = [
              ...BASE_ARGS,
              "-f", "18/best[ext=mp4]/best",
              "--merge-output-format", "mp4",
              "-o", videoPath,
              url.trim(),
            ];
            videoResult = await runYtdlp(muxedArgs, platform, false);
          }

          if (!videoResult.success || !videoResult.outputPath) {
            try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
            send("error", { message: videoResult.error || "Video download failed" });
            controller.close();
            return;
          }

          // Check if the downloaded file already has audio (muxed format)
          const videoPath_actual = videoResult.outputPath;
          const isMuxed = videoPath_actual.endsWith(".mp4") || videoPath_actual.endsWith(".webm");

          // Try to download audio, but don't fail if it's a muxed format
          let audioResult: { success: boolean; outputPath?: string } = { success: false };
          const audioArgs = [
            ...BASE_ARGS,
            "-f", "bestaudio[ext=m4a]/bestaudio/best",
            "-x", "--audio-format", "m4a", "--audio-quality", "256K",
            "-o", audioPath,
            url.trim(),
          ];
          audioResult = await runYtdlp(audioArgs, platform, false);

          if (audioResult.success && audioResult.outputPath) {
            // Got separate audio - merge video + audio
            send("status", { step: "merging", percent: 70 });
            const ffmpegResult = await runFfmpeg([
              "-y",
              "-i", videoPath_actual,
              "-i", audioResult.outputPath,
              "-c:v", "copy",
              "-c:a", "aac",
              "-movflags", "+faststart",
              mergedPath,
            ]);

            try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}

            if (!ffmpegResult.success) {
              send("error", { message: ffmpegResult.error || "Merge failed" });
              controller.close();
              return;
            }
          } else {
            // No separate audio (muxed format) - just copy the video file
            send("status", { step: "merging", percent: 70 });
            const { copyFileSync } = await import("fs");
            copyFileSync(videoPath_actual, mergedPath);
            try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
          }

          send("status", { step: "finalizing", percent: 95 });
          const mergedBuffer = readFileSync(mergedPath);
          const fileId = Date.now().toString(36);

          try { rmSync(MERGED_DIR, { recursive: true, force: true }); } catch {}
          mkdirSync(MERGED_DIR, { recursive: true });
          const savePath = join(MERGED_DIR, `${fileId}.mp4`);
          const { writeFileSync } = await import("fs");
          writeFileSync(savePath, mergedBuffer);

          send("done", { fileUrl: `/api/download-merged/file?id=${fileId}&ext=mp4`, fileName: "download.mp4" });
          controller.close();
          return;
        }

        // Muxed format or no format_id — stream directly
        const formatMap: Record<string, string> = {
          "1080p": "bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=1080]+bestaudio/best[height<=1080]/best",
          "720p": "bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=720]+bestaudio/best[height<=720]/best",
          "480p": "bestvideo[height<=480][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=480]+bestaudio/best[height<=480]/best",
        };

        let fmtStr = formatId || formatMap["720p"];
        if (platform === "instagram" || platform === "facebook") {
          fmtStr = "best[ext=mp4]/best";
        }

        send("status", { step: "downloading", percent: 20 });

        const args = [
          ...BASE_ARGS,
          "-f", fmtStr,
          "--merge-output-format", "mp4",
          "-o", "-",
          url.trim(),
        ];

        const child = spawn("yt-dlp", args, { stdio: ["ignore", "pipe", "pipe"] });
        const chunks: Buffer[] = [];

        child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
        child.stderr.on("data", () => {});

        await new Promise<void>((resolve, reject) => {
          child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`yt-dlp exited with code ${code}`)));
          child.on("error", reject);
        });

        send("status", { step: "finalizing", percent: 90 });
        const fileBuffer = Buffer.concat(chunks);
        const fileId = Date.now().toString(36);

        try { rmSync(MERGED_DIR, { recursive: true, force: true }); } catch {}
        mkdirSync(MERGED_DIR, { recursive: true });
        const savePath = join(MERGED_DIR, `${fileId}.mp4`);
        const { writeFileSync } = await import("fs");
        writeFileSync(savePath, fileBuffer);

        send("done", { fileUrl: `/api/download-merged/file?id=${fileId}&ext=mp4`, fileName: "download.mp4" });
        controller.close();
      } catch (err) {
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
