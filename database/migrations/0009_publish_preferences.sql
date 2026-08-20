-- Stage 9: safe final-publish preferences.
-- Stores only curated template identity and caption preference; no FFmpeg commands or free-form render settings.

CREATE TABLE IF NOT EXISTS episode_publish_preferences (
  episode_id TEXT PRIMARY KEY REFERENCES episodes(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  show_id TEXT NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
  template_id TEXT NOT NULL DEFAULT 'hrtechify-studio-dark',
  template_version INTEGER NOT NULL DEFAULT 1 CHECK (template_version = 1),
  captions_enabled INTEGER NOT NULL DEFAULT 1 CHECK (captions_enabled IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_episode_publish_preferences_owner
  ON episode_publish_preferences(user_id, show_id, episode_id);
