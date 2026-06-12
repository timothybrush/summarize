import { Writable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { createRunFlowContexts } from "../src/application/flow-contexts.js";
import type { CacheState } from "../src/cache.js";
import type { AssetSummaryContext } from "../src/run/flows/asset/types.js";
import type { UrlFlowContext } from "../src/run/flows/url/types.js";
import { createRunnerAssetInputContext } from "../src/run/runner-asset-context.js";

const createWritable = () =>
  new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });

describe("run flow contexts", () => {
  it("derives asset and URL contexts from one model/runtime contract", () => {
    const cacheState = { mode: "off", store: null } as unknown as CacheState;
    const summaryEngine = {} as UrlFlowContext["model"]["summaryEngine"];
    const onModelChosen = vi.fn();
    const runtimeHooks = {
      setTranscriptionCost: vi.fn(),
      writeViaFooter: vi.fn(),
      clearProgressForStdout: vi.fn(),
      restoreProgressAfterStdout: vi.fn(),
      setClearProgressBeforeStdout: vi.fn(),
      clearProgressIfCurrent: vi.fn(),
      buildReport: vi.fn(async () => ({ tokens: 0, calls: 0, durationMs: 0 })),
      estimateCostUsd: vi.fn(async () => null),
    };

    const { assetSummaryContext, urlFlowContext } = createRunFlowContexts({
      cacheState,
      mediaCache: null,
      io: {
        env: {},
        envForRun: {},
        stdout: createWritable(),
        stderr: createWritable(),
        execFileImpl: vi.fn() as unknown as UrlFlowContext["io"]["execFileImpl"],
        fetch: vi.fn() as unknown as typeof fetch,
      },
      flags: {
        timeoutMs: 1_000,
        retries: 1,
        format: "markdown",
        markdownMode: "readability",
        preprocessMode: "auto",
        youtubeMode: "auto",
        firecrawlMode: "off",
        videoMode: "auto",
        embeddedVideoMode: "auto",
        transcriptTimestamps: false,
        transcriptDiarization: null,
        speakerIdentification: null,
        outputLanguage: { kind: "auto" },
        lengthArg: { kind: "preset", preset: "medium" },
        forceSummary: false,
        promptOverride: null,
        lengthInstruction: null,
        languageInstruction: null,
        summaryCacheBypass: false,
        maxOutputTokensArg: null,
        json: false,
        extractMode: false,
        metricsEnabled: false,
        metricsDetailed: false,
        shouldComputeReport: false,
        runStartedAtMs: 1,
        verbose: false,
        verboseColor: false,
        progressEnabled: false,
        streamMode: "on",
        streamingEnabled: true,
        plain: true,
        configPath: null,
        configModelLabel: null,
        slides: null,
        slidesDebug: false,
      },
      model: {
        summaryEngine,
        summaryStream: null,
        apiStatus: {},
      } as unknown as UrlFlowContext["model"],
      runtimeHooks,
      eventHooks: { onModelChosen },
      assetSummaryOverrides: { format: "text" },
    });

    expect(assetSummaryContext.format).toBe("text");
    expect(assetSummaryContext.summaryEngine).toBe(summaryEngine);
    expect(assetSummaryContext.cache).toBe(cacheState);
    expect(urlFlowContext.flags.format).toBe("markdown");
    expect(urlFlowContext.model.summaryEngine).toBe(summaryEngine);
    expect(urlFlowContext.cache).toBe(cacheState);
    expect(urlFlowContext.hooks.onModelChosen).toBe(onModelChosen);
    expect(typeof urlFlowContext.hooks.summarizeAsset).toBe("function");
  });

  it("keeps media-file handling in the CLI adapter", async () => {
    const summarizeAssetImpl = vi.fn(async () => ({}) as never);
    const summarizeMediaFileImpl = vi.fn(async () => {});
    const assetSummaryContext = {
      env: {},
      envForRun: {},
      stderr: createWritable(),
      timeoutMs: 1_000,
    } as unknown as AssetSummaryContext;
    const inputContext = createRunnerAssetInputContext({
      summarizeAssetImpl,
      summarizeMediaFileImpl,
      assetSummaryContext,
      progressEnabled: true,
      trackedFetch: vi.fn() as unknown as typeof fetch,
      setClearProgressBeforeStdout: vi.fn(),
      clearProgressIfCurrent: vi.fn(),
    });
    const args = {
      sourceKind: "file" as const,
      sourceLabel: "/tmp/audio.mp3",
      attachment: {
        kind: "file" as const,
        filename: "audio.mp3",
        mediaType: "audio/mpeg",
        bytes: new Uint8Array(),
      },
    };

    await inputContext.summarizeMediaFile?.(args);
    await inputContext.summarizeAsset(args);

    expect(summarizeMediaFileImpl).toHaveBeenCalledWith(assetSummaryContext, args);
    expect(summarizeAssetImpl).toHaveBeenCalledWith(args);
    expect(inputContext.progressEnabled).toBe(true);
  });
});
