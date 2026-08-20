import type { WorkerEnv } from "./db";
import {
  createGoogleDriveSession,
  type GoogleDriveFile,
} from "./google-drive";
import type { StorageConnectionRow } from "./storage-store";

export type EpisodePublishAssetKind =
  | "caption-word-timings"
  | "source-captions-vtt"
  | "final-captions-vtt"
  | "final-podcast-mp3"
  | "final-podcast-mp4";

interface EpisodeArtifactScope {
  showId: string;
  showName: string;
  sourceFileId: string;
  assetKind: EpisodePublishAssetKind;
  analysisRunId?: string;
  renderJobId?: string;
}

interface DriveFileResponse {
  id?: string;
  name?: string;
  mimeType?: string;
  size?: string;
  webViewLink?: string;
  appProperties?: Record<string, string>;
  parents?: string[];
  trashed?: boolean;
}

const MIME_BY_KIND: Record<EpisodePublishAssetKind, string> = {
  "caption-word-timings": "application/json",
  "source-captions-vtt": "text/vtt",
  "final-captions-vtt": "text/vtt",
  "final-podcast-mp3": "audio/mpeg",
  "final-podcast-mp4": "video/mp4",
};

const serialize = (file: DriveFileResponse): GoogleDriveFile => {
  if (!file.id || !file.name || !file.mimeType) throw new Error("publish_artifact_metadata_invalid");
  const sizeBytes = file.size ? Number(file.size) : null;
  return {
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    sizeBytes: Number.isSafeInteger(sizeBytes) && (sizeBytes as number) >= 0 ? sizeBytes as number : null,
    webViewLink: file.webViewLink ?? null,
    parents: file.parents ?? [],
    appProperties: file.appProperties ?? {},
    trashed: file.trashed === true,
  };
};

const encodeQuery = (value: string) => value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

const responseError = (response: Response) => {
  if (response.status === 401) return new Error("google_drive_access_token_invalid");
  if (response.status === 403) return new Error("google_drive_permission_denied");
  if (response.status === 404) return new Error("google_drive_file_not_found");
  if (response.status === 429 || response.status >= 500) return new Error("google_drive_retryable_failure");
  return new Error("google_drive_request_failed");
};

const fields = "files(id,name,mimeType,size,webViewLink,appProperties,parents,trashed)";

const buildAppProperties = (input: EpisodeArtifactScope) => ({
  hrtechify: "true",
  showId: input.showId,
  assetKind: input.assetKind,
  immutable: "true",
  original: "false",
  sourceFileId: input.sourceFileId,
  ...(input.analysisRunId ? { analysisRunId: input.analysisRunId } : {}),
  ...(input.renderJobId ? { renderJobId: input.renderJobId } : {}),
});

export const findGoogleDriveEpisodePublishArtifact = async (
  env: WorkerEnv,
  userId: string,
  connection: StorageConnectionRow,
  input: EpisodeArtifactScope,
): Promise<GoogleDriveFile | null> => {
  const session = await createGoogleDriveSession(env, userId, connection);
  const workspace = await session.ensureShowWorkspace(input.showId, input.showName);
  const token = await session.getAccessToken();
  const properties = buildAppProperties(input);
  const clauses = [
    "trashed = false",
    `'${encodeQuery(workspace.episodesFolderId)}' in parents`,
    ...Object.entries(properties).map(([key, value]) =>
      `appProperties has { key='${encodeQuery(key)}' and value='${encodeQuery(value)}' }`,
    ),
  ];
  const url = new URL("https://www.googleapis.com/drive/v3/files");
  url.searchParams.set("q", clauses.join(" and "));
  url.searchParams.set("spaces", "drive");
  url.searchParams.set("pageSize", "2");
  url.searchParams.set("fields", fields);
  url.searchParams.set("orderBy", "createdTime desc");
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw responseError(response);
  const payload = (await response.json()) as { files?: DriveFileResponse[] };
  const matches = (payload.files ?? []).map(serialize);
  if (matches.length > 1) throw new Error("publish_artifact_duplicate_detected");
  return matches[0] ?? null;
};

const startResumableUpload = async (
  token: string,
  metadata: Record<string, unknown>,
  mimeType: string,
  sizeBytes: number,
) => {
  const response = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id%2Cname%2CmimeType%2Csize%2CwebViewLink%2CappProperties%2Cparents%2Ctrashed",
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json; charset=utf-8",
        "x-upload-content-type": mimeType,
        "x-upload-content-length": String(sizeBytes),
      },
      body: JSON.stringify(metadata),
    },
  );
  if (!response.ok) throw responseError(response);
  const location = response.headers.get("location");
  if (!location || !location.startsWith("https://www.googleapis.com/upload/drive/")) {
    throw new Error("google_drive_resumable_location_invalid");
  }
  return location;
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
) => {
  if (!Number.isSafeInteger(input.totalBytes) || input.totalBytes <= 0) {
    throw new Error("publish_artifact_size_invalid");
  }
  const existing = await findGoogleDriveEpisodePublishArtifact(env, userId, connection, input);
  if (existing) return existing;

  const session = await createGoogleDriveSession(env, userId, connection);
  const workspace = await session.ensureShowWorkspace(input.showId, input.showName);
  const token = await session.getAccessToken();
  const expectedMimeType = MIME_BY_KIND[input.assetKind];
  const metadata = {
    name: input.fileName,
    mimeType: expectedMimeType,
    parents: [workspace.episodesFolderId],
    appProperties: buildAppProperties(input),
  };
  const location = await startResumableUpload(token, metadata, expectedMimeType, input.totalBytes);
  const uploaded = await fetch(location, {
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
  const stableBytes = input.bytes.slice().buffer;
  const body = new Response(stableBytes).body;
  if (!body) throw new Error("publish_artifact_stream_unavailable");
  return uploadGoogleDriveEpisodePublishArtifactStream(env, userId, connection, {
    ...input,
    totalBytes: input.bytes.byteLength,
    body,
  });
};
