import type { LlmTokenUsage } from "../generate-text.js";
import { sumNullable, toNumber } from "./shared.js";

function parseOpenCodeTokens(payload: Record<string, unknown>): LlmTokenUsage | null {
  const tokens = payload.tokens;
  if (!tokens || typeof tokens !== "object") return null;
  const record = tokens as Record<string, unknown>;
  const promptTokens = toNumber(record.input);
  const completionTokens = toNumber(record.output);
  const totalTokens =
    toNumber(record.total) ??
    (typeof promptTokens === "number" && typeof completionTokens === "number"
      ? promptTokens + completionTokens
      : null);
  if (promptTokens === null && completionTokens === null && totalTokens === null) return null;
  return { promptTokens, completionTokens, totalTokens };
}

function extractOpenCodeErrorMessage(payload: Record<string, unknown>): string | null {
  const error = payload.error;
  if (!error) return null;
  if (typeof error === "string" && error.trim().length > 0) return error.trim();
  if (typeof error !== "object") return null;
  const record = error as Record<string, unknown>;
  const data = record.data;
  if (data && typeof data === "object") {
    const message = (data as Record<string, unknown>).message;
    if (typeof message === "string" && message.trim().length > 0) return message.trim();
  }
  if (typeof record.message === "string" && record.message.trim().length > 0) {
    return record.message.trim();
  }
  return typeof record.name === "string" && record.name.trim().length > 0
    ? record.name.trim()
    : null;
}

export function parseOpenCodeOutputFromJsonl(output: string): {
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
  const textParts: string[] = [];
  const errorMessages: string[] = [];
  let promptTokens: number | null = null;
  let completionTokens: number | null = null;
  let totalTokens: number | null = null;
  let costUsd: number | null = null;
  let sawStructuredEvent = false;
  for (const line of lines) {
    if (!line.startsWith("{")) continue;
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      sawStructuredEvent = true;
      if (parsed.type === "text") {
        const part = parsed.part;
        const text =
          part && typeof part === "object" ? (part as Record<string, unknown>).text : null;
        if (typeof text === "string" && text.length > 0) textParts.push(text);
      } else if (parsed.type === "step_finish") {
        const part = parsed.part;
        if (!part || typeof part !== "object") continue;
        const usage = parseOpenCodeTokens(part as Record<string, unknown>);
        if (usage) {
          promptTokens = sumNullable(promptTokens, usage.promptTokens);
          completionTokens = sumNullable(completionTokens, usage.completionTokens);
          totalTokens = sumNullable(totalTokens, usage.totalTokens);
        }
        const cost = toNumber((part as Record<string, unknown>).cost);
        if (typeof cost === "number") costUsd = typeof costUsd === "number" ? costUsd + cost : cost;
      } else if (parsed.type === "error") {
        const message = extractOpenCodeErrorMessage(parsed);
        if (message) errorMessages.push(message);
      }
    } catch {
      // Ignore malformed JSON lines.
    }
  }
  const text = textParts.join("").trim();
  const usage =
    promptTokens !== null || completionTokens !== null || totalTokens !== null
      ? { promptTokens, completionTokens, totalTokens }
      : null;
  if (text) return { text, usage, costUsd };
  if (errorMessages.length > 0) throw new Error(errorMessages.join("\n"));
  if (sawStructuredEvent) throw new Error("CLI returned empty output");
  return { text: trimmed, usage: null, costUsd: null };
}
