import { Writable } from "node:stream";
import type { SummaryStreamHandler } from "../engine/events.js";
import { executeAssetSummary } from "../run/flows/asset/summary.js";
import type { UrlFlowContext } from "../run/flows/url/types.js";
import { scopeTranscriptCacheForDiarization } from "../shared/transcript-diarization-cache-scope.js";
import { createSummarizeModelResources } from "./execution-resources.js";
import { createRunFlowContexts } from "./flow-contexts.js";
import { resolveSummarizeRun } from "./run-spec.js";
import type {
  SummarizeEventSink,
  SummarizeRequest,
  SummarizeRuntime,
} from "./summarize-contracts.js";

export function createEventSummaryStreamHandler(emit: SummarizeEventSink): SummaryStreamHandler {
  return {
    onChunk: ({ streamed, prevStreamed }) => {
      const normalizedStreamed = streamed.replace(/^\n+/, "");
      const normalizedPrevious = prevStreamed.replace(/^\n+/, "");
      const chunk = normalizedStreamed.startsWith(normalizedPrevious)
        ? normalizedStreamed.slice(normalizedPrevious.length)
        : normalizedStreamed;
      if (!chunk) return false;
      emit({ type: "summary-delta", text: chunk });
      return true;
    },
    onDone: (finalText) => {
      if (finalText.endsWith("\n")) return false;
      emit({ type: "summary-delta", text: "\n" });
      return true;
    },
    onReset: () => {},
  };
}

export function createEventWritable(
  emit: SummarizeEventSink,
  enabled = true,
): NodeJS.WritableStream {
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      const text =
        typeof chunk === "string" ? chunk : Buffer.isBuffer(chunk) ? chunk.toString("utf8") : "";
      if (enabled && text) emit({ type: "summary-delta", text });
      callback();
    },
  });
  (stream as unknown as { isTTY?: boolean }).isTTY = false;
  return stream;
}

export function createSummarizeUrlFlowContext(args: {
  request: SummarizeRequest;
  runtime: SummarizeRuntime;
  runStartedAtMs: number;
  emit: SummarizeEventSink;
}): UrlFlowContext {
  const { request, runtime, runStartedAtMs, emit } = args;
  const { extractOnly, slides } = request;
  const { env, fetch: fetchImpl, urlFetch: urlFetchImpl, cache, mediaCache, execFile } = runtime;
  const { spec, bindings } = resolveSummarizeRun({ request, env });
  const { envForRun } = bindings;
  const stdout = createEventWritable(emit, !extractOnly);
  const stderr = process.stderr;

  const summaryStream = createEventSummaryStreamHandler(emit);
  const modelResources = createSummarizeModelResources({
    resolvedRun: { spec, bindings },
    env: envForRun,
    metricsEnv: envForRun,
    fetchImpl,
    execFileImpl: execFile,
    streamingEnabled: true,
    summaryStream,
  });
  const { metrics } = modelResources.runtime;
  const { model } = modelResources;

  const urlCache = scopeTranscriptCacheForDiarization(cache, spec.transcriptDiarization);
  const io: UrlFlowContext["io"] = {
    env: envForRun,
    envForRun,
    stdout,
    stderr,
    execFileImpl: execFile,
    fetch: metrics.trackedFetch,
    ...(urlFetchImpl ? { urlFetch: urlFetchImpl } : {}),
  };
  const flags: UrlFlowContext["flags"] = {
    timeoutMs: spec.timeoutMs,
    maxExtractCharacters: spec.maxExtractCharacters,
    retries: spec.retries,
    format: spec.format,
    markdownMode: spec.markdownMode,
    preprocessMode: spec.preprocessMode,
    youtubeMode: spec.youtubeMode,
    firecrawlMode: spec.firecrawlMode,
    videoMode: spec.videoMode,
    embeddedVideoMode: spec.embeddedVideoMode,
    transcriptTimestamps: spec.transcriptTimestamps,
    transcriptDiarization: spec.transcriptDiarization,
    speakerIdentification: null,
    outputLanguage: spec.outputLanguage,
    lengthArg: spec.lengthArg,
    forceSummary: spec.forceSummary,
    promptOverride: spec.promptOverride,
    lengthInstruction: spec.lengthInstruction,
    languageInstruction: spec.languageInstruction,
    summaryCacheBypass: false,
    maxOutputTokensArg: spec.maxOutputTokensArg,
    json: false,
    extractMode: extractOnly ?? false,
    metricsEnabled: false,
    metricsDetailed: false,
    shouldComputeReport: false,
    runStartedAtMs,
    verbose: false,
    verboseColor: false,
    progressEnabled: false,
    streamMode: "on",
    streamingEnabled: true,
    plain: true,
    configPath: spec.configPath,
    configModelLabel: spec.configModelLabel,
    slides: slides ?? null,
    slidesDebug: false,
    slidesOutput: false,
  };
  const runtimeHooks = {
    setTranscriptionCost: metrics.setTranscriptionCost,
    writeViaFooter: () => {},
    clearProgressForStdout: () => {},
    restoreProgressAfterStdout: undefined,
    setClearProgressBeforeStdout: () => {},
    clearProgressIfCurrent: () => {},
    buildReport: metrics.buildReport,
    estimateCostUsd: metrics.estimateCostUsd,
  };
  const { assetSummaryContext, urlFlowContext } = createRunFlowContexts({
    cacheState: urlCache,
    mediaCache,
    io,
    flags,
    model,
    runtimeHooks,
    eventHooks: {
      onModelChosen: (modelId) => emit({ type: "model-selected", modelId }),
      onExtracted: (content) => emit({ type: "content-extracted", content }),
      onSlidesExtracted: (extractedSlides) =>
        emit({ type: "slides-extracted", slides: extractedSlides }),
      onSlidesProgress: (text) => emit({ type: "slides-progress", text }),
      onSlidesDone: (result) => emit({ type: "slides-completed", ...result }),
      onSlideChunk: ({ slide, meta }) => emit({ type: "slide", slide, meta }),
      onLinkPreviewProgress: (event) => emit({ type: "extraction-progress", event }),
      onSummaryCached: (cached) => emit({ type: "summary-cache", cached }),
    },
    assetSummaryOverrides: { format: "text" },
  });

  return {
    ...urlFlowContext,
    hooks: {
      ...urlFlowContext.hooks,
      summarizeAsset: (args) => executeAssetSummary(assetSummaryContext, args),
    },
  };
}
