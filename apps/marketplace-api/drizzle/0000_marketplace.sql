DO $$ BEGIN
  CREATE TYPE marketplace_version_status AS ENUM ('draft', 'validating', 'pending_review', 'published', 'rejected', 'unlisted', 'archived');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS marketplace_authors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), handle text NOT NULL UNIQUE, name text NOT NULL,
  official boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS marketplace_categories (
  slug text PRIMARY KEY, name text NOT NULL, description text, order_index integer NOT NULL
);
CREATE TABLE IF NOT EXISTS marketplace_skills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), slug text NOT NULL UNIQUE, display_name text NOT NULL,
  description text NOT NULL, author_id uuid NOT NULL REFERENCES marketplace_authors(id),
  category_slug text NOT NULL REFERENCES marketplace_categories(slug), latest_published_version_id uuid,
  install_count bigint NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS marketplace_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), skill_id uuid NOT NULL REFERENCES marketplace_skills(id),
  version text NOT NULL, status marketplace_version_status NOT NULL DEFAULT 'draft', guide_markdown text NOT NULL,
  changelog text, sha256 text NOT NULL, package_size bigint NOT NULL, object_key text NOT NULL, manifest jsonb NOT NULL,
  published_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(skill_id, version)
);
CREATE TABLE IF NOT EXISTS marketplace_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), version_id uuid NOT NULL REFERENCES marketplace_versions(id),
  path text NOT NULL, kind text NOT NULL, size bigint NOT NULL, content text, object_key text, UNIQUE(version_id, path)
);
CREATE TABLE IF NOT EXISTS marketplace_examples (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), version_id uuid NOT NULL REFERENCES marketplace_versions(id),
  title text NOT NULL, summary text NOT NULL, featured boolean NOT NULL DEFAULT false, content jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS marketplace_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), object_key text NOT NULL, status text NOT NULL,
  submitted_by text NOT NULL, idempotency_key text NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS marketplace_validation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), submission_id uuid NOT NULL REFERENCES marketplace_submissions(id),
  status text NOT NULL, started_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz
);
CREATE TABLE IF NOT EXISTS marketplace_validation_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), run_id uuid NOT NULL REFERENCES marketplace_validation_runs(id),
  severity text NOT NULL, code text NOT NULL, path text, message text NOT NULL
);
CREATE TABLE IF NOT EXISTS marketplace_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), submission_id uuid NOT NULL REFERENCES marketplace_submissions(id),
  actor text NOT NULL, decision text NOT NULL, reason text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS marketplace_install_events (
  event_id uuid PRIMARY KEY, skill_id uuid NOT NULL REFERENCES marketplace_skills(id), version text NOT NULL,
  platform text NOT NULL, app_version text NOT NULL, installed_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS marketplace_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor text NOT NULL, action text NOT NULL,
  skill_id uuid, details jsonb, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS marketplace_admin_users (
  github_login text PRIMARY KEY, enabled boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO marketplace_categories (slug, name, description, order_index) VALUES
  ('research', '研究与分析', '多来源研究、事实核查和竞品分析', 10),
  ('productivity', '效率工具', '任务、会议和工作流效率', 20),
  ('content', '内容创作', '选题、改写和内容生产', 30),
  ('design', '设计与 UI', '界面审查和设计规范', 40),
  ('data-ai', '数据与 AI', '数据处理与模型辅助', 50),
  ('devops', 'DevOps 与部署', '仓库、发布和部署检查', 60),
  ('writing', '文档与写作', '技术文档和知识整理', 70)
ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, order_index = EXCLUDED.order_index;
