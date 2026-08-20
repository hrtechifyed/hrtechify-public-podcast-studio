PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS storage_upload_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  show_id TEXT NOT NULL,
  connection_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('dropbox')),
  provider_session_encrypted TEXT NOT NULL,
  destination_path_encrypted TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  total_bytes INTEGER NOT NULL CHECK (total_bytes > 0),
  next_offset INTEGER NOT NULL DEFAULT 0 CHECK (next_offset >= 0),
  asset_kind TEXT NOT NULL,
  folder TEXT NOT NULL CHECK (folder IN ('brand-assets', 'episodes')),
  expires_at TEXT NOT NULL,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (show_id) REFERENCES shows(id) ON DELETE CASCADE,
  FOREIGN KEY (connection_id) REFERENCES storage_connections(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_storage_upload_sessions_user_expiry
  ON storage_upload_sessions(user_id, expires_at);

CREATE INDEX IF NOT EXISTS idx_storage_upload_sessions_show_active
  ON storage_upload_sessions(show_id, completed_at, expires_at);
