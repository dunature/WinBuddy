ALTER TABLE categories
  ADD COLUMN normalized_name text,
  ADD COLUMN revision integer NOT NULL DEFAULT 1,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

UPDATE categories
SET normalized_name = lower(regexp_replace(trim(name), '[[:space:]]+', ' ', 'g'));

ALTER TABLE categories ALTER COLUMN normalized_name SET NOT NULL;
CREATE UNIQUE INDEX categories_normalized_name_unique ON categories (normalized_name);

ALTER TABLE skills DROP CONSTRAINT skills_category_id_fkey;
ALTER TABLE skills ALTER COLUMN category_id DROP NOT NULL;
ALTER TABLE skills
  ADD CONSTRAINT skills_category_id_fkey
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL;

CREATE TABLE tags (
  id text PRIMARY KEY,
  name text NOT NULL,
  normalized_name text NOT NULL UNIQUE,
  revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE skill_tags (
  skill_id text NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  tag_id text NOT NULL REFERENCES tags(id),
  PRIMARY KEY (skill_id, tag_id)
);

INSERT INTO tags (id, name, normalized_name)
SELECT 'legacy-' || md5(normalized_name), name, normalized_name
FROM (
  SELECT DISTINCT ON (lower(regexp_replace(trim(tag_name), '[[:space:]]+', ' ', 'g')))
    regexp_replace(trim(tag_name), '[[:space:]]+', ' ', 'g') AS name,
    lower(regexp_replace(trim(tag_name), '[[:space:]]+', ' ', 'g')) AS normalized_name
  FROM skills, unnest(skills.tags) AS tag_name
  WHERE trim(tag_name) <> ''
  ORDER BY lower(regexp_replace(trim(tag_name), '[[:space:]]+', ' ', 'g')), tag_name
) legacy_tags;

INSERT INTO skill_tags (skill_id, tag_id)
SELECT DISTINCT skills.id, tags.id
FROM skills
CROSS JOIN LATERAL unnest(skills.tags) AS tag_name
INNER JOIN tags
  ON tags.normalized_name = lower(regexp_replace(trim(tag_name), '[[:space:]]+', ' ', 'g'));

CREATE INDEX skill_tags_tag_skill_idx ON skill_tags (tag_id, skill_id);
