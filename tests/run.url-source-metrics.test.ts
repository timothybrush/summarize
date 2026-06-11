import { describe, expect, it } from "vitest";
import { formatSourceMetricsHeader } from "../src/run/flows/url/source-metrics.js";

describe("URL source metrics", () => {
  it("formats YouTube views for transcript output", () => {
    expect(
      formatSourceMetricsHeader({
        platform: "youtube",
        viewCount: 1_234_567,
        observedAt: "2026-06-11T19:00:00.000Z",
      }),
    ).toBe("YouTube views: 1,234,567");
  });

  it("reports unavailable counts without inventing a value", () => {
    expect(
      formatSourceMetricsHeader({
        platform: "youtube",
        viewCount: null,
        observedAt: "2026-06-11T19:00:00.000Z",
      }),
    ).toBe("YouTube views: unavailable");
    expect(formatSourceMetricsHeader(null)).toBeNull();
  });
});
