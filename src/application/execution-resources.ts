import type { SummaryStreamHandler } from "../engine/events.js";
import type { ModelExecutorDeps } from "../engine/model-executor.js";
import type { ExecFileFn } from "../markitdown.js";
import {
  createExecutableRunModel,
  createRunModelRuntime,
  type ExecutableRunModel,
  type ModelExecutorRequestOptions,
  type RunModelRuntime,
} from "./model-runtime.js";
import type { ResolvedSummarizeRun } from "./run-spec.js";

export type SummarizeModelResources = {
  context: ResolvedSummarizeRun["bindings"]["context"];
  envForRun: Record<string, string | undefined>;
  runtime: RunModelRuntime;
  model: ExecutableRunModel;
};

export function createSummarizeModelResources(options: {
  resolvedRun: ResolvedSummarizeRun;
  env: Record<string, string | undefined>;
  metricsEnv?: Record<string, string | undefined>;
  fetchImpl: typeof fetch;
  execFileImpl: ExecFileFn;
  streamingEnabled: boolean;
  summaryStream: SummaryStreamHandler | null;
  requestOptions?: ModelExecutorRequestOptions;
  log?: ModelExecutorDeps["log"];
  trace?: ModelExecutorDeps["trace"];
}): SummarizeModelResources {
  const {
    resolvedRun,
    env,
    metricsEnv = env,
    fetchImpl,
    execFileImpl,
    streamingEnabled,
    summaryStream,
    requestOptions,
    log,
    trace,
  } = options;
  const { context, envForRun } = resolvedRun.bindings;
  const runtime = createRunModelRuntime({
    context,
    env,
    envForRun,
    metricsEnv,
    fetchImpl,
    execFileImpl,
    maxOutputTokensArg: resolvedRun.spec.maxOutputTokensArg,
    timeoutMs: resolvedRun.spec.timeoutMs,
    retries: resolvedRun.spec.retries,
    streamingEnabled,
    requestOptions,
    log,
    trace,
  });
  const model = createExecutableRunModel({
    spec: resolvedRun.bindings.model,
    runtime,
    context,
    allowAutoCliFallback: resolvedRun.spec.allowAutoCliFallback,
    summaryStream,
    requestOptions,
  });

  return { context, envForRun, runtime, model };
}
