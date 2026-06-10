PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS repos (
  name TEXT PRIMARY KEY,
  profile_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  repo TEXT NOT NULL,
  source TEXT NOT NULL,
  title TEXT NOT NULL,
  branch TEXT,
  base_branch TEXT,
  base_sha TEXT,
  payload_json TEXT NOT NULL,
  depends_on_json TEXT NOT NULL,
  status TEXT NOT NULL,
  attempts_left INTEGER NOT NULL,
  worktree_path TEXT,
  cancel_requested_at TEXT,
  deferred_until TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_jobs_status_created_at
  ON jobs (status, created_at);

CREATE INDEX IF NOT EXISTS idx_jobs_status_deferred_until
  ON jobs (status, deferred_until, updated_at);

CREATE TABLE IF NOT EXISTS events (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  stage TEXT,
  status TEXT,
  gate_name TEXT,
  reason TEXT,
  evidence TEXT,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_job_sequence
  ON events (job_id, sequence);
