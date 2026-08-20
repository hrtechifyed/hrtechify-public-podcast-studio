export const MAX_BRAND_ASSET_BYTES = 8 * 1024 * 1024;

export const BRAND_ASSET_KINDS = new Set([
  "show-logo-original",
  "profile-photo-original",
] as const);

export const BRAND_IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
]);

export type BrandAssetKind = "show-logo-original" | "profile-photo-original";

export interface BrandAssetUploadInput {
  showId: string;
  connectionId: string;
  assetKind: BrandAssetKind;
  fileName: string;
  mimeType: string;
  contentLength: number;
}

export class BrandAssetValidationError extends Error {
  constructor(
    public readonly code: string,
    public readonly status = 400,
  ) {
    super(code);
    this.name = "BrandAssetValidationError";
  }
}

const requiredString = (value: unknown, code: string) => {
  if (typeof value !== "string" || !value.trim()) {
    throw new BrandAssetValidationError(code);
  }
  return value.trim();
};

const safeFileName = (value: unknown) => {
  const fileName = requiredString(value, "file_name_required");
  if (fileName.length > 180) throw new BrandAssetValidationError("file_name_too_long");
  if (
    fileName === "." ||
    fileName === ".." ||
    fileName.includes("/") ||
    fileName.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(fileName)
  ) {
    throw new BrandAssetValidationError("file_name_invalid");
  }
  return fileName;
};

export const parseBrandAssetUploadInput = (input: {
  showId: unknown;
  connectionId: unknown;
  assetKind: unknown;
  fileName: unknown;
  mimeType: unknown;
  contentLength: unknown;
}): BrandAssetUploadInput => {
  const showId = requiredString(input.showId, "show_id_required");
  const connectionId = requiredString(input.connectionId, "storage_connection_id_required");
  const fileName = safeFileName(input.fileName);
  const mimeType = requiredString(input.mimeType, "mime_type_required").toLowerCase();
  if (!BRAND_IMAGE_MIME_TYPES.has(mimeType)) {
    throw new BrandAssetValidationError("brand_asset_mime_type_not_allowed");
  }

  const assetKind = input.assetKind;
  if (
    assetKind !== "show-logo-original" &&
    assetKind !== "profile-photo-original"
  ) {
    throw new BrandAssetValidationError("brand_asset_kind_invalid");
  }

  const contentLength = typeof input.contentLength === "string"
    ? Number(input.contentLength)
    : input.contentLength;
  if (
    typeof contentLength !== "number" ||
    !Number.isSafeInteger(contentLength) ||
    contentLength <= 0
  ) {
    throw new BrandAssetValidationError("content_length_required");
  }
  if (contentLength > MAX_BRAND_ASSET_BYTES) {
    throw new BrandAssetValidationError("brand_asset_too_large", 413);
  }

  return {
    showId,
    connectionId,
    assetKind,
    fileName,
    mimeType,
    contentLength,
  };
};
