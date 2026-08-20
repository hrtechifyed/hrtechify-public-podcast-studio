PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS episode_render_jobs (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL,
  show_id TEXT NOT NULL,
  episode_id TEXT NOT NULL,
  workflow_instance_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN (
    'queued', 'processing', 'completed', 'failed', 'cancelled'
  )),
  source_provider TEXT NOT NULL CHECK (source_provider IN ('google-drive', 'dropbox')),
  source_storage_connection_id TEXT NOT NULL,
  source_file_id TEXT NOT NULL,
  cleanup_profile_version TEXT NOT NULL,
  approved_edits_json TEXT NOT NULL,
  technical_plan_json TEXT NOT NULL,
  derived_file_id TEXT,
  derived_file_name TEXT,
  derived_mime_type TEXT,
  derived_size_bytes INTEGER CHECK (derived_size_bytes IS NULL OR derived_size_bytes > 0),
  failure_code TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  started_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (show_id) REFERENCES shows(id) ON DELETE CASCADE,
  FOREIGN KEY (episode_id) REFERENCES episodes(id) ON DELETE CASCADE,
  FOREIGN KEY (source_storage_connection_id) REFERENCES storage_connections(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_render_jobs_one_active_per_episode
  ON episode_render_jobs(episode_id)
  WHERE status IN ('queued', 'processing');

CREATE INDEX IF NOT EXISTS idx_render_jobs_user_episode_sequence
  ON episode_render_jobs(user_id, episode_id, sequence DESC);

CREATE INDEX IF NOT EXISTS idx_render_jobs_user_status
  ON episode_render_jobs(user_id, status, updated_at DESC);
