-- Session Sentinel schema v2

CREATE TABLE IF NOT EXISTS _meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT OR IGNORE INTO _meta (key, value) VALUES ('schema_version', '2');

CREATE TABLE IF NOT EXISTS sessions (
  id                  TEXT PRIMARY KEY,
  claude_session_id   TEXT UNIQUE NOT NULL,
  label               TEXT,
  status              TEXT NOT NULL DEFAULT 'starting',
  type                TEXT NOT NULL DEFAULT 'unmanaged',
  owner               TEXT,
  cwd                 TEXT,
  project_name        TEXT,
  model               TEXT,
  effort              TEXT,
  git_branch          TEXT,
  git_remote          TEXT,
  jsonl_path          TEXT NOT NULL,
  pid                 INTEGER,
  remote_url          TEXT,
  last_entrypoint     TEXT,
  input_tokens        INTEGER NOT NULL DEFAULT 0,
  output_tokens       INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens   INTEGER NOT NULL DEFAULT 0,
  cache_create_tokens INTEGER NOT NULL DEFAULT 0,
  pending_question    TEXT,
  last_output         TEXT,
  error_message       TEXT,
  can_resume          INTEGER NOT NULL DEFAULT 1,
  parent_session_id   TEXT,
  notifications_enabled     INTEGER NOT NULL DEFAULT 1,
  notifications_target_override TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at            TEXT
);

CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
CREATE INDEX IF NOT EXISTS idx_sessions_type ON sessions(type);
CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_name);
CREATE INDEX IF NOT EXISTS idx_sessions_owner ON sessions(owner);

CREATE TABLE IF NOT EXISTS runs (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id          TEXT NOT NULL REFERENCES sessions(id),
  run_number          INTEGER NOT NULL,
  jsonl_path          TEXT NOT NULL,
  start_type          TEXT NOT NULL DEFAULT 'startup',
  type_during_run     TEXT NOT NULL DEFAULT 'unmanaged',
  owner_during_run    TEXT,
  model               TEXT,
  effort              TEXT,
  remote_url          TEXT,
  sentinel_managed    INTEGER NOT NULL DEFAULT 0,
  input_tokens        INTEGER NOT NULL DEFAULT 0,
  output_tokens       INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens   INTEGER NOT NULL DEFAULT 0,
  cache_create_tokens INTEGER NOT NULL DEFAULT 0,
  started_at          TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at            TEXT
);

CREATE INDEX IF NOT EXISTS idx_runs_session ON runs(session_id);

CREATE TABLE IF NOT EXISTS sub_agents (
  id                  TEXT PRIMARY KEY,
  session_id          TEXT NOT NULL REFERENCES sessions(id),
  pattern             TEXT NOT NULL,
  agent_type          TEXT,
  description         TEXT,
  jsonl_path          TEXT NOT NULL,
  input_tokens        INTEGER NOT NULL DEFAULT 0,
  output_tokens       INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens   INTEGER NOT NULL DEFAULT 0,
  cache_create_tokens INTEGER NOT NULL DEFAULT 0,
  started_at          TEXT,
  ended_at            TEXT
);

CREATE INDEX IF NOT EXISTS idx_subagents_session ON sub_agents(session_id);

CREATE TABLE IF NOT EXISTS session_events (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id          TEXT NOT NULL REFERENCES sessions(id),
  event_type          TEXT NOT NULL,
  from_status         TEXT,
  to_status           TEXT,
  actor               TEXT NOT NULL DEFAULT 'monitor',
  detail              TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_events_session ON session_events(session_id);
CREATE INDEX IF NOT EXISTS idx_events_type ON session_events(event_type);

CREATE TABLE IF NOT EXISTS transcript_cache (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id          TEXT NOT NULL REFERENCES sessions(id),
  run_id              INTEGER REFERENCES runs(id),
  turn                INTEGER NOT NULL,
  role                TEXT NOT NULL,
  content             TEXT NOT NULL,
  tools_used          TEXT,
  input_tokens        INTEGER NOT NULL DEFAULT 0,
  output_tokens       INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens   INTEGER NOT NULL DEFAULT 0,
  cache_create_tokens INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_transcript_session ON transcript_cache(session_id);

CREATE TABLE IF NOT EXISTS notifications (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id          TEXT NOT NULL REFERENCES sessions(id),
  channel             TEXT NOT NULL,
  destination         TEXT NOT NULL,
  trigger             TEXT NOT NULL,
  payload             TEXT,
  delivered           INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_notifications_session ON notifications(session_id);

CREATE TABLE IF NOT EXISTS projects (
  name                TEXT PRIMARY KEY,
  cwd                 TEXT UNIQUE NOT NULL,
  discovered_at       TEXT NOT NULL DEFAULT (datetime('now')),
  last_session_at     TEXT,
  session_count       INTEGER NOT NULL DEFAULT 0,
  alias               TEXT
);
