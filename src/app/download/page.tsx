"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useState, Suspense } from "react";

function DownloadContent() {
  const searchParams = useSearchParams();
  const url = searchParams.get("url") || "";
  const format = searchParams.get("format") || "mp4";
  const quality = searchParams.get("quality") || "720p";

  const [status, setStatus] = useState<"preparing" | "downloading" | "error">("preparing");
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!url) {
      setStatus("error");
      return;
    }

    const params = new URLSearchParams({ url, format });
    if (format === "mp4") params.set("quality", quality);

    const downloadUrl = `/api/download?${params.toString()}`;

    const iframe = document.createElement("iframe");
    iframe.style.display = "none";
    iframe.src = downloadUrl;
    document.body.appendChild(iframe);

    const checkTimer = setTimeout(() => {
      setStatus("downloading");
    }, 3000);

    return () => {
      clearTimeout(checkTimer);
      iframe.remove();
    };
  }, [url, format, quality]);

  const formatLabel = format === "mp3" ? "MP3 (256kbps)" : `MP4 (${quality})`;

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="max-w-md w-full mx-4">
        <div className="glass-card rounded-xl p-8 text-center">
          {status === "error" ? (
            <>
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-red-500/10 flex items-center justify-center">
                <svg className="w-8 h-8 text-red-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                </svg>
              </div>
              <h1 className="text-lg font-semibold text-white mb-2">Invalid Request</h1>
              <p className="text-sm text-zinc-500">No URL provided. Go back and try again.</p>
            </>
          ) : (
            <>
              <div className="w-16 h-16 mx-auto mb-6 relative">
                <div className="absolute inset-0 rounded-full border-2 border-indigo-500/20" />
                <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-indigo-500 animate-spin" />
                <div className="absolute inset-2 rounded-full border-2 border-transparent border-t-purple-500 animate-spin" style={{ animationDirection: "reverse", animationDuration: "1.5s" }} />
                <div className="absolute inset-0 flex items-center justify-center">
                  <svg className="w-6 h-6 text-indigo-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                  </svg>
                </div>
              </div>

              <h1 className="text-lg font-semibold text-white mb-2">
                {status === "preparing" ? "Preparing your download..." : "Download started"}
              </h1>

              <p className="text-sm text-zinc-500 mb-6">
                {status === "preparing"
                  ? "Fetching video info and processing..."
                  : "Your browser should prompt you to save the file."}
              </p>

              <div className="space-y-3 text-left">
                <div className="flex items-center justify-between py-2 border-b border-white/5">
                  <span className="text-xs text-zinc-600 uppercase tracking-wider">Format</span>
                  <span className="text-sm text-zinc-300 font-medium">{formatLabel}</span>
                </div>
                <div className="flex items-center justify-between py-2 border-b border-white/5">
                  <span className="text-xs text-zinc-600 uppercase tracking-wider">Status</span>
                  <span className={`text-sm font-medium ${status === "downloading" ? "text-green-400" : "text-indigo-400"}`}>
                    {status === "downloading" ? "Ready" : "Processing"}
                  </span>
                </div>
                <div className="flex items-center justify-between py-2">
                  <span className="text-xs text-zinc-600 uppercase tracking-wider">Elapsed</span>
                  <span className="text-sm text-zinc-400 font-mono">{elapsed}s</span>
                </div>
              </div>

              {status === "downloading" && (
                <p className="mt-6 text-xs text-zinc-600">
                  If download didn&apos;t start,{" "}
                  <button
                    onClick={() => {
                      const params = new URLSearchParams({ url, format });
                      if (format === "mp4") params.set("quality", quality);
                      window.location.href = `/api/download?${params.toString()}`;
                    }}
                    className="text-indigo-400 hover:text-indigo-300 underline underline-offset-2"
                  >
                    click here
                  </button>
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function DownloadPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          <div className="glass-card rounded-xl p-8 text-center max-w-md w-full mx-4">
            <div className="w-16 h-16 mx-auto mb-6 relative">
              <div className="absolute inset-0 rounded-full border-2 border-indigo-500/20" />
              <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-indigo-500 animate-spin" />
            </div>
            <h1 className="text-lg font-semibold text-white mb-2">Loading...</h1>
          </div>
        </div>
      }
    >
      <DownloadContent />
    </Suspense>
  );
}
