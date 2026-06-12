import type { SummarizeConfig } from "../config.js";
import type { SummaryStreamHandler } from "../engine/events.js";
import { createModelExecutor, type ModelExecutorDeps } from "../engine/model-executor.js";
import type { LengthArg } from "../flags.js";
import { resolveRunApiStatus } from "./api-status.js";
import type { RunContextState } from "./context.js";
import { createRunMetrics } from "./metrics.js";
import { resolveModelSelection, type ModelSelection } from "./model-selection.js";
import { resolveDesiredOutputTokens } from "./output-policy.js";
import { resolveProviderRuntimeBindings } from "./provider-runtime.js";

export type ModelExecutorRequestOptions = Pick<
  ModelExecutorDeps,
  "openaiRequestOptions" | "openaiRequestOptionsOverride" | "cliReasoningEffortOverride"
>;

export type RunModelSpec = ModelSelection & {
  fixedModelSpec: Extract<ModelSelection["requestedModel"], { kind: "fixed" }> | null;
  desiredOutputTokens: number | null;
};

export type RunModelRuntime = {
  metrics: ReturnType<typeof createRunMetrics>;
  apiStatus: ReturnType<typeof resolveRunApiStatus>;
  summaryEngine: ReturnType<typeof createModelExecutor>;
};

export type ExecutableRunModel = RunModelSpec &
  ModelExecutorRequestOptions & {
    allowAutoCliFallback: boolean;
    envForAuto: RunContextState["envForAuto"];
    cliAvailability: RunContextState["cliAvailability"];
    openaiUseChatCompletions: RunContextState["openaiUseChatCompletions"];
    openaiWhisperUsdPerMinute: RunContextState["openaiWhisperUsdPerMinute"];
    apiStatus: RunModelRuntime["apiStatus"];
    summaryEngine: RunModelRuntime["summaryEngine"];
    summaryStream: SummaryStreamHandler | null;
    getLiteLlmCatalog: RunModelRuntime["metrics"]["getLiteLlmCatalog"];
    llmCalls: RunModelRuntime["metrics"]["llmCalls"];
  };

export function resolveRunModelSpec({
  context,
  envForRun,
  explicitModelArg,
  configForSelection,
  lengthArg,
  maxOutputTokensArg,
}: {
  context: RunContextState;
  envForRun: Record<string, string | undefined>;
  explicitModelArg: string | null;
  configForSelection: SummarizeConfig | null;
  lengthArg: LengthArg;
  maxOutputTokensArg: number | null;
}): RunModelSpec {
  const selection = resolveModelSelection({
    config: context.config,
    configForCli: configForSelection,
    configPath: context.configPath,
    envForRun,
    explicitModelArg,
  });
  return {
    ...selection,
    fixedModelSpec: selection.requestedModel.kind === "fixed" ? selection.requestedModel : null,
    desiredOutputTokens: resolveDesiredOutputTokens({
      lengthArg,
      maxOutputTokensArg,
    }),
  };
}

export function createRunModelRuntime({
  context,
  env,
  envForRun,
  metricsEnv,
  fetchImpl,
  execFileImpl,
  maxOutputTokensArg,
  timeoutMs,
  retries,
  streamingEnabled,
  requestOptions = {},
  log,
  trace,
}: {
  context: RunContextState;
  env: Record<string, string | undefined>;
  envForRun: Record<string, string | undefined>;
  metricsEnv: Record<string, string | undefined>;
  fetchImpl: typeof fetch;
  execFileImpl: ModelExecutorDeps["execFileImpl"];
  maxOutputTokensArg: number | null;
  timeoutMs: number;
  retries: number;
  streamingEnabled: boolean;
  requestOptions?: ModelExecutorRequestOptions;
  log?: ModelExecutorDeps["log"];
  trace?: ModelExecutorDeps["trace"];
}): RunModelRuntime {
  const metrics = createRunMetrics({
    env: metricsEnv,
    fetchImpl,
    maxOutputTokensArg,
  });
  const apiStatus = resolveRunApiStatus(context);
  const providerRuntime = resolveProviderRuntimeBindings({
    env: envForRun,
    envState: context,
    configForCli: context.configForCli,
  });
  const summaryEngine = createModelExecutor({
    env,
    envForRun,
    execFileImpl,
    timeoutMs,
    retries,
    streamingEnabled,
    ...requestOptions,
    cliConfigForRun: context.cliConfigForRun ?? null,
    cliAvailability: context.cliAvailability,
    trackedFetch: metrics.trackedFetch,
    resolveMaxOutputTokensForCall: metrics.resolveMaxOutputTokensForCall,
    resolveMaxInputTokensForCall: metrics.resolveMaxInputTokensForCall,
    llmCalls: metrics.llmCalls,
    log,
    trace,
    providerRuntime,
    openrouterApiKey: apiStatus.openrouterApiKey,
  });

  return {
    metrics,
    apiStatus,
    summaryEngine,
  };
}

export function createExecutableRunModel({
  spec,
  runtime,
  context,
  allowAutoCliFallback,
  summaryStream,
  requestOptions = {},
}: {
  spec: RunModelSpec;
  runtime: RunModelRuntime;
  context: RunContextState;
  allowAutoCliFallback: boolean;
  summaryStream: SummaryStreamHandler | null;
  requestOptions?: ModelExecutorRequestOptions;
}): ExecutableRunModel {
  return {
    ...spec,
    allowAutoCliFallback,
    envForAuto: context.envForAuto,
    cliAvailability: context.cliAvailability,
    openaiUseChatCompletions: context.openaiUseChatCompletions,
    openaiWhisperUsdPerMinute: context.openaiWhisperUsdPerMinute,
    ...requestOptions,
    apiStatus: runtime.apiStatus,
    summaryEngine: runtime.summaryEngine,
    summaryStream,
    getLiteLlmCatalog: runtime.metrics.getLiteLlmCatalog,
    llmCalls: runtime.metrics.llmCalls,
  };
}
