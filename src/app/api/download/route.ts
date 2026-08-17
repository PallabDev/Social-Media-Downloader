import { type NextRequest } from "next/server";
import { downloadMedia } from "@/lib/downloader";
import { Readable } from "stream";
import { statSync, createReadStream } from "fs";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const url = request.nextUrl.searchParams.get("url");
    const format = request.nextUrl.searchParams.get("format");
    const quality = request.nextUrl.searchParams.get("quality");

    if (!url || typeof url !== "string") {
      return Response.json({ error: "URL is required" }, { status: 400 });
    }

    if (!format || !["mp4", "mp3"].includes(format)) {
      return Response.json({ error: "Format must be mp4 or mp3" }, { status: 400 });
    }

    if (format === "mp4" && quality && !["1080p", "720p", "480p"].includes(quality)) {
      return Response.json({ error: "Invalid quality" }, { status: 400 });
    }

    const result = await downloadMedia(url.trim(), format as "mp4" | "mp3", quality || "720p");

    if (!result.success || !result.filePath) {
      return Response.json({ error: result.error || "Download failed" }, { status: 500 });
    }

    const fileStream = createReadStream(result.filePath);
    const fileName = result.fileName || "download";

    const headers = new Headers();
    headers.set("Content-Disposition", `attachment; filename="${fileName}"`);
    headers.set("Content-Type", format === "mp3" ? "audio/mpeg" : "video/mp4");

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
