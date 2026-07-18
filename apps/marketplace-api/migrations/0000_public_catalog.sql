CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE categories (
  id text PRIMARY KEY,
  name text NOT NULL UNIQUE,
  icon text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE skills (
  id text PRIMARY KEY,
  identifier text NOT NULL UNIQUE,
  name text NOT NULL,
  tagline text NOT NULL,
  description text NOT NULL,
  author_name text NOT NULL,
  author_url text,
  category_id text NOT NULL REFERENCES categories(id),
  tags text[] NOT NULL DEFAULT '{}',
  icon text NOT NULL,
  featured boolean NOT NULL DEFAULT false,
  installs integer NOT NULL DEFAULT 0 CHECK (installs >= 0),
  status text NOT NULL CHECK (status IN ('draft', 'published', 'unpublished', 'archived')),
  current_published_version_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE skill_versions (
  id text PRIMARY KEY,
  skill_id text NOT NULL REFERENCES skills(id),
  version text NOT NULL,
  changelog text NOT NULL DEFAULT '',
  sha256 text NOT NULL,
  size integer NOT NULL CHECK (size >= 0),
  file_count integer NOT NULL CHECK (file_count >= 0),
  status text NOT NULL CHECK (status IN (
    'created', 'validation_failed', 'pending_review', 'approved',
    'rejected', 'published', 'unpublished', 'archived'
  )),
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (skill_id, version)
);

ALTER TABLE skills
  ADD CONSTRAINT skills_current_published_version_fk
  FOREIGN KEY (current_published_version_id) REFERENCES skill_versions(id);

CREATE TABLE version_files (
  version_id text NOT NULL REFERENCES skill_versions(id) ON DELETE CASCADE,
  path text NOT NULL,
  size integer NOT NULL CHECK (size >= 0),
  is_text boolean NOT NULL,
  content text,
  PRIMARY KEY (version_id, path)
);

CREATE INDEX skills_search_trgm_idx
  ON skills USING gin ((name || ' ' || identifier || ' ' || tagline) gin_trgm_ops);
CREATE INDEX skills_category_idx ON skills (category_id);
CREATE INDEX skills_current_published_version_idx ON skills (current_published_version_id);
CREATE INDEX skill_versions_skill_published_idx ON skill_versions (skill_id, published_at DESC);
