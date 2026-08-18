import { type NextRequest } from "next/server";
import { fetchVideoInfo } from "@/lib/downloader";

export async function POST(request: NextRequest) {
  try {
    console.log("Info API: parsing body...");
    const body = await request.text();
    console.log("Info API: raw body:", body.slice(0, 200));
    const { url } = JSON.parse(body);

    if (!url || typeof url !== "string") {
      return Response.json({ error: "URL is required" }, { status: 400 });
    }

    const urlPattern = /^https?:\/\/.+/i;
    if (!urlPattern.test(url.trim())) {
      return Response.json({ error: "Invalid URL format" }, { status: 400 });
    }

    console.log("Info API: fetching info for", url.trim());
    const info = await fetchVideoInfo(url.trim());
    console.log("Info API: result success:", info.success, "formats:", info.formats?.length);

    if (!info.success) {
      return Response.json({ error: info.error || "Failed to fetch video info" }, { status: 400 });
    }

    return Response.json(info);
  } catch (e: any) {
    console.error("Info API error:", e?.message || e, e?.stack?.slice(0, 500));
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
