import { completeOpenAiChatText } from "./chat-completions.js";
import type { OpenAiTextCompletionResult, OpenAiTextRequest } from "./types.js";

function resolveGitHubModelsCompatFallbackModelId(modelId: string): string | null {
  const normalized = modelId.trim().toLowerCase();
  if (!normalized.startsWith("openai/gpt-5") || normalized === "openai/gpt-5-chat") {
    return null;
  }
  return "openai/gpt-5-chat";
}

function shouldRetryGitHubModelsCompat(error: unknown): boolean {
  const statusCode =
    typeof (error as { statusCode?: unknown })?.statusCode === "number"
      ? Number((error as { statusCode?: unknown }).statusCode)
      : null;
  return statusCode === 400 || statusCode === 404 || statusCode === 500 || statusCode === 502;
}

export async function completeGitHubModelsText(
  request: OpenAiTextRequest,
): Promise<OpenAiTextCompletionResult> {
  try {
    return await completeOpenAiChatText(request);
  } catch (error) {
    const fallbackModelId = resolveGitHubModelsCompatFallbackModelId(request.modelId);
    if (!fallbackModelId || !shouldRetryGitHubModelsCompat(error)) {
      throw error;
    }
    return completeOpenAiChatText({
      ...request,
      modelId: fallbackModelId,
    });
  }
}
