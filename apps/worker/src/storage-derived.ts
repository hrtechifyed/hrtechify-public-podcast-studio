import type { D1DatabaseLike, WorkerEnv } from "./db";
import {
  findGoogleDriveDerivedRenderOutput,
  uploadGoogleDriveDerivedRenderStream,
} from "./google-drive-derived";
import { findStorageArtifact } from "./storage-asset-store";
import { createStudioStorageSession, type StudioStoredFile } from "./studio-storage";
import type { StorageConnectionRow } from "./storage-store";

export const findDerivedRenderOutput = async (
  env: WorkerEnv,
  db: D1DatabaseLike,
  userId: string,
  connection: StorageConnectionRow,
  input: { showId: string; showName: string; renderJobId: string },
): Promise<StudioStoredFile | null> => {
  if (connection.provider === "google-drive") {
    const file = await findGoogleDriveDerivedRenderOutput(env, userId, connection, input);
    return file ? { ...file, provider: "google-drive" } : null;
  }
  if (connection.provider !== "dropbox") throw new Error("storage_provider_not_supported");
  const record = await findStorageArtifact(db, {
    userId,
    showId: input.showId,
    connectionId: connection.id,
    assetKind: "derived-technical-master",
    renderJobId: input.renderJobId,
  });
  if (!record) return null;
  const session = await createStudioStorageSession(env, db, userId, connection);
  return session.getOwnedFile(input.showId, input.showName, record.provider_file_id);
};

export const uploadDerivedRenderStream = async (
  env: WorkerEnv,
  db: D1DatabaseLike,
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
): Promise<StudioStoredFile> => {
  if (!Number.isSafeInteger(input.totalBytes) || input.totalBytes <= 0) throw new Error("render_output_size_invalid");
  if (connection.provider === "google-drive") {
    const file = await uploadGoogleDriveDerivedRenderStream(env, userId, connection, input);
    return { ...file, provider: "google-drive" };
  }
  if (connection.provider !== "dropbox") throw new Error("storage_provider_not_supported");
  const existing = await findDerivedRenderOutput(env, db, userId, connection, input);
  if (existing) return existing;
  const session = await createStudioStorageSession(env, db, userId, connection);
  if (session.provider !== "dropbox") throw new Error("storage_provider_mismatch");
  const file = await session.uploadStreamAsset({
    showId: input.showId,
    showName: input.showName,
    folder: "episodes",
    fileName: input.fileName,
    mimeType: input.mimeType,
    totalBytes: input.totalBytes,
    body: input.body,
    metadata: {
      assetKind: "derived-technical-master",
      immutable: true,
      original: false,
      sourceFileId: input.sourceFileId,
      renderJobId: input.renderJobId,
    },
  });
  if (file.mimeType !== input.mimeType || file.sizeBytes !== input.totalBytes) {
    throw new Error("render_output_verification_failed");
  }
  return file;
};
