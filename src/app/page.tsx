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
  youtube: "bg-red-600 text-white",
  instagram: "bg-gradient-to-r from-purple-500 to-pink-500 text-white",
  facebook: "bg-blue-600 text-white",
  tiktok: "bg-black text-white",
  twitter: "bg-sky-500 text-white",
  unknown: "bg-zinc-500 text-white",
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

      // Cleanup on server
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
    <div className="min-h-screen bg-[#f0f0f0] text-[#1a1a1a]">
      <div className="max-w-2xl mx-auto px-4 py-12">
        {/* Header */}
        <div className="text-center mb-10">
          <h1 className="text-3xl font-bold tracking-tight text-[#1a1a1a]">
            Social Media Downloader
          </h1>
          <p className="mt-2 text-sm text-[#666]">
            YouTube, Instagram, Facebook, TikTok, Twitter/X
          </p>
        </div>

        {/* URL Input */}
        <Card className="border border-[#d4d4d4] bg-white shadow-none rounded-lg mb-6">
          <CardContent className="p-5">
            <Label htmlFor="url" className="text-xs font-medium text-[#555] uppercase tracking-wider">
              Video URL
            </Label>
            <div className="flex gap-2 mt-2">
              <Input
                id="url"
                type="url"
                placeholder="Paste video URL here..."
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={handleKeyDown}
                className="flex-1 h-10 border-[#d4d4d4] rounded-md text-sm focus-visible:ring-1 focus-visible:ring-[#999]"
                disabled={loading}
              />
              <Button
                onClick={fetchInfo}
                disabled={loading || !url.trim()}
                className="h-10 px-5 bg-[#1a1a1a] text-white hover:bg-[#333] rounded-md font-medium text-sm"
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
          <Card className="border border-red-200 bg-red-50 shadow-none rounded-lg mb-6">
            <CardContent className="p-4">
              <p className="text-sm text-red-700">{error}</p>
            </CardContent>
          </Card>
        )}

        {/* Video Preview */}
        {videoInfo && videoInfo.success && (
          <Card className="border border-[#d4d4d4] bg-white shadow-none rounded-lg mb-6">
            <CardContent className="p-5">
              {/* Platform Badge & Thumbnail */}
              <div className="flex items-center justify-between mb-4">
                <Badge className={`${platformColors[videoInfo.platform]} rounded text-xs font-medium px-2.5 py-0.5`}>
                  {platformLabels[videoInfo.platform]}
                </Badge>
                <span className="text-xs text-[#999]">
                  {videoInfo.duration_string}
                </span>
              </div>

              {videoInfo.thumbnail && (
                <div className="relative mb-4 rounded-md overflow-hidden bg-[#e5e5e5]">
                  <img
                    src={videoInfo.thumbnail}
                    alt={videoInfo.title}
                    className="w-full aspect-video object-cover"
                    crossOrigin="anonymous"
                  />
                </div>
              )}

              {/* Title & Metadata */}
              <h2 className="text-base font-semibold text-[#1a1a1a] leading-tight mb-2">
                {videoInfo.title}
              </h2>
              <p className="text-xs text-[#777] mb-1">
                {videoInfo.uploader}
              </p>
              {videoInfo.view_count > 0 && (
                <p className="text-xs text-[#999]">
                  {formatNumber(videoInfo.view_count)} views
                </p>
              )}

              <Separator className="my-4 bg-[#e5e5e5]" />

              {/* Format Selection */}
              <div className="space-y-3">
                <Label className="text-xs font-medium text-[#555] uppercase tracking-wider">
                  Format
                </Label>
                <div className="flex gap-2">
                  <Button
                    variant={format === "mp4" ? "default" : "outline"}
                    onClick={() => setFormat("mp4")}
                    className={`h-9 px-4 rounded-md text-sm font-medium ${
                      format === "mp4"
                        ? "bg-[#1a1a1a] text-white hover:bg-[#333]"
                        : "bg-white text-[#555] border-[#d4d4d4] hover:bg-[#f5f5f5]"
                    }`}
                  >
                    MP4
                  </Button>
                  <Button
                    variant={format === "mp3" ? "default" : "outline"}
                    onClick={() => setFormat("mp3")}
                    className={`h-9 px-4 rounded-md text-sm font-medium ${
                      format === "mp3"
                        ? "bg-[#1a1a1a] text-white hover:bg-[#333]"
                        : "bg-white text-[#555] border-[#d4d4d4] hover:bg-[#f5f5f5]"
                    }`}
                  >
                    MP3
                  </Button>
                </div>

                {/* Quality Selection */}
                {format === "mp4" && (
                  <div className="space-y-2">
                    <Label className="text-xs font-medium text-[#555] uppercase tracking-wider">
                      Quality
                    </Label>
                    <Select value={quality} onValueChange={(v) => v && setQuality(v)}>
                      <SelectTrigger className="h-9 border-[#d4d4d4] rounded-md text-sm w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-white border-[#d4d4d4] rounded-md">
                        <SelectItem value="1080p" className="text-sm">1080p (Full HD)</SelectItem>
                        <SelectItem value="720p" className="text-sm">720p (HD)</SelectItem>
                        <SelectItem value="480p" className="text-sm">480p (SD)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {format === "mp3" && (
                  <div className="bg-[#f5f5f5] border border-[#e5e5e5] rounded-md p-3">
                    <p className="text-xs text-[#666]">
                      Audio only &middot; 256kbps MP3
                    </p>
                  </div>
                )}
              </div>

              {/* Download Button */}
              <div className="mt-5">
                {downloadProgress > 0 && (
                  <Progress value={downloadProgress} className="h-1.5 mb-3 rounded bg-[#e5e5e5]" />
                )}
                <Button
                  onClick={handleDownload}
                  disabled={downloading}
                  className="w-full h-10 bg-[#1a1a1a] text-white hover:bg-[#333] rounded-md font-medium text-sm"
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

        {/* Footer */}
        <div className="text-center mt-12">
          <p className="text-xs text-[#aaa]">
            Powered by yt-dlp + FFmpeg
          </p>
        </div>
      </div>
    </div>
  );
}
