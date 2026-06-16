import { normalizeBrowserAiGeneratedPoints } from "../../lib/browser-summary";
import { logExtensionEvent } from "../../lib/extension-logs";
import { isGeminiNanoModel } from "../../lib/model-routing";
import {
  buildSlideTextFallback,
  parseSlideSummariesFromMarkdown,
  splitSlideTitleFromText,
} from "../../lib/slides-text";
import type { createBrowserAiSummaryRuntime } from "./browser-ai-summary-runtime";
import type { PanelState } from "./types";

type BrowserAiRuntime = Pick<
  ReturnType<typeof createBrowserAiSummaryRuntime>,
  "cancel" | "summarize"
>;

type GeneratedSummary = {
  runId: string;
  url: string | null;
  markdown: string;
  model: string;
  complete: boolean;
};

const MODEL_LABEL = "Gemini Nano";

export function shouldUseBrowserAiForSlides(panelState: PanelState): boolean {
  const settings = panelState.ui?.settings;
  if (!settings) return false;
  if (isGeminiNanoModel(settings.model)) return true;
  const model = settings.model.trim().toLowerCase();
  const browserSlides =
    panelState.slides?.slideRuntime === "browser" ||
    panelState.slidesLifecycle.activeRun?.local === true;
  return (
    browserSlides &&
    settings.summaryRuntime === "direct" &&
    model === "auto" &&
    !settings.providerConfigured
  );
}

function hashText(value: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(36);
}

function normalizeSlideBody(value: string): string {
  return normalizeBrowserAiGeneratedPoints(
    value
      .replace(/^\s*\[[^\]]*slide[^\]]*\]\s*$/gim, "")
      .replace(/^\s*(?:title|headline)\s*:\s*/gim, ""),
  )
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function sanitizeHeadline(value: string): string {
  const normalized = value
    .replace(/^#{1,6}\s+/, "")
    .replace(/^\s*(?:title|headline)\s*:\s*/i, "")
    .replace(/\[[^\]]*slide[^\]]*\]/gi, "")
    .replace(/[*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (normalized.length <= 80) return normalized;
  return normalized
    .slice(0, 80)
    .replace(/\s+\S*$/, "")
    .trim();
}

function buildSlideBlock({
  index,
  total,
  body,
}: {
  index: number;
  total: number;
  body: string;
}): string {
  if (!body) return `[slide:${index}]\n## Interlude`;
  const parsed = splitSlideTitleFromText({ text: body, slideIndex: index, total });
  const headline = sanitizeHeadline(parsed.title ?? "") || "Key point";
  return `[slide:${index}]\n## ${headline}\n${body}`;
}

function hasCompleteNanoSummary(panelState: PanelState): boolean {
  const slides = panelState.slides?.slides ?? [];
  const summary = panelState.slidesSummary;
  if (!summary.complete || summary.model !== MODEL_LABEL || slides.length === 0) return false;
  const parsed = parseSlideSummariesFromMarkdown(summary.markdown);
  return slides.every((slide) => parsed.has(slide.index));
}

export function createBrowserAiSlidesRuntime(options: {
  panelState: PanelState;
  browserAi: BrowserAiRuntime;
  getTranscriptTimedText: () => string | null;
  applyGeneratedSummary: (summary: GeneratedSummary) => void;
  schedulePanelCacheSync: () => void;
}) {
  let activeGeneration = 0;
  let activeSourceKey: string | null = null;

  const cancel = () => {
    activeGeneration += 1;
    activeSourceKey = null;
    options.browserAi.cancel("slides");
  };

  const refresh = async () => {
    const { panelState } = options;
    const payload = panelState.slides;
    if (!payload || payload.slides.length === 0 || !shouldUseBrowserAiForSlides(panelState)) {
      cancel();
      return;
    }
    if (hasCompleteNanoSummary(panelState)) return;

    const transcriptTimedText =
      options.getTranscriptTimedText() ?? payload.transcriptTimedText ?? null;
    const timeline = payload.slides.map((slide) => ({
      index: slide.index,
      timestamp: Number.isFinite(slide.timestamp) ? slide.timestamp : Number.NaN,
    }));
    const transcriptBySlide = buildSlideTextFallback({
      slides: timeline,
      transcriptTimedText,
      lengthArg: { kind: "preset", preset: "xxl" },
    });
    const hasAnySource = payload.slides.some(
      (slide) => transcriptBySlide.has(slide.index) || Boolean(slide.ocrText?.trim()),
    );
    if (!hasAnySource) return;
    const sourceKey = [
      payload.sourceId,
      payload.slides.length,
      hashText(transcriptTimedText ?? ""),
      hashText(payload.slides.map((slide) => slide.ocrText ?? "").join("\n")),
    ].join(":");
    if (activeSourceKey === sourceKey) return;

    const generation = ++activeGeneration;
    activeSourceKey = sourceKey;
    options.browserAi.cancel("slides");
    const runId =
      panelState.slidesRunId ?? panelState.runId ?? `browser-ai-slides:${payload.sourceId}`;
    const url = payload.sourceUrl || panelState.currentSource?.url || null;
    const ordered = payload.slides.slice().sort((a, b) => a.index - b.index);
    const blocks: string[] = [];
    let complete = true;
    let hasGeneratedBody = false;

    for (let offset = 0; offset < ordered.length; offset += 1) {
      const slide = ordered[offset];
      if (!slide || generation !== activeGeneration) return;
      if (options.panelState.slides?.sourceId !== payload.sourceId) return;
      const sourceText = transcriptBySlide.get(slide.index) ?? slide.ocrText?.trim() ?? "";
      let body = "";
      if (sourceText) {
        const result = await options.browserAi.summarize({
          input: { text: sourceText, length: "short", keyMoments: [] },
          context: [
            `Summarize slide ${offset + 1} of ${ordered.length}.`,
            "Return only one or two concise factual sentences in plain text.",
            "Do not mention the slide, transcript, speaker, timestamps, or these instructions.",
            panelState.currentSource?.title
              ? `The video is titled "${panelState.currentSource.title}".`
              : "",
          ]
            .filter(Boolean)
            .join(" "),
          requestKey: "slides",
          status: `Summarizing slide ${offset + 1} of ${ordered.length} with on-device AI…`,
        });
        body = result ? normalizeSlideBody(result) : "";
        if (!body) {
          complete = false;
          if (!hasGeneratedBody) {
            if (activeSourceKey === sourceKey) activeSourceKey = null;
            return;
          }
          continue;
        }
        hasGeneratedBody = true;
      }
      if (generation !== activeGeneration) return;
      blocks.push(
        buildSlideBlock({
          index: slide.index,
          total: ordered.length,
          body,
        }),
      );
      if (hasGeneratedBody) {
        options.applyGeneratedSummary({
          runId,
          url,
          markdown: blocks.join("\n"),
          model: MODEL_LABEL,
          complete: false,
        });
        options.schedulePanelCacheSync();
      }
    }

    if (generation !== activeGeneration) return;
    if (!hasGeneratedBody || blocks.length === 0) {
      if (activeSourceKey === sourceKey) activeSourceKey = null;
      return;
    }
    const markdown = blocks.join("\n");
    options.applyGeneratedSummary({
      runId,
      url,
      markdown,
      model: MODEL_LABEL,
      complete,
    });
    options.schedulePanelCacheSync();
    if (activeSourceKey === sourceKey) activeSourceKey = null;
    logExtensionEvent({
      event: "browser-ai:slides-done",
      level: complete ? "verbose" : "warn",
      scope: "sidepanel",
      detail: {
        complete,
        slides: ordered.length,
        sourceKind: payload.sourceKind,
      },
    });
  };

  return { cancel, refresh };
}
