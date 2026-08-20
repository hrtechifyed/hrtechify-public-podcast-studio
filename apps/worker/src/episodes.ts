import { validateMusicPlan } from "@hrtechify/audio";
import { templateById } from "@hrtechify/templates";
import type { MusicCue, RecordingSourceKind } from "@hrtechify/shared";
import type { D1DatabaseLike } from "./db";
import { getShowForUser } from "./shows";

export interface EpisodeRow {
  id: string;
  user_id: string;
  show_id: string;
  title: string;
  status: string;
  source_kind: RecordingSourceKind;
  source_file_id: string;
  source_file_name: string;
  source_mime_type: string | null;
  source_size_bytes: number | null;
  drive_episode_folder_id: string;
  template_id: string;
  template_version: number;
  music_plan_json: string;
  created_at: string;
  updated_at: string;
}

export interface CreateEpisodeInput {
  id?: string;
  title: string;
  sourceKind: RecordingSourceKind;
  sourceFileId: string;
  sourceFileName: string;
  sourceMimeType?: string;
  sourceSizeBytes?: number;
  driveEpisodeFolderId: string;
  templateId: string;
  templateVersion?: number;
  musicPlan?: MusicCue[];
}

const cleanText = (value: string, field: string, maxLength: number) => {
  const cleaned = value.trim();
  if (!cleaned) throw new Error(`${field}_required`);
  if (cleaned.length > maxLength) throw new Error(`${field}_too_long`);
  return cleaned;
};

const parseMusicPlan = (value: string): MusicCue[] => {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? (parsed as MusicCue[]) : [];
  } catch {
    return [];
  }
};

export const serializeEpisode = (episode: EpisodeRow) => ({
  id: episode.id,
  showId: episode.show_id,
  title: episode.title,
  status: episode.status,
  sourceKind: episode.source_kind,
  sourceFileId: episode.source_file_id,
  sourceFileName: episode.source_file_name,
  sourceMimeType: episode.source_mime_type,
  sourceSizeBytes: episode.source_size_bytes,
  driveEpisodeFolderId: episode.drive_episode_folder_id,
  templateId: episode.template_id,
  templateVersion: episode.template_version,
  musicPlan: parseMusicPlan(episode.music_plan_json),
  createdAt: episode.created_at,
  updatedAt: episode.updated_at,
});

export const listEpisodesForShow = async (
  db: D1DatabaseLike,
  userId: string,
  showId: string,
): Promise<EpisodeRow[] | null> => {
  const show = await getShowForUser(db, userId, showId);
  if (!show) return null;

  const { results } = await db
    .prepare(
      `SELECT id, user_id, show_id, title, status, source_kind, source_file_id,
              source_file_name, source_mime_type, source_size_bytes,
              drive_episode_folder_id, template_id, template_version,
              music_plan_json, created_at, updated_at
       FROM episodes
       WHERE user_id = ? AND show_id = ?
       ORDER BY created_at DESC`,
    )
    .bind(userId, showId)
    .all<EpisodeRow>();
  return results;
};

export const createEpisodeForShow = async (
  db: D1DatabaseLike,
  userId: string,
  showId: string,
  input: CreateEpisodeInput,
): Promise<EpisodeRow> => {
  const show = await getShowForUser(db, userId, showId);
  if (!show) throw new Error("show_not_found");
  if (!show.drive_show_folder_id || !show.drive_episodes_folder_id) {
    throw new Error("google_drive_workspace_required");
  }

  const title = cleanText(input.title, "episode_title", 180);
  const sourceFileId = cleanText(input.sourceFileId, "source_file_id", 256);
  const sourceFileName = cleanText(input.sourceFileName, "source_file_name", 240);
  const driveEpisodeFolderId = cleanText(input.driveEpisodeFolderId, "drive_episode_folder_id", 256);
  const templateId = cleanText(input.templateId, "template_id", 120);
  if (input.sourceKind !== "upload" && input.sourceKind !== "recording") {
    throw new Error("source_kind_invalid");
  }

  const template = templateById(templateId);
  if (!template) throw new Error("template_not_found");
  const musicPlan = validateMusicPlan(input.musicPlan ?? [], template.musicTrackIds);
  const id = input.id?.trim() || crypto.randomUUID();
  const version = Number.isFinite(Number(input.templateVersion))
    ? Math.max(1, Math.floor(Number(input.templateVersion)))
    : template.version;
  const sourceSize = Number.isFinite(Number(input.sourceSizeBytes))
    ? Math.max(0, Math.floor(Number(input.sourceSizeBytes)))
    : null;

  await db
    .prepare(
      `INSERT INTO episodes
        (id, user_id, show_id, title, status, source_kind, source_file_id,
         source_file_name, source_mime_type, source_size_bytes,
         drive_episode_folder_id, template_id, template_version, music_plan_json)
       VALUES (?, ?, ?, ?, 'source_ready', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      userId,
      showId,
      title,
      input.sourceKind,
      sourceFileId,
      sourceFileName,
      input.sourceMimeType?.trim() || null,
      sourceSize,
      driveEpisodeFolderId,
      template.id,
      version,
      JSON.stringify(musicPlan),
    )
    .run();

  const episode = await db
    .prepare(
      `SELECT id, user_id, show_id, title, status, source_kind, source_file_id,
              source_file_name, source_mime_type, source_size_bytes,
              drive_episode_folder_id, template_id, template_version,
              music_plan_json, created_at, updated_at
       FROM episodes WHERE id = ? AND user_id = ? AND show_id = ?`,
    )
    .bind(id, userId, showId)
    .first<EpisodeRow>();
  if (!episode) throw new Error("episode_create_failed");
  return episode;
};
