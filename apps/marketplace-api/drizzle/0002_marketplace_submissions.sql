ALTER TABLE marketplace_submissions ADD COLUMN IF NOT EXISTS file_name text NOT NULL DEFAULT 'package.zip';
ALTER TABLE marketplace_submissions ADD COLUMN IF NOT EXISTS package_size bigint NOT NULL DEFAULT 0;
ALTER TABLE marketplace_submissions ADD COLUMN IF NOT EXISTS sha256 text;
ALTER TABLE marketplace_submissions ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE marketplace_validation_runs ADD COLUMN IF NOT EXISTS lease_owner text;
ALTER TABLE marketplace_validation_runs ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz;
ALTER TABLE marketplace_validation_runs ADD COLUMN IF NOT EXISTS attempt integer NOT NULL DEFAULT 0;

DO $$ BEGIN
  ALTER TABLE marketplace_submissions ADD CONSTRAINT marketplace_submissions_status_check CHECK (status IN (
    'uploading', 'validating', 'validation_failed', 'pending_review', 'rejected', 'approved', 'publishing', 'published', 'publish_failed'
  ));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS marketplace_submissions_status_idx ON marketplace_submissions(status, updated_at);
CREATE INDEX IF NOT EXISTS marketplace_validation_runs_lease_idx ON marketplace_validation_runs(status, lease_expires_at);
