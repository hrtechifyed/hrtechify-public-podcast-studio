import type { D1DatabaseLike, WorkerEnv } from "./db";
import {
  findGoogleDriveEpisodePublishArtifact,
  uploadGoogleDriveEpisodePublishArtifactBytes,
  uploadGoogleDriveEpisodePublishArtifactStream,
  type EpisodeArtifactScope,
  type EpisodePublishArtifactKind,
} from "./google-drive-publish-artifacts";
import { findStorageArtifact } from "./storage-asset-store";
import { createStudioStorageSession, type StudioStoredFile } from "./studio-storage";
import type { StorageConnectionRow } from "./storage-store";

const MIME_BY_KIND: Record<EpisodePublishArtifactKind, string> = {
  "source-captions-vtt": "text/vtt",
  "caption-word-timings": "application/json",
  "derived-technical-master": "audio/flac",
  "final-captions-vtt": "text/vtt",
  "final-podcast-mp3": "audio/mpeg",
  "final-podcast-mp4": "video/mp4",
};

const validateScope = (input: EpisodeArtifactScope) => {
  if (!input.showId || !input.sourceFileId) throw new Error("publish_artifact_scope_invalid");
  if (input.assetKind === "source-captions-vtt" || input.assetKind === "caption-word-timings") {
    if (!input.analysisRunId || input.renderJobId) throw new Error("publish_artifact_scope_invalid");
  } else if (!input.renderJobId || input.analysisRunId) {
    throw new Error("publish_artifact_scope_invalid");
  }
};

export const findEpisodePublishArtifact = async (
  env: WorkerEnv,
  db: D1DatabaseLike,
  userId: string,
  connection: StorageConnectionRow,
  input: EpisodeArtifactScope,
): Promise<StudioStoredFile | null> => {
  validateScope(input);
  if (connection.provider === "google-drive") {
    const file = await findGoogleDriveEpisodePublishArtifact(env, userId, connection, input);
    return file ? { ...file, provider: "google-drive" } : null;
  }
  if (connection.provider !== "dropbox") throw new Error("storage_provider_not_supported");
  const record = await findStorageArtifact(db, {
    userId,
    showId: input.showId,
    connectionId: connection.id,
    assetKind: input.assetKind,
    sourceFileId: input.sourceFileId,
    analysisRunId: input.analysisRunId ?? null,
    renderJobId: input.renderJobId ?? null,
  });
  if (!record) return null;
  const session = await createStudioStorageSession(env, db, userId, connection);
  return session.getOwnedFile(input.showId, input.showName, record.provider_file_id);
};

export const uploadEpisodePublishArtifactStream = async (
  env: WorkerEnv,
  db: D1DatabaseLike,
  userId: string,
  connection: StorageConnectionRow,
  input: EpisodeArtifactScope & {
    fileName: string;
    totalBytes: number;
    body: ReadableStream<Uint8Array>;
  },
): Promise<StudioStoredFile> => {
  validateScope(input);
  const mimeType = MIME_BY_KIND[input.assetKind];
  if (!Number.isSafeInteger(input.totalBytes) || input.totalBytes <= 0) throw new Error("publish_artifact_size_invalid");
  if (!input.fileName || input.fileName.length > 180 || /[/\\\u0000-\u001f\u007f]/.test(input.fileName)) {
    throw new Error("publish_artifact_file_name_invalid");
  }
  if (connection.provider === "google-drive") {
    const file = await uploadGoogleDriveEpisodePublishArtifactStream(env, userId, connection, input);
    return { ...file, provider: "google-drive" };
  }
  if (connection.provider !== "dropbox") throw new Error("storage_provider_not_supported");
  const existing = await findEpisodePublishArtifact(env, db, userId, connection, input);
  if (existing) {
    if (existing.mimeType !== mimeType || existing.sizeBytes !== input.totalBytes) {
      throw new Error("publish_artifact_existing_mismatch");
    }
    return existing;
  }
  const session = await createStudioStorageSession(env, db, userId, connection);
  if (session.provider !== "dropbox") throw new Error("storage_provider_mismatch");
  const file = await session.uploadStreamAsset({
    showId: input.showId,
    showName: input.showName,
    folder: "episodes",
    fileName: input.fileName,
    mimeType,
    totalBytes: input.totalBytes,
    body: input.body,
    metadata: {
      assetKind: input.assetKind,
      immutable: true,
      original: false,
      sourceFileId: input.sourceFileId,
      analysisRunId: input.analysisRunId ?? null,
      renderJobId: input.renderJobId ?? null,
    },
  });
  if (file.mimeType !== mimeType || file.sizeBytes !== input.totalBytes) throw new Error("publish_artifact_verification_failed");
  return file;
};

export const uploadEpisodePublishArtifactBytes = async (
  env: WorkerEnv,
  db: D1DatabaseLike,
  userId: string,
  connection: StorageConnectionRow,
  input: EpisodeArtifactScope & { fileName: string; bytes: Uint8Array },
): Promise<StudioStoredFile> => {
  if (!input.bytes.byteLength) throw new Error("publish_artifact_empty");
  if (connection.provider === "google-drive") {
    const file = await uploadGoogleDriveEpisodePublishArtifactBytes(env, userId, connection, input);
    return { ...file, provider: "google-drive" };
  }
  const body = new Response(input.bytes.slice().buffer).body;
  if (!body) throw new Error("publish_artifact_stream_unavailable");
  return uploadEpisodePublishArtifactStream(env, db, userId, connection, {
    ...input,
    totalBytes: input.bytes.byteLength,
    body,
  });
};
