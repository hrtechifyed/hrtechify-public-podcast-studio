PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS user_onboarding (
  user_id TEXT PRIMARY KEY,
  starter_show_id TEXT,
  brand_prompt_dismissed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (starter_show_id) REFERENCES shows(id) ON DELETE SET NULL
);

-- Accounts that already existed before starter onboarding must not suddenly receive
-- a new HRTechify show or a first-time prompt.
INSERT OR IGNORE INTO user_onboarding
  (user_id, starter_show_id, brand_prompt_dismissed_at)
SELECT id, NULL, datetime('now')
FROM users;

CREATE TABLE IF NOT EXISTS show_preferences (
  show_id TEXT PRIMARY KEY,
  default_episode_name TEXT NOT NULL DEFAULT 'HRPodcast',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (show_id) REFERENCES shows(id) ON DELETE CASCADE
);
