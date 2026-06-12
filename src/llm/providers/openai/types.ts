import type { Context } from "@earendil-works/pi-ai";
import type { LlmTokenUsage } from "../../types.js";
import type { OpenAiClientConfig } from "../types.js";

export type OpenAiTextRequest = {
  modelId: string;
  openaiConfig: OpenAiClientConfig;
  context: Context;
  temperature?: number;
  maxOutputTokens?: number;
  signal: AbortSignal;
  fetchImpl: typeof fetch;
};

export type OpenAiTextCompletionResult = {
  text: string;
  usage: LlmTokenUsage | null;
  resolvedModelId?: string;
};

export type OpenAiTextStreamResult = {
  textStream: AsyncIterable<string>;
  usage: Promise<LlmTokenUsage | null>;
  resolvedModelId?: string;
};

export type OpenAiStructuredOutput = {
  name: string;
  schema: Record<string, unknown>;
};
