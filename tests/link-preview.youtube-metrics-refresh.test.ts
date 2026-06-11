import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveTranscriptForLink = vi.hoisted(() => vi.fn());
const extractYoutubeViewCount = vi.hoisted(() => vi.fn(() => null));
const fetchYoutubePlayerMetadata = vi.hoisted(() => vi.fn(async () => null));
const fetchMediaMetadataWithYtDlp = vi.hoisted(() => vi.fn());

vi.mock("../packages/core/src/content/transcript/index.js", () => ({
  resolveTranscriptForLink,
}));
vi.mock("../packages/core/src/content/transcript/providers/youtube/captions.js", () => ({
  extractYoutubeViewCount,
  fetchYoutubePlayerMetadata,
}));
vi.mock("../packages/core/src/content/transcript/providers/youtube/yt-dlp.js", () => ({
  fetchMediaMetadataWithYtDlp,
}));

import { buildResultFromFirecrawl } from "../packages/core/src/content/link-preview/content/firecrawl.js";
import { buildResultFromHtmlDocument } from "../packages/core/src/content/link-preview/content/html.js";

describe("YouTube source metric refresh", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    extractYoutubeViewCount.mockReturnValue(null);
    fetchYoutubePlayerMetadata.mockResolvedValue(null);
  });

  it("falls back to yt-dlp when cached transcript metrics cannot refresh via player metadata", async () => {
    resolveTranscriptForLink.mockResolvedValue({
      text: "cached transcript",
      source: "captionTracks",
      metadata: {
        sourceMetrics: {
          platform: "youtube",
          videoId: "abcdefghijk",
          viewCount: 10,
          observedAt: "2026-06-01T00:00:00.000Z",
        },
      },
      diagnostics: {
        cacheMode: "default",
        cacheStatus: "hit",
        textProvided: true,
        provider: "captionTracks",
        attemptedProviders: [],
      },
    });
    fetchMediaMetadataWithYtDlp.mockResolvedValue({
      durationSeconds: 60,
      viewCount: 20,
    });

    const result = await buildResultFromHtmlDocument({
      url: "https://www.youtube.com/watch?v=abcdefghijk",
      html: "<!doctype html><html><head><title>Video</title></head><body></body></html>",
      cacheMode: "default",
      maxCharacters: null,
      youtubeTranscriptMode: "web",
      mediaTranscriptMode: "auto",
      firecrawlDiagnostics: {
        attempted: false,
        used: false,
        cacheMode: "default",
        cacheStatus: "bypassed",
        notes: null,
      },
      markdownRequested: false,
      markdownMode: "off",
      timeoutMs: 2_000,
      deps: {
        fetch: vi.fn(),
        ytDlpPath: "/usr/bin/yt-dlp",
      } as never,
      readabilityCandidate: null,
    });

    expect(fetchMediaMetadataWithYtDlp).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://www.youtube.com/watch?v=abcdefghijk",
        timeoutMs: expect.any(Number),
      }),
    );
    expect(result.sourceMetrics).toMatchObject({
      videoId: "abcdefghijk",
      viewCount: 20,
    });
  });

  it("records a fresh unavailable observation after a successful metadata refresh", async () => {
    resolveTranscriptForLink.mockResolvedValue({
      text: "cached transcript",
      source: "captionTracks",
      metadata: {
        sourceMetrics: {
          platform: "youtube",
          videoId: "abcdefghijk",
          viewCount: 10,
          observedAt: "2026-06-01T00:00:00.000Z",
        },
      },
      diagnostics: { cacheStatus: "hit" },
    });
    fetchYoutubePlayerMetadata.mockResolvedValue({
      durationSeconds: 60,
      viewCount: null,
    });

    const result = await buildResultFromHtmlDocument({
      url: "https://www.youtube.com/watch?v=abcdefghijk",
      html: "<!doctype html><html><head><title>Video</title></head><body></body></html>",
      cacheMode: "default",
      maxCharacters: null,
      youtubeTranscriptMode: "web",
      mediaTranscriptMode: "auto",
      firecrawlDiagnostics: {
        attempted: false,
        used: false,
        cacheMode: "default",
        cacheStatus: "bypassed",
        notes: null,
      },
      markdownRequested: false,
      markdownMode: "off",
      timeoutMs: 2_000,
      deps: { fetch: vi.fn(), ytDlpPath: null } as never,
      readabilityCandidate: null,
    });

    expect(result.sourceMetrics?.viewCount).toBeNull();
    expect(result.sourceMetrics?.observedAt).not.toBe("2026-06-01T00:00:00.000Z");
  });

  it("recovers an embedded video ID from HTML for a legacy transcript-cache hit", async () => {
    resolveTranscriptForLink.mockResolvedValue({
      text: "cached transcript",
      source: "captionTracks",
      metadata: {},
      diagnostics: { cacheStatus: "hit" },
    });
    fetchYoutubePlayerMetadata.mockResolvedValue({
      durationSeconds: 60,
      viewCount: 30,
    });

    const result = await buildResultFromHtmlDocument({
      url: "https://example.com/episode",
      html: '<!doctype html><html><head><title>Episode</title></head><body><iframe src="https://www.youtube.com/embed/abcdefghijk"></iframe></body></html>',
      cacheMode: "default",
      maxCharacters: null,
      youtubeTranscriptMode: "web",
      mediaTranscriptMode: "auto",
      firecrawlDiagnostics: {
        attempted: false,
        used: false,
        cacheMode: "default",
        cacheStatus: "bypassed",
        notes: null,
      },
      markdownRequested: false,
      markdownMode: "off",
      timeoutMs: 2_000,
      deps: { fetch: vi.fn(), ytDlpPath: null } as never,
      readabilityCandidate: null,
    });

    expect(result.sourceMetrics).toMatchObject({
      videoId: "abcdefghijk",
      viewCount: 30,
    });
  });

  it("does not attach embed metrics to an article resolved by the generic provider", async () => {
    resolveTranscriptForLink.mockResolvedValue({
      text: "article transcript",
      source: "html",
      metadata: {},
      diagnostics: { cacheStatus: "miss" },
    });

    const result = await buildResultFromHtmlDocument({
      url: "https://example.com/article",
      html: '<!doctype html><html><head><title>Article</title></head><body><article>Long article</article><iframe src="https://www.youtube.com/embed/abcdefghijk"></iframe></body></html>',
      cacheMode: "default",
      maxCharacters: null,
      youtubeTranscriptMode: "web",
      mediaTranscriptMode: "auto",
      firecrawlDiagnostics: {
        attempted: false,
        used: false,
        cacheMode: "default",
        cacheStatus: "bypassed",
        notes: null,
      },
      markdownRequested: false,
      markdownMode: "off",
      timeoutMs: 2_000,
      deps: { fetch: vi.fn(), ytDlpPath: null } as never,
      readabilityCandidate: null,
    });

    expect(result.sourceMetrics).toBeNull();
    expect(fetchYoutubePlayerMetadata).not.toHaveBeenCalled();
  });

  it("refreshes cached metrics on the Firecrawl result path", async () => {
    resolveTranscriptForLink.mockResolvedValue({
      text: "cached transcript",
      source: "captionTracks",
      metadata: {
        sourceMetrics: {
          platform: "youtube",
          videoId: "abcdefghijk",
          viewCount: 10,
          observedAt: "2026-06-01T00:00:00.000Z",
        },
      },
      diagnostics: { cacheStatus: "hit" },
    });
    fetchYoutubePlayerMetadata.mockResolvedValue({
      durationSeconds: 60,
      viewCount: 40,
    });

    const result = await buildResultFromFirecrawl({
      url: "https://www.youtube.com/watch?v=abcdefghijk",
      payload: {
        markdown: "Firecrawl content",
        html: "<!doctype html><html><head><title>Video</title></head><body></body></html>",
      },
      cacheMode: "default",
      maxCharacters: null,
      youtubeTranscriptMode: "web",
      mediaTranscriptMode: "auto",
      firecrawlDiagnostics: {
        attempted: true,
        used: false,
        cacheMode: "default",
        cacheStatus: "miss",
        notes: null,
      },
      markdownRequested: true,
      timeoutMs: 2_000,
      deps: { fetch: vi.fn(), ytDlpPath: null } as never,
    });

    expect(result?.sourceMetrics).toMatchObject({
      videoId: "abcdefghijk",
      viewCount: 40,
    });
  });
});
