CREATE TABLE uploads (
  id text PRIMARY KEY,
  skill_version_id text NOT NULL REFERENCES skill_versions(id),
  original_filename text NOT NULL,
  storage_key text NOT NULL UNIQUE,
  sha256 text NOT NULL,
  size integer NOT NULL CHECK (size >= 0),
  status text NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  created_by text REFERENCES admins(id) ON DELETE SET NULL,
  last_error text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE validation_reports (
  id text PRIMARY KEY,
  upload_id text NOT NULL UNIQUE REFERENCES uploads(id) ON DELETE CASCADE,
  passed boolean NOT NULL,
  checks jsonb NOT NULL,
  manifest jsonb,
  root_directory text,
  file_count integer NOT NULL CHECK (file_count >= 0),
  expanded_size integer NOT NULL CHECK (expanded_size >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX uploads_version_created_idx
  ON uploads (skill_version_id, created_at DESC);
CREATE INDEX uploads_queue_idx
  ON uploads (status, created_at);
