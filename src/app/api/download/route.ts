import { type NextRequest } from "next/server";
import { spawn } from "child_process";
import { Readable } from "stream";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

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

function runYtdlp(args: string[]): Promise<{ success: boolean; outputPath?: string; error?: string }> {
  return new Promise((resolve) => {
    const child = spawn("yt-dlp", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("close", (code) => {
      if (code === 0) {
        const outputDir = args[args.indexOf("-o") + 1];
        const parentDir = join(outputDir, "..");
        try {
          const files = readdirSync(parentDir);
          const match = files.find((f) => f.includes(outputDir.split("/").pop() || ""));
          resolve({ success: true, outputPath: join(parentDir, match || "") });
        } catch {
          resolve({ success: false, error: stderr || "Output not found" });
        }
      } else {
        resolve({ success: false, error: stderr || `yt-dlp exited with code ${code}` });
      }
    });

    child.on("error", (err) => {
      resolve({ success: false, error: err.message });
    });
  });
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

  const fileName = `download.${format === "mp3" ? "mp3" : "mp4"}`;
  const contentType = format === "mp3" ? "audio/mpeg" : "video/mp4";

  if (format === "mp3") {
    const tmpDir = mkdtempSync(join(tmpdir(), "sdl-"));
    const outputTemplate = join(tmpDir, "audio");

    const args = [
      ...BASE_ARGS,
      "-f", "bestaudio/best",
      "-x",
      "--audio-format", "mp3",
      "--audio-quality", "256K",
      "-o", outputTemplate,
      url.trim(),
    ];

    const result = await runYtdlp(args);

    if (!result.success || !result.outputPath) {
      try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
      return Response.json({ error: result.error || "Download failed" }, { status: 500 });
    }

    const fileBuffer = readFileSync(result.outputPath);
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}

    return new Response(fileBuffer, {
      status: 200,
      headers: {
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Content-Type": contentType,
        "Content-Length": fileBuffer.length.toString(),
      },
    });
  }

  const formatMap: Record<string, string> = {
    "1080p": "bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=1080]+bestaudio/best[height<=1080]/best",
    "720p": "bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=720]+bestaudio/best[height<=720]/best",
    "480p": "bestvideo[height<=480][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=480]+bestaudio/best[height<=480]/best",
  };

  const platform = detectPlatform(url.trim());
  let fmtStr = formatMap[quality] || formatMap["720p"];
  if (platform === "instagram" || platform === "facebook") {
    fmtStr = "best[ext=mp4]/best";
  }

  const args = [
    ...BASE_ARGS,
    "-f", fmtStr,
    "--merge-output-format", "mp4",
    "-o", "-",
    url.trim(),
  ];

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

  return new Response(webStream, {
    status: 200,
    headers: {
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Content-Type": contentType,
      "Transfer-Encoding": "chunked",
      "Cache-Control": "no-cache",
    },
  });
}
