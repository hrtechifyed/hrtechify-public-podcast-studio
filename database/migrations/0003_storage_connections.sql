PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS storage_connections (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('google-drive', 'dropbox')),
  provider_account_id TEXT NOT NULL,
  provider_account_email TEXT,
  refresh_token_encrypted TEXT NOT NULL,
  scopes TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked', 'error')),
  last_used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE (user_id, provider, provider_account_id)
);

CREATE INDEX IF NOT EXISTS idx_storage_connections_user_provider
  ON storage_connections(user_id, provider, status);

CREATE TABLE IF NOT EXISTS storage_oauth_states (
  state_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('google-drive', 'dropbox')),
  code_verifier TEXT NOT NULL,
  return_to TEXT NOT NULL DEFAULT '/',
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_storage_oauth_states_expiry
  ON storage_oauth_states(expires_at);

CREATE INDEX IF NOT EXISTS idx_storage_oauth_states_user
  ON storage_oauth_states(user_id, provider);

CREATE INDEX IF NOT EXISTS idx_shows_storage_connection
  ON shows(storage_connection_id);
