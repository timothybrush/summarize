import {
  extractYoutubeViewCount,
  fetchYoutubePlayerMetadata,
} from "../../transcript/providers/youtube/captions.js";
import { fetchMediaMetadataWithYtDlp } from "../../transcript/providers/youtube/yt-dlp.js";
import { extractYouTubeVideoId } from "../../url.js";
import type { LinkPreviewDeps } from "../deps.js";
import type { TranscriptResolution, TranscriptSource } from "../types.js";
import type { SourceMetrics } from "./types.js";
import type { DetectedVideo } from "./video.js";

const SOURCE_METRICS_TTL_MS = 60 * 60 * 1_000;
const METRICS_BEST_EFFORT_TIMEOUT_MS = 5_000;
const YOUTUBE_TRANSCRIPT_SOURCES = new Set<TranscriptSource>([
  "youtubei",
  "captionTracks",
  "youtube-media",
  "apify",
]);

export async function refreshYoutubeSourceMetrics({
  url,
  html,
  detectedVideo,
  transcriptResolution,
  deps,
  timeoutMs,
  startedAtMs,
}: {
  url: string;
  html: string;
  detectedVideo: DetectedVideo | null;
  transcriptResolution: TranscriptResolution;
  deps: LinkPreviewDeps;
  timeoutMs: number;
  startedAtMs: number;
}): Promise<void> {
  const metricsDeadlineMs = startedAtMs + Math.min(timeoutMs, METRICS_BEST_EFFORT_TIMEOUT_MS);
  const remainingMetricsMs = () => Math.max(0, metricsDeadlineMs - Date.now());
  const existingMetrics = transcriptResolution.metadata?.sourceMetrics;
  const existingRecord =
    existingMetrics && typeof existingMetrics === "object" && !Array.isArray(existingMetrics)
      ? (existingMetrics as Record<string, unknown>)
      : null;
  const existingVideoId =
    existingRecord?.platform === "youtube" && typeof existingRecord.videoId === "string"
      ? existingRecord.videoId
      : null;
  const urlVideoId = extractYouTubeVideoId(url);
  const detectedVideoId =
    detectedVideo?.kind === "youtube" ? extractYouTubeVideoId(detectedVideo.url) : null;
  const resolvedEmbedId =
    detectedVideoId &&
    transcriptResolution.text &&
    transcriptResolution.source &&
    YOUTUBE_TRANSCRIPT_SOURCES.has(transcriptResolution.source)
      ? detectedVideoId
      : null;
  const resolvedVideoId = urlVideoId ?? existingVideoId ?? resolvedEmbedId;
  if (!resolvedVideoId) return;

  const existingViewCount =
    existingRecord?.platform === "youtube" &&
    typeof existingRecord.viewCount === "number" &&
    Number.isSafeInteger(existingRecord.viewCount) &&
    existingRecord.viewCount >= 0
      ? existingRecord.viewCount
      : null;
  const htmlViewCount = urlVideoId ? extractYoutubeViewCount(html) : null;
  const htmlViewObservedAt = htmlViewCount === null ? null : new Date(startedAtMs).toISOString();
  let viewCount = htmlViewCount ?? existingViewCount;
  let observedAt =
    htmlViewObservedAt ??
    (typeof existingRecord?.observedAt === "string"
      ? existingRecord.observedAt
      : new Date().toISOString());
  const observedTime = Date.parse(observedAt);
  const metricsAreStale =
    !Number.isFinite(observedTime) || Date.now() - observedTime >= SOURCE_METRICS_TTL_MS;
  const transcriptCacheHit = transcriptResolution.diagnostics?.cacheStatus === "hit";
  const shouldRefresh =
    htmlViewCount === null &&
    (viewCount === null || transcriptCacheHit || existingRecord === null || metricsAreStale);
  const remainingTimeoutMs = remainingMetricsMs();

  if (shouldRefresh && remainingTimeoutMs > 0) {
    if (!urlVideoId) {
      const refreshedMetrics = await fetchYoutubeSourceMetrics({
        fetchImpl: deps.fetch,
        ytDlpPath: deps.ytDlpPath,
        videoId: resolvedVideoId,
        timeoutMs: remainingTimeoutMs,
      });
      if (refreshedMetrics) {
        transcriptResolution.metadata = {
          ...(transcriptResolution.metadata ?? {}),
          sourceMetrics: refreshedMetrics,
        };
        return;
      }
    }
    const refreshed = await fetchYoutubePlayerMetadata(deps.fetch, {
      html,
      videoId: resolvedVideoId,
      timeoutMs: remainingTimeoutMs,
    });
    let refreshedViewCount = refreshed?.viewCount ?? null;
    let refreshObserved = refreshed !== null;
    const ytDlpTimeoutMs = remainingMetricsMs();
    if (refreshedViewCount === null && deps.ytDlpPath && ytDlpTimeoutMs > 0) {
      const ytDlpMetadata = await fetchMediaMetadataWithYtDlp({
        ytDlpPath: deps.ytDlpPath,
        url: `https://www.youtube.com/watch?v=${resolvedVideoId}`,
        timeoutMs: ytDlpTimeoutMs,
      });
      refreshedViewCount = ytDlpMetadata?.viewCount ?? null;
      refreshObserved ||= ytDlpMetadata !== null;
    }
    if (refreshObserved) {
      viewCount = refreshedViewCount;
      observedAt = new Date().toISOString();
    }
  }

  transcriptResolution.metadata = {
    ...(transcriptResolution.metadata ?? {}),
    sourceMetrics: {
      platform: "youtube",
      videoId: resolvedVideoId,
      viewCount,
      observedAt,
    },
  };
}

export async function fetchYoutubeSourceMetrics({
  fetchImpl,
  ytDlpPath,
  videoId,
  timeoutMs,
}: {
  fetchImpl: typeof fetch;
  ytDlpPath: string | null;
  videoId: string;
  timeoutMs: number;
}): Promise<SourceMetrics | null> {
  const startedAt = Date.now();
  const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
  let html = "";
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(watchUrl, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml",
        },
        signal: controller.signal,
      });
      if (response.ok) html = await response.text();
    } finally {
      clearTimeout(timer);
    }
  } catch {
    // yt-dlp remains available as an independent metadata fallback.
  }

  const htmlViewCount = html ? extractYoutubeViewCount(html) : null;
  if (htmlViewCount !== null) {
    return {
      platform: "youtube",
      videoId,
      viewCount: htmlViewCount,
      observedAt: new Date(startedAt).toISOString(),
    };
  }

  const remainingAfterHtml = Math.max(0, timeoutMs - (Date.now() - startedAt));
  let playerObservation: SourceMetrics | null = null;
  if (html && remainingAfterHtml > 0) {
    const player = await fetchYoutubePlayerMetadata(fetchImpl, {
      html,
      videoId,
      timeoutMs: remainingAfterHtml,
    });
    if (player) {
      playerObservation = {
        platform: "youtube",
        videoId,
        viewCount: player.viewCount,
        observedAt: new Date().toISOString(),
      };
      if (player.viewCount !== null) return playerObservation;
    }
  }

  const remainingAfterPlayer = Math.max(0, timeoutMs - (Date.now() - startedAt));
  if (ytDlpPath && remainingAfterPlayer > 0) {
    const metadata = await fetchMediaMetadataWithYtDlp({
      ytDlpPath,
      url: watchUrl,
      timeoutMs: remainingAfterPlayer,
    });
    if (metadata) {
      return {
        platform: "youtube",
        videoId,
        viewCount: metadata.viewCount,
        observedAt: new Date().toISOString(),
      };
    }
  }

  return playerObservation;
}
