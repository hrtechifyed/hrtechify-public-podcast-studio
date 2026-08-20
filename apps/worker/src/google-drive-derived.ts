import type { WorkerEnv } from "./db";
import { createGoogleDriveSession, GoogleDriveError, type GoogleDriveStoredFile } from "./google-drive";
import type { StorageConnectionRow } from "./storage-store";
import { decryptStorageToken } from "./token-crypto";

const DRIVE_API = "https://www.googleapis.com/drive/v3";
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

interface DriveFileListResponse {
  files?: DriveFileResponse[];
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
  if (!response.ok) throw new GoogleDriveError("google_drive_access_token_failed", 502);
  const token = (await response.json()) as GoogleTokenResponse;
  if (!token.access_token) throw new GoogleDriveError("google_drive_access_token_missing", 502);
  return token.access_token;
};

const responseError = (response: Response) => {
  if (response.status === 401) return new GoogleDriveError("google_drive_authorization_expired", 401);
  if (response.status === 403) return new GoogleDriveError("google_drive_permission_denied", 403);
  if (response.status === 404 || response.status === 410) return new GoogleDriveError("google_drive_resource_not_found", 404);
  if (response.status === 429) return new GoogleDriveError("google_drive_rate_limited", 429);
  if (response.status >= 500) return new GoogleDriveError("google_drive_retryable", 503);
  return new GoogleDriveError("google_drive_api_failed", 502);
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

const qEscape = (value: string) => value.replaceAll("\\", "\\\\").replaceAll("'", "\\'");

const validateSessionUrl = (value: string | null) => {
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

export const findGoogleDriveDerivedRenderOutput = async (
  env: WorkerEnv,
  userId: string,
  connection: StorageConnectionRow,
  input: { showId: string; showName: string; renderJobId: string },
): Promise<GoogleDriveStoredFile | null> => {
  const drive = await createGoogleDriveSession(env, userId, connection);
  const workspace = await drive.ensureShowWorkspace(input.showId, input.showName);
  const accessToken = await refreshAccessToken(env, userId, connection);
  const query = [
    "trashed=false",
    `'${qEscape(workspace.folders.episodes)}' in parents`,
    "appProperties has { key='hrtechifyStudio' and value='v1' }",
    "appProperties has { key='role' and value='asset' }",
    `appProperties has { key='showId' and value='${qEscape(input.showId)}' }`,
    "appProperties has { key='folder' and value='episodes' }",
    "appProperties has { key='assetKind' and value='derived-technical-master' }",
    `appProperties has { key='renderJobId' and value='${qEscape(input.renderJobId)}' }`,
  ].join(" and ");
  const url = new URL(`${DRIVE_API}/files`);
  url.searchParams.set("q", query);
  url.searchParams.set("spaces", "drive");
  url.searchParams.set("pageSize", "2");
  url.searchParams.set("fields", `files(${DRIVE_FILE_FIELDS})`);
  const response = await fetch(url.toString(), {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw responseError(response);
  const payload = (await response.json()) as DriveFileListResponse;
  const file = payload.files?.[0];
  return file ? serializeFile(file) : null;
};

export const uploadGoogleDriveDerivedRenderStream = async (
  env: WorkerEnv,
  userId: string,
  connection: StorageConnectionRow,
  input: {
    showId: string;
    showName: string;
    renderJobId: string;
    sourceFileId: string;
    fileName: string;
    mimeType: "audio/flac";
    totalBytes: number;
    body: ReadableStream<Uint8Array>;
  },
): Promise<GoogleDriveStoredFile> => {
  if (!Number.isSafeInteger(input.totalBytes) || input.totalBytes <= 0) {
    throw new Error("render_output_size_invalid");
  }
  const existing = await findGoogleDriveDerivedRenderOutput(env, userId, connection, input);
  if (existing) return existing;

  const drive = await createGoogleDriveSession(env, userId, connection);
  const workspace = await drive.ensureShowWorkspace(input.showId, input.showName);
  const accessToken = await refreshAccessToken(env, userId, connection);
  const startUrl = new URL(`${DRIVE_UPLOAD_API}/files`);
  startUrl.searchParams.set("uploadType", "resumable");
  startUrl.searchParams.set("fields", DRIVE_FILE_FIELDS);

  const startResponse = await fetch(startUrl.toString(), {
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
        assetKind: "derived-technical-master",
        immutable: "true",
        sourceFileId: input.sourceFileId,
        renderJobId: input.renderJobId,
      },
    }),
  });
  if (!startResponse.ok) throw responseError(startResponse);
  const sessionUrl = validateSessionUrl(startResponse.headers.get("location"));

  const uploadResponse = await fetch(sessionUrl, {
    method: "PUT",
    redirect: "manual",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": input.mimeType,
      "content-length": String(input.totalBytes),
      "content-range": `bytes 0-${input.totalBytes - 1}/${input.totalBytes}`,
    },
    body: input.body,
  });
  if (!uploadResponse.ok) throw responseError(uploadResponse);
  const file = serializeFile((await uploadResponse.json()) as DriveFileResponse);
  if (
    file.mimeType !== input.mimeType ||
    file.sizeBytes !== input.totalBytes ||
    file.appProperties.renderJobId !== input.renderJobId ||
    file.appProperties.sourceFileId !== input.sourceFileId
  ) {
    throw new Error("render_output_verification_failed");
  }
  return file;
};
