import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

const BASE_ARGS = [
  "--no-warnings",
  "--no-playlist",
  "--user-agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
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
