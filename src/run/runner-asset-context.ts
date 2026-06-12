import type { AssetInputContext } from "./flows/asset/input.js";
import type { AssetSummaryContext } from "./flows/asset/types.js";

type SummarizeMediaFile = typeof import("./flows/asset/media.js").summarizeMediaFile;

export function createRunnerAssetInputContext({
  summarizeAssetImpl,
  summarizeMediaFileImpl,
  assetSummaryContext,
  progressEnabled,
  trackedFetch,
  setClearProgressBeforeStdout,
  clearProgressIfCurrent,
}: {
  summarizeAssetImpl: AssetInputContext["summarizeAsset"];
  summarizeMediaFileImpl: SummarizeMediaFile;
  assetSummaryContext: AssetSummaryContext;
  progressEnabled: boolean;
  trackedFetch: typeof fetch;
  setClearProgressBeforeStdout: AssetInputContext["setClearProgressBeforeStdout"];
  clearProgressIfCurrent: AssetInputContext["clearProgressIfCurrent"];
}): AssetInputContext {
  const summarizeMediaFile = (args: Parameters<SummarizeMediaFile>[1]) =>
    summarizeMediaFileImpl(assetSummaryContext, args);
  return {
    env: assetSummaryContext.env,
    envForRun: assetSummaryContext.envForRun,
    stderr: assetSummaryContext.stderr,
    progressEnabled,
    timeoutMs: assetSummaryContext.timeoutMs,
    trackedFetch,
    summarizeAsset: summarizeAssetImpl,
    summarizeMediaFile,
    setClearProgressBeforeStdout,
    clearProgressIfCurrent,
  };
}
