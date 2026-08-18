import { type NextRequest } from "next/server";
import { fetchVideoInfo } from "@/lib/downloader";
import { createChildLogger } from "@/lib/logger";

const log = createChildLogger("api:info");

export async function POST(request: NextRequest) {
  const start = Date.now();
  let url = "";

  try {
    const body = await request.json();
    url = body.url;

    log.info("POST /api/info - request received", { url: url?.slice(0, 200) });

    if (!url || typeof url !== "string") {
      log.warn("POST /api/info - missing URL", { body });
      return Response.json({ error: "URL is required" }, { status: 400 });
    }

    const urlPattern = /^https?:\/\/.+/i;
    if (!urlPattern.test(url.trim())) {
      log.warn("POST /api/info - invalid URL format", { url });
      return Response.json({ error: "Invalid URL format" }, { status: 400 });
    }

    const info = await fetchVideoInfo(url.trim());

    if (!info.success) {
      log.error("POST /api/info - failed to fetch info", {
        url,
        error: info.error,
        elapsed: Date.now() - start,
      });
      return Response.json({ error: info.error || "Failed to fetch video info" }, { status: 400 });
    }

    log.info("POST /api/info - success", {
      url,
      platform: info.platform,
      title: info.title,
      formatCount: info.formats?.length ?? 0,
      elapsed: Date.now() - start,
    });

    return Response.json(info);
  } catch (e: any) {
    log.error("POST /api/info - unhandled error", {
      url,
      error: e?.message ?? String(e),
      stack: e?.stack,
      elapsed: Date.now() - start,
    });
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
