PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS auth_password_credentials (
  user_id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  iterations INTEGER NOT NULL CHECK (iterations >= 100000),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_auth_password_credentials_email
  ON auth_password_credentials(email);

CREATE TABLE IF NOT EXISTS auth_password_verifications (
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  iterations INTEGER NOT NULL CHECK (iterations >= 100000),
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_auth_password_verifications_email_created
  ON auth_password_verifications(email, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_auth_password_verifications_expiry
  ON auth_password_verifications(expires_at);

CREATE TABLE IF NOT EXISTS auth_password_resets (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  email TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_auth_password_resets_user_created
  ON auth_password_resets(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_auth_password_resets_expiry
  ON auth_password_resets(expires_at);

CREATE TABLE IF NOT EXISTS auth_rate_limits (
  action TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  window_started_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (action, key_hash)
);

CREATE INDEX IF NOT EXISTS idx_auth_rate_limits_updated
  ON auth_rate_limits(updated_at);
