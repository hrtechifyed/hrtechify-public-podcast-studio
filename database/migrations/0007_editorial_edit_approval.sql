PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS episode_edit_analysis_runs (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL,
  show_id TEXT NOT NULL,
  episode_id TEXT NOT NULL,
  source_file_id TEXT NOT NULL,
  analyzer_version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'analyzing' CHECK (status IN ('analyzing', 'completed', 'failed')),
  failure_code TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  completed_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (show_id) REFERENCES shows(id) ON DELETE CASCADE,
  FOREIGN KEY (episode_id) REFERENCES episodes(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_edit_analysis_episode_sequence
  ON episode_edit_analysis_runs(user_id, episode_id, sequence DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_edit_analysis_one_active_per_episode
  ON episode_edit_analysis_runs(episode_id)
  WHERE status = 'analyzing';

CREATE TABLE IF NOT EXISTS episode_edit_proposals (
  id TEXT PRIMARY KEY,
  analysis_run_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  show_id TEXT NOT NULL,
  episode_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN (
    'unusual_pause',
    'false_start',
    'repeated_speech',
    'fumble',
    'spoken_content_removal'
  )),
  start_ms INTEGER NOT NULL CHECK (start_ms >= 0),
  end_ms INTEGER NOT NULL CHECK (end_ms > start_ms),
  explanation TEXT NOT NULL CHECK (length(trim(explanation)) > 0),
  confidence REAL CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (analysis_run_id) REFERENCES episode_edit_analysis_runs(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (show_id) REFERENCES shows(id) ON DELETE CASCADE,
  FOREIGN KEY (episode_id) REFERENCES episodes(id) ON DELETE CASCADE,
  UNIQUE (analysis_run_id, kind, start_ms, end_ms)
);

CREATE INDEX IF NOT EXISTS idx_edit_proposals_episode_range
  ON episode_edit_proposals(user_id, episode_id, start_ms, end_ms);

CREATE TABLE IF NOT EXISTS episode_edit_decisions (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL,
  show_id TEXT NOT NULL,
  episode_id TEXT NOT NULL,
  proposal_id TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('apply', 'keep_original')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (show_id) REFERENCES shows(id) ON DELETE CASCADE,
  FOREIGN KEY (episode_id) REFERENCES episodes(id) ON DELETE CASCADE,
  FOREIGN KEY (proposal_id) REFERENCES episode_edit_proposals(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_edit_decisions_proposal_latest
  ON episode_edit_decisions(user_id, proposal_id, sequence DESC);

CREATE INDEX IF NOT EXISTS idx_edit_decisions_episode_latest
  ON episode_edit_decisions(user_id, episode_id, sequence DESC);
