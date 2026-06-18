import type { CliProvider } from "../../config.js";
import { execCliWithInput } from "../cli-exec.js";
import {
  isJsonCliProvider,
  parseJsonProviderOutput,
  type JsonCliProvider,
} from "../cli-provider-output.js";
import type { CliRunResult, ResolvedCliRunOptions } from "./types.js";

function appendArgs({
  provider,
  args,
  options,
}: {
  provider: JsonCliProvider;
  args: string[];
  options: ResolvedCliRunOptions;
}): string {
  if (provider === "claude" || provider === "agent") args.push("--print");
  args.push("--output-format", "json");
  if (provider === "agent" && !options.allowTools) args.push("--mode", "ask");
  if (options.requestedModel) args.push("--model", options.requestedModel);
  if (options.allowTools && provider === "claude") {
    args.push("--tools", "Read", "--dangerously-skip-permissions");
  }
  if (options.allowTools && provider === "gemini") args.push("--yolo");
  if (provider === "agent") {
    args.push(options.prompt);
    return "";
  }
  if (provider === "gemini") {
    args.push("--prompt", options.prompt);
    return "";
  }
  return options.prompt;
}

export async function runJsonCli(
  provider: CliProvider,
  options: ResolvedCliRunOptions,
): Promise<CliRunResult> {
  if (!isJsonCliProvider(provider)) throw new Error(`Unsupported CLI provider "${provider}".`);
  const args = [...options.providerExtraArgs];
  const input = appendArgs({ provider, args, options });
  const { stdout } = await execCliWithInput({
    execFileImpl: options.execFileImpl,
    cmd: options.binary,
    args,
    input,
    timeoutMs: options.timeoutMs,
    env: options.env,
    cwd: options.cwd,
    signal: options.signal,
  });
  return parseJsonProviderOutput({ provider, stdout });
}
