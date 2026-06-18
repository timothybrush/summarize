import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execCliWithInput } from "../cli-exec.js";
import type { CliRunResult, ResolvedCliRunOptions } from "./types.js";

function hasAnyFlag(args: string[], flags: string[]): boolean {
  return args.some((arg) => flags.some((flag) => arg === flag || arg.startsWith(`${flag}=`)));
}

export async function runCopilotCli(options: ResolvedCliRunOptions): Promise<CliRunResult> {
  const args = [...options.providerExtraArgs, "-p", options.prompt];
  if (options.allowTools) args.push("--allow-all-tools");
  if (options.requestedModel) args.push("--model", options.requestedModel);
  const { stdout } = await execCliWithInput({
    execFileImpl: options.execFileImpl,
    cmd: options.binary,
    args,
    input: "",
    timeoutMs: options.timeoutMs,
    env: options.env,
    cwd: options.cwd,
    signal: options.signal,
  });
  const text = stdout.trim();
  if (!text) throw new Error("CLI returned empty output");
  return { text, usage: null, costUsd: null };
}

export async function runAgyCli(options: ResolvedCliRunOptions): Promise<CliRunResult> {
  const isolatedCwd = !options.allowTools
    ? await fs.mkdtemp(path.join(tmpdir(), "summarize-agy-"))
    : null;
  try {
    const args = [...options.providerExtraArgs];
    if (!options.allowTools && !hasAnyFlag(args, ["--sandbox"])) args.push("--sandbox");
    args.push("--print");
    if (
      Number.isFinite(options.timeoutMs) &&
      options.timeoutMs > 0 &&
      !hasAnyFlag(args, ["--print-timeout", "-print-timeout"])
    ) {
      args.push("--print-timeout", `${Math.max(1, Math.ceil(options.timeoutMs / 1000))}s`);
    }
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
    const text = stdout.trim();
    if (!text) throw new Error("CLI returned empty output");
    return { text, usage: null, costUsd: null };
  } finally {
    if (isolatedCwd) await fs.rm(isolatedCwd, { recursive: true, force: true }).catch(() => {});
  }
}
