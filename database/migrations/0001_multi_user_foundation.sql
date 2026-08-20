PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'deleted')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS shows (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  host_display_name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived', 'deleted')),
  storage_connection_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_shows_user_status
  ON shows(user_id, status);

CREATE INDEX IF NOT EXISTS idx_shows_user_created
  ON shows(user_id, created_at DESC);

-- Defense in depth: the application also enforces this rule, but D1 must reject
-- attempts to create a sixth active show even if an application path regresses.
CREATE TRIGGER IF NOT EXISTS shows_max_five_active_insert
BEFORE INSERT ON shows
WHEN NEW.status = 'active'
  AND (
    SELECT COUNT(*)
    FROM shows
    WHERE user_id = NEW.user_id
      AND status = 'active'
  ) >= 5
BEGIN
  SELECT RAISE(ABORT, 'active_show_limit_reached');
END;

CREATE TRIGGER IF NOT EXISTS shows_max_five_active_update
BEFORE UPDATE OF status, user_id ON shows
WHEN NEW.status = 'active'
  AND (OLD.status <> 'active' OR OLD.user_id <> NEW.user_id)
  AND (
    SELECT COUNT(*)
    FROM shows
    WHERE user_id = NEW.user_id
      AND status = 'active'
      AND id <> NEW.id
  ) >= 5
BEGIN
  SELECT RAISE(ABORT, 'active_show_limit_reached');
END;
