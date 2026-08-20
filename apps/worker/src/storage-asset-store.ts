import type { D1DatabaseLike } from "./db";
import type { StorageConnectionRow } from "./storage-store";

export type StorageAssetFolder = "brand-assets" | "templates" | "episodes";

export interface StorageAssetRecord {
  id: string;
  user_id: string;
  show_id: string;
  connection_id: string;
  provider: "google-drive" | "dropbox";
  provider_file_id: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number | null;
  folder: StorageAssetFolder;
  asset_kind: string;
  immutable: number;
  original: number;
  source_file_id: string | null;
  source_asset_id: string | null;
  analysis_run_id: string | null;
  render_job_id: string | null;
  state_marker: number;
  selection_choice: "original" | "background-removed" | null;
  selected_asset_id: string | null;
  created_at: string;
}

export interface CreateStorageAssetInput {
  userId: string;
  showId: string;
  connection: StorageConnectionRow;
  providerFileId: string;
  fileName: string;
  mimeType?: string | null;
  sizeBytes?: number | null;
  folder: StorageAssetFolder;
  assetKind: string;
  immutable?: boolean;
  original?: boolean;
  sourceFileId?: string | null;
  sourceAssetId?: string | null;
  analysisRunId?: string | null;
  renderJobId?: string | null;
  stateMarker?: boolean;
  selectionChoice?: "original" | "background-removed" | null;
  selectedAssetId?: string | null;
}

export const recordStorageAsset = async (
  db: D1DatabaseLike,
  input: CreateStorageAssetInput,
) => {
  if (input.connection.user_id !== input.userId) throw new Error("storage_asset_owner_mismatch");
  await db.prepare(
    `INSERT OR IGNORE INTO storage_asset_records (
      id, user_id, show_id, connection_id, provider, provider_file_id,
      file_name, mime_type, size_bytes, folder, asset_kind, immutable, original,
      source_file_id, source_asset_id, analysis_run_id, render_job_id,
      state_marker, selection_choice, selected_asset_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    crypto.randomUUID(),
    input.userId,
    input.showId,
    input.connection.id,
    input.connection.provider,
    input.providerFileId,
    input.fileName,
    input.mimeType ?? null,
    input.sizeBytes ?? null,
    input.folder,
    input.assetKind,
    input.immutable === false ? 0 : 1,
    input.original === true ? 1 : 0,
    input.sourceFileId ?? null,
    input.sourceAssetId ?? null,
    input.analysisRunId ?? null,
    input.renderJobId ?? null,
    input.stateMarker === true ? 1 : 0,
    input.selectionChoice ?? null,
    input.selectedAssetId ?? null,
  ).run();
  return getStorageAssetByProviderFileId(
    db,
    input.userId,
    input.showId,
    input.connection.id,
    input.providerFileId,
  );
};

export const getStorageAssetByProviderFileId = async (
  db: D1DatabaseLike,
  userId: string,
  showId: string,
  connectionId: string,
  providerFileId: string,
) => db.prepare(
  `SELECT * FROM storage_asset_records
   WHERE user_id = ? AND show_id = ? AND connection_id = ? AND provider_file_id = ?
   LIMIT 1`,
).bind(userId, showId, connectionId, providerFileId).first<StorageAssetRecord>();

export const listStorageAssetsByKind = async (
  db: D1DatabaseLike,
  userId: string,
  showId: string,
  connectionId: string,
  assetKinds: readonly string[],
) => {
  if (assetKinds.length === 0) return [] as StorageAssetRecord[];
  const placeholders = assetKinds.map(() => "?").join(",");
  const result = await db.prepare(
    `SELECT * FROM storage_asset_records
     WHERE user_id = ? AND show_id = ? AND connection_id = ?
       AND asset_kind IN (${placeholders})
     ORDER BY created_at DESC, id DESC`,
  ).bind(userId, showId, connectionId, ...assetKinds).all<StorageAssetRecord>();
  return result.results;
};

export const findStorageArtifact = async (
  db: D1DatabaseLike,
  input: {
    userId: string;
    showId: string;
    connectionId: string;
    assetKind: string;
    sourceFileId?: string | null;
    analysisRunId?: string | null;
    renderJobId?: string | null;
  },
) => {
  const clauses = [
    "user_id = ?",
    "show_id = ?",
    "connection_id = ?",
    "asset_kind = ?",
  ];
  const values: unknown[] = [input.userId, input.showId, input.connectionId, input.assetKind];
  if (input.sourceFileId !== undefined) {
    clauses.push(input.sourceFileId === null ? "source_file_id IS NULL" : "source_file_id = ?");
    if (input.sourceFileId !== null) values.push(input.sourceFileId);
  }
  if (input.analysisRunId !== undefined) {
    clauses.push(input.analysisRunId === null ? "analysis_run_id IS NULL" : "analysis_run_id = ?");
    if (input.analysisRunId !== null) values.push(input.analysisRunId);
  }
  if (input.renderJobId !== undefined) {
    clauses.push(input.renderJobId === null ? "render_job_id IS NULL" : "render_job_id = ?");
    if (input.renderJobId !== null) values.push(input.renderJobId);
  }
  return db.prepare(
    `SELECT * FROM storage_asset_records
     WHERE ${clauses.join(" AND ")}
     ORDER BY created_at DESC, id DESC
     LIMIT 1`,
  ).bind(...values).first<StorageAssetRecord>();
};

export const latestStorageSelection = async (
  db: D1DatabaseLike,
  input: {
    userId: string;
    showId: string;
    connectionId: string;
    assetKind: "show-logo-selection" | "profile-photo-selection";
    sourceAssetId: string;
  },
) => db.prepare(
  `SELECT * FROM storage_asset_records
   WHERE user_id = ? AND show_id = ? AND connection_id = ?
     AND asset_kind = ? AND source_asset_id = ? AND state_marker = 1
   ORDER BY created_at DESC, id DESC
   LIMIT 1`,
).bind(
  input.userId,
  input.showId,
  input.connectionId,
  input.assetKind,
  input.sourceAssetId,
).first<StorageAssetRecord>();
