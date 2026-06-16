import { describe, expect, it, vi } from "vitest";
import { createBrowserAiSlidesRuntime } from "../apps/chrome-extension/src/entrypoints/sidepanel/browser-ai-slides-runtime";
import { createInitialPanelState } from "../apps/chrome-extension/src/entrypoints/sidepanel/panel-state-store";
import type { PanelState, UiState } from "../apps/chrome-extension/src/entrypoints/sidepanel/types";

function buildUiState(overrides: Partial<UiState["settings"]> = {}): UiState {
  return {
    panelOpen: true,
    daemon: { ok: false, authed: false },
    tab: { id: 1, url: "https://www.youtube.com/watch?v=test", title: "Lecture" },
    media: { hasVideo: true, hasAudio: true, hasCaptions: true },
    stats: { pageWords: null, videoDurationSeconds: 180 },
    settings: {
      autoSummarize: true,
      hoverSummaries: false,
      chatEnabled: true,
      automationEnabled: false,
      slidesEnabled: true,
      slidesParallel: true,
      slidesOcrEnabled: false,
      slidesLayout: "gallery",
      slideRuntime: "browser",
      summaryRuntime: "direct",
      providerConfigured: false,
      daemonHintDismissed: false,
      fontSize: 14,
      lineHeight: 1.45,
      model: "auto",
      length: "long",
      tokenPresent: false,
      ...overrides,
    },
    status: "",
  };
}

function buildPanelState(): PanelState {
  const panelState = createInitialPanelState();
  panelState.ui = buildUiState();
  panelState.currentSource = {
    url: "https://www.youtube.com/watch?v=test",
    title: "Machine Learning Lecture",
  };
  panelState.slidesRunId = "slides-run";
  panelState.slides = {
    sourceUrl: panelState.currentSource.url,
    sourceId: "browser-slides",
    sourceKind: "youtube",
    slideRuntime: "browser",
    ocrAvailable: false,
    transcriptTimedText:
      "[00:00] The first section explains linear decision boundaries and classification.\n" +
      "[01:00] The second section derives the sigmoid function and probability model.",
    slides: [
      { index: 1, timestamp: 0, imageUrl: "", ocrText: "" },
      { index: 2, timestamp: 60, imageUrl: "", ocrText: "" },
    ],
  };
  return panelState;
}

describe("sidepanel browser AI slides runtime", () => {
  it("builds canonical per-slide Nano summaries instead of transcript fallbacks", async () => {
    const panelState = buildPanelState();
    const applyGeneratedSummary = vi.fn((value) => {
      panelState.slidesSummary = {
        ...panelState.slidesSummary,
        ...value,
      };
    });
    const summarize = vi.fn(async ({ input }: { input: { text: string } }) =>
      input.text.includes("linear decision")
        ? "Linear classifiers divide examples with a learned decision boundary."
        : "The sigmoid maps scores into probabilities for logistic regression.",
    );
    const runtime = createBrowserAiSlidesRuntime({
      panelState,
      browserAi: {
        cancel: vi.fn(),
        summarize,
      },
      getTranscriptTimedText: () => panelState.slides?.transcriptTimedText ?? null,
      applyGeneratedSummary,
      schedulePanelCacheSync: vi.fn(),
    });

    await runtime.refresh();

    expect(summarize).toHaveBeenCalledTimes(2);
    expect(summarize).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        requestKey: "slides",
        status: "Summarizing slide 1 of 2 with on-device AI…",
      }),
    );
    const final = applyGeneratedSummary.mock.calls.at(-1)?.[0];
    expect(final).toEqual(
      expect.objectContaining({
        complete: true,
        model: "Gemini Nano",
        runId: "slides-run",
      }),
    );
    expect(final?.markdown).toContain("[slide:1]\n## Linear classifiers divide examples");
    expect(final?.markdown).toContain("[slide:2]\n## The sigmoid maps scores into");
    expect(final?.markdown).not.toContain("The first section explains");

    await runtime.refresh();
    expect(summarize).toHaveBeenCalledTimes(2);
  });

  it("does not use Nano when a direct provider model is selected", async () => {
    const panelState = buildPanelState();
    panelState.ui = buildUiState({
      model: "openai/gpt-5-mini",
      providerConfigured: true,
    });
    const summarize = vi.fn();
    const runtime = createBrowserAiSlidesRuntime({
      panelState,
      browserAi: {
        cancel: vi.fn(),
        summarize,
      },
      getTranscriptTimedText: () => panelState.slides?.transcriptTimedText ?? null,
      applyGeneratedSummary: vi.fn(),
      schedulePanelCacheSync: vi.fn(),
    });

    await runtime.refresh();

    expect(summarize).not.toHaveBeenCalled();
  });

  it("keeps daemon slide summaries for default Auto and preserves copy when Nano is unavailable", async () => {
    const daemonState = buildPanelState();
    if (!daemonState.slides) throw new Error("Missing slides fixture");
    daemonState.slides.slideRuntime = "daemon";
    const daemonSummarize = vi.fn();
    const daemonRuntime = createBrowserAiSlidesRuntime({
      panelState: daemonState,
      browserAi: {
        cancel: vi.fn(),
        summarize: daemonSummarize,
      },
      getTranscriptTimedText: () => daemonState.slides?.transcriptTimedText ?? null,
      applyGeneratedSummary: vi.fn(),
      schedulePanelCacheSync: vi.fn(),
    });

    await daemonRuntime.refresh();
    expect(daemonSummarize).not.toHaveBeenCalled();

    const browserState = buildPanelState();
    const applyGeneratedSummary = vi.fn();
    const browserRuntime = createBrowserAiSlidesRuntime({
      panelState: browserState,
      browserAi: {
        cancel: vi.fn(),
        summarize: vi.fn(async () => null),
      },
      getTranscriptTimedText: () => browserState.slides?.transcriptTimedText ?? null,
      applyGeneratedSummary,
      schedulePanelCacheSync: vi.fn(),
    });

    await browserRuntime.refresh();
    expect(applyGeneratedSummary).not.toHaveBeenCalled();
  });
});
