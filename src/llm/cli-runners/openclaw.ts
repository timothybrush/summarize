import { execCliWithInput } from "../cli-exec.js";
import type { CliRunResult, ResolvedCliRunOptions } from "./types.js";

const CLI_MAX_MESSAGE_ARG_BYTES = 120 * 1024;

export async function runOpenClawCli(options: ResolvedCliRunOptions): Promise<CliRunResult> {
  const promptBytes = Buffer.byteLength(options.prompt, "utf8");
  if (promptBytes > CLI_MAX_MESSAGE_ARG_BYTES) {
    throw new Error(
      `OpenClaw CLI requires --message and cannot safely receive large prompts over argv (${promptBytes} bytes). ` +
        "Use a different CLI provider for this input, reduce extracted content, or update OpenClaw to support stdin/file input.",
    );
  }
  const args = [
    ...options.providerExtraArgs,
    "agent",
    "--agent",
    options.requestedModel ?? "main",
    "-m",
    options.prompt,
    "--json",
    "--timeout",
    String(Math.max(1, Math.ceil(options.timeoutMs / 1000))),
  ];
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
  const parsed = JSON.parse(stdout);
  const payloads = parsed?.result?.payloads;
  const text = Array.isArray(payloads)
    ? payloads
        .map((payload) => (typeof payload?.text === "string" ? payload.text : ""))
        .filter(Boolean)
        .join("\n\n")
    : "";
  if (!text.trim()) throw new Error("OpenClaw CLI returned empty output");
  const usage =
    parsed?.result?.meta?.agentMeta?.lastCallUsage ??
    parsed?.result?.meta?.agentMeta?.usage ??
    null;
  return { text: text.trim(), usage, costUsd: null };
}
