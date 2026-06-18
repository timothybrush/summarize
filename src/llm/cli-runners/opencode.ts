import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execCliWithInput } from "../cli-exec.js";
import { parseOpenCodeOutputFromJsonl } from "../cli-provider-output.js";
import type { CliRunResult, ResolvedCliRunOptions } from "./types.js";

export async function runOpenCodeCli(options: ResolvedCliRunOptions): Promise<CliRunResult> {
  const isolatedCwd =
    !options.allowTools && !options.cwd
      ? await fs.mkdtemp(path.join(tmpdir(), "summarize-opencode-"))
      : null;
  try {
    const args = ["run", ...options.providerExtraArgs, "--format", "json"];
    if (options.requestedModel) args.push("--model", options.requestedModel);
    const { stdout } = await execCliWithInput({
      execFileImpl: options.execFileImpl,
      cmd: options.binary,
      args,
      input: options.prompt,
      timeoutMs: options.timeoutMs,
      env: options.env,
      cwd: isolatedCwd ?? options.cwd,
      signal: options.signal,
    });
    return parseOpenCodeOutputFromJsonl(stdout);
  } finally {
    if (isolatedCwd) await fs.rm(isolatedCwd, { recursive: true, force: true }).catch(() => {});
  }
}
