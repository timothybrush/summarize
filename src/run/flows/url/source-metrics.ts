import type { SourceMetrics } from "@steipete/summarize-core/content";

export function formatSourceMetricsHeader(
  metrics: SourceMetrics | null | undefined,
): string | null {
  if (!metrics || metrics.platform !== "youtube") return null;
  return metrics.viewCount === null
    ? "YouTube views: unavailable"
    : `YouTube views: ${metrics.viewCount.toLocaleString("en-US")}`;
}
