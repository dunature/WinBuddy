ALTER TABLE audit_entries
  ADD COLUMN skill_id text,
  ADD COLUMN version_id text;

UPDATE audit_entries
SET version_id = COALESCE(
  after_state->>'versionId',
  before_state->>'versionId',
  CASE WHEN action = 'skill_version.created' THEN after_state->>'id' END
)
WHERE version_id IS NULL;

UPDATE audit_entries
SET skill_id = COALESCE(after_state->>'skillId', before_state->>'skillId')
WHERE skill_id IS NULL;

UPDATE audit_entries
SET skill_id = COALESCE(after_state->>'id', before_state->>'id')
WHERE skill_id IS NULL AND action LIKE 'skill.%';

UPDATE audit_entries AS audit
SET skill_id = versions.skill_id
FROM skill_versions AS versions
WHERE audit.skill_id IS NULL AND audit.version_id = versions.id;

CREATE INDEX audit_entries_skill_created_idx ON audit_entries (skill_id, created_at DESC, id DESC);
CREATE INDEX audit_entries_version_created_idx ON audit_entries (version_id, created_at DESC, id DESC);
CREATE INDEX audit_entries_created_id_idx ON audit_entries (created_at DESC, id DESC);
