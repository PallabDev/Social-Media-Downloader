import { execFile } from "child_process";
import { promisify } from "util";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { createChildLogger } from "./logger";

const execFileAsync = promisify(execFile);

const COOKIE_FILE = join(tmpdir(), "cookies.txt");

const log = createChildLogger("downloader");

export function getBaseArgs(): string[] {
  const hasCookies = existsSync(COOKIE_FILE);
  return [
    "--no-warnings",
    "--no-playlist",
    "--js-runtimes", "node",
    "--user-agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    ...(hasCookies ? ["--cookies", COOKIE_FILE] : ["--extractor-args", "youtube:player_client=android_vr,android,web,mweb"]),
  ];
}

export function detectPlatform(url: string): "youtube" | "instagram" | "facebook" | "tiktok" | "twitter" | "unknown" {
  const lower = url.toLowerCase();
  if (lower.includes("youtube.com") || lower.includes("youtu.be") || lower.includes("youtube.com/shorts")) return "youtube";
  if (lower.includes("instagram.com")) return "instagram";
  if (lower.includes("facebook.com") || lower.includes("fb.watch") || lower.includes("fb.com")) return "facebook";
  if (lower.includes("tiktok")) return "tiktok";
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

const TARGET_HEIGHTS = [1080, 720, 480];

function processFormats(formats: RawFormat[]): ProcessedFormat[] {
  const result: ProcessedFormat[] = [];

  for (const height of TARGET_HEIGHTS) {
    const candidates = formats.filter(
      (f) => f.height === height && f.vcodec !== "none" && f.acodec === "none" && (f.ext === "mp4" || f.ext === "webm")
    );

    const bestMp4 = candidates.filter((f) => f.ext === "mp4").sort((a, b) => (b.tbr || 0) - (a.tbr || 0))[0];
    const bestWebm = candidates.filter((f) => f.ext === "webm").sort((a, b) => (b.tbr || 0) - (a.tbr || 0))[0];

    if (bestMp4) {
      result.push({
        format_id: bestMp4.format_id,
        label: `${height}p`,
        ext: "mp4",
        type: "video",
        height,
        fps: bestMp4.fps,
        filesize: formatSize(bestMp4.filesize),
        bitrate: formatBitrate(bestMp4.tbr),
      });
    }

    if (bestWebm) {
      result.push({
        format_id: bestWebm.format_id,
        label: `${height}p`,
        ext: "webm",
        type: "video",
        height,
        fps: bestWebm.fps,
        filesize: formatSize(bestWebm.filesize),
        bitrate: formatBitrate(bestWebm.tbr),
      });
    }
  }

  const audioFormats = formats.filter((f) => f.vcodec === "none" && f.acodec !== "none");
  const bestAudio = audioFormats.filter((f) => f.ext === "m4a").sort((a, b) => (b.tbr || 0) - (a.tbr || 0))[0]
    || audioFormats.sort((a, b) => (b.tbr || 0) - (a.tbr || 0))[0];

  if (bestAudio) {
    result.push({
      format_id: bestAudio.format_id,
      label: `Audio ${formatBitrate(bestAudio.tbr)}`.trim(),
      ext: bestAudio.ext,
      type: "audio",
      height: 0,
      fps: 0,
      filesize: formatSize(bestAudio.filesize),
      bitrate: formatBitrate(bestAudio.tbr),
    });
  }

  return result;
}

export async function fetchVideoInfo(url: string) {
  const platform = detectPlatform(url);
  const isYouTube = platform === "youtube";
  const hasCookies = existsSync(COOKIE_FILE);

  log.info("fetchVideoInfo started", { url, platform, hasCookies });

  const runYtDlp = async (extraArgs: string[], attemptLabel: string) => {
    log.info(`yt-dlp info attempt: ${attemptLabel}`, {
      url,
      args: extraArgs,
      hasCookies,
    });

    const { stdout, stderr } = await execFileAsync("yt-dlp", [
      ...extraArgs,
      "--dump-json",
      "--no-download",
      url,
    ], { timeout: 30000 });

    const output = (stdout || "").trim();
    const errOutput = (stderr || "").trim();

    if (errOutput) {
      log.warn("yt-dlp stderr during info fetch", { attemptLabel, stderr: errOutput.slice(0, 500) });
    }

    if (output.length === 0) {
      throw new Error(`Empty response from yt-dlp: ${errOutput || "unknown"}`);
    }

    try {
      const parsed = JSON.parse(output);
      log.info("yt-dlp info parsed OK", { attemptLabel, formatCount: parsed.formats?.length ?? 0 });
      return parsed;
    } catch {
      const lines = output.split("\n");
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line.trim());
          if (parsed?.id) {
            log.info("yt-dlp info parsed OK (multiline)", { attemptLabel, formatCount: parsed.formats?.length ?? 0 });
            return parsed;
          }
        } catch { continue; }
      }
      throw new Error(`Failed to parse yt-dlp JSON (first 200 chars): ${output.slice(0, 200)}`);
    }
  };

  const runYtDlpSafe = async (extraArgs: string[], attemptLabel: string): Promise<any> => {
    try {
      return await runYtDlp(extraArgs, attemptLabel);
    } catch (err) {
      log.error("yt-dlp info attempt failed", {
        attemptLabel,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  };

  try {
    let info;

    const baseArgs = getBaseArgs();
    log.info("Trying base args (with cookies or player_client)", { args: baseArgs });
    info = await runYtDlpSafe(baseArgs, "base-args");

    if (!info && isYouTube) {
      log.warn("Base args failed, trying android player_client fallback");
      info = await runYtDlpSafe(
        ["--no-warnings", "--no-playlist", "--js-runtimes", "node", "--extractor-args", "youtube:player_client=android"],
        "android-fallback"
      );
    }

    if (!info && isYouTube) {
      log.warn("Android fallback failed, trying web,mweb player_client fallback");
      info = await runYtDlpSafe(
        ["--no-warnings", "--no-playlist", "--js-runtimes", "node", "--extractor-args", "youtube:player_client=web,mweb"],
        "web-mweb-fallback"
      );
    }

    if (!info) {
      throw new Error("Failed to fetch video info with all methods");
    }

    let thumbnail = info.thumbnail || info.thumbnails?.[info.thumbnails.length - 1]?.url || "";
    if (!thumbnail && info.thumbnails?.length > 0) {
      thumbnail = info.thumbnails[0].url;
    }

    const processedFormats = processFormats(info.formats || []);

    log.info("fetchVideoInfo completed", {
      url,
      platform,
      title: info.title,
      totalFormats: info.formats?.length ?? 0,
      processedFormats: processedFormats.length,
      formats: processedFormats.map((f) => `${f.label} ${f.ext}`),
    });

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
    log.error("fetchVideoInfo failed", { url, platform, error: errMsg });
    return {
      success: false,
      platform,
      error: errMsg,
    };
  }
}
