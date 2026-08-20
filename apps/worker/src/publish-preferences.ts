import {
  DEFAULT_TEMPLATE_ID,
  getSafeTemplateManifest,
  SAFE_TEMPLATE_MANIFESTS,
  type SafeTemplateId,
} from "@hrtechify/templates";
import type { D1DatabaseLike } from "./db";
import type { EpisodeRow } from "./episodes";

export interface EpisodePublishPreferenceRow {
  episode_id: string;
  user_id: string;
  show_id: string;
  template_id: SafeTemplateId;
  template_version: 1;
  captions_enabled: 0 | 1;
  created_at: string;
  updated_at: string;
}

const select = `
  SELECT episode_id, user_id, show_id, template_id, template_version,
         captions_enabled, created_at, updated_at
  FROM episode_publish_preferences`;

export const listSafePublishTemplates = () =>
  SAFE_TEMPLATE_MANIFESTS.map((manifest) => ({
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    backgroundColor: manifest.style.backgroundColor,
    textColor: manifest.style.textColor,
    accentColor: manifest.style.accentColor,
    platformCredit: manifest.platformCredit,
  }));

export const ensureEpisodePublishPreferences = async (
  db: D1DatabaseLike,
  userId: string,
  episode: EpisodeRow,
) => {
  if (episode.user_id !== userId) throw new Error("episode_not_found");
  await db
    .prepare(
      `INSERT OR IGNORE INTO episode_publish_preferences
         (episode_id, user_id, show_id, template_id, template_version, captions_enabled)
       VALUES (?, ?, ?, ?, 1, 1)`,
    )
    .bind(episode.id, userId, episode.show_id, DEFAULT_TEMPLATE_ID)
    .run();
  const row = await db
    .prepare(`${select} WHERE episode_id = ? AND user_id = ? AND show_id = ?`)
    .bind(episode.id, userId, episode.show_id)
    .first<EpisodePublishPreferenceRow>();
  if (!row) throw new Error("publish_preferences_create_failed");
  getSafeTemplateManifest(row.template_id, row.template_version);
  if (row.captions_enabled !== 0 && row.captions_enabled !== 1) {
    throw new Error("publish_preferences_corrupt");
  }
  return row;
};

export const updateEpisodePublishPreferences = async (
  db: D1DatabaseLike,
  userId: string,
  episode: EpisodeRow,
  input: { templateId: unknown; captionsEnabled: unknown },
) => {
  if (episode.user_id !== userId) throw new Error("episode_not_found");
  const manifest = getSafeTemplateManifest(input.templateId, 1);
  if (typeof input.captionsEnabled !== "boolean") {
    throw new Error("captions_enabled_invalid");
  }
  await ensureEpisodePublishPreferences(db, userId, episode);
  await db
    .prepare(
      `UPDATE episode_publish_preferences
       SET template_id = ?, template_version = 1, captions_enabled = ?,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE episode_id = ? AND user_id = ? AND show_id = ?`,
    )
    .bind(
      manifest.id,
      input.captionsEnabled ? 1 : 0,
      episode.id,
      userId,
      episode.show_id,
    )
    .run();
  return ensureEpisodePublishPreferences(db, userId, episode);
};
