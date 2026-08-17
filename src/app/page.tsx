"use client";

import { useState, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Platform = "youtube" | "instagram" | "facebook" | "tiktok" | "twitter" | "unknown";

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
  formats: unknown[];
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
  const [downloading, setDownloading] = useState(false);
  const [format, setFormat] = useState<"mp4" | "mp3">("mp4");
  const [quality, setQuality] = useState("720p");
  const [error, setError] = useState("");
  const [downloadProgress, setDownloadProgress] = useState(0);

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

  const handleDownload = useCallback(async () => {
    if (!videoInfo || !url.trim()) return;

    setDownloading(true);
    setDownloadProgress(0);

    const progressInterval = setInterval(() => {
      setDownloadProgress((prev) => {
        if (prev >= 90) return prev;
        return prev + Math.random() * 15;
      });
    }, 1000);

    try {
      const res = await fetch("/api/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: url.trim(),
          format,
          quality: format === "mp4" ? quality : undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Download failed");
        return;
      }

      const contentDisposition = res.headers.get("Content-Disposition");
      const fileNameMatch = contentDisposition?.match(/filename="?(.+?)"?$/);
      const fileName = fileNameMatch?.[1] || `download.${format === "mp3" ? "mp3" : "mp4"}`;

      const blob = await res.blob();
      const downloadUrl = window.URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = downloadUrl;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(downloadUrl);
      document.body.removeChild(a);

      setDownloadProgress(100);

      fetch("/api/cleanup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName }),
      });
    } catch {
      setError("Download failed. Please try again.");
    } finally {
      clearInterval(progressInterval);
      setDownloading(false);
      setTimeout(() => setDownloadProgress(0), 2000);
    }
  }, [videoInfo, url, format, quality]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !loading) {
      fetchInfo();
    }
  };

  const formatNumber = (num: number) => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toString();
  };

  return (
    <div className="min-h-screen">
      <div className="max-w-2xl mx-auto px-4 py-16 relative z-10">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold tracking-tight bg-gradient-to-br from-white via-white to-zinc-500 bg-clip-text text-transparent">
            Social Media Downloader
          </h1>
          <p className="mt-3 text-sm text-zinc-500">
            YouTube &middot; Instagram &middot; Facebook &middot; TikTok &middot; Twitter/X
          </p>
        </div>

        {/* URL Input */}
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

        {/* Error */}
        {error && (
          <Card className="glass-card border-red-500/20 mb-6 rounded-xl">
            <CardContent className="p-4">
              <p className="text-sm text-red-400">{error}</p>
            </CardContent>
          </Card>
        )}

        {/* Video Preview */}
        {videoInfo && videoInfo.success && (
          <Card className="glass-card mb-6 rounded-xl overflow-hidden">
            <CardContent className="p-5">
              {/* Platform Badge & Duration */}
              <div className="flex items-center justify-between mb-4">
                <Badge className={`${platformColors[videoInfo.platform]} rounded-full text-xs font-medium px-3 py-1`}>
                  {platformLabels[videoInfo.platform]}
                </Badge>
                <span className="text-xs text-zinc-500 font-mono">
                  {videoInfo.duration_string}
                </span>
              </div>

              {/* Thumbnail */}
              {videoInfo.thumbnail && (
                <div className="relative mb-4 rounded-lg overflow-hidden bg-white/5">
                  <img
                    src={videoInfo.thumbnail}
                    alt={videoInfo.title}
                    className="w-full aspect-video object-cover"
                    crossOrigin="anonymous"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
                  <div className="absolute bottom-3 left-3 right-3">
                    <span className="text-xs text-white/80 font-mono bg-black/40 backdrop-blur-sm px-2 py-1 rounded">
                      {videoInfo.duration_string}
                    </span>
                  </div>
                </div>
              )}

              {/* Title & Metadata */}
              <h2 className="text-base font-semibold text-white leading-tight mb-2">
                {videoInfo.title}
              </h2>
              <p className="text-xs text-zinc-500 mb-1">
                {videoInfo.uploader}
              </p>
              {videoInfo.view_count > 0 && (
                <p className="text-xs text-zinc-600">
                  {formatNumber(videoInfo.view_count)} views
                </p>
              )}

              <Separator className="my-4 bg-white/5" />

              {/* Format Selection */}
              <div className="space-y-3">
                <Label className="text-xs font-medium text-zinc-500 uppercase tracking-wider">
                  Format
                </Label>
                <div className="flex gap-2">
                  <Button
                    variant={format === "mp4" ? "default" : "outline"}
                    onClick={() => setFormat("mp4")}
                    className={`h-9 px-5 rounded-lg text-sm font-medium transition-all ${
                      format === "mp4"
                        ? "bg-gradient-to-r from-indigo-500 to-purple-500 text-white shadow-lg shadow-indigo-500/25"
                        : "bg-white/5 text-zinc-400 border-white/10 hover:bg-white/10 hover:text-white"
                    }`}
                  >
                    MP4
                  </Button>
                  <Button
                    variant={format === "mp3" ? "default" : "outline"}
                    onClick={() => setFormat("mp3")}
                    className={`h-9 px-5 rounded-lg text-sm font-medium transition-all ${
                      format === "mp3"
                        ? "bg-gradient-to-r from-indigo-500 to-purple-500 text-white shadow-lg shadow-indigo-500/25"
                        : "bg-white/5 text-zinc-400 border-white/10 hover:bg-white/10 hover:text-white"
                    }`}
                  >
                    MP3
                  </Button>
                </div>

                {/* Quality Selection */}
                {format === "mp4" && (
                  <div className="space-y-2">
                    <Label className="text-xs font-medium text-zinc-500 uppercase tracking-wider">
                      Quality
                    </Label>
                    <Select value={quality} onValueChange={(v) => v && setQuality(v)}>
                      <SelectTrigger className="h-9 bg-white/5 border-white/10 rounded-lg text-sm w-full focus:ring-indigo-500/50">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-zinc-900 border-white/10 rounded-lg">
                        <SelectItem value="1080p" className="text-sm focus:bg-indigo-500/20 focus:text-indigo-300">1080p (Full HD)</SelectItem>
                        <SelectItem value="720p" className="text-sm focus:bg-indigo-500/20 focus:text-indigo-300">720p (HD)</SelectItem>
                        <SelectItem value="480p" className="text-sm focus:bg-indigo-500/20 focus:text-indigo-300">480p (SD)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {format === "mp3" && (
                  <div className="bg-white/5 border border-white/5 rounded-lg p-3">
                    <p className="text-xs text-zinc-500">
                      Audio only &middot; 256kbps MP3
                    </p>
                  </div>
                )}
              </div>

              {/* Download Button */}
              <div className="mt-5">
                {downloadProgress > 0 && (
                  <Progress value={downloadProgress} className="h-1.5 mb-3 rounded-full bg-white/5" />
                )}
                <Button
                  onClick={handleDownload}
                  disabled={downloading}
                  className="w-full h-11 bg-gradient-to-r from-indigo-500 to-purple-500 hover:from-indigo-600 hover:to-purple-600 text-white rounded-lg font-medium text-sm shadow-lg shadow-indigo-500/25 transition-all"
                >
                  {downloading ? (
                    <span className="flex items-center gap-2">
                      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      Downloading...
                    </span>
                  ) : (
                    <span className="flex items-center gap-2">
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                      </svg>
                      Download {format.toUpperCase()}
                      {format === "mp4" ? ` (${quality})` : " (256kbps)"}
                    </span>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}


      </div>
    </div>
  );
}
