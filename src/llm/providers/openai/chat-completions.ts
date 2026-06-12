import { normalizeOpenAiUsage } from "../../usage.js";
import { buildOpenAiChatRequestOptions } from "./request-options.js";
import { createDeferredUsage, parseOpenAiSseJsonStream } from "./sse.js";
import {
  buildOpenAiRequestHeaders,
  contextToChatCompletionMessages,
  createOpenAiHttpError,
  resolveOpenAiChatCompletionsUrl,
} from "./transport.js";
import type {
  OpenAiTextCompletionResult,
  OpenAiTextRequest,
  OpenAiTextStreamResult,
} from "./types.js";

function extractChatCompletionText(payload: {
  choices?: Array<{
    message?: {
      content?: unknown;
    };
  }>;
}): string {
  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  const content = choices[0]?.message?.content;
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      const record = part as Record<string, unknown>;
      return typeof record.text === "string" ? record.text : "";
    })
    .join("")
    .trim();
}

export async function completeOpenAiChatText({
  modelId,
  openaiConfig,
  context,
  temperature,
  maxOutputTokens,
  signal,
  fetchImpl,
}: OpenAiTextRequest): Promise<OpenAiTextCompletionResult> {
  const baseUrl = openaiConfig.baseURL ?? "https://api.openai.com/v1";
  const response = await fetchImpl(String(resolveOpenAiChatCompletionsUrl(baseUrl)), {
    method: "POST",
    headers: buildOpenAiRequestHeaders(openaiConfig),
    body: JSON.stringify({
      model: modelId,
      messages: contextToChatCompletionMessages(context),
      ...buildOpenAiChatRequestOptions(openaiConfig.requestOptions),
      ...(typeof maxOutputTokens === "number" ? { max_tokens: maxOutputTokens } : {}),
      ...(typeof temperature === "number" ? { temperature } : {}),
    }),
    signal,
  });

  const bodyText = await response.text();
  if (!response.ok) {
    throw createOpenAiHttpError({ baseUrl, status: response.status, bodyText });
  }

  const data = JSON.parse(bodyText) as {
    choices?: Array<{ message?: { content?: unknown } }>;
    usage?: unknown;
  };
  const text = extractChatCompletionText(data);
  if (!text) throw new Error(`LLM returned an empty summary (model openai/${modelId}).`);
  return { text, usage: normalizeOpenAiUsage(data.usage), resolvedModelId: modelId };
}

export async function streamOpenAiChatText({
  modelId,
  openaiConfig,
  context,
  temperature,
  maxOutputTokens,
  signal,
  fetchImpl,
}: OpenAiTextRequest): Promise<OpenAiTextStreamResult> {
  const baseUrl = openaiConfig.baseURL ?? "https://api.openai.com/v1";
  const response = await fetchImpl(String(resolveOpenAiChatCompletionsUrl(baseUrl)), {
    method: "POST",
    headers: buildOpenAiRequestHeaders(openaiConfig),
    body: JSON.stringify({
      model: modelId,
      messages: contextToChatCompletionMessages(context),
      ...buildOpenAiChatRequestOptions(openaiConfig.requestOptions),
      stream: true,
      stream_options: { include_usage: true },
      ...(typeof maxOutputTokens === "number" ? { max_tokens: maxOutputTokens } : {}),
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
      let finalUsage = null;
      try {
        for await (const event of parseOpenAiSseJsonStream(response.body!)) {
          if (event.error) {
            const error = event.error;
            const message =
              error &&
              typeof error === "object" &&
              typeof (error as { message?: unknown }).message === "string"
                ? String((error as { message?: unknown }).message)
                : "OpenAI stream failed.";
            throw new Error(message);
          }
          if (event.usage) finalUsage = normalizeOpenAiUsage(event.usage);
          const choices = Array.isArray(event.choices) ? event.choices : [];
          const delta = choices[0]?.delta;
          const content =
            delta && typeof delta === "object" ? (delta as { content?: unknown }).content : null;
          if (typeof content === "string") yield content;
        }
      } finally {
        usage.resolve(finalUsage);
      }
    },
  };

  return { textStream, usage: usage.promise, resolvedModelId: modelId };
}
