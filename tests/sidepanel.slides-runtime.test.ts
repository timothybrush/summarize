import { beforeEach, describe, expect, it, vi } from "vitest";
import { createInitialPanelState } from "../apps/chrome-extension/src/entrypoints/sidepanel/panel-state-store";
import { createSidepanelSlidesRuntime } from "../apps/chrome-extension/src/entrypoints/sidepanel/slides-runtime";

let capturedHydratorOptions: Record<string, Function> | null = null;
let capturedRunOptions: Record<string, unknown> | null = null;
let browserAiSlidesRuntime: {
  cancel: ReturnType<typeof vi.fn>;
  refresh: ReturnType<typeof vi.fn>;
} | null = null;
let summaryController: {
  applyGeneratedSummary: ReturnType<typeof vi.fn>;
  applyMarkdown: ReturnType<typeof vi.fn>;
  getMarkdown: ReturnType<typeof vi.fn>;
  maybeApplyPending: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  getRunId: ReturnType<typeof vi.fn>;
  setRunId: ReturnType<typeof vi.fn>;
  setUrl: ReturnType<typeof vi.fn>;
  resetSummaryState: ReturnType<typeof vi.fn>;
  setModel: ReturnType<typeof vi.fn>;
} | null = null;
let hydrator: {
  hydrateSnapshot: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
  handlePayload: ReturnType<typeof vi.fn>;
  handleSummaryFromCache: ReturnType<typeof vi.fn>;
  isStreaming: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  syncFromCache: ReturnType<typeof vi.fn>;
} | null = null;

vi.mock("../apps/chrome-extension/src/entrypoints/sidepanel/slides-summary-controller", () => ({
  createSlidesSummaryController: vi.fn(() => {
    summaryController = {
      applyGeneratedSummary: vi.fn(),
      applyMarkdown: vi.fn(),
      getMarkdown: vi.fn(() => ""),
      maybeApplyPending: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      getRunId: vi.fn(() => null),
      setRunId: vi.fn(),
      setUrl: vi.fn(),
      resetSummaryState: vi.fn(),
      setModel: vi.fn(),
    };
    return summaryController;
  }),
}));

vi.mock("../apps/chrome-extension/src/entrypoints/sidepanel/browser-ai-slides-runtime", () => ({
  createBrowserAiSlidesRuntime: vi.fn(() => {
    browserAiSlidesRuntime = {
      cancel: vi.fn(),
      refresh: vi.fn(async () => {}),
    };
    return browserAiSlidesRuntime;
  }),
  shouldUseBrowserAiForSlides: vi.fn(() => false),
}));

vi.mock("../apps/chrome-extension/src/entrypoints/sidepanel/slides-hydrator", () => ({
  createSlidesHydrator: vi.fn((options) => {
    capturedHydratorOptions = options;
    hydrator = {
      hydrateSnapshot: vi.fn(async () => {}),
      start: vi.fn(async () => {}),
      handlePayload: vi.fn(),
      handleSummaryFromCache: vi.fn(),
      isStreaming: vi.fn(() => false),
      stop: vi.fn(),
      syncFromCache: vi.fn(),
    };
    return hydrator;
  }),
}));

vi.mock("../apps/chrome-extension/src/entrypoints/sidepanel/slides-run-runtime", () => ({
  createSlidesRunRuntime: vi.fn((options) => {
    capturedRunOptions = options;
    return {
      handleSlidesStatus: vi.fn(),
      isActiveSlidesRunLocal: vi.fn(),
      maybeStartPendingSlidesForUrl: vi.fn(),
      rememberPendingSlidesRun: vi.fn(),
      resolveActiveSlidesRunId: vi.fn(),
      startSlidesStreamForRunId: vi.fn(),
      startSlidesStream: vi.fn(),
      startSlidesSummaryStreamForRunId: vi.fn(),
      stopSlidesStream: vi.fn(),
    };
  }),
}));

function createRuntime(options: { phase?: "idle" | "streaming"; summaryStreaming?: boolean } = {}) {
  const panelState = createInitialPanelState();
  panelState.phase = options.phase ?? "idle";
  return createSidepanelSlidesRuntime({
    applySlidesPayload: vi.fn(),
    browserAi: {} as never,
    clearSummarySource: vi.fn(),
    panelState,
    friendlyFetchError: vi.fn((_error, fallback) => fallback),
    getLengthValue: vi.fn(() => "medium"),
    getToken: vi.fn(async () => "token"),
    getTranscriptTimedText: vi.fn(() => null),
    headerSetStatus: vi.fn(),
    hideSlideNotice: vi.fn(),
    isStreaming: vi.fn(() => options.summaryStreaming ?? false),
    panelUrlsMatch: vi.fn((left, right) => left === right),
    refreshSummarizeControl: vi.fn(),
    renderInlineSlidesFallback: vi.fn(),
    renderMarkdown: vi.fn(),
    schedulePanelCacheSync: vi.fn(),
    setSlidesBusy: vi.fn(),
    showSlideNotice: vi.fn(),
    updateSlideSummaryFromMarkdown: vi.fn(),
  });
}

describe("sidepanel slides runtime", () => {
  beforeEach(() => {
    capturedHydratorOptions = null;
    capturedRunOptions = null;
    browserAiSlidesRuntime = null;
    summaryController = null;
    hydrator = null;
    vi.clearAllMocks();
  });

  it("delegates summary helpers to the summary controller", () => {
    const runtime = createRuntime();

    runtime.applySlidesSummaryMarkdown("slides");
    runtime.maybeApplyPendingSlidesSummary();

    expect(summaryController?.applyMarkdown).toHaveBeenCalledWith("slides");
    expect(summaryController?.maybeApplyPending).toHaveBeenCalledOnce();
  });

  it("hydrates snapshot and surfaces retryable errors through the hydrator callback", async () => {
    const showSlideNotice = vi.fn();
    const setSlidesBusy = vi.fn();
    const headerSetStatus = vi.fn();
    const panelState = createInitialPanelState();
    createSidepanelSlidesRuntime({
      applySlidesPayload: vi.fn(),
      browserAi: {} as never,
      clearSummarySource: vi.fn(),
      panelState,
      friendlyFetchError: vi.fn(() => "friendly slides error"),
      getLengthValue: vi.fn(() => "medium"),
      getToken: vi.fn(async () => "token"),
      getTranscriptTimedText: vi.fn(() => null),
      headerSetStatus,
      hideSlideNotice: vi.fn(),
      isStreaming: vi.fn(() => false),
      panelUrlsMatch: vi.fn((left, right) => left === right),
      refreshSummarizeControl: vi.fn(),
      renderInlineSlidesFallback: vi.fn(),
      renderMarkdown: vi.fn(),
      schedulePanelCacheSync: vi.fn(),
      setSlidesBusy,
      showSlideNotice,
      updateSlideSummaryFromMarkdown: vi.fn(),
    });

    const message = capturedHydratorOptions?.onError?.(new Error("boom"));
    await Promise.resolve();

    expect(message).toBe("friendly slides error");
    expect(showSlideNotice).toHaveBeenCalledWith("friendly slides error", { allowRetry: true });
    expect(setSlidesBusy).toHaveBeenCalledWith(false);
    expect(headerSetStatus).toHaveBeenCalledWith("");
    expect(hydrator?.hydrateSnapshot).toHaveBeenCalledWith("timeout");
    expect(capturedRunOptions?.startSlidesHydrator).toBeTypeOf("function");
    expect(capturedRunOptions?.stopSlidesHydrator).toBe(hydrator?.stop);
    const stopSlidesSummaryController = capturedRunOptions?.stopSlidesSummaryController as
      | (() => void)
      | undefined;
    stopSlidesSummaryController?.();
    expect(browserAiSlidesRuntime?.cancel).toHaveBeenCalledOnce();
    expect(summaryController?.stop).toHaveBeenCalledOnce();
  });

  it("keeps the header text when summary streaming is still active", async () => {
    const headerSetStatus = vi.fn();
    const setSlidesBusy = vi.fn();
    const panelState = createInitialPanelState();
    panelState.phase = "streaming";
    createSidepanelSlidesRuntime({
      applySlidesPayload: vi.fn(),
      browserAi: {} as never,
      clearSummarySource: vi.fn(),
      panelState,
      friendlyFetchError: vi.fn(() => "friendly slides error"),
      getLengthValue: vi.fn(() => "medium"),
      getToken: vi.fn(async () => "token"),
      getTranscriptTimedText: vi.fn(() => null),
      headerSetStatus,
      hideSlideNotice: vi.fn(),
      isStreaming: vi.fn(() => true),
      panelUrlsMatch: vi.fn((left, right) => left === right),
      refreshSummarizeControl: vi.fn(),
      renderInlineSlidesFallback: vi.fn(),
      renderMarkdown: vi.fn(),
      schedulePanelCacheSync: vi.fn(),
      setSlidesBusy,
      showSlideNotice: vi.fn(),
      updateSlideSummaryFromMarkdown: vi.fn(),
    });

    const message = capturedHydratorOptions?.onError?.(new Error("boom"));
    capturedHydratorOptions?.onDone?.();
    await Promise.resolve();

    expect(message).toBe("friendly slides error");
    expect(headerSetStatus).not.toHaveBeenCalledWith("");
    expect(setSlidesBusy).toHaveBeenCalledWith(false);
  });

  it("clears the header when slide streaming finishes in idle phase", () => {
    createRuntime();
    const headerSetStatus = capturedRunOptions?.headerSetStatus as ReturnType<typeof vi.fn>;
    const setSlidesBusy = capturedRunOptions?.setSlidesBusy as ReturnType<typeof vi.fn>;

    capturedHydratorOptions?.onDone?.();

    expect(setSlidesBusy).toHaveBeenCalledWith(false);
    expect(headerSetStatus).toHaveBeenCalledWith("");
  });

  it("exposes the full run lifecycle surface", () => {
    const runtime = createRuntime();

    expect(runtime).toEqual(
      expect.objectContaining({
        handleSlidesStatus: expect.any(Function),
        isActiveSlidesRunLocal: expect.any(Function),
        maybeStartPendingSlidesForUrl: expect.any(Function),
        rememberPendingSlidesRun: expect.any(Function),
        resolveActiveSlidesRunId: expect.any(Function),
        startSlidesStream: expect.any(Function),
        startSlidesStreamForRunId: expect.any(Function),
        startSlidesSummaryStreamForRunId: expect.any(Function),
        stopSlidesStream: expect.any(Function),
        refreshBrowserAiSlides: expect.any(Function),
      }),
    );
  });
});
