import type { BrandAssetKind } from "./brand-assets";

export const MAX_BACKGROUND_REMOVED_BYTES = 20 * 1024 * 1024;

export type BackgroundRemovedCandidateKind =
  | "show-logo-background-removed-candidate"
  | "profile-photo-background-removed-candidate";

export interface BackgroundRemovalAssetLike {
  id: string;
  name: string;
  mimeType: string | null;
  appProperties: Record<string, string>;
}

export class BackgroundRemovalValidationError extends Error {
  constructor(
    public readonly code: string,
    public readonly status = 400,
  ) {
    super(code);
    this.name = "BackgroundRemovalValidationError";
  }
}

export const sourceBrandAssetKind = (
  file: BackgroundRemovalAssetLike,
): BrandAssetKind => {
  const kind = file.appProperties.assetKind;
  if (kind !== "show-logo-original" && kind !== "profile-photo-original") {
    throw new BackgroundRemovalValidationError("background_source_not_original", 409);
  }
  if (
    file.appProperties.original !== "true" ||
    file.appProperties.immutable !== "true" ||
    file.appProperties.folder !== "brand-assets"
  ) {
    throw new BackgroundRemovalValidationError("background_source_not_original", 409);
  }
  if (!file.mimeType || !["image/png", "image/jpeg", "image/webp"].includes(file.mimeType)) {
    throw new BackgroundRemovalValidationError("background_source_mime_not_supported", 415);
  }
  return kind;
};

export const candidateKindFor = (
  sourceKind: BrandAssetKind,
): BackgroundRemovedCandidateKind =>
  sourceKind === "show-logo-original"
    ? "show-logo-background-removed-candidate"
    : "profile-photo-background-removed-candidate";

export const backgroundRemovedFileName = (sourceName: string) => {
  const safe = sourceName
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/[\\/]/g, "_")
    .trim();
  const base = safe.replace(/\.[^.]+$/, "").trim() || "branding";
  return `${base.slice(0, 145)}.background-removed.png`;
};

export const assertBackgroundRemovedCandidate = (
  file: BackgroundRemovalAssetLike,
) => {
  const kind = file.appProperties.assetKind;
  if (
    kind !== "show-logo-background-removed-candidate" &&
    kind !== "profile-photo-background-removed-candidate"
  ) {
    throw new BackgroundRemovalValidationError("background_candidate_not_found", 404);
  }
  if (
    file.mimeType !== "image/png" ||
    file.appProperties.derived !== "true" ||
    file.appProperties.candidate !== "true" ||
    file.appProperties.immutable !== "true" ||
    file.appProperties.folder !== "brand-assets" ||
    file.appProperties.transformation !== "background-removal-v1" ||
    !file.appProperties.sourceAssetId
  ) {
    throw new BackgroundRemovalValidationError("background_candidate_not_found", 404);
  }
  return kind as BackgroundRemovedCandidateKind;
};

export const parseCandidatePreviewPath = (pathname: string) => {
  const prefix = "/api/branding/background-removal/candidates/";
  const suffix = "/preview";
  if (!pathname.startsWith(prefix) || !pathname.endsWith(suffix)) return null;
  const encodedId = pathname.slice(prefix.length, -suffix.length);
  if (!encodedId || encodedId.includes("/")) return null;
  let fileId: string;
  try {
    fileId = decodeURIComponent(encodedId);
  } catch {
    return null;
  }
  return /^[A-Za-z0-9_-]{1,200}$/.test(fileId) ? fileId : null;
};
