import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

const BASE_ARGS = [
  "--no-warnings",
  "--no-playlist",
  "--user-agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
];

const YOUTUBE_FALLBACK_ARGS = [
  "--extractor-args", "youtube:player_client=web,mweb,android",
];

function detectPlatform(url: string): "youtube" | "instagram" | "facebook" | "tiktok" | "twitter" | "unknown" {
  const lower = url.toLowerCase();
  if (lower.includes("youtube.com") || lower.includes("youtu.be") || lower.includes("youtube.com/shorts")) return "youtube";
  if (lower.includes("instagram.com")) return "instagram";
  if (lower.includes("facebook.com") || lower.includes("fb.watch") || lower.includes("fb.com")) return "facebook";
  if (lower.includes("tiktok.com")) return "tiktok";
  if (lower.includes("twitter.com") || lower.includes("x.com")) return "twitter";
  return "unknown";
}

interface RawFormat {
  format_id: string;
  ext: string;
  resolution: string;
  height: number | null;
  fps: number | null;
  vcodec: string;
  acodec: string;
  filesize: number | null;
  tbr: number | null;
  format_note: string;
  quality_label: string;
}

interface ProcessedFormat {
  format_id: string;
  label: string;
  ext: string;
  type: "video" | "audio" | "video+audio";
  height: number | null;
  fps: number | null;
  filesize: string;
  bitrate: string;
}

function formatSize(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(1)} GB`;
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(0)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}

function formatBitrate(kbps: number | null): string {
  if (!kbps) return "";
  if (kbps >= 1000) return `${(kbps / 1000).toFixed(1)} Mbps`;
  return `${kbps.toFixed(0)} Kbps`;
}

function processFormats(formats: RawFormat[]): ProcessedFormat[] {
  const seen = new Set<string>();
  const result: ProcessedFormat[] = [];

  // Sort: video with audio first, then video only, then audio only
  const sorted = [...formats].sort((a, b) => {
    const aHasVideo = a.vcodec !== "none" ? 1 : 0;
    const bHasVideo = b.vcodec !== "none" ? 1 : 0;
    const aHasAudio = a.acodec !== "none" ? 1 : 0;
    const bHasAudio = b.acodec !== "none" ? 1 : 0;

    const aScore = aHasVideo * 2 + aHasAudio;
    const bScore = bHasVideo * 2 + bHasAudio;
    if (aScore !== bScore) return bScore - aScore;

    const aHeight = a.height || 0;
    const bHeight = b.height || 0;
    return bHeight - aHeight;
  });

  for (const f of sorted) {
    const hasVideo = f.vcodec !== "none";
    const hasAudio = f.acodec !== "none";

    // Skip storyboards, subtitles, etc
    if (!hasVideo && !hasAudio) continue;
    if (f.ext === "mhtml" || f.ext === "json") continue;

    // Create a dedup key based on resolution + codec combo
    const height = f.height || 0;
    const fps = f.fps || 0;
    const dedupKey = `${height}p${fps}_${f.vcodec}_${f.acodec}`;
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);

    let type: "video" | "audio" | "video+audio";
    let label: string;

    if (hasVideo && hasAudio) {
      type = "video+audio";
      label = height > 0 ? `${height}p${fps > 30 ? ` ${fps}fps` : ""}` : f.format_note || f.ext;
    } else if (hasVideo) {
      type = "video";
      label = height > 0 ? `${height}p${fps > 30 ? ` ${fps}fps` : ""} (no audio)` : f.format_note || f.ext;
    } else {
      type = "audio";
      const bitrate = f.tbr || 0;
      label = `Audio ${bitrate > 0 ? `${formatBitrate(bitrate)}` : ""}`.trim();
    }

    result.push({
      format_id: f.format_id,
      label,
      ext: f.ext,
      type,
      height,
      fps,
      filesize: formatSize(f.filesize),
      bitrate: formatBitrate(f.tbr),
    });
  }

  return result;
}

export async function fetchVideoInfo(url: string) {
  const platform = detectPlatform(url);
  const isYouTube = platform === "youtube";

  const runYtDlp = async (extraArgs: string[]) => {
    const { stdout } = await execFileAsync("yt-dlp", [
      ...BASE_ARGS,
      ...extraArgs,
      "--dump-json",
      "--no-download",
      url,
    ], { timeout: 30000 });
    if (!stdout || stdout.trim().length === 0) {
      throw new Error("Empty response from yt-dlp");
    }
    return JSON.parse(stdout);
  };

  const runYtDlpSafe = async (extraArgs: string[]): Promise<any> => {
    try {
      return await runYtDlp(extraArgs);
    } catch {
      return null;
    }
  };

  try {
    let info;
    // Try default first (full formats via android_vr)
    info = await runYtDlpSafe([]);

    if (!info) {
      // Default failed, try YouTube fallback if applicable
      if (isYouTube) {
        info = await runYtDlpSafe(YOUTUBE_FALLBACK_ARGS);
      }
    }

    if (!info) {
      throw new Error("Failed to fetch video info with all methods");
    }

    let thumbnail = info.thumbnail || info.thumbnails?.[info.thumbnails.length - 1]?.url || "";
    if (!thumbnail && info.thumbnails?.length > 0) {
      thumbnail = info.thumbnails[0].url;
    }

    const processedFormats = processFormats(info.formats || []);

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
      formats: processedFormats,
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
