import type { WorkerEnv } from "./db";
import { nextOffsetFromGoogleRange } from "./drive-resumable";
import { createGoogleDriveSession, GoogleDriveError, type GoogleDriveStoredFile } from "./google-drive";
import type { BrandMediaAssetKind } from "./brand-media-resumable";
import type { StorageConnectionRow } from "./storage-store";
import { decryptStorageToken } from "./token-crypto";

const DRIVE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
const DRIVE_FILE_FIELDS = "id,name,mimeType,size,webViewLink,parents,appProperties,trashed,capabilities(canDownload)";

interface GoogleTokenResponse {
  access_token?: string;
}

interface DriveFileResponse {
  id: string;
  name: string;
  mimeType?: string;
  size?: string;
  webViewLink?: string;
  parents?: string[];
  appProperties?: Record<string, string>;
  capabilities?: { canDownload?: boolean };
}

export interface ResumableChunkResult {
  complete: boolean;
  nextOffset: number | null;
  file: GoogleDriveStoredFile | null;
}

const refreshAccessToken = async (
  env: WorkerEnv,
  userId: string,
  connection: StorageConnectionRow,
) => {
  if (!env.GOOGLE_DRIVE_CLIENT_ID || !env.GOOGLE_DRIVE_CLIENT_SECRET || !env.TOKEN_ENCRYPTION_KEY) {
    throw new GoogleDriveError("google_drive_not_configured", 503);
  }
  if (connection.provider !== "google-drive" || connection.status !== "active") {
    throw new GoogleDriveError("google_drive_connection_inactive", 409);
  }

  let refreshToken: string;
  try {
    refreshToken = await decryptStorageToken(
      connection.refresh_token_encrypted,
      env.TOKEN_ENCRYPTION_KEY,
      `storage:${userId}:google-drive:${connection.provider_account_id}`,
    );
  } catch {
    throw new GoogleDriveError("google_drive_token_decryption_failed", 500);
  }

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_DRIVE_CLIENT_ID,
      client_secret: env.GOOGLE_DRIVE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!response.ok) {
    throw new GoogleDriveError("google_drive_access_token_failed", 502);
  }
  const token = (await response.json()) as GoogleTokenResponse;
  if (!token.access_token) {
    throw new GoogleDriveError("google_drive_access_token_missing", 502);
  }
  return token.access_token;
};

const responseError = (response: Response) => {
  if (response.status === 401) return new GoogleDriveError("google_drive_authorization_expired", 401);
  if (response.status === 403) return new GoogleDriveError("google_drive_permission_denied", 403);
  if (response.status === 404 || response.status === 410) {
    return new GoogleDriveError("google_drive_resumable_session_expired", 410);
  }
  if (response.status === 429) return new GoogleDriveError("google_drive_rate_limited", 429);
  if (response.status >= 500) return new GoogleDriveError("google_drive_resumable_retryable", 503);
  return new GoogleDriveError("google_drive_resumable_failed", 502);
};

const serializeFile = (file: DriveFileResponse): GoogleDriveStoredFile => {
  const parsedSize = file.size ? Number(file.size) : null;
  return {
    id: file.id,
    name: file.name,
    mimeType: file.mimeType ?? null,
    sizeBytes: parsedSize !== null && Number.isFinite(parsedSize) ? parsedSize : null,
    webViewLink: file.webViewLink ?? null,
    parents: file.parents ?? [],
    appProperties: file.appProperties ?? {},
    canDownload: file.capabilities?.canDownload === true,
  };
};

const validateReturnedSessionUrl = (value: string | null) => {
  if (!value) throw new GoogleDriveError("google_drive_resumable_session_missing", 502);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new GoogleDriveError("google_drive_resumable_session_invalid", 502);
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "www.googleapis.com" ||
    !url.pathname.startsWith("/upload/drive/v3/files")
  ) {
    throw new GoogleDriveError("google_drive_resumable_session_invalid", 502);
  }
  return url.toString();
};

export const startGoogleDriveResumableUpload = async (
  env: WorkerEnv,
  userId: string,
  connection: StorageConnectionRow,
  input: {
    showId: string;
    showName: string;
    fileName: string;
    mimeType: string;
    totalBytes: number;
  },
) => {
  const drive = await createGoogleDriveSession(env, userId, connection);
  const workspace = await drive.ensureShowWorkspace(input.showId, input.showName);
  const accessToken = await refreshAccessToken(env, userId, connection);

  const url = new URL(`${DRIVE_UPLOAD_API}/files`);
  url.searchParams.set("uploadType", "resumable");
  url.searchParams.set("fields", DRIVE_FILE_FIELDS);

  const response = await fetch(url.toString(), {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json; charset=UTF-8",
      "x-upload-content-type": input.mimeType,
      "x-upload-content-length": String(input.totalBytes),
    },
    body: JSON.stringify({
      name: input.fileName,
      parents: [workspace.folders.episodes],
      appProperties: {
        hrtechifyStudio: "v1",
        role: "asset",
        showId: input.showId,
        folder: "episodes",
        assetKind: "original-recording",
        immutable: "true",
      },
    }),
  });
  if (!response.ok) throw responseError(response);

  return {
    sessionUrl: validateReturnedSessionUrl(response.headers.get("location")),
  };
};

export const startGoogleDriveBrandMediaResumableUpload = async (
  env: WorkerEnv,
  userId: string,
  connection: StorageConnectionRow,
  input: {
    showId: string;
    showName: string;
    assetKind: BrandMediaAssetKind;
    fileName: string;
    mimeType: string;
    totalBytes: number;
  },
) => {
  const drive = await createGoogleDriveSession(env, userId, connection);
  const workspace = await drive.ensureShowWorkspace(input.showId, input.showName);
  const accessToken = await refreshAccessToken(env, userId, connection);
  const url = new URL(`${DRIVE_UPLOAD_API}/files`);
  url.searchParams.set("uploadType", "resumable");
  url.searchParams.set("fields", DRIVE_FILE_FIELDS);

  const response = await fetch(url.toString(), {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json; charset=UTF-8",
      "x-upload-content-type": input.mimeType,
      "x-upload-content-length": String(input.totalBytes),
    },
    body: JSON.stringify({
      name: input.fileName,
      parents: [workspace.folders.brandAssets],
      appProperties: {
        hrtechifyStudio: "v1",
        role: "asset",
        showId: input.showId,
        folder: "brand-assets",
        assetKind: input.assetKind,
        original: "true",
        immutable: "true",
      },
    }),
  });
  if (!response.ok) throw responseError(response);
  return {
    sessionUrl: validateReturnedSessionUrl(response.headers.get("location")),
  };
};

export const uploadGoogleDriveResumableChunk = async (
  env: WorkerEnv,
  userId: string,
  connection: StorageConnectionRow,
  input: {
    sessionUrl: string;
    contentRange: string;
    contentLength: number;
    mimeType: string;
    body: ArrayBuffer;
  },
): Promise<ResumableChunkResult> => {
  if (input.body.byteLength !== input.contentLength) {
    throw new GoogleDriveError("resumable_chunk_body_length_mismatch", 400);
  }
  const accessToken = await refreshAccessToken(env, userId, connection);
  const response = await fetch(input.sessionUrl, {
    method: "PUT",
    redirect: "manual",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": input.mimeType,
      "content-length": String(input.contentLength),
      "content-range": input.contentRange,
    },
    body: input.body,
  });

  if (response.status === 308) {
    return {
      complete: false,
      nextOffset: nextOffsetFromGoogleRange(response.headers.get("range")),
      file: null,
    };
  }
  if (!response.ok) throw responseError(response);

  const file = serializeFile((await response.json()) as DriveFileResponse);
  return {
    complete: true,
    nextOffset: file.sizeBytes,
    file,
  };
};

export const queryGoogleDriveResumableStatus = async (
  env: WorkerEnv,
  userId: string,
  connection: StorageConnectionRow,
  input: {
    sessionUrl: string;
    totalBytes: number;
  },
): Promise<ResumableChunkResult> => {
  const accessToken = await refreshAccessToken(env, userId, connection);
  const response = await fetch(input.sessionUrl, {
    method: "PUT",
    redirect: "manual",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-length": "0",
      "content-range": `bytes */${input.totalBytes}`,
    },
  });

  if (response.status === 308) {
    return {
      complete: false,
      nextOffset: nextOffsetFromGoogleRange(response.headers.get("range")) ?? 0,
      file: null,
    };
  }
  if (!response.ok) throw responseError(response);

  const file = serializeFile((await response.json()) as DriveFileResponse);
  return {
    complete: true,
    nextOffset: file.sizeBytes,
    file,
  };
};
