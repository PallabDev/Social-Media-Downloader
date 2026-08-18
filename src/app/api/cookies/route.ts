import { type NextRequest } from "next/server";
import { writeFileSync, existsSync, readFileSync, rmSync } from "fs";
import { join } from "path";

export const dynamic = "force-dynamic";

const COOKIE_FILE = join(process.cwd(), "cookies.txt");

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("cookies") as File;

    if (!file) {
      return Response.json({ error: "No file uploaded" }, { status: 400 });
    }

    const text = await file.text();

    if (!text.includes("# Netscape HTTP Cookie File")) {
      return Response.json({ error: "Invalid cookie file format" }, { status: 400 });
    }

    writeFileSync(COOKIE_FILE, text);

    return Response.json({ success: true, message: "Cookies uploaded successfully" });
  } catch {
    return Response.json({ error: "Failed to upload cookies" }, { status: 500 });
  }
}

export async function GET() {
  try {
    if (existsSync(COOKIE_FILE)) {
      const content = readFileSync(COOKIE_FILE, "utf-8");
      const lines = content.split("\n").filter((l) => l.trim() && !l.startsWith("#"));
      return Response.json({ hasCookies: true, count: lines.length });
    }
    return Response.json({ hasCookies: false, count: 0 });
  } catch {
    return Response.json({ hasCookies: false, count: 0 });
  }
}

export async function DELETE() {
  try {
    if (existsSync(COOKIE_FILE)) {
      rmSync(COOKIE_FILE);
    }
    return Response.json({ success: true, message: "Cookies deleted" });
  } catch {
    return Response.json({ error: "Failed to delete cookies" }, { status: 500 });
  }
}
