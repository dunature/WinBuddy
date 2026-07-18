CREATE TABLE admins (
  id text PRIMARY KEY CHECK (id = 'primary'),
  username text NOT NULL,
  normalized_username text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  must_change_password boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE admin_sessions (
  id text PRIMARY KEY,
  admin_id text NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  csrf_token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  invalidated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_entries (
  id text PRIMARY KEY,
  actor_id text REFERENCES admins(id) ON DELETE SET NULL,
  actor_identifier text,
  action text NOT NULL,
  request_id text NOT NULL,
  ip_address text,
  before_state jsonb,
  after_state jsonb,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX admin_sessions_expires_at_idx ON admin_sessions (expires_at);
CREATE INDEX audit_entries_action_created_idx ON audit_entries (action, created_at DESC);
CREATE INDEX audit_entries_actor_created_idx ON audit_entries (actor_identifier, created_at DESC);
CREATE INDEX audit_entries_ip_created_idx ON audit_entries (ip_address, created_at DESC);
