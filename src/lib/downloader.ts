import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import fs from "fs/promises";
import { existsSync, mkdirSync } from "fs";

const execFileAsync = promisify(execFile);

const DOWNLOAD_DIR = process.env.DOWNLOAD_DIR || /* turbopackIgnore: true */ path.join(process.cwd(), "downloads");

const BASE_ARGS = [
  "--no-warnings",
  "--no-playlist",
  "--user-agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "--extractor-args", "youtube:player_client=web,mweb,android",
];

if (!existsSync(/* turbopackIgnore: true */ DOWNLOAD_DIR)) {
  mkdirSync(/* turbopackIgnore: true */ DOWNLOAD_DIR, { recursive: true });
}

function detectPlatform(url: string): "youtube" | "instagram" | "facebook" | "tiktok" | "twitter" | "unknown" {
  const lower = url.toLowerCase();
  if (lower.includes("youtube.com") || lower.includes("youtu.be") || lower.includes("youtube.com/shorts")) {
    return "youtube";
  }
  if (lower.includes("instagram.com")) {
    return "instagram";
  }
  if (lower.includes("facebook.com") || lower.includes("fb.watch") || lower.includes("fb.com")) {
    return "facebook";
  }
  if (lower.includes("tiktok.com")) {
    return "tiktok";
  }
  if (lower.includes("twitter.com") || lower.includes("x.com")) {
    return "twitter";
  }
  return "unknown";
}

export async function fetchVideoInfo(url: string) {
  const platform = detectPlatform(url);

  try {
    const { stdout } = await execFileAsync("yt-dlp", [
      ...BASE_ARGS,
      "--dump-json",
      "--no-download",
      url,
    ], { timeout: 30000 });

    const info = JSON.parse(stdout);

    let thumbnail = info.thumbnail || info.thumbnails?.[info.thumbnails.length - 1]?.url || "";
    if (!thumbnail && info.thumbnails?.length > 0) {
      thumbnail = info.thumbnails[0].url;
    }

    return {
      success: true,
      platform,
      title: info.title || "Unknown Title",
      thumbnail,
      duration: info.duration || 0,
      duration_string: info.duration_string || "0:00",
      uploader: info.uploader || info.channel || "Unknown",
      view_count: info.view_count || 0,
      upload_date: info.upload_date || "",
      description: (info.description || "").slice(0, 200),
      formats: info.formats || [],
    };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : "Unknown error";
    return {
      success: false,
      platform,
      error: errMsg,
    };
  }
}

export async function downloadMedia(
  url: string,
  format: "mp4" | "mp3",
  quality: string = "720p"
): Promise<{ success: boolean; filePath?: string; error?: string; fileName?: string }> {
  const jobId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let outputTemplate: string;
  let args: string[] = [];

  if (format === "mp3") {
    outputTemplate = path.join(DOWNLOAD_DIR, `${jobId}.%(ext)s`);
    args = [
      ...BASE_ARGS,
      "-x",
      "--audio-format", "mp3",
      "--audio-quality", "256K",
      "--embed-thumbnail",
      "--add-metadata",
      "-o", outputTemplate,
      url,
    ];
  } else {
    const formatMap: Record<string, string> = {
      "1080p": "bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080][ext=mp4]/best",
      "720p": "bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720][ext=mp4]/best",
      "480p": "bestvideo[height<=480][ext=mp4]+bestaudio[ext=m4a]/best[height<=480][ext=mp4]/best",
    };

    const platform = detectPlatform(url);
    let fmtStr = formatMap[quality] || formatMap["720p"];

    if (platform === "instagram" || platform === "facebook") {
      fmtStr = "best[ext=mp4]/best";
    }

    outputTemplate = path.join(DOWNLOAD_DIR, `${jobId}.%(ext)s`);
    args = [
      ...BASE_ARGS,
      "-f", fmtStr,
      "--merge-output-format", "mp4",
      "--embed-thumbnail",
      "--add-metadata",
      "-o", outputTemplate,
      url,
    ];
  }

  try {
    await execFileAsync("yt-dlp", args, { timeout: 300000 });

    const files = await fs.readdir(/* turbopackIgnore: true */ DOWNLOAD_DIR);
    const matchedFile = files.find((f) => f.startsWith(jobId));

    if (!matchedFile) {
      return { success: false, error: "Download completed but file not found" };
    }

    const filePath = path.join(/* turbopackIgnore: true */ DOWNLOAD_DIR, matchedFile);
    return { success: true, filePath, fileName: matchedFile };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : "Download failed";
    return { success: false, error: errMsg };
  }
}

export async function cleanupFile(filePath: string) {
  try {
    if (existsSync(filePath)) {
      await fs.unlink(filePath);
    }
  } catch {
    // silent cleanup
  }
}
