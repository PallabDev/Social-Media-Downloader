"use client";

import { useState, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";

type Platform = "youtube" | "instagram" | "facebook" | "tiktok" | "twitter" | "unknown";

interface Format {
  format_id: string;
  label: string;
  ext: string;
  type: "video" | "audio" | "video+audio";
  height: number | null;
  fps: number | null;
  filesize: string;
  bitrate: string;
}

interface VideoInfo {
  success: boolean;
  platform: Platform;
  title: string;
  thumbnail: string;
  duration: number;
  duration_string: string;
  uploader: string;
  view_count: number;
  upload_date: string;
  description: string;
  formats: Format[];
  error?: string;
}

const platformColors: Record<Platform, string> = {
  youtube: "bg-red-500/20 text-red-400 border border-red-500/30",
  instagram: "bg-purple-500/20 text-purple-400 border border-purple-500/30",
  facebook: "bg-blue-500/20 text-blue-400 border border-blue-500/30",
  tiktok: "bg-pink-500/20 text-pink-400 border border-pink-500/30",
  twitter: "bg-sky-500/20 text-sky-400 border border-sky-500/30",
  unknown: "bg-zinc-500/20 text-zinc-400 border border-zinc-500/30",
};

const platformLabels: Record<Platform, string> = {
  youtube: "YouTube",
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
  twitter: "Twitter/X",
  unknown: "Unknown",
};

export default function Home() {
  const [url, setUrl] = useState("");
  const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"video" | "audio">("video");

  const fetchInfo = useCallback(async () => {
    if (!url.trim()) return;
    setLoading(true);
    setError("");
    setVideoInfo(null);
    try {
      const res = await fetch("/api/info", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to fetch video info");
        return;
      }
      setVideoInfo(data);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [url]);

  const handleDownload = useCallback((formatId: string, isAudio: boolean) => {
    if (!videoInfo || !url.trim()) return;
    const params = new URLSearchParams({ url: url.trim(), format_id: formatId });
    if (isAudio) params.set("format", "mp3");
    window.open(`/download?${params.toString()}`, "_blank");
  }, [videoInfo, url]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !loading) fetchInfo();
  };

  const formatNumber = (num: number) => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toString();
  };

  const videoFormats = videoInfo?.formats.filter((f) => f.type === "video+audio") || [];
  const audioFormats = videoInfo?.formats.filter((f) => f.type === "audio") || [];

  return (
    <div className="min-h-screen">
      <div className="max-w-2xl mx-auto px-4 py-16 relative z-10">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold tracking-tight bg-gradient-to-br from-white via-white to-zinc-500 bg-clip-text text-transparent">
            Social Media Downloader
          </h1>
          <p className="mt-3 text-sm text-zinc-500">
            YouTube &middot; Instagram &middot; Facebook &middot; TikTok &middot; Twitter/X
          </p>
        </div>

        <Card className="glass-card mb-6 rounded-xl">
          <CardContent className="p-5">
            <Label htmlFor="url" className="text-xs font-medium text-zinc-500 uppercase tracking-wider">
              Video URL
            </Label>
            <div className="flex gap-2 mt-3">
              <Input
                id="url"
                type="url"
                placeholder="Paste video URL here..."
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={handleKeyDown}
                className="flex-1 h-11 bg-white/5 border-white/10 rounded-lg text-sm placeholder:text-zinc-600 focus-visible:ring-indigo-500/50 focus-visible:border-indigo-500/50"
                disabled={loading}
              />
              <Button
                onClick={fetchInfo}
                disabled={loading || !url.trim()}
                className="h-11 px-6 bg-gradient-to-r from-indigo-500 to-purple-500 hover:from-indigo-600 hover:to-purple-600 text-white rounded-lg font-medium text-sm shadow-lg shadow-indigo-500/25 transition-all"
              >
                {loading ? (
                  <span className="flex items-center gap-2">
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Fetching
                  </span>
                ) : (
                  "Fetch"
                )}
              </Button>
            </div>
          </CardContent>
        </Card>

        {error && (
          <Card className="glass-card border-red-500/20 mb-6 rounded-xl">
            <CardContent className="p-4">
              <p className="text-sm text-red-400">{error}</p>
            </CardContent>
          </Card>
        )}

        {videoInfo && videoInfo.success && (
          <Card className="glass-card rounded-xl overflow-hidden">
            <CardContent className="p-5">
              <div className="flex items-center justify-between mb-4">
                <Badge className={`${platformColors[videoInfo.platform]} rounded-full text-xs font-medium px-3 py-1`}>
                  {platformLabels[videoInfo.platform]}
                </Badge>
                <span className="text-xs text-zinc-500 font-mono">{videoInfo.duration_string}</span>
              </div>

              {videoInfo.thumbnail && (
                <div className="relative mb-4 rounded-lg overflow-hidden bg-white/5">
                  <img
                    src={`/api/thumb?src=${encodeURIComponent(videoInfo.thumbnail)}`}
                    alt={videoInfo.title}
                    className="w-full aspect-video object-cover"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
                  <div className="absolute bottom-3 left-3 right-3">
                    <span className="text-xs text-white/80 font-mono bg-black/40 backdrop-blur-sm px-2 py-1 rounded">
                      {videoInfo.duration_string}
                    </span>
                  </div>
                </div>
              )}

              <h2 className="text-base font-semibold text-white leading-tight mb-2">{videoInfo.title}</h2>
              <p className="text-xs text-zinc-500 mb-1">{videoInfo.uploader}</p>
              {videoInfo.view_count > 0 && (
                <p className="text-xs text-zinc-600">{formatNumber(videoInfo.view_count)} views</p>
              )}

              <Separator className="my-4 bg-white/5" />

              {/* Tabs */}
              <div className="flex gap-1 mb-4 bg-white/5 rounded-lg p-1">
                <button
                  onClick={() => setTab("video")}
                  className={`flex-1 py-2 rounded-md text-sm font-medium transition-all ${
                    tab === "video"
                      ? "bg-gradient-to-r from-indigo-500 to-purple-500 text-white shadow"
                      : "text-zinc-400 hover:text-white"
                  }`}
                >
                  Video ({videoFormats.length})
                </button>
                <button
                  onClick={() => setTab("audio")}
                  className={`flex-1 py-2 rounded-md text-sm font-medium transition-all ${
                    tab === "audio"
                      ? "bg-gradient-to-r from-indigo-500 to-purple-500 text-white shadow"
                      : "text-zinc-400 hover:text-white"
                  }`}
                >
                  Audio ({audioFormats.length})
                </button>
              </div>

              {/* Format List */}
              <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                {tab === "video" && videoFormats.map((f) => (
                  <button
                    key={f.format_id}
                    onClick={() => handleDownload(f.format_id, false)}
                    className="w-full flex items-center justify-between p-3 rounded-lg bg-white/[0.03] border border-white/5 hover:bg-white/[0.06] hover:border-indigo-500/30 transition-all group text-left"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-white group-hover:text-indigo-400 transition-colors">
                          {f.label}
                        </span>
                        <span className="text-[10px] text-zinc-600 font-mono">{f.ext}</span>
                      </div>
                      <div className="flex items-center gap-3 mt-1">
                        {f.filesize && <span className="text-[11px] text-zinc-600">{f.filesize}</span>}
                        {f.bitrate && <span className="text-[11px] text-zinc-600">{f.bitrate}</span>}
                        {f.fps && f.fps > 30 && <span className="text-[11px] text-zinc-600">{f.fps}fps</span>}
                      </div>
                    </div>
                    <svg className="w-4 h-4 text-zinc-600 group-hover:text-indigo-400 transition-colors shrink-0 ml-2" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                    </svg>
                  </button>
                ))}

                {tab === "audio" && audioFormats.map((f) => (
                  <button
                    key={f.format_id}
                    onClick={() => handleDownload(f.format_id, true)}
                    className="w-full flex items-center justify-between p-3 rounded-lg bg-white/[0.03] border border-white/5 hover:bg-white/[0.06] hover:border-indigo-500/30 transition-all group text-left"
                  >
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-medium text-white group-hover:text-indigo-400 transition-colors">
                        {f.label}
                      </span>
                      <div className="flex items-center gap-3 mt-1">
                        {f.filesize && <span className="text-[11px] text-zinc-600">{f.filesize}</span>}
                        {f.bitrate && <span className="text-[11px] text-zinc-600">{f.bitrate}</span>}
                      </div>
                    </div>
                    <svg className="w-4 h-4 text-zinc-600 group-hover:text-indigo-400 transition-colors shrink-0 ml-2" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                    </svg>
                  </button>
                ))}

                {tab === "video" && videoFormats.length === 0 && (
                  <p className="text-sm text-zinc-600 text-center py-4">No video formats available</p>
                )}
                {tab === "audio" && audioFormats.length === 0 && (
                  <p className="text-sm text-zinc-600 text-center py-4">No audio formats available</p>
                )}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
