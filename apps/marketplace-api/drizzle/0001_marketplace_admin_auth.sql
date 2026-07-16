ALTER TABLE marketplace_admin_users ADD COLUMN IF NOT EXISTS display_name text NOT NULL DEFAULT '';
ALTER TABLE marketplace_admin_users ADD COLUMN IF NOT EXISTS avatar_url text;
ALTER TABLE marketplace_admin_users ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'editor';

DO $$ BEGIN
  ALTER TABLE marketplace_admin_users ADD CONSTRAINT marketplace_admin_users_role_check
    CHECK (role IN ('admin', 'reviewer', 'editor'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS marketplace_admin_sessions (
  token_hash text PRIMARY KEY,
  github_login text NOT NULL REFERENCES marketplace_admin_users(github_login),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS marketplace_admin_sessions_expiry_idx ON marketplace_admin_sessions(expires_at);
