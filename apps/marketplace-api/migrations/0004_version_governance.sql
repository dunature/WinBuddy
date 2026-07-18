CREATE TABLE review_records (
  id text PRIMARY KEY,
  skill_id text NOT NULL REFERENCES skills(id),
  version_id text NOT NULL REFERENCES skill_versions(id),
  actor_id text REFERENCES admins(id) ON DELETE SET NULL,
  action text NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  request_id text NOT NULL,
  reason text,
  before_state jsonb NOT NULL,
  after_state jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX review_records_version_created_idx
  ON review_records (version_id, created_at DESC);
