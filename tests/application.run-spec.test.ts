import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createRunConfigInput } from "../src/application/config-state.js";
import { resolveSummarizeRun } from "../src/application/run-spec.js";
import type { SummarizeRequest } from "../src/application/summarize-contracts.js";
import { createEmptyRunOverrides } from "../src/run/run-settings.js";

function createRequest(overrides: Partial<SummarizeRequest> = {}): SummarizeRequest {
  return {
    input: {
      kind: "url",
      url: "https://example.com/",
      title: null,
      maxCharacters: 9_000,
    },
    modelOverride: null,
    promptOverride: null,
    lengthRaw: null,
    languageRaw: null,
    format: "text",
    overrides: createEmptyRunOverrides(),
    extractOnly: false,
    slides: null,
    ...overrides,
  };
}

describe("resolved summarize run", () => {
  it("separates serializable intent from credential-bearing context", () => {
    const home = mkdtempSync(join(tmpdir(), "summarize-run-spec-"));
    const configDir = join(home, ".summarize");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, "config.json"),
      JSON.stringify({
        model: "openai/gpt-5-mini",
        output: { language: "German", length: "short" },
        media: { videoMode: "transcript", embeddedVideo: "prefer" },
        apiKeys: { openai: "config-secret" },
      }),
      "utf8",
    );

    const run = resolveSummarizeRun({
      request: createRequest(),
      env: { HOME: home, OPENAI_API_KEY: "secret-key" },
    });

    expect(run.spec).toMatchObject({
      format: "text",
      maxExtractCharacters: 9_000,
      timeoutMs: 120_000,
      retries: 1,
      videoMode: "transcript",
      embeddedVideoMode: "prefer",
      outputLanguage: { kind: "fixed", label: "German" },
      lengthArg: { kind: "preset", preset: "short" },
    });
    expect(run.bindings.context.apiKey).toBe("secret-key");
    expect(JSON.stringify(run.spec)).not.toContain("secret-key");
    expect(JSON.stringify(run.spec)).not.toContain("config-secret");
  });

  it("applies normalized adapter overrides without Commander-shaped input", () => {
    const request = createRequest({
      modelOverride: "openai/gpt-5.4",
      promptOverride: "Custom prompt",
      lengthRaw: "medium",
      languageRaw: "French",
      format: "markdown",
      overrides: {
        ...createEmptyRunOverrides(),
        timeoutMs: 4_000,
        retries: 3,
        markdownMode: "llm",
        preprocessMode: "always",
        youtubeMode: "yt-dlp",
        firecrawlMode: "auto",
        transcriptTimestamps: true,
        autoCliFallbackEnabled: true,
        transcriber: "parakeet",
      },
    });
    const run = resolveSummarizeRun({
      request,
      env: { HOME: mkdtempSync(join(tmpdir(), "summarize-run-spec-")) },
      configInput: createRunConfigInput({
        languageRaw: "French",
        languageExplicit: true,
        fast: true,
        thinkingRaw: "high",
      }),
    });

    expect(run.spec).toMatchObject({
      timeoutMs: 4_000,
      retries: 3,
      markdownMode: "llm",
      preprocessMode: "always",
      youtubeMode: "yt-dlp",
      firecrawlMode: "auto",
      transcriptTimestamps: true,
      allowAutoCliFallback: true,
      model: {
        requestedModelLabel: "openai/gpt-5.4",
      },
    });
    expect(run.spec.lengthInstruction).toBeTruthy();
    expect(run.spec.languageInstruction).toBe("Output should be French.");
    expect(run.bindings.context.openaiRequestOptionsOverride).toEqual({ serviceTier: "fast" });
    expect(run.bindings.context.cliReasoningEffortOverride).toBe("high");
    expect(run.bindings.envForRun.SUMMARIZE_TRANSCRIBER).toBe("parakeet");
  });
});
