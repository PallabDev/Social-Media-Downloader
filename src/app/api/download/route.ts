import { type NextRequest } from "next/server";
import { spawn } from "child_process";
import { Readable } from "stream";

export const dynamic = "force-dynamic";

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

function buildArgs(url: string, format: "mp4" | "mp3", quality: string): string[] {
  if (format === "mp3") {
    return [
      ...BASE_ARGS,
      "-x",
      "--audio-format", "mp3",
      "--audio-quality", "256K",
      "-o", "-",
      url,
    ];
  }

  const formatMap: Record<string, string> = {
    "1080p": "bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=1080]+bestaudio/best[height<=1080]/best",
    "720p": "bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=720]+bestaudio/best[height<=720]/best",
    "480p": "bestvideo[height<=480][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=480]+bestaudio/best[height<=480]/best",
  };

  const platform = detectPlatform(url);
  let fmtStr = formatMap[quality] || formatMap["720p"];
  if (platform === "instagram" || platform === "facebook") {
    fmtStr = "best[ext=mp4]/best";
  }

  return [
    ...BASE_ARGS,
    "-f", fmtStr,
    "--merge-output-format", "mp4",
    "-o", "-",
    url,
  ];
}

function getContentType(format: string): string {
  return format === "mp3" ? "audio/mpeg" : "video/mp4";
}

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get("url");
  const format = request.nextUrl.searchParams.get("format") || "mp4";
  const quality = request.nextUrl.searchParams.get("quality") || "720p";

  if (!url) {
    return Response.json({ error: "URL is required" }, { status: 400 });
  }

  if (!["mp4", "mp3"].includes(format)) {
    return Response.json({ error: "Format must be mp4 or mp3" }, { status: 400 });
  }

  if (format === "mp4" && !["1080p", "720p", "480p"].includes(quality)) {
    return Response.json({ error: "Invalid quality" }, { status: 400 });
  }

  const args = buildArgs(url.trim(), format as "mp4" | "mp3", quality);
  const child = spawn("yt-dlp", args, { stdio: ["ignore", "pipe", "pipe"] });

  const webStream = new ReadableStream({
    start(controller) {
      child.stdout.on("data", (chunk: Buffer) => {
        controller.enqueue(new Uint8Array(chunk));
      });

      child.stdout.on("end", () => {
        controller.close();
      });

      child.on("error", (err) => {
        controller.error(err);
      });

      child.stderr.on("data", () => {});
    },
    cancel() {
      child.kill("SIGTERM");
    },
  });

  const fileName = `download.${format === "mp3" ? "mp3" : "mp4"}`;

  return new Response(webStream, {
    status: 200,
    headers: {
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Content-Type": getContentType(format),
      "Transfer-Encoding": "chunked",
      "Cache-Control": "no-cache",
    },
  });
}
