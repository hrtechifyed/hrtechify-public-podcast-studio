import type { D1DatabaseLike, WorkerEnv } from "./db";
import type { StorageConnectionRow } from "./storage-store";
import { decryptStorageToken, encryptStorageToken } from "./token-crypto";

export interface StorageUploadSessionRow {
  id: string;
  user_id: string;
  show_id: string;
  connection_id: string;
  provider: "dropbox";
  provider_session_encrypted: string;
  destination_path_encrypted: string;
  file_name: string;
  mime_type: string;
  total_bytes: number;
  next_offset: number;
  asset_kind: string;
  folder: "brand-assets" | "episodes";
  expires_at: string;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

const aad = (userId: string, id: string, field: "session" | "path") =>
  `storage-upload:${userId}:${id}:${field}`;

export const createStorageUploadSession = async (
  env: WorkerEnv,
  db: D1DatabaseLike,
  input: {
    userId: string;
    showId: string;
    connection: StorageConnectionRow;
    providerSessionId: string;
    destinationPath: string;
    fileName: string;
    mimeType: string;
    totalBytes: number;
    assetKind: string;
    folder: "brand-assets" | "episodes";
  },
) => {
  if (!env.TOKEN_ENCRYPTION_KEY) throw new Error("storage_token_encryption_not_configured");
  if (input.connection.provider !== "dropbox" || input.connection.user_id !== input.userId) {
    throw new Error("storage_upload_connection_invalid");
  }
  const id = crypto.randomUUID();
  const providerSessionEncrypted = await encryptStorageToken(
    input.providerSessionId,
    env.TOKEN_ENCRYPTION_KEY,
    aad(input.userId, id, "session"),
  );
  const destinationPathEncrypted = await encryptStorageToken(
    input.destinationPath,
    env.TOKEN_ENCRYPTION_KEY,
    aad(input.userId, id, "path"),
  );
  await db.prepare(
    `INSERT INTO storage_upload_sessions (
      id, user_id, show_id, connection_id, provider,
      provider_session_encrypted, destination_path_encrypted,
      file_name, mime_type, total_bytes, next_offset,
      asset_kind, folder, expires_at
    ) VALUES (?, ?, ?, ?, 'dropbox', ?, ?, ?, ?, ?, 0, ?, ?, datetime('now', '+24 hours'))`,
  ).bind(
    id,
    input.userId,
    input.showId,
    input.connection.id,
    providerSessionEncrypted,
    destinationPathEncrypted,
    input.fileName,
    input.mimeType,
    input.totalBytes,
    input.assetKind,
    input.folder,
  ).run();
  return getStorageUploadSession(db, input.userId, id);
};

export const getStorageUploadSession = async (
  db: D1DatabaseLike,
  userId: string,
  id: string,
) => db.prepare(
  `SELECT * FROM storage_upload_sessions
   WHERE id = ? AND user_id = ?
     AND completed_at IS NULL
     AND expires_at > datetime('now')
   LIMIT 1`,
).bind(id, userId).first<StorageUploadSessionRow>();

export const decryptStorageUploadSession = async (
  env: WorkerEnv,
  row: StorageUploadSessionRow,
) => {
  if (!env.TOKEN_ENCRYPTION_KEY) throw new Error("storage_token_encryption_not_configured");
  return {
    providerSessionId: await decryptStorageToken(
      row.provider_session_encrypted,
      env.TOKEN_ENCRYPTION_KEY,
      aad(row.user_id, row.id, "session"),
    ),
    destinationPath: await decryptStorageToken(
      row.destination_path_encrypted,
      env.TOKEN_ENCRYPTION_KEY,
      aad(row.user_id, row.id, "path"),
    ),
  };
};

export const advanceStorageUploadSession = async (
  db: D1DatabaseLike,
  userId: string,
  id: string,
  expectedOffset: number,
  nextOffset: number,
) => {
  const result = await db.prepare(
    `UPDATE storage_upload_sessions
     SET next_offset = ?, updated_at = datetime('now')
     WHERE id = ? AND user_id = ? AND next_offset = ?
       AND completed_at IS NULL AND expires_at > datetime('now')`,
  ).bind(nextOffset, id, userId, expectedOffset).run();
  return (result.meta?.changes ?? 0) === 1;
};

export const reconcileStorageUploadSessionOffset = async (
  db: D1DatabaseLike,
  userId: string,
  id: string,
  nextOffset: number,
) => {
  await db.prepare(
    `UPDATE storage_upload_sessions
     SET next_offset = ?, updated_at = datetime('now')
     WHERE id = ? AND user_id = ? AND completed_at IS NULL`,
  ).bind(nextOffset, id, userId).run();
};

export const completeStorageUploadSession = async (
  db: D1DatabaseLike,
  userId: string,
  id: string,
) => {
  await db.prepare(
    `UPDATE storage_upload_sessions
     SET completed_at = datetime('now'), updated_at = datetime('now')
     WHERE id = ? AND user_id = ? AND completed_at IS NULL`,
  ).bind(id, userId).run();
};

export const purgeExpiredStorageUploadSessions = async (db: D1DatabaseLike) => {
  await db.prepare(
    `DELETE FROM storage_upload_sessions
     WHERE expires_at <= datetime('now') OR completed_at IS NOT NULL`,
  ).run();
};
