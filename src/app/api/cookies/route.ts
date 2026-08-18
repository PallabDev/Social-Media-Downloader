import { type NextRequest } from "next/server";
import { writeFileSync, existsSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { createChildLogger } from "@/lib/logger";

export const dynamic = "force-dynamic";

const log = createChildLogger("api:cookies");

const COOKIE_FILE = join(tmpdir(), "cookies.txt");

export async function POST(request: NextRequest) {
  log.info("POST /api/cookies - uploading cookies");

  try {
    const formData = await request.formData();
    const file = formData.get("cookies") as File;

    if (!file) {
      log.warn("POST /api/cookies - no file uploaded");
      return Response.json({ error: "No file uploaded" }, { status: 400 });
    }

    const text = await file.text();

    if (!text.includes("# Netscape HTTP Cookie File")) {
      log.warn("POST /api/cookies - invalid cookie file format", { fileName: file.name });
      return Response.json({ error: "Invalid cookie file format" }, { status: 400 });
    }

    writeFileSync(COOKIE_FILE, text);

    const lines = text.split("\n").filter((l) => l.trim() && !l.startsWith("#"));

    log.info("POST /api/cookies - cookies uploaded", { fileName: file.name, cookieCount: lines.length });

    return Response.json({ success: true, message: "Cookies uploaded successfully", count: lines.length });
  } catch (err) {
    log.error("POST /api/cookies - failed", { error: err instanceof Error ? err.message : String(err) });
    return Response.json({ error: "Failed to upload cookies" }, { status: 500 });
  }
}

export async function GET() {
  try {
    if (existsSync(COOKIE_FILE)) {
      const content = readFileSync(COOKIE_FILE, "utf-8");
      const lines = content.split("\n").filter((l) => l.trim() && !l.startsWith("#"));
      log.info("GET /api/cookies - cookies found", { cookieCount: lines.length });
      return Response.json({ hasCookies: true, count: lines.length });
    }
    log.info("GET /api/cookies - no cookies file");
    return Response.json({ hasCookies: false, count: 0 });
  } catch (err) {
    log.error("GET /api/cookies - error", { error: err instanceof Error ? err.message : String(err) });
    return Response.json({ hasCookies: false, count: 0 });
  }
}

export async function DELETE() {
  log.info("DELETE /api/cookies - deleting cookies");
  try {
    if (existsSync(COOKIE_FILE)) {
      rmSync(COOKIE_FILE);
      log.info("DELETE /api/cookies - cookies deleted");
    }
    return Response.json({ success: true, message: "Cookies deleted" });
  } catch (err) {
    log.error("DELETE /api/cookies - failed", { error: err instanceof Error ? err.message : String(err) });
    return Response.json({ error: "Failed to delete cookies" }, { status: 500 });
  }
}
