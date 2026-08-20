PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS episodes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  show_id TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'source_ready' CHECK (status IN (
    'draft',
    'source_ready',
    'analyzing',
    'awaiting_edit_approval',
    'awaiting_render_confirmation',
    'rendering',
    'completed',
    'failed',
    'cancelled'
  )),
  source_provider TEXT NOT NULL CHECK (source_provider IN ('google-drive', 'dropbox')),
  source_storage_connection_id TEXT NOT NULL,
  source_file_id TEXT NOT NULL,
  source_file_name TEXT NOT NULL,
  source_mime_type TEXT NOT NULL,
  source_size_bytes INTEGER NOT NULL CHECK (source_size_bytes > 0),
  source_immutable INTEGER NOT NULL DEFAULT 1 CHECK (source_immutable = 1),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (show_id) REFERENCES shows(id) ON DELETE CASCADE,
  FOREIGN KEY (source_storage_connection_id) REFERENCES storage_connections(id),
  UNIQUE (show_id, source_file_id)
);

CREATE INDEX IF NOT EXISTS idx_episodes_user_show_created
  ON episodes(user_id, show_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_episodes_user_status
  ON episodes(user_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_episodes_show_status
  ON episodes(show_id, status, updated_at DESC);
