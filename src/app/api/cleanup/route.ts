import { type NextRequest } from "next/server";
import { cleanupFile } from "@/lib/downloader";
import path from "path";

const DOWNLOAD_DIR = process.env.DOWNLOAD_DIR || path.join(process.cwd(), "downloads");

export async function POST(request: NextRequest) {
  try {
    const { fileName } = await request.json();

    if (!fileName || typeof fileName !== "string") {
      return Response.json({ error: "File name is required" }, { status: 400 });
    }

    if (fileName.includes("..") || fileName.includes("/") || fileName.includes("\\")) {
      return Response.json({ error: "Invalid file name" }, { status: 400 });
    }

    const filePath = path.join(DOWNLOAD_DIR, fileName);
    await cleanupFile(filePath);

    return Response.json({ success: true });
  } catch {
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
