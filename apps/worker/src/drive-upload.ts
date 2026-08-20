export const MAX_SMALL_DRIVE_UPLOAD_BYTES = 1024 * 1024;

export const SMALL_DRIVE_UPLOAD_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "audio/mpeg",
  "audio/wav",
  "audio/webm",
  "video/webm",
  "application/json",
  "text/plain",
]);

export type SmallDriveUploadFolder = "brand-assets" | "episodes";

export interface SmallDriveUploadInput {
  showId: string;
  connectionId: string;
  folder: SmallDriveUploadFolder;
  fileName: string;
  mimeType: string;
  bytes: Uint8Array;
}

export class SmallDriveUploadValidationError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "SmallDriveUploadValidationError";
  }
}

const requiredString = (value: unknown, code: string) => {
  if (typeof value !== "string" || !value.trim()) {
    throw new SmallDriveUploadValidationError(code);
  }
  return value.trim();
};

const validateFileName = (value: unknown) => {
  const fileName = requiredString(value, "file_name_required");
  if (fileName.length > 180) {
    throw new SmallDriveUploadValidationError("file_name_too_long");
  }
  if (
    fileName === "." ||
    fileName === ".." ||
    fileName.includes("/") ||
    fileName.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(fileName)
  ) {
    throw new SmallDriveUploadValidationError("file_name_invalid");
  }
  return fileName;
};

const decodeBase64 = (value: unknown) => {
  const contentBase64 = requiredString(value, "content_base64_required");
  const maxEncodedLength = Math.ceil(MAX_SMALL_DRIVE_UPLOAD_BYTES / 3) * 4 + 4;
  if (contentBase64.length > maxEncodedLength) {
    throw new SmallDriveUploadValidationError("file_too_large");
  }
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(contentBase64) || contentBase64.length % 4 !== 0) {
    throw new SmallDriveUploadValidationError("content_base64_invalid");
  }

  let binary: string;
  try {
    binary = atob(contentBase64);
  } catch {
    throw new SmallDriveUploadValidationError("content_base64_invalid");
  }

  if (binary.length > MAX_SMALL_DRIVE_UPLOAD_BYTES) {
    throw new SmallDriveUploadValidationError("file_too_large");
  }

  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
};

export const parseSmallDriveUploadBody = (body: Record<string, unknown>): SmallDriveUploadInput => {
  const showId = requiredString(body.showId, "show_id_required");
  const connectionId = requiredString(body.connectionId, "storage_connection_id_required");
  const fileName = validateFileName(body.fileName);
  const mimeType = requiredString(body.mimeType, "mime_type_required").toLowerCase();
  if (!SMALL_DRIVE_UPLOAD_MIME_TYPES.has(mimeType)) {
    throw new SmallDriveUploadValidationError("mime_type_not_allowed");
  }

  const folder = body.folder;
  if (folder !== "brand-assets" && folder !== "episodes") {
    throw new SmallDriveUploadValidationError("drive_folder_invalid");
  }

  const bytes = decodeBase64(body.contentBase64);
  if (bytes.byteLength === 0) {
    throw new SmallDriveUploadValidationError("file_empty");
  }

  return {
    showId,
    connectionId,
    folder,
    fileName,
    mimeType,
    bytes,
  };
};

export interface DriveMultipartInput {
  boundary: string;
  metadata: Record<string, unknown>;
  mimeType: string;
  bytes: Uint8Array;
}

export const buildDriveMultipartUpload = ({
  boundary,
  metadata,
  mimeType,
  bytes,
}: DriveMultipartInput) => {
  if (!/^[A-Za-z0-9_-]{12,120}$/.test(boundary)) {
    throw new SmallDriveUploadValidationError("multipart_boundary_invalid");
  }

  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,
    JSON.stringify(metadata),
    `\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`,
    bytes,
    `\r\n--${boundary}--\r\n`,
  ]);

  return {
    body,
    contentType: `multipart/related; boundary=${boundary}`,
  };
};
