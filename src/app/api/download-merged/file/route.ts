import { type NextRequest } from "next/server";
import { readFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

export const dynamic = "force-dynamic";

const MERGED_DIR = join(tmpdir(), "sdl-merged");

export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");
  const ext = request.nextUrl.searchParams.get("ext") || "mp4";

  if (!id) {
    return Response.json({ error: "ID is required" }, { status: 400 });
  }

  const filePath = join(MERGED_DIR, `${id}.${ext}`);

  try {
    const fileBuffer = readFileSync(filePath);
    const contentType = ext === "mp3" ? "audio/mpeg" : "video/mp4";

    setTimeout(() => {
      try { rmSync(filePath); } catch {}
    }, 5000);

    return new Response(fileBuffer, {
      status: 200,
      headers: {
        "Content-Disposition": `attachment; filename="download.${ext}"`,
        "Content-Type": contentType,
        "Content-Length": fileBuffer.length.toString(),
      },
    });
  } catch {
    return Response.json({ error: "File not found or expired" }, { status: 404 });
  }
}
