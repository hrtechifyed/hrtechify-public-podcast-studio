PRAGMA foreign_keys = ON;

-- Dropbox does not provide Drive-style custom appProperties on files.
-- This table stores only the Studio's ownership/workflow metadata; media bytes remain in user storage.
CREATE TABLE IF NOT EXISTS storage_asset_records (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  show_id TEXT NOT NULL,
  connection_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('google-drive', 'dropbox')),
  provider_file_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT,
  size_bytes INTEGER CHECK (size_bytes IS NULL OR size_bytes >= 0),
  folder TEXT NOT NULL CHECK (folder IN ('brand-assets', 'templates', 'episodes')),
  asset_kind TEXT NOT NULL,
  immutable INTEGER NOT NULL DEFAULT 1 CHECK (immutable IN (0, 1)),
  original INTEGER NOT NULL DEFAULT 0 CHECK (original IN (0, 1)),
  source_file_id TEXT,
  source_asset_id TEXT,
  analysis_run_id TEXT,
  render_job_id TEXT,
  state_marker INTEGER NOT NULL DEFAULT 0 CHECK (state_marker IN (0, 1)),
  selection_choice TEXT CHECK (selection_choice IS NULL OR selection_choice IN ('original', 'background-removed')),
  selected_asset_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (show_id) REFERENCES shows(id) ON DELETE CASCADE,
  FOREIGN KEY (connection_id) REFERENCES storage_connections(id) ON DELETE CASCADE,
  UNIQUE (provider, connection_id, provider_file_id)
);

CREATE INDEX IF NOT EXISTS idx_storage_asset_records_show_kind
  ON storage_asset_records(user_id, show_id, connection_id, asset_kind, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_storage_asset_records_source
  ON storage_asset_records(user_id, show_id, connection_id, source_file_id, asset_kind, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_storage_asset_records_render
  ON storage_asset_records(user_id, show_id, connection_id, render_job_id, asset_kind, created_at DESC);
