import { Writable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  setText: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
  stopAndClear: vi.fn(),
  stopOsc: vi.fn(),
}));

vi.mock("../src/tty/spinner.js", () => ({
  startSpinner: vi.fn(() => ({
    stop: vi.fn(),
    clear: vi.fn(),
    pause: mocks.pause,
    refresh: vi.fn(),
    resume: mocks.resume,
    stopAndClear: mocks.stopAndClear,
    setText: mocks.setText,
  })),
}));
vi.mock("../src/tty/osc-progress.js", () => ({
  startOscProgress: vi.fn(() => mocks.stopOsc),
}));

import { createCliInputProgress } from "../src/run/cli-input-progress.js";
import { startOscProgress } from "../src/tty/osc-progress.js";
import { startSpinner } from "../src/tty/spinner.js";

function stripAnsi(value: string): string {
  return value.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "");
}

describe("CLI input progress", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders semantic local input phases and model selection", () => {
    const setClearProgressBeforeStdout = vi.fn();
    const clearProgressIfCurrent = vi.fn();
    const progress = createCliInputProgress({
      env: {},
      envForRun: {},
      stderr: new Writable({ write: (_chunk, _encoding, callback) => callback() }),
      enabled: true,
      progressGate: { setClearProgressBeforeStdout, clearProgressIfCurrent },
    });

    progress.handleEvent({
      type: "input-progress",
      phase: "loading",
      source: "/tmp/report.pdf",
      filename: "report.pdf",
      mediaType: null,
      sizeBytes: 1536,
    });
    progress.handleEvent({
      type: "input-progress",
      phase: "summarizing",
      source: "/tmp/report.pdf",
      filename: "report.pdf",
      mediaType: "application/pdf",
      sizeBytes: 1536,
    });
    progress.handleEvent({ type: "model-selected", modelId: "openai/gpt-5.4" });

    expect(startOscProgress).toHaveBeenCalledWith(
      expect.objectContaining({ label: "Loading file", indeterminate: true }),
    );
    const initialText = vi.mocked(startSpinner).mock.calls[0]?.[0].text ?? "";
    expect(stripAnsi(initialText)).toBe("Loading file (1.5 KB)…");
    expect(stripAnsi(String(mocks.setText.mock.calls.at(-1)?.[0]))).toBe(
      "Summarizing report.pdf (application/pdf, 1.5 KB) (model: openai/gpt-5.4)…",
    );
    expect(setClearProgressBeforeStdout).toHaveBeenCalledWith(expect.any(Function));

    const pause = setClearProgressBeforeStdout.mock.calls[0]?.[0] as () => () => void;
    pause()();
    expect(mocks.pause).toHaveBeenCalledOnce();
    expect(mocks.resume).toHaveBeenCalledOnce();

    progress.stop();
    expect(clearProgressIfCurrent).toHaveBeenCalledWith(pause);
    expect(mocks.stopAndClear).toHaveBeenCalledOnce();
    expect(mocks.stopOsc).toHaveBeenCalledOnce();
  });

  it("uses remote media labels without starting for unrelated events", () => {
    const progress = createCliInputProgress({
      env: {},
      envForRun: {},
      stderr: new Writable({ write: (_chunk, _encoding, callback) => callback() }),
      enabled: true,
      progressGate: {
        setClearProgressBeforeStdout: vi.fn(),
        clearProgressIfCurrent: vi.fn(),
      },
    });

    progress.handleEvent({ type: "summary-started" });
    expect(startSpinner).not.toHaveBeenCalled();

    progress.handleEvent({
      type: "input-progress",
      phase: "transcribing",
      source: "https://example.com/download?id=audio",
      filename: "download",
      mediaType: "audio/mpeg",
      sizeBytes: null,
    });

    expect(startOscProgress).toHaveBeenCalledWith(
      expect.objectContaining({ label: "Transcribing media" }),
    );
    const initialText = vi.mocked(startSpinner).mock.calls[0]?.[0].text ?? "";
    expect(stripAnsi(initialText)).toBe("Transcribing download…");
  });
});
