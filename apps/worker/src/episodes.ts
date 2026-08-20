import type { D1DatabaseLike } from "./db";
import type { GoogleDriveStoredFile } from "./google-drive";
import type { ShowRow } from "./shows";
import type { StorageConnectionRow } from "./storage-store";

export type EpisodeStatus =
  | "draft"
  | "source_ready"
  | "analyzing"
  | "awaiting_edit_approval"
  | "awaiting_render_confirmation"
  | "rendering"
  | "completed"
  | "failed"
  | "cancelled";

export interface EpisodeRow {
  id: string;
  user_id: string;
  show_id: string;
  title: string;
  status: EpisodeStatus;
  source_provider: "google-drive" | "dropbox";
  source_storage_connection_id: string;
  source_file_id: string;
  source_file_name: string;
  source_mime_type: string;
  source_size_bytes: number;
  source_immutable: number;
  created_at: string;
  updated_at: string;
}

const episodeSelect = `
  SELECT id, user_id, show_id, title, status,
         source_provider, source_storage_connection_id,
         source_file_id, source_file_name, source_mime_type,
         source_size_bytes, source_immutable, created_at, updated_at
  FROM episodes`;

const cleanEpisodeTitle = (value: string) => {
  const cleaned = value.trim();
  if (!cleaned) throw new Error("episode_title_required");
  if (cleaned.length > 160) throw new Error("episode_title_too_long");
  return cleaned;
};

const titleFromFileName = (fileName: string) => {
  const withoutExtension = fileName.replace(/\.[^.]+$/, "").trim();
  return cleanEpisodeTitle(withoutExtension || "HRPodcast");
};

const requireVerifiedOriginal = (show: ShowRow, file: GoogleDriveStoredFile) => {
  if (
    file.appProperties.assetKind !== "original-recording" ||
    file.appProperties.immutable !== "true" ||
    file.appProperties.showId !== show.id ||
    file.appProperties.folder !== "episodes"
  ) {
    throw new Error("episode_source_not_verified_original");
  }
  if (!file.id || !file.name || !file.mimeType || !file.sizeBytes || file.sizeBytes <= 0) {
    throw new Error("episode_source_metadata_invalid");
  }
};

export const getEpisodeForUser = async (
  db: D1DatabaseLike,
  userId: string,
  episodeId: string,
): Promise<EpisodeRow | null> =>
  db
    .prepare(`${episodeSelect} WHERE id = ? AND user_id = ?`)
    .bind(episodeId, userId)
    .first<EpisodeRow>();

export const listEpisodesForShow = async (
  db: D1DatabaseLike,
  userId: string,
  showId: string,
): Promise<EpisodeRow[]> => {
  const { results } = await db
    .prepare(`${episodeSelect} WHERE user_id = ? AND show_id = ? ORDER BY created_at DESC`)
    .bind(userId, showId)
    .all<EpisodeRow>();
  return results;
};

export const ensureEpisodeFromVerifiedOriginal = async (
  db: D1DatabaseLike,
  userId: string,
  show: ShowRow,
  connection: StorageConnectionRow,
  file: GoogleDriveStoredFile,
): Promise<EpisodeRow> => {
  requireVerifiedOriginal(show, file);
  if (show.user_id !== userId || connection.user_id !== userId) {
    throw new Error("episode_source_tenant_mismatch");
  }
  if (show.storage_connection_id !== connection.id) {
    throw new Error("episode_source_connection_mismatch");
  }

  const id = crypto.randomUUID();
  const title = titleFromFileName(file.name);
  await db
    .prepare(
      `INSERT OR IGNORE INTO episodes (
         id, user_id, show_id, title, status,
         source_provider, source_storage_connection_id,
         source_file_id, source_file_name, source_mime_type,
         source_size_bytes, source_immutable
       ) VALUES (?, ?, ?, ?, 'source_ready', ?, ?, ?, ?, ?, ?, 1)`,
    )
    .bind(
      id,
      userId,
      show.id,
      title,
      connection.provider,
      connection.id,
      file.id,
      file.name,
      file.mimeType,
      file.sizeBytes,
    )
    .run();

  const episode = await db
    .prepare(
      `${episodeSelect}
       WHERE user_id = ? AND show_id = ? AND source_provider = ? AND source_file_id = ?`,
    )
    .bind(userId, show.id, connection.provider, file.id)
    .first<EpisodeRow>();
  if (!episode) throw new Error("episode_create_failed");
  return episode;
};

export const updateEpisodeTitleForUser = async (
  db: D1DatabaseLike,
  userId: string,
  episodeId: string,
  title: string,
): Promise<EpisodeRow | null> => {
  const existing = await getEpisodeForUser(db, userId, episodeId);
  if (!existing) return null;
  const cleaned = cleanEpisodeTitle(title);
  await db
    .prepare(
      `UPDATE episodes
       SET title = ?, updated_at = datetime('now')
       WHERE id = ? AND user_id = ?`,
    )
    .bind(cleaned, episodeId, userId)
    .run();
  return getEpisodeForUser(db, userId, episodeId);
};
