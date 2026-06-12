import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  isDirectMediaExtension,
  isDirectMediaUrl,
  isDirectVideoInput,
} from "@steipete/summarize-core/content/url";
import mime from "mime";
import {
  classifyUrl,
  type AssetAttachment,
  loadLocalAsset,
  loadRemoteAsset,
  shouldProbeUnknownAssetUrl,
} from "../content/asset.js";
import { assertAssetMediaTypeSupported } from "../run/attachments.js";

type AcquiredAssetInputBase = {
  sourceKind: "file" | "asset-url";
  sourceLabel: string;
  attachment: AssetAttachment;
  sizeBytes: number | null;
};

export type AcquiredAssetInput = AcquiredAssetInputBase &
  ({ kind: "resolved-asset" } | { kind: "resolved-media" });
export type AcquiredResolvedAssetInput = AcquiredAssetInputBase & { kind: "resolved-asset" };
export type AcquiredMediaInput = AcquiredAssetInputBase & { kind: "resolved-media" };
export type MaterializedAcquiredInput = {
  filePath: string;
  cleanup: () => Promise<void>;
};

export type UrlAssetRoute = "asset" | "audio" | "video" | "none";

function normalizePathForExtension(value: string): string {
  try {
    return new URL(value).pathname;
  } catch {
    return value.split(/[?#]/, 1)[0];
  }
}

export function isTranscribableAssetPath(value: string): boolean {
  if (isDirectMediaUrl(value)) return true;
  const ext = path.extname(normalizePathForExtension(value));
  return isDirectMediaExtension(ext);
}

export function isPdfAssetPath(value: string): boolean {
  return path.extname(normalizePathForExtension(value)).toLowerCase() === ".pdf";
}

function isTranscribableMediaType(mediaType: string): boolean {
  const normalized = mediaType.toLowerCase();
  return normalized.startsWith("audio/") || normalized.startsWith("video/");
}

function createMediaInput({
  sourceKind,
  sourceLabel,
  filename,
  sizeBytes,
}: {
  sourceKind: "file" | "asset-url";
  sourceLabel: string;
  filename: string;
  sizeBytes: number | null;
}): AcquiredMediaInput {
  return {
    kind: "resolved-media",
    sourceKind,
    sourceLabel,
    attachment: {
      kind: "file",
      filename,
      mediaType: "audio/mpeg",
      bytes: new Uint8Array(0),
    },
    sizeBytes,
  };
}

export async function getLocalAssetSize(filePath: string): Promise<number | null> {
  return await fs
    .stat(filePath)
    .then((stat) => (stat.isFile() ? stat.size : null))
    .catch(() => null);
}

export async function acquireLocalAssetInput({
  filePath,
  maxBytes,
}: {
  filePath: string;
  maxBytes?: number;
}): Promise<AcquiredAssetInput> {
  if (isTranscribableAssetPath(filePath)) {
    const sizeBytes = await getLocalAssetSize(filePath);
    return createMediaInput({
      sourceKind: "file",
      sourceLabel: filePath,
      filename: path.basename(filePath),
      sizeBytes,
    });
  }

  const loaded = await loadLocalAsset({ filePath, maxBytes });
  assertAssetMediaTypeSupported({ attachment: loaded.attachment, sizeLabel: null });
  return {
    kind: isTranscribableMediaType(loaded.attachment.mediaType)
      ? "resolved-media"
      : "resolved-asset",
    sourceKind: "file",
    sourceLabel: loaded.sourceLabel,
    attachment: loaded.attachment,
    sizeBytes: loaded.attachment.bytes.byteLength,
  };
}

export async function resolveUrlAssetRoute({
  url,
  isYoutubeUrl,
  fetchImpl,
  timeoutMs,
  detectUnknownAssetUrls = true,
  assumeAsset = false,
}: {
  url: string;
  isYoutubeUrl: boolean;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  detectUnknownAssetUrls?: boolean;
  assumeAsset?: boolean;
}): Promise<UrlAssetRoute> {
  if (!url || isYoutubeUrl) return "none";
  if (isTranscribableAssetPath(url)) return isDirectVideoInput(url) ? "video" : "audio";
  if (!detectUnknownAssetUrls && !shouldProbeUnknownAssetUrl(url)) {
    return assumeAsset ? "asset" : "none";
  }

  const kind = await classifyUrl({ url, fetchImpl, timeoutMs });
  if (kind.kind === "media") return kind.mediaType.startsWith("video/") ? "video" : "audio";
  if (kind.kind === "asset") return "asset";
  return assumeAsset ? "asset" : "none";
}

export function createRemoteMediaInput(url: string): AcquiredMediaInput {
  let filename = "media";
  try {
    filename = path.basename(new URL(url).pathname) || filename;
  } catch {
    // Keep the stable fallback name.
  }
  return createMediaInput({
    sourceKind: "asset-url",
    sourceLabel: url,
    filename,
    sizeBytes: null,
  });
}

export async function acquireRemoteAssetInput({
  url,
  fetchImpl,
  timeoutMs,
}: {
  url: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
}): Promise<AcquiredAssetInput | null> {
  const loaded = await (async () => {
    try {
      return await loadRemoteAsset({ url, fetchImpl, timeoutMs });
    } catch (error) {
      if (error instanceof Error && /HTML/i.test(error.message)) {
        return null;
      }
      throw error;
    }
  })();
  if (!loaded) return null;

  assertAssetMediaTypeSupported({ attachment: loaded.attachment, sizeLabel: null });
  return {
    kind: isTranscribableMediaType(loaded.attachment.mediaType)
      ? "resolved-media"
      : "resolved-asset",
    sourceKind: "asset-url",
    sourceLabel: loaded.sourceLabel,
    attachment: loaded.attachment,
    sizeBytes: loaded.attachment.bytes.byteLength,
  };
}

export async function materializeAcquiredMediaInput(
  input: AcquiredMediaInput,
): Promise<MaterializedAcquiredInput> {
  const extension = mime.getExtension(input.attachment.mediaType);
  const rawFilename = path.basename(input.attachment.filename?.trim() || "media");
  const filename =
    path.extname(rawFilename) || !extension ? rawFilename : `${rawFilename}.${extension}`;
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "summarize-media-"));
  const filePath = path.join(tempDir, filename);
  const cleanup = async () => {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  };

  try {
    await fs.writeFile(filePath, input.attachment.bytes, {
      mode: 0o600,
      flag: "wx",
    });
  } catch (error) {
    await cleanup();
    throw error;
  }

  return { filePath, cleanup };
}
