import { type NextRequest } from "next/server";
import { downloadMedia } from "@/lib/downloader";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import { createWriteStream } from "fs";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { url, format, quality } = body;

    if (!url || typeof url !== "string") {
      return Response.json({ error: "URL is required" }, { status: 400 });
    }

    if (!format || !["mp4", "mp3"].includes(format)) {
      return Response.json({ error: "Format must be mp4 or mp3" }, { status: 400 });
    }

    if (format === "mp4" && quality && !["1080p", "720p", "480p"].includes(quality)) {
      return Response.json({ error: "Invalid quality" }, { status: 400 });
    }

    const result = await downloadMedia(url.trim(), format, quality || "720p");

    if (!result.success || !result.filePath) {
      return Response.json({ error: result.error || "Download failed" }, { status: 500 });
    }

    const { Readable } = await import("stream");
    const { createReadStream } = await import("fs");

    const fileStream = createReadStream(result.filePath);
    const fileName = result.fileName || "download";

    const headers = new Headers();
    headers.set("Content-Disposition", `attachment; filename="${fileName}"`);
    headers.set("Content-Type", format === "mp3" ? "audio/mpeg" : "video/mp4");

    const { statSync } = await import("fs");
    const fileStat = statSync(result.filePath);
    headers.set("Content-Length", fileStat.size.toString());

    const webStream = Readable.toWeb(fileStream) as ReadableStream;

    return new Response(webStream, {
      status: 200,
      headers,
    });
  } catch {
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
