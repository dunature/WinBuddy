ALTER TABLE skills
  ADD COLUMN revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  ADD COLUMN deleted_at timestamptz,
  ADD COLUMN deleted_by text REFERENCES admins(id) ON DELETE SET NULL;

ALTER TABLE skill_versions
  ADD COLUMN revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX skills_admin_list_idx ON skills (deleted_at, updated_at DESC);
