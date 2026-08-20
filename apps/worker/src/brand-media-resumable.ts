import { decryptStorageToken, encryptStorageToken } from "./token-crypto";

export const MAX_BRAND_MEDIA_BYTES = 500 * 1024 * 1024;
export const BRAND_MEDIA_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

export const BRAND_MEDIA_MIME_TYPES = new Set([
  "audio/mpeg",
  "audio/wav",
  "audio/webm",
  "audio/mp4",
  "audio/x-m4a",
  "video/webm",
  "video/mp4",
]);

export type BrandMediaAssetKind = "show-intro-original" | "show-outro-original";

export interface BrandMediaStartInput {
  showId: string;
  connectionId: string;
  assetKind: BrandMediaAssetKind;
  fileName: string;
  mimeType: string;
  totalBytes: number;
}

export interface BrandMediaUploadTokenPayload extends BrandMediaStartInput {
  version: 1;
  sessionUrl: string;
  issuedAt: number;
  expiresAt: number;
}

export class BrandMediaValidationError extends Error {
  constructor(
    public readonly code: string,
    public readonly status = 400,
  ) {
    super(code);
    this.name = "BrandMediaValidationError";
  }
}

const requiredString = (value: unknown, code: string) => {
  if (typeof value !== "string" || !value.trim()) throw new BrandMediaValidationError(code);
  return value.trim();
};

const safeFileName = (value: unknown) => {
  const fileName = requiredString(value, "file_name_required");
  if (fileName.length > 180) throw new BrandMediaValidationError("file_name_too_long");
  if (
    fileName === "." ||
    fileName === ".." ||
    fileName.includes("/") ||
    fileName.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(fileName)
  ) {
    throw new BrandMediaValidationError("file_name_invalid");
  }
  return fileName;
};

export const parseBrandMediaStartBody = (body: Record<string, unknown>): BrandMediaStartInput => {
  const showId = requiredString(body.showId, "show_id_required");
  const connectionId = requiredString(body.connectionId, "storage_connection_id_required");
  const fileName = safeFileName(body.fileName);
  const mimeType = requiredString(body.mimeType, "mime_type_required").toLowerCase();
  if (!BRAND_MEDIA_MIME_TYPES.has(mimeType)) {
    throw new BrandMediaValidationError("brand_media_mime_type_not_allowed", 415);
  }

  const assetKind = body.assetKind;
  if (assetKind !== "show-intro-original" && assetKind !== "show-outro-original") {
    throw new BrandMediaValidationError("brand_media_asset_kind_invalid");
  }

  const totalBytes = body.totalBytes;
  if (
    typeof totalBytes !== "number" ||
    !Number.isSafeInteger(totalBytes) ||
    totalBytes <= 0
  ) {
    throw new BrandMediaValidationError("brand_media_total_bytes_invalid");
  }
  if (totalBytes > MAX_BRAND_MEDIA_BYTES) {
    throw new BrandMediaValidationError("brand_media_too_large", 413);
  }

  return { showId, connectionId, assetKind, fileName, mimeType, totalBytes };
};

const validateSessionUrl = (value: unknown) => {
  if (typeof value !== "string" || !value) {
    throw new BrandMediaValidationError("brand_media_upload_token_invalid", 401);
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new BrandMediaValidationError("brand_media_upload_token_invalid", 401);
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "www.googleapis.com" ||
    !url.pathname.startsWith("/upload/drive/v3/files")
  ) {
    throw new BrandMediaValidationError("brand_media_upload_token_invalid", 401);
  }
  return url.toString();
};

export const createBrandMediaUploadToken = async (
  input: BrandMediaStartInput & { sessionUrl: string },
  secret: string,
  userId: string,
  now = Date.now(),
) => {
  const payload: BrandMediaUploadTokenPayload = {
    version: 1,
    ...input,
    sessionUrl: validateSessionUrl(input.sessionUrl),
    issuedAt: now,
    expiresAt: now + BRAND_MEDIA_TOKEN_TTL_MS,
  };
  return encryptStorageToken(JSON.stringify(payload), secret, `brand-media-resumable:${userId}`);
};

export const readBrandMediaUploadToken = async (
  token: string,
  secret: string,
  userId: string,
): Promise<BrandMediaUploadTokenPayload> => {
  if (!token.trim()) throw new BrandMediaValidationError("brand_media_upload_token_required");
  let plaintext: string;
  try {
    plaintext = await decryptStorageToken(token, secret, `brand-media-resumable:${userId}`);
  } catch {
    throw new BrandMediaValidationError("brand_media_upload_token_invalid", 401);
  }

  let value: unknown;
  try {
    value = JSON.parse(plaintext);
  } catch {
    throw new BrandMediaValidationError("brand_media_upload_token_invalid", 401);
  }
  if (!value || typeof value !== "object") {
    throw new BrandMediaValidationError("brand_media_upload_token_invalid", 401);
  }
  const raw = value as Record<string, unknown>;
  if (raw.version !== 1) throw new BrandMediaValidationError("brand_media_upload_token_invalid", 401);
  const start = parseBrandMediaStartBody(raw);
  if (
    typeof raw.issuedAt !== "number" ||
    !Number.isSafeInteger(raw.issuedAt) ||
    typeof raw.expiresAt !== "number" ||
    !Number.isSafeInteger(raw.expiresAt)
  ) {
    throw new BrandMediaValidationError("brand_media_upload_token_invalid", 401);
  }
  if (raw.expiresAt <= Date.now()) {
    throw new BrandMediaValidationError("brand_media_upload_token_expired", 410);
  }
  if (raw.issuedAt > Date.now() + 5 * 60 * 1000 || raw.expiresAt <= raw.issuedAt) {
    throw new BrandMediaValidationError("brand_media_upload_token_invalid", 401);
  }
  return {
    version: 1,
    ...start,
    sessionUrl: validateSessionUrl(raw.sessionUrl),
    issuedAt: raw.issuedAt,
    expiresAt: raw.expiresAt,
  };
};
