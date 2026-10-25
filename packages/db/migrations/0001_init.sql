-- Initial schema. Plain SQL kept portable to PostgreSQL:
--   * TEXT primary keys (app-generated ids), ISO-8601 UTC TEXT timestamps
--   * JSON stored as TEXT and validated with Zod in the application
--   * booleans as INTEGER 0/1
-- SQLite requires: PRAGMA foreign_keys = ON on every connection.

CREATE TABLE projects (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  base_url      TEXT NOT NULL,
  allowed_origin TEXT NOT NULL,
  path_scope    TEXT NOT NULL DEFAULT '/',
  query_policy  TEXT NOT NULL DEFAULT 'none',   -- none | all | comma-separated allowlist
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE crawl_jobs (
  id             TEXT PRIMARY KEY,
  project_id     TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  status         TEXT NOT NULL CHECK (status IN ('queued','running','completed','cancelled','failed')),
  max_pages      INTEGER NOT NULL CHECK (max_pages > 0),
  cancel_requested INTEGER NOT NULL DEFAULT 0 CHECK (cancel_requested IN (0,1)),
  error_category TEXT,
  created_at     TEXT NOT NULL,
  started_at     TEXT,
  finished_at    TEXT
);
CREATE INDEX idx_crawl_jobs_project ON crawl_jobs(project_id, created_at);

-- scan_status separates "scanned" from "could not be reached" / "skipped" / "blocked" (honest coverage).
CREATE TABLE pages (
  id             TEXT PRIMARY KEY,
  crawl_job_id   TEXT NOT NULL REFERENCES crawl_jobs(id) ON DELETE CASCADE,
  project_id     TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  url            TEXT NOT NULL,
  normalized_url TEXT NOT NULL,
  final_url      TEXT,
  http_status    INTEGER,
  scan_status    TEXT NOT NULL CHECK (scan_status IN ('pending','scanned','unreachable','skipped','blocked')),
  error_message  TEXT,
  scanned_at     TEXT,
  UNIQUE (crawl_job_id, normalized_url)
);
CREATE INDEX idx_pages_project ON pages(project_id);

-- No field values, password values, or raw HTML are stored here by design.
CREATE TABLE elements (
  id              TEXT PRIMARY KEY,
  page_id         TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  category        TEXT NOT NULL,
  tag_name        TEXT NOT NULL,
  role            TEXT,
  accessible_name TEXT,
  label           TEXT,
  placeholder     TEXT,
  input_type      TEXT,
  name_attr       TEXT,
  id_attr         TEXT,
  safe_attrs      TEXT NOT NULL DEFAULT '{}',
  is_required     INTEGER NOT NULL DEFAULT 0 CHECK (is_required IN (0,1)),
  is_disabled     INTEGER NOT NULL DEFAULT 0 CHECK (is_disabled IN (0,1)),
  is_readonly     INTEGER NOT NULL DEFAULT 0 CHECK (is_readonly IN (0,1)),
  is_checked      INTEGER CHECK (is_checked IN (0,1)),
  is_visible      INTEGER NOT NULL CHECK (is_visible IN (0,1)),
  bounding_box    TEXT,
  locators        TEXT NOT NULL DEFAULT '[]',
  match_count     INTEGER,
  confidence      REAL CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  detected_at     TEXT NOT NULL
);
CREATE INDEX idx_elements_page_category ON elements(page_id, category);

CREATE TABLE test_cases (
  id              TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name            TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  description     TEXT NOT NULL DEFAULT '',
  target_page_url TEXT NOT NULL,
  definition      TEXT NOT NULL,                -- structured JSON steps; never executable code
  action_policy   TEXT NOT NULL DEFAULT 'read_only' CHECK (action_policy IN ('read_only','allow_state_changing')),
  timeout_ms      INTEGER NOT NULL CHECK (timeout_ms > 0),
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX idx_test_cases_project ON test_cases(project_id);

-- A run cannot exist without an explicit approval snapshot (approved_at/approved_plan NOT NULL).
-- idempotency_key is UNIQUE to block accidental duplicate execution requests.
CREATE TABLE test_runs (
  id              TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  status          TEXT NOT NULL CHECK (status IN ('queued','running','passed','failed','cancelled','errored')),
  idempotency_key TEXT NOT NULL UNIQUE,
  approved_at     TEXT NOT NULL,
  approved_plan   TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  started_at      TEXT,
  finished_at     TEXT
);
CREATE INDEX idx_test_runs_project ON test_runs(project_id, created_at);

CREATE TABLE test_results (
  id            TEXT PRIMARY KEY,
  run_id        TEXT NOT NULL REFERENCES test_runs(id) ON DELETE CASCADE,
  test_case_id  TEXT REFERENCES test_cases(id) ON DELETE SET NULL,
  test_name     TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('passed','failed','skipped','errored')),
  skip_reason   TEXT,
  duration_ms   INTEGER,
  error_message TEXT
);
CREATE INDEX idx_test_results_run ON test_results(run_id);

CREATE TABLE step_results (
  id            TEXT PRIMARY KEY,
  result_id     TEXT NOT NULL REFERENCES test_results(id) ON DELETE CASCADE,
  step_index    INTEGER NOT NULL CHECK (step_index >= 0),
  action        TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('passed','failed','skipped','errored')),
  expected      TEXT,
  actual        TEXT,
  duration_ms   INTEGER,
  error_message TEXT,
  diagnostics   TEXT,
  UNIQUE (result_id, step_index)
);

-- storage_key is relative to ARTIFACT_DIR; absolute server paths are never stored or exposed.
CREATE TABLE artifacts (
  id           TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  run_id       TEXT REFERENCES test_runs(id) ON DELETE CASCADE,
  result_id    TEXT REFERENCES test_results(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('screenshot','report','scan_export')),
  storage_key  TEXT NOT NULL CHECK (storage_key NOT LIKE '/%' AND storage_key NOT LIKE '%..%'),
  content_type TEXT NOT NULL,
  size_bytes   INTEGER NOT NULL CHECK (size_bytes >= 0),
  created_at   TEXT NOT NULL
);
CREATE INDEX idx_artifacts_project ON artifacts(project_id);
