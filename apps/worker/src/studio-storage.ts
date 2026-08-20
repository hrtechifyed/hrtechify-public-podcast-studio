import type { D1DatabaseLike, WorkerEnv } from "./db";
import { createDropboxSession, DropboxError } from "./dropbox";
import { createGoogleDriveSession, GoogleDriveError, type GoogleDriveStoredFile } from "./google-drive";
import {
  getStorageAssetByProviderFileId,
  parseStorageAssetProperties,
  recordStorageAsset,
  type CreateStorageAssetInput,
  type StorageAssetFolder,
  type StorageAssetRecord,
} from "./storage-asset-store";
import type { StorageConnectionRow } from "./storage-store";

export type StudioStorageProvider = "google-drive" | "dropbox";

export interface StudioStoredFile extends GoogleDriveStoredFile {
  provider: StudioStorageProvider;
}

export interface StudioFileDownload {
  file: StudioStoredFile;
  body: ReadableStream<Uint8Array> | null;
  sourceContentType: string | null;
  contentLength: string | null;
}

export class StudioStorageError extends Error {
  constructor(
    public readonly code: string,
    public readonly status = 502,
  ) {
    super(code);
    this.name = "StudioStorageError";
  }
}

const appPropertiesFromRecord = (record: StorageAssetRecord) => ({
  ...parseStorageAssetProperties(record),
  hrtechifyStudio: "v1",
  role: "asset",
  showId: record.show_id,
  folder: record.folder,
  assetKind: record.asset_kind,
  immutable: record.immutable === 1 ? "true" : "false",
  ...(record.original === 1 ? { original: "true" } : {}),
  ...(record.source_file_id ? { sourceFileId: record.source_file_id } : {}),
  ...(record.source_asset_id ? { sourceAssetId: record.source_asset_id } : {}),
  ...(record.analysis_run_id ? { analysisRunId: record.analysis_run_id } : {}),
  ...(record.render_job_id ? { renderJobId: record.render_job_id } : {}),
  ...(record.state_marker === 1 ? { stateMarker: "true" } : {}),
  ...(record.selection_choice ? { selectionChoice: record.selection_choice } : {}),
  ...(record.selected_asset_id ? { selectedAssetId: record.selected_asset_id } : {}),
});

const normalizeDropboxFile = (
  file: Awaited<ReturnType<Awaited<ReturnType<typeof createDropboxSession>>["getOwnedFile"]>>,
  record: StorageAssetRecord,
): StudioStoredFile => ({
  id: file.id,
  name: file.name,
  mimeType: record.mime_type,
  sizeBytes: file.sizeBytes ?? record.size_bytes,
  webViewLink: null,
  parents: file.parents,
  appProperties: appPropertiesFromRecord(record),
  canDownload: file.canDownload,
  provider: "dropbox",
});

const normalizeDriveFile = (file: GoogleDriveStoredFile): StudioStoredFile => ({
  ...file,
  provider: "google-drive",
});

const rethrowProviderError = (error: unknown): never => {
  if (error instanceof GoogleDriveError || error instanceof DropboxError) {
    throw new StudioStorageError(error.code, error.status);
  }
  if (error instanceof StudioStorageError) throw error;
  throw error;
};

const requireDropboxAssetRecord = async (
  db: D1DatabaseLike,
  userId: string,
  showId: string,
  connectionId: string,
  fileId: string,
) => {
  const record = await getStorageAssetByProviderFileId(db, userId, showId, connectionId, fileId);
  if (!record || record.provider !== "dropbox") {
    throw new StudioStorageError("dropbox_file_not_found", 404);
  }
  return record;
};

export const createStudioStorageSession = async (
  env: WorkerEnv,
  db: D1DatabaseLike,
  userId: string,
  connection: StorageConnectionRow,
) => {
  if (connection.user_id !== userId || connection.status !== "active") {
    throw new StudioStorageError("storage_connection_unavailable", 409);
  }

  if (connection.provider === "google-drive") {
    const drive = await createGoogleDriveSession(env, userId, connection);
    return {
      provider: "google-drive" as const,
      ensureShowWorkspace: drive.ensureShowWorkspace,
      async getOwnedFile(showId: string, showName: string, fileId: string) {
        try {
          return normalizeDriveFile(await drive.getOwnedFile(showId, showName, fileId));
        } catch (error) {
          return rethrowProviderError(error);
        }
      },
      async downloadOwnedFile(showId: string, showName: string, fileId: string): Promise<StudioFileDownload> {
        try {
          const result = await drive.downloadOwnedFile(showId, showName, fileId);
          return { ...result, file: normalizeDriveFile(result.file) };
        } catch (error) {
          return rethrowProviderError(error);
        }
      },
      async uploadSmallAsset(input: {
        showId: string;
        showName: string;
        folder: Exclude<StorageAssetFolder, "templates">;
        fileName: string;
        mimeType: string;
        bytes: Uint8Array;
        metadata: Omit<CreateStorageAssetInput, "userId" | "showId" | "connection" | "providerFileId" | "fileName" | "mimeType" | "sizeBytes" | "folder">;
      }) {
        try {
          const file = await drive.uploadSmallFile(input.showId, input.showName, {
            folder: input.folder,
            fileName: input.fileName,
            mimeType: input.mimeType,
            bytes: input.bytes,
          });
          return normalizeDriveFile(file);
        } catch (error) {
          return rethrowProviderError(error);
        }
      },
    };
  }

  if (connection.provider !== "dropbox") {
    throw new StudioStorageError("storage_provider_not_supported", 422);
  }

  const dropbox = await createDropboxSession(env, userId, connection);
  return {
    provider: "dropbox" as const,
    ensureShowWorkspace: dropbox.ensureShowWorkspace,
    async getOwnedFile(showId: string, showName: string, fileId: string) {
      try {
        const record = await requireDropboxAssetRecord(db, userId, showId, connection.id, fileId);
        const file = await dropbox.getOwnedFile(showId, showName, fileId);
        return normalizeDropboxFile(file, record);
      } catch (error) {
        return rethrowProviderError(error);
      }
    },
    async downloadOwnedFile(showId: string, showName: string, fileId: string): Promise<StudioFileDownload> {
      try {
        const record = await requireDropboxAssetRecord(db, userId, showId, connection.id, fileId);
        const result = await dropbox.downloadOwnedFile(showId, showName, fileId);
        return {
          ...result,
          file: normalizeDropboxFile(result.file, record),
        };
      } catch (error) {
        return rethrowProviderError(error);
      }
    },
    async uploadSmallAsset(input: {
      showId: string;
      showName: string;
      folder: Exclude<StorageAssetFolder, "templates">;
      fileName: string;
      mimeType: string;
      bytes: Uint8Array;
      metadata: Omit<CreateStorageAssetInput, "userId" | "showId" | "connection" | "providerFileId" | "fileName" | "mimeType" | "sizeBytes" | "folder">;
    }) {
      try {
        const file = await dropbox.uploadSmallFile(input.showId, input.showName, {
          folder: input.folder,
          fileName: input.fileName,
          mimeType: input.mimeType,
          bytes: input.bytes,
        });
        const record = await recordStorageAsset(db, {
          userId,
          showId: input.showId,
          connection,
          providerFileId: file.id,
          fileName: file.name,
          mimeType: input.mimeType,
          sizeBytes: file.sizeBytes,
          folder: input.folder,
          ...input.metadata,
        });
        if (!record) throw new StudioStorageError("storage_asset_record_failed", 500);
        return normalizeDropboxFile(file, record);
      } catch (error) {
        return rethrowProviderError(error);
      }
    },
    async uploadStreamAsset(input: {
      showId: string;
      showName: string;
      folder: StorageAssetFolder;
      fileName: string;
      mimeType: string;
      totalBytes: number;
      body: ReadableStream<Uint8Array>;
      metadata: Omit<CreateStorageAssetInput, "userId" | "showId" | "connection" | "providerFileId" | "fileName" | "mimeType" | "sizeBytes" | "folder">;
    }) {
      try {
        const file = await dropbox.uploadStreamFile(input.showId, input.showName, {
          folder: input.folder,
          fileName: input.fileName,
          totalBytes: input.totalBytes,
          body: input.body,
        });
        const record = await recordStorageAsset(db, {
          userId,
          showId: input.showId,
          connection,
          providerFileId: file.id,
          fileName: file.name,
          mimeType: input.mimeType,
          sizeBytes: file.sizeBytes,
          folder: input.folder,
          ...input.metadata,
        });
        if (!record) throw new StudioStorageError("storage_asset_record_failed", 500);
        return normalizeDropboxFile(file, record);
      } catch (error) {
        return rethrowProviderError(error);
      }
    },
  };
};
