import type { Attachment } from "../../attachments.js";
import { createUnsupportedFunctionalityError } from "../../errors.js";
import type { LlmTokenUsage } from "../../types.js";
import { normalizeOpenAiUsage } from "../../usage.js";
import { bytesToBase64 } from "../shared.js";
import type { OpenAiClientConfig } from "../types.js";
import { buildOpenAiResponsesRequestOptions } from "./request-options.js";
import { createDeferredUsage, parseOpenAiSseJsonStream } from "./sse.js";
import {
  buildOpenAiRequestHeaders,
  contextToResponsesInput,
  createOpenAiHttpError,
  resolveOpenAiResponsesUrl,
} from "./transport.js";
import type {
  OpenAiStructuredOutput,
  OpenAiTextCompletionResult,
  OpenAiTextRequest,
  OpenAiTextStreamResult,
} from "./types.js";

function extractOpenAiResponseText(payload: {
  output_text?: unknown;
  output?: Array<{ content?: Array<{ text?: string }> }>;
}): string {
  if (typeof payload.output_text === "string") return payload.output_text.trim();
  const output = Array.isArray(payload.output) ? payload.output : [];
  const text = output
    .flatMap((item) => (Array.isArray(item.content) ? item.content : []))
    .map((block) => (typeof block.text === "string" ? block.text : ""))
    .join("")
    .trim();
  return text;
}

function extractOpenAiResponsesStreamUsage(payload: Record<string, unknown>): LlmTokenUsage | null {
  const response = payload.response;
  const usage =
    response && typeof response === "object"
      ? (response as Record<string, unknown>).usage
      : payload.usage;
  return normalizeOpenAiUsage(usage);
}

export async function completeOpenAiResponsesText({
  modelId,
  openaiConfig,
  context,
  temperature,
  maxOutputTokens,
  signal,
  fetchImpl,
  structuredOutput,
}: OpenAiTextRequest & {
  structuredOutput?: OpenAiStructuredOutput;
}): Promise<OpenAiTextCompletionResult> {
  const baseUrl = openaiConfig.baseURL ?? "https://api.openai.com/v1";
  const response = await fetchImpl(String(resolveOpenAiResponsesUrl(baseUrl)), {
    method: "POST",
    headers: buildOpenAiRequestHeaders(openaiConfig),
    body: JSON.stringify({
      model: modelId,
      input: contextToResponsesInput(context),
      ...(context.systemPrompt?.trim() ? { instructions: context.systemPrompt.trim() } : {}),
      ...buildOpenAiResponsesRequestOptions(openaiConfig.requestOptions, structuredOutput),
      ...(typeof maxOutputTokens === "number" ? { max_output_tokens: maxOutputTokens } : {}),
      ...(typeof temperature === "number" ? { temperature } : {}),
    }),
    signal,
  });

  const bodyText = await response.text();
  if (!response.ok) {
    throw createOpenAiHttpError({ baseUrl, status: response.status, bodyText });
  }

  const data = JSON.parse(bodyText) as {
    output_text?: unknown;
    output?: Array<{ content?: Array<{ text?: string }> }>;
    usage?: unknown;
  };
  const text = extractOpenAiResponseText(data);
  if (!text) throw new Error(`LLM returned an empty summary (model openai/${modelId}).`);
  return { text, usage: normalizeOpenAiUsage(data.usage), resolvedModelId: modelId };
}

export async function streamOpenAiResponsesText({
  modelId,
  openaiConfig,
  context,
  temperature,
  maxOutputTokens,
  signal,
  fetchImpl,
}: OpenAiTextRequest): Promise<OpenAiTextStreamResult> {
  const baseUrl = openaiConfig.baseURL ?? "https://api.openai.com/v1";
  const response = await fetchImpl(String(resolveOpenAiResponsesUrl(baseUrl)), {
    method: "POST",
    headers: buildOpenAiRequestHeaders(openaiConfig),
    body: JSON.stringify({
      model: modelId,
      input: contextToResponsesInput(context),
      ...(context.systemPrompt?.trim() ? { instructions: context.systemPrompt.trim() } : {}),
      ...buildOpenAiResponsesRequestOptions(openaiConfig.requestOptions),
      stream: true,
      ...(typeof maxOutputTokens === "number" ? { max_output_tokens: maxOutputTokens } : {}),
      ...(typeof temperature === "number" ? { temperature } : {}),
    }),
    signal,
  });

  if (!response.ok) {
    const bodyText = await response.text();
    throw createOpenAiHttpError({ baseUrl, status: response.status, bodyText });
  }
  if (!response.body) {
    throw new Error("OpenAI stream response was empty.");
  }

  const usage = createDeferredUsage();
  const textStream = {
    async *[Symbol.asyncIterator]() {
      let finalUsage: LlmTokenUsage | null = null;
      try {
        for await (const event of parseOpenAiSseJsonStream(response.body!)) {
          const type = typeof event.type === "string" ? event.type : "";
          if (type === "response.output_text.delta" && typeof event.delta === "string") {
            yield event.delta;
            continue;
          }
          if (type === "response.completed") {
            finalUsage = extractOpenAiResponsesStreamUsage(event);
            continue;
          }
          if (type === "response.failed" || type === "error") {
            const error = event.error;
            const message =
              error &&
              typeof error === "object" &&
              typeof (error as { message?: unknown }).message === "string"
                ? String((error as { message?: unknown }).message)
                : "OpenAI stream failed.";
            throw new Error(message);
          }
        }
      } finally {
        usage.resolve(finalUsage);
      }
    },
  };

  return { textStream, usage: usage.promise, resolvedModelId: modelId };
}

export async function completeOpenAiDocument({
  modelId,
  openaiConfig,
  promptText,
  document,
  maxOutputTokens,
  temperature,
  timeoutMs,
  fetchImpl,
}: {
  modelId: string;
  openaiConfig: OpenAiClientConfig;
  promptText: string;
  document: Attachment;
  maxOutputTokens?: number;
  temperature?: number;
  timeoutMs: number;
  fetchImpl: typeof fetch;
}): Promise<{ text: string; usage: LlmTokenUsage | null }> {
  if (document.kind !== "document") {
    throw new Error("Internal error: expected a document attachment for OpenAI.");
  }
  if (openaiConfig.isOpenRouter) {
    throw createUnsupportedFunctionalityError(
      "OpenRouter does not support PDF attachments for openai/... models",
    );
  }
  const baseUrl = openaiConfig.baseURL ?? "https://api.openai.com/v1";
  const host = new URL(baseUrl).host;
  if (host !== "api.openai.com") {
    throw createUnsupportedFunctionalityError(
      `Document attachments require api.openai.com; got ${host}`,
    );
  }

  const url = resolveOpenAiResponsesUrl(baseUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const filename = document.filename?.trim() || "document.pdf";
  const payload = {
    model: modelId,
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_file",
            filename,
            file_data: `data:${document.mediaType};base64,${bytesToBase64(document.bytes)}`,
          },
          { type: "input_text", text: promptText },
        ],
      },
    ],
    ...buildOpenAiResponsesRequestOptions(openaiConfig.requestOptions),
    ...(typeof maxOutputTokens === "number" ? { max_output_tokens: maxOutputTokens } : {}),
    ...(typeof temperature === "number" ? { temperature } : {}),
  };

  try {
    const response = await fetchImpl(String(url), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${openaiConfig.apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const bodyText = await response.text();
    if (!response.ok) {
      throw createOpenAiHttpError({ baseUrl, status: response.status, bodyText });
    }

    const data = JSON.parse(bodyText) as {
      output_text?: unknown;
      output?: Array<{ content?: Array<{ text?: string }> }>;
      usage?: unknown;
    };
    const text = extractOpenAiResponseText(data);
    if (!text) {
      throw new Error(`LLM returned an empty summary (model openai/${modelId}).`);
    }
    return { text, usage: normalizeOpenAiUsage(data.usage) };
  } finally {
    clearTimeout(timeout);
  }
}
