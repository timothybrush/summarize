import { afterEach, describe, expect, it, vi } from "vitest";
import {
  extractBrowserFfmpegFrames,
  extractBrowserFfmpegFramesInDocument,
  isBrowserFfmpegMediaUrl,
} from "../apps/chrome-extension/src/entrypoints/background/browser-ffmpeg";

const originalChrome = globalThis.chrome;
const originalFileReader = globalThis.FileReader;
const originalWorker = globalThis.Worker;

type WorkerListener = (event: { data?: unknown; message?: string }) => void;
type WorkerPlan = (worker: FakeWorker, message: Record<string, unknown>) => void;

let workerPlan: WorkerPlan = () => {};
let latestWorker: FakeWorker | null = null;

class FakeWorker {
  readonly listeners = new Map<string, WorkerListener>();
  readonly terminate = vi.fn();
  postedMessage: Record<string, unknown> | null = null;

  constructor() {
    latestWorker = this;
  }

  addEventListener(type: string, listener: WorkerListener) {
    this.listeners.set(type, listener);
  }

  postMessage(message: Record<string, unknown>) {
    this.postedMessage = message;
    workerPlan(this, message);
  }

  emit(type: string, event: { data?: unknown; message?: string }) {
    this.listeners.get(type)?.(event);
  }
}

class FakeFileReader {
  error: Error | null = null;
  result: string | null = null;
  readonly listeners = new Map<string, () => void>();

  addEventListener(type: string, listener: () => void) {
    this.listeners.set(type, listener);
  }

  readAsDataURL() {
    this.result = "data:image/png;base64,AQID";
    this.listeners.get("load")?.();
  }
}

function installBrowserGlobals() {
  Object.defineProperty(globalThis, "chrome", {
    configurable: true,
    value: {
      runtime: {
        getURL: (path: string) => `chrome-extension://test/${path}`,
      },
    },
  });
  Object.defineProperty(globalThis, "FileReader", {
    configurable: true,
    value: FakeFileReader,
  });
  Object.defineProperty(globalThis, "Worker", {
    configurable: true,
    value: FakeWorker,
  });
}

describe("chrome browser ffmpeg", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    workerPlan = () => {};
    latestWorker = null;
    Object.defineProperty(globalThis, "chrome", {
      configurable: true,
      value: originalChrome,
    });
    Object.defineProperty(globalThis, "FileReader", {
      configurable: true,
      value: originalFileReader,
    });
    Object.defineProperty(globalThis, "Worker", {
      configurable: true,
      value: originalWorker,
    });
  });

  it("accepts only fetchable HTTP media URLs", async () => {
    expect(isBrowserFfmpegMediaUrl("https://example.com/video.mp4")).toBe(true);
    expect(isBrowserFfmpegMediaUrl("http://example.com/video.mp4")).toBe(true);
    expect(isBrowserFfmpegMediaUrl("blob:https://example.com/id")).toBe(false);
    expect(isBrowserFfmpegMediaUrl("not a URL")).toBe(false);

    const fetchImpl = vi.fn();
    await expect(
      extractBrowserFfmpegFramesInDocument({
        mediaUrl: "https://example.com/video.mp4",
        timestamps: [],
        fetchImpl,
      }),
    ).resolves.toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
    await expect(
      extractBrowserFfmpegFramesInDocument({
        mediaUrl: "file:///tmp/video.mp4",
        timestamps: [1],
        fetchImpl,
      }),
    ).rejects.toThrow("fetchable HTTP media URL");
  });

  it("creates the offscreen document and returns its frames", async () => {
    const onStatus = vi.fn();
    const createDocument = vi.fn(async () => {});
    const sendMessage = vi.fn(async () => ({
      ok: true,
      frames: [{ imageUrl: "data:image/png;base64,AQID", timestamp: 1 }],
    }));
    Object.defineProperty(globalThis, "chrome", {
      configurable: true,
      value: {
        offscreen: {
          createDocument,
          hasDocument: vi.fn(async () => false),
          Reason: { WORKERS: "WORKERS" },
        },
        runtime: { sendMessage },
      },
    });

    await expect(
      extractBrowserFfmpegFrames({
        mediaUrl: "https://example.com/video.mp4",
        timestamps: [1],
        onStatus,
      }),
    ).resolves.toHaveLength(1);
    expect(onStatus).toHaveBeenCalledWith("Preparing FFmpeg WebAssembly...");
    expect(createDocument).toHaveBeenCalledWith(
      expect.objectContaining({ url: "offscreen.html", reasons: ["WORKERS"] }),
    );
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ target: "offscreen", type: "ffmpeg-wasm:frames" }),
    );
  });

  it("reports unavailable and failed offscreen runtimes", async () => {
    Object.defineProperty(globalThis, "chrome", {
      configurable: true,
      value: { offscreen: {}, runtime: { sendMessage: vi.fn() } },
    });
    await expect(
      extractBrowserFfmpegFrames({
        mediaUrl: "https://example.com/video.mp4",
        timestamps: [1],
      }),
    ).rejects.toThrow("offscreen documents are unavailable");

    Object.defineProperty(globalThis, "chrome", {
      configurable: true,
      value: {
        offscreen: {
          createDocument: vi.fn(),
          hasDocument: vi.fn(async () => true),
        },
        runtime: { sendMessage: vi.fn(async () => ({ ok: false, error: "worker failed" })) },
      },
    });
    await expect(
      extractBrowserFfmpegFrames({
        mediaUrl: "https://example.com/video.mp4",
        timestamps: [1],
      }),
    ).rejects.toThrow("worker failed");
  });

  it("rejects failed and oversized media downloads", async () => {
    await expect(
      extractBrowserFfmpegFramesInDocument({
        mediaUrl: "https://example.com/video.mp4",
        timestamps: [1],
        fetchImpl: vi.fn(
          async () =>
            new Response("missing", {
              status: 404,
              statusText: "Not Found",
            }),
        ),
      }),
    ).rejects.toThrow("404 Not Found");

    await expect(
      extractBrowserFfmpegFramesInDocument({
        mediaUrl: "https://example.com/video.mp4",
        timestamps: [1],
        fetchImpl: vi.fn(
          async () =>
            new Response("video", {
              headers: { "content-length": String(128 * 1024 * 1024 + 1) },
            }),
        ),
      }),
    ).rejects.toThrow("too large");
  });

  it("extracts frames through the worker and maps media metadata", async () => {
    installBrowserGlobals();
    workerPlan = (worker, message) => {
      queueMicrotask(() => {
        worker.emit("message", {
          data: {
            exitCode: 0,
            files: [{ path: "/slide_0001.png", buffer: new Uint8Array([1, 2, 3]).buffer }],
            id: message.id,
            ok: true,
            stderrText: "",
          },
        });
      });
    };

    const frames = await extractBrowserFfmpegFramesInDocument({
      mediaUrl: "https://example.com/video",
      timestamps: [1.25],
      fetchImpl: vi.fn(
        async () =>
          new Response(new Uint8Array([1, 2, 3]), {
            headers: { "content-type": "video/webm; charset=binary" },
          }),
      ),
    });

    expect(frames).toEqual([{ imageUrl: "data:image/png;base64,AQID", timestamp: 1.25 }]);
    expect(latestWorker?.postedMessage).toEqual(
      expect.objectContaining({
        inputPath: "/input.webm",
        outputPaths: ["/slide_0001.png"],
      }),
    );
    expect(latestWorker?.terminate).toHaveBeenCalled();
  });

  it("surfaces worker failures and timeouts", async () => {
    installBrowserGlobals();
    const fetchImpl = vi.fn(
      async () =>
        ({
          arrayBuffer: async () => new Uint8Array([1]).buffer,
          body: null,
          headers: new Headers(),
          ok: true,
        }) as Response,
    );

    workerPlan = (worker, message) => {
      queueMicrotask(() => {
        worker.emit("message", {
          data: {
            error: "module failed",
            id: message.id,
            ok: false,
            stderrText: "decoder failed",
          },
        });
      });
    };
    await expect(
      extractBrowserFfmpegFramesInDocument({
        mediaUrl: "https://example.com/video.mov",
        timestamps: [1],
        fetchImpl,
      }),
    ).rejects.toThrow("decoder failed");

    workerPlan = (worker) => {
      queueMicrotask(() => worker.emit("error", { message: "" }));
    };
    await expect(
      extractBrowserFfmpegFramesInDocument({
        mediaUrl: "https://example.com/video.unknown",
        timestamps: [1],
        fetchImpl,
      }),
    ).rejects.toThrow("worker failed");

    vi.useFakeTimers();
    workerPlan = () => {};
    const timedOut = extractBrowserFfmpegFramesInDocument({
      mediaUrl: "https://example.com/video.mp4",
      timestamps: [1],
      fetchImpl,
    });
    const timedOutExpectation = expect(timedOut).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(120_000);
    await timedOutExpectation;
  });
});
