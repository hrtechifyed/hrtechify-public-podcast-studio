import { MAX_SMALL_DRIVE_UPLOAD_BYTES } from "./drive-upload";
import { decryptStorageToken, encryptStorageToken } from "./token-crypto";

export const RESUMABLE_CHUNK_GRANULARITY_BYTES = 256 * 1024;
export const MAX_RESUMABLE_CHUNK_BYTES = 8 * 1024 * 1024;
export const RESUMABLE_UPLOAD_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

export const RESUMABLE_RECORDING_MIME_TYPES = new Set([
  "audio/mpeg",
  "audio/wav",
  "audio/webm",
  "audio/mp4",
  "audio/x-m4a",
  "video/webm",
  "video/mp4",
]);

export interface ResumableUploadStartInput {
  showId: string;
  connectionId: string;
  fileName: string;
  mimeType: string;
  totalBytes: number;
}

export interface ResumableUploadTokenPayload extends ResumableUploadStartInput {
  version: 1;
  sessionUrl: string;
  issuedAt: number;
  expiresAt: number;
}

export interface ParsedChunkRange {
  start: number;
  end: number;
  totalBytes: number;
  length: number;
  isFinal: boolean;
}

export class ResumableUploadValidationError extends Error {
  constructor(
    public readonly code: string,
    public readonly status = 400,
  ) {
    super(code);
    this.name = "ResumableUploadValidationError";
  }
}

const requiredString = (value: unknown, code: string) => {
  if (typeof value !== "string" || !value.trim()) {
    throw new ResumableUploadValidationError(code);
  }
  return value.trim();
};

const validateFileName = (value: unknown) => {
  const fileName = requiredString(value, "file_name_required");
  if (fileName.length > 180) {
    throw new ResumableUploadValidationError("file_name_too_long");
  }
  if (
    fileName === "." ||
    fileName === ".." ||
    fileName.includes("/") ||
    fileName.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(fileName)
  ) {
    throw new ResumableUploadValidationError("file_name_invalid");
  }
  return fileName;
};

export const parseResumableUploadStartBody = (
  body: Record<string, unknown>,
): ResumableUploadStartInput => {
  const showId = requiredString(body.showId, "show_id_required");
  const connectionId = requiredString(body.connectionId, "storage_connection_id_required");
  const fileName = validateFileName(body.fileName);
  const mimeType = requiredString(body.mimeType, "mime_type_required").toLowerCase();
  if (!RESUMABLE_RECORDING_MIME_TYPES.has(mimeType)) {
    throw new ResumableUploadValidationError("mime_type_not_allowed");
  }

  const totalBytes = body.totalBytes;
  if (
    typeof totalBytes !== "number" ||
    !Number.isSafeInteger(totalBytes) ||
    totalBytes <= MAX_SMALL_DRIVE_UPLOAD_BYTES
  ) {
    throw new ResumableUploadValidationError("resumable_total_bytes_invalid");
  }

  return {
    showId,
    connectionId,
    fileName,
    mimeType,
    totalBytes,
  };
};

const validateSessionUrl = (value: unknown) => {
  if (typeof value !== "string" || !value) {
    throw new ResumableUploadValidationError("resumable_session_invalid", 401);
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ResumableUploadValidationError("resumable_session_invalid", 401);
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "www.googleapis.com" ||
    !url.pathname.startsWith("/upload/drive/v3/files")
  ) {
    throw new ResumableUploadValidationError("resumable_session_invalid", 401);
  }
  return url.toString();
};

const validateTokenPayload = (value: unknown): ResumableUploadTokenPayload => {
  if (!value || typeof value !== "object") {
    throw new ResumableUploadValidationError("resumable_upload_token_invalid", 401);
  }
  const payload = value as Record<string, unknown>;
  if (payload.version !== 1) {
    throw new ResumableUploadValidationError("resumable_upload_token_invalid", 401);
  }

  const start = parseResumableUploadStartBody(payload);
  const issuedAt = payload.issuedAt;
  const expiresAt = payload.expiresAt;
  if (
    typeof issuedAt !== "number" ||
    typeof expiresAt !== "number" ||
    !Number.isSafeInteger(issuedAt) ||
    !Number.isSafeInteger(expiresAt)
  ) {
    throw new ResumableUploadValidationError("resumable_upload_token_invalid", 401);
  }
  if (expiresAt <= Date.now()) {
    throw new ResumableUploadValidationError("resumable_upload_token_expired", 410);
  }
  if (issuedAt > Date.now() + 5 * 60 * 1000 || expiresAt <= issuedAt) {
    throw new ResumableUploadValidationError("resumable_upload_token_invalid", 401);
  }

  return {
    version: 1,
    ...start,
    sessionUrl: validateSessionUrl(payload.sessionUrl),
    issuedAt,
    expiresAt,
  };
};

export const createResumableUploadToken = async (
  input: ResumableUploadStartInput & { sessionUrl: string },
  secret: string,
  userId: string,
  now = Date.now(),
) => {
  const payload: ResumableUploadTokenPayload = {
    version: 1,
    ...input,
    sessionUrl: validateSessionUrl(input.sessionUrl),
    issuedAt: now,
    expiresAt: now + RESUMABLE_UPLOAD_TOKEN_TTL_MS,
  };
  return encryptStorageToken(
    JSON.stringify(payload),
    secret,
    `drive-resumable:${userId}`,
  );
};

export const readResumableUploadToken = async (
  token: string,
  secret: string,
  userId: string,
) => {
  if (!token.trim()) {
    throw new ResumableUploadValidationError("resumable_upload_token_required", 400);
  }
  let plaintext: string;
  try {
    plaintext = await decryptStorageToken(token, secret, `drive-resumable:${userId}`);
  } catch {
    throw new ResumableUploadValidationError("resumable_upload_token_invalid", 401);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(plaintext);
  } catch {
    throw new ResumableUploadValidationError("resumable_upload_token_invalid", 401);
  }
  return validateTokenPayload(parsed);
};

export const parseResumableContentRange = (
  contentRange: string | null,
  contentLength: string | null,
  expectedTotalBytes: number,
): ParsedChunkRange => {
  if (!contentRange) {
    throw new ResumableUploadValidationError("content_range_required");
  }
  if (!contentLength || !/^\d+$/.test(contentLength)) {
    throw new ResumableUploadValidationError("content_length_required");
  }

  const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(contentRange.trim());
  if (!match) {
    throw new ResumableUploadValidationError("content_range_invalid");
  }

  const start = Number(match[1]);
  const end = Number(match[2]);
  const totalBytes = Number(match[3]);
  const declaredLength = Number(contentLength);
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    !Number.isSafeInteger(totalBytes) ||
    !Number.isSafeInteger(declaredLength) ||
    start < 0 ||
    end < start ||
    totalBytes !== expectedTotalBytes ||
    end >= totalBytes
  ) {
    throw new ResumableUploadValidationError("content_range_invalid");
  }

  const length = end - start + 1;
  if (declaredLength !== length) {
    throw new ResumableUploadValidationError("content_length_mismatch");
  }
  if (length > MAX_RESUMABLE_CHUNK_BYTES) {
    throw new ResumableUploadValidationError("resumable_chunk_too_large", 413);
  }

  const isFinal = end === totalBytes - 1;
  if (!isFinal) {
    if (
      start % RESUMABLE_CHUNK_GRANULARITY_BYTES !== 0 ||
      length % RESUMABLE_CHUNK_GRANULARITY_BYTES !== 0
    ) {
      throw new ResumableUploadValidationError("resumable_chunk_alignment_invalid");
    }
  }

  return { start, end, totalBytes, length, isFinal };
};

export const nextOffsetFromGoogleRange = (rangeHeader: string | null) => {
  if (!rangeHeader) return null;
  const match = /^bytes=0-(\d+)$/.exec(rangeHeader.trim());
  if (!match) return null;
  const lastByte = Number(match[1]);
  if (!Number.isSafeInteger(lastByte) || lastByte < 0) return null;
  return lastByte + 1;
};
