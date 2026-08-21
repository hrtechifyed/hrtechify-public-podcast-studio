import type { WorkerEnv } from "./db";
import type { StorageConnectionRow } from "./storage-store";
import { decryptStorageToken } from "./token-crypto";

const DROPBOX_CONTENT_API = "https://content.dropboxapi.com/2";

interface DropboxTokenResponse { access_token?: string }
interface DropboxSessionStartResponse { session_id?: string }
interface DropboxMetadata {
  ".tag"?: string;
  id?: string;
  name?: string;
  path_lower?: string;
  size?: number;
  is_downloadable?: boolean;
  content_hash?: string;
}

export interface DropboxResumableResult {
  complete: boolean;
  nextOffset: number;
  file?: {
    id: string;
    name: string;
    sizeBytes: number;
    pathLower: string;
    canDownload: boolean;
    contentHash: string | null;
  };
}

export class DropboxResumableError extends Error {
  constructor(
    public readonly code: string,
    public readonly status = 502,
  ) {
    super(code);
    this.name = "DropboxResumableError";
  }
}

const accessToken = async (
  env: WorkerEnv,
  userId: string,
  connection: StorageConnectionRow,
) => {
  if (!env.DROPBOX_CLIENT_ID || !env.DROPBOX_CLIENT_SECRET || !env.TOKEN_ENCRYPTION_KEY) {
    throw new DropboxResumableError("dropbox_not_configured", 503);
  }
  if (connection.provider !== "dropbox" || connection.status !== "active") {
    throw new DropboxResumableError("dropbox_connection_inactive", 409);
  }
  let refreshToken: string;
  try {
    refreshToken = await decryptStorageToken(
      connection.refresh_token_encrypted,
      env.TOKEN_ENCRYPTION_KEY,
      `storage:${userId}:dropbox:${connection.provider_account_id}`,
    );
  } catch {
    throw new DropboxResumableError("dropbox_token_decryption_failed", 500);
  }
  const response = await fetch("https://api.dropboxapi.com/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: env.DROPBOX_CLIENT_ID,
      client_secret: env.DROPBOX_CLIENT_SECRET,
    }),
  });
  if (!response.ok) throw new DropboxResumableError("dropbox_access_token_failed", response.status === 401 ? 401 : 502);
  const token = (await response.json()) as DropboxTokenResponse;
  if (!token.access_token) throw new DropboxResumableError("dropbox_access_token_missing", 502);
  return token.access_token;
};

const findCorrectOffset = (value: unknown): number | null => {
  if (!value || typeof value !== "object") return null;
  const object = value as Record<string, unknown>;
  const direct = object.correct_offset;
  if (typeof direct === "number" && Number.isSafeInteger(direct) && direct >= 0) return direct;
  for (const nested of Object.values(object)) {
    const result = findCorrectOffset(nested);
    if (result !== null) return result;
  }
  return null;
};

const errorOrOffset = async (response: Response): Promise<number | DropboxResumableError> => {
  let payload: unknown = null;
  try { payload = await response.clone().json(); } catch { payload = null; }
  const correctOffset = findCorrectOffset(payload);
  if (correctOffset !== null) return correctOffset;
  if (response.status === 401) return new DropboxResumableError("dropbox_authorization_expired", 401);
  if (response.status === 403) return new DropboxResumableError("dropbox_permission_denied", 403);
  if (response.status === 409) return new DropboxResumableError("dropbox_upload_session_conflict", 409);
  if (response.status === 429) return new DropboxResumableError("dropbox_rate_limited", 429);
  if (response.status >= 500) return new DropboxResumableError("dropbox_retryable", 503);
  return new DropboxResumableError("dropbox_api_failed", 502);
};

const contentCall = async (
  token: string,
  endpoint: string,
  arg: unknown,
  body: ArrayBuffer,
) => fetch(`${DROPBOX_CONTENT_API}${endpoint}`, {
  method: "POST",
  headers: {
    authorization: `Bearer ${token}`,
    "content-type": "application/octet-stream",
    "dropbox-api-arg": JSON.stringify(arg),
  },
  body,
});

export const startDropboxResumableSession = async (
  env: WorkerEnv,
  userId: string,
  connection: StorageConnectionRow,
) => {
  const token = await accessToken(env, userId, connection);
  const response = await contentCall(token, "/files/upload_session/start", { close: false }, new ArrayBuffer(0));
  if (!response.ok) {
    const error = await errorOrOffset(response);
    throw error instanceof DropboxResumableError ? error : new DropboxResumableError("dropbox_upload_session_start_failed", 502);
  }
  const payload = (await response.json()) as DropboxSessionStartResponse;
  if (!payload.session_id || payload.session_id.length > 500) {
    throw new DropboxResumableError("dropbox_upload_session_missing", 502);
  }
  return payload.session_id;
};

const serializeCompleted = (metadata: DropboxMetadata, totalBytes: number): DropboxResumableResult => {
  if (
    metadata[".tag"] !== "file" ||
    !metadata.id ||
    !metadata.name ||
    !metadata.path_lower ||
    !Number.isSafeInteger(metadata.size) ||
    metadata.size !== totalBytes
  ) {
    throw new DropboxResumableError("dropbox_upload_completion_invalid", 502);
  }
  return {
    complete: true,
    nextOffset: totalBytes,
    file: {
      id: metadata.id.replace(/^id:/, ""),
      name: metadata.name,
      sizeBytes: metadata.size,
      pathLower: metadata.path_lower,
      canDownload: metadata.is_downloadable !== false,
      contentHash: metadata.content_hash ?? null,
    },
  };
};

export const uploadDropboxResumableChunk = async (
  env: WorkerEnv,
  userId: string,
  connection: StorageConnectionRow,
  input: {
    sessionId: string;
    destinationPath: string;
    start: number;
    totalBytes: number;
    body: ArrayBuffer;
  },
): Promise<DropboxResumableResult> => {
  const token = await accessToken(env, userId, connection);
  const nextOffset = input.start + input.body.byteLength;
  const final = nextOffset === input.totalBytes;
  const endpoint = final ? "/files/upload_session/finish" : "/files/upload_session/append_v2";
  const arg = final
    ? {
        cursor: { session_id: input.sessionId, offset: input.start },
        commit: {
          path: input.destinationPath,
          mode: "add",
          autorename: true,
          mute: true,
          strict_conflict: true,
        },
      }
    : {
        cursor: { session_id: input.sessionId, offset: input.start },
        close: false,
      };
  const response = await contentCall(token, endpoint, arg, input.body);
  if (!response.ok) {
    const parsed = await errorOrOffset(response);
    if (typeof parsed === "number") return { complete: false, nextOffset: parsed };
    throw parsed;
  }
  if (!final) return { complete: false, nextOffset };
  return serializeCompleted((await response.json()) as DropboxMetadata, input.totalBytes);
};
