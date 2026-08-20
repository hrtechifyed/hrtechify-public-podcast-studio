PRAGMA foreign_keys = ON;

ALTER TABLE shows ADD COLUMN drive_show_folder_id TEXT;
ALTER TABLE shows ADD COLUMN drive_episodes_folder_id TEXT;
ALTER TABLE shows ADD COLUMN deleted_at TEXT;

-- The product limit is five non-deleted shows total. Archived shows still occupy
-- a slot until the user explicitly deletes one.
CREATE TRIGGER IF NOT EXISTS shows_max_five_total_insert
BEFORE INSERT ON shows
WHEN NEW.status <> 'deleted'
  AND (
    SELECT COUNT(*)
    FROM shows
    WHERE user_id = NEW.user_id
      AND status <> 'deleted'
  ) >= 5
BEGIN
  SELECT RAISE(ABORT, 'show_limit_reached');
END;

CREATE TRIGGER IF NOT EXISTS shows_max_five_total_restore
BEFORE UPDATE OF status, user_id ON shows
WHEN NEW.status <> 'deleted'
  AND (OLD.status = 'deleted' OR OLD.user_id <> NEW.user_id)
  AND (
    SELECT COUNT(*)
    FROM shows
    WHERE user_id = NEW.user_id
      AND status <> 'deleted'
      AND id <> NEW.id
  ) >= 5
BEGIN
  SELECT RAISE(ABORT, 'show_limit_reached');
END;

CREATE TABLE IF NOT EXISTS episodes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  show_id TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'source_ready' CHECK (
    status IN (
      'draft',
      'source_ready',
      'analyzing',
      'awaiting_edit_approval',
      'awaiting_render_confirmation',
      'rendering',
      'completed',
      'failed',
      'cancelled'
    )
  ),
  source_kind TEXT NOT NULL CHECK (source_kind IN ('upload', 'recording')),
  source_file_id TEXT NOT NULL,
  source_file_name TEXT NOT NULL,
  source_mime_type TEXT,
  source_size_bytes INTEGER,
  drive_episode_folder_id TEXT NOT NULL,
  template_id TEXT NOT NULL,
  template_version INTEGER NOT NULL DEFAULT 1,
  music_plan_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (show_id) REFERENCES shows(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_episodes_user_show_created
  ON episodes(user_id, show_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_episodes_show_status
  ON episodes(show_id, status);
