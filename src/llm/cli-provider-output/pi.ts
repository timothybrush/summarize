import type { LlmTokenUsage } from "../generate-text.js";
import { toNumber } from "./shared.js";

function parsePiUsage(usage: unknown): LlmTokenUsage | null {
  if (!usage || typeof usage !== "object") return null;
  const record = usage as Record<string, unknown>;
  const promptTokens = toNumber(record.input);
  const completionTokens = toNumber(record.output);
  const totalTokens = toNumber(record.totalTokens);
  if (promptTokens === null && completionTokens === null && totalTokens === null) return null;
  return { promptTokens, completionTokens, totalTokens };
}

function parsePiCost(usage: unknown): number | null {
  if (!usage || typeof usage !== "object") return null;
  const cost = (usage as Record<string, unknown>).cost;
  return cost && typeof cost === "object"
    ? toNumber((cost as Record<string, unknown>).total)
    : null;
}

function extractPiTextContent(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .filter(
      (block): block is { type: string; text: string } =>
        block && typeof block === "object" && (block as Record<string, unknown>).type === "text",
    )
    .map((block) => block.text)
    .filter((text) => typeof text === "string" && text.trim().length > 0)
    .join("")
    .trim();
}

export function parsePiOutputFromJsonl(output: string): {
  text: string;
  usage: LlmTokenUsage | null;
  costUsd: number | null;
} {
  const trimmed = output.trim();
  if (!trimmed) throw new Error("CLI returned empty output");
  const lines = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const textDeltaParts: string[] = [];
  let fullText: string | null = null;
  let usage: LlmTokenUsage | null = null;
  let costUsd: number | null = null;
  let sawStructuredEvent = false;
  const errorMessages: string[] = [];
  const plainLines: string[] = [];
  for (const line of lines) {
    if (!line.startsWith("{")) {
      plainLines.push(line);
      continue;
    }
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      sawStructuredEvent = true;
      if (parsed.type === "message_update") {
        const event = parsed.assistantMessageEvent as Record<string, unknown> | undefined;
        if (
          event?.type === "text_delta" &&
          typeof event.delta === "string" &&
          event.delta.length > 0
        ) {
          textDeltaParts.push(event.delta);
        }
        continue;
      }
      if (parsed.type !== "message_end" && parsed.type !== "turn_end") continue;
      const message = parsed.message as Record<string, unknown> | undefined;
      if (!message || message.role !== "assistant") continue;
      if (typeof message.errorMessage === "string" && message.errorMessage.trim().length > 0) {
        const error = message.errorMessage.trim();
        if (!errorMessages.includes(error)) errorMessages.push(error);
      }
      const extracted = extractPiTextContent(message.content);
      if (extracted) fullText = extracted;
      usage = parsePiUsage(message.usage) ?? usage;
      costUsd = parsePiCost(message.usage) ?? costUsd;
    } catch {
      // Ignore malformed JSON lines.
    }
  }
  const text = fullText ?? textDeltaParts.join("").trim();
  if (text) return { text, usage, costUsd };
  if (errorMessages.length > 0) throw new Error(errorMessages.join("\n"));
  if (sawStructuredEvent && plainLines.length > 0) throw new Error(plainLines.join("\n"));
  if (sawStructuredEvent) throw new Error("CLI returned empty output");
  return { text: trimmed, usage: null, costUsd: null };
}
