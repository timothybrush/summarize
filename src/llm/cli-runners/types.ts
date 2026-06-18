import type { CliProviderConfig } from "../../config.js";
import type { ExecFileFn } from "../../markitdown.js";
import type { LlmTokenUsage } from "../generate-text.js";

export type CliRunResult = {
  text: string;
  usage: LlmTokenUsage | null;
  costUsd: number | null;
};

export type ResolvedCliRunOptions = {
  binary: string;
  prompt: string;
  requestedModel: string | null;
  allowTools: boolean;
  timeoutMs: number;
  env: Record<string, string | undefined>;
  execFileImpl: ExecFileFn;
  providerConfig?: CliProviderConfig;
  providerExtraArgs: string[];
  cwd?: string;
  systemPrompt?: string | null;
  signal?: AbortSignal;
};
