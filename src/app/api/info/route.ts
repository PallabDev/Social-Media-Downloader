import { type NextRequest } from "next/server";
import { fetchVideoInfo } from "@/lib/downloader";

export async function POST(request: NextRequest) {
  try {
    const { url } = await request.json();

    if (!url || typeof url !== "string") {
      return Response.json({ error: "URL is required" }, { status: 400 });
    }

    const urlPattern = /^https?:\/\/.+/i;
    if (!urlPattern.test(url.trim())) {
      return Response.json({ error: "Invalid URL format" }, { status: 400 });
    }

    const info = await fetchVideoInfo(url.trim());

    if (!info.success) {
      return Response.json({ error: info.error || "Failed to fetch video info" }, { status: 400 });
    }

    return Response.json(info);
  } catch (e: any) {
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
