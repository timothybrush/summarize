import { Readable, Writable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SummarizeRequest, SummarizeRuntime } from "../src/application/summarize-contracts.js";

const seen = vi.hoisted(() => ({
  request: null as SummarizeRequest | null,
  runtime: null as SummarizeRuntime | null,
}));

vi.mock("../src/application/execute-summarize.js", () => ({
  executeSummarize: vi.fn(async (request: SummarizeRequest, runtime: SummarizeRuntime) => {
    seen.request = request;
    seen.runtime = runtime;
    return {
      kind: "asset-summary",
      input: {
        kind: "asset",
        sourceKind: "file",
        source: "/tmp/stdin.png",
        mediaType: "image/png",
        filename: "stdin.png",
      },
      details: { kind: "summary" },
    };
  }),
}));
vi.mock("../src/run/flows/asset/summary.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/run/flows/asset/summary.js")>()),
  presentAssetSummary: vi.fn(async () => {}),
}));

import { runCli } from "../src/run.js";

const noopStream = () =>
  new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });

describe("cli stdin binary routing", () => {
  afterEach(() => {
    seen.request = null;
    seen.runtime = null;
  });

  it("passes stdin unchanged to application-owned acquisition", async () => {
    const pngBytes = Buffer.from(
      "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489",
      "hex",
    );
    const stdin = Readable.from([pngBytes]);

    await runCli(["-"], {
      env: { HOME: "/tmp" },
      fetch: vi.fn() as unknown as typeof fetch,
      stdin,
      stdout: noopStream(),
      stderr: noopStream(),
    });

    expect(seen.request?.input).toEqual({ kind: "stdin" });
    expect(seen.runtime?.stdin).toBe(stdin);
  });
});
