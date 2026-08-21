import type { WorkerEnv } from "./db";
import { createGoogleDriveSession, GoogleDriveError, type GoogleDriveStoredFile } from "./google-drive";
import type { StorageConnectionRow } from "./storage-store";
import { decryptStorageToken } from "./token-crypto";

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
const DRIVE_FILE_FIELDS = "id,name,mimeType,size,webViewLink,parents,appProperties,trashed,capabilities(canDownload)";

export type EpisodePublishArtifactKind =
  | "source-captions-vtt"
  | "caption-word-timings"
  | "derived-technical-master"
  | "final-captions-vtt"
  | "final-podcast-mp3"
  | "final-podcast-mp4";

const MIME_BY_KIND: Record<EpisodePublishArtifactKind, string> = {
  "source-captions-vtt": "text/vtt",
  "caption-word-timings": "application/json",
  "derived-technical-master": "audio/flac",
  "final-captions-vtt": "text/vtt",
  "final-podcast-mp3": "audio/mpeg",
  "final-podcast-mp4": "video/mp4",
};

interface TokenResponse { access_token?: string }
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
interface DriveListResponse { files?: DriveFileResponse[] }

const qEscape = (value: string) => value.replaceAll("\\", "\\\\").replaceAll("'", "\\'");

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
  const token = (await response.json()) as TokenResponse;
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

const serialize = (file: DriveFileResponse): GoogleDriveStoredFile => {
  const size = file.size ? Number(file.size) : null;
  return {
    id: file.id,
    name: file.name,
    mimeType: file.mimeType ?? null,
    sizeBytes: size !== null && Number.isFinite(size) ? size : null,
    webViewLink: file.webViewLink ?? null,
    parents: file.parents ?? [],
    appProperties: file.appProperties ?? {},
    canDownload: file.capabilities?.canDownload === true,
  };
};

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

export interface EpisodeArtifactScope {
  showId: string;
  showName: string;
  sourceFileId: string;
  assetKind: EpisodePublishArtifactKind;
  analysisRunId?: string;
  renderJobId?: string;
}

const scopeProperties = (input: EpisodeArtifactScope) => {
  if (!input.showId || !input.sourceFileId) throw new Error("publish_artifact_scope_invalid");
  if (input.assetKind === "source-captions-vtt" || input.assetKind === "caption-word-timings") {
    if (!input.analysisRunId || input.renderJobId) throw new Error("publish_artifact_scope_invalid");
  } else if (!input.renderJobId || input.analysisRunId) {
    throw new Error("publish_artifact_scope_invalid");
  }
  return {
    hrtechifyStudio: "v1",
    role: "asset",
    showId: input.showId,
    folder: "episodes",
    assetKind: input.assetKind,
    immutable: "true",
    sourceFileId: input.sourceFileId,
    ...(input.analysisRunId ? { analysisRunId: input.analysisRunId } : {}),
    ...(input.renderJobId ? { renderJobId: input.renderJobId } : {}),
  };
};

export const findGoogleDriveEpisodePublishArtifact = async (
  env: WorkerEnv,
  userId: string,
  connection: StorageConnectionRow,
  input: EpisodeArtifactScope,
): Promise<GoogleDriveStoredFile | null> => {
  const properties = scopeProperties(input);
  const drive = await createGoogleDriveSession(env, userId, connection);
  const workspace = await drive.ensureShowWorkspace(input.showId, input.showName);
  const token = await refreshAccessToken(env, userId, connection);
  const query = [
    "trashed=false",
    `'${qEscape(workspace.folders.episodes)}' in parents`,
    ...Object.entries(properties).map(
      ([key, value]) => `appProperties has { key='${qEscape(key)}' and value='${qEscape(value)}' }`,
    ),
  ].join(" and ");
  const url = new URL(`${DRIVE_API}/files`);
  url.searchParams.set("q", query);
  url.searchParams.set("spaces", "drive");
  url.searchParams.set("pageSize", "2");
  url.searchParams.set("fields", `files(${DRIVE_FILE_FIELDS})`);
  const response = await fetch(url.toString(), { headers: { authorization: `Bearer ${token}` } });
  if (!response.ok) throw responseError(response);
  const file = ((await response.json()) as DriveListResponse).files?.[0];
  return file ? serialize(file) : null;
};

export const uploadGoogleDriveEpisodePublishArtifactStream = async (
  env: WorkerEnv,
  userId: string,
  connection: StorageConnectionRow,
  input: EpisodeArtifactScope & {
    fileName: string;
    totalBytes: number;
    body: ReadableStream<Uint8Array>;
  },
): Promise<GoogleDriveStoredFile> => {
  const expectedMimeType = MIME_BY_KIND[input.assetKind];
  if (!Number.isSafeInteger(input.totalBytes) || input.totalBytes <= 0) {
    throw new Error("publish_artifact_size_invalid");
  }
  if (!input.fileName || input.fileName.length > 180 || /[/\\\u0000-\u001f\u007f]/.test(input.fileName)) {
    throw new Error("publish_artifact_file_name_invalid");
  }
  const existing = await findGoogleDriveEpisodePublishArtifact(env, userId, connection, input);
  if (existing) {
    if (existing.mimeType !== expectedMimeType || existing.sizeBytes !== input.totalBytes) {
      throw new Error("publish_artifact_existing_mismatch");
    }
    return existing;
  }

  const properties = scopeProperties(input);
  const drive = await createGoogleDriveSession(env, userId, connection);
  const workspace = await drive.ensureShowWorkspace(input.showId, input.showName);
  const token = await refreshAccessToken(env, userId, connection);
  const startUrl = new URL(`${DRIVE_UPLOAD_API}/files`);
  startUrl.searchParams.set("uploadType", "resumable");
  startUrl.searchParams.set("fields", DRIVE_FILE_FIELDS);
  const start = await fetch(startUrl.toString(), {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json; charset=UTF-8",
      "x-upload-content-type": expectedMimeType,
      "x-upload-content-length": String(input.totalBytes),
    },
    body: JSON.stringify({
      name: input.fileName,
      parents: [workspace.folders.episodes],
      appProperties: properties,
    }),
  });
  if (!start.ok) throw responseError(start);
  const sessionUrl = validateSessionUrl(start.headers.get("location"));
  const uploaded = await fetch(sessionUrl, {
    method: "PUT",
    redirect: "manual",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": expectedMimeType,
      "content-length": String(input.totalBytes),
      "content-range": `bytes 0-${input.totalBytes - 1}/${input.totalBytes}`,
    },
    body: input.body,
  });
  if (!uploaded.ok) throw responseError(uploaded);
  const file = serialize((await uploaded.json()) as DriveFileResponse);
  if (
    file.mimeType !== expectedMimeType ||
    file.sizeBytes !== input.totalBytes ||
    file.appProperties.assetKind !== input.assetKind ||
    file.appProperties.sourceFileId !== input.sourceFileId ||
    file.appProperties.analysisRunId !== (input.analysisRunId ?? undefined) ||
    file.appProperties.renderJobId !== (input.renderJobId ?? undefined)
  ) {
    throw new Error("publish_artifact_verification_failed");
  }
  return file;
};

export const uploadGoogleDriveEpisodePublishArtifactBytes = async (
  env: WorkerEnv,
  userId: string,
  connection: StorageConnectionRow,
  input: EpisodeArtifactScope & { fileName: string; bytes: Uint8Array },
) => {
  if (!input.bytes.byteLength) throw new Error("publish_artifact_empty");
  const body = new Response(input.bytes.slice().buffer).body;
  if (!body) throw new Error("publish_artifact_stream_unavailable");
  return uploadGoogleDriveEpisodePublishArtifactStream(env, userId, connection, {
    ...input,
    totalBytes: input.bytes.byteLength,
    body,
  });
};
