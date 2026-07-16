ALTER TABLE marketplace_submissions ADD COLUMN IF NOT EXISTS manifest jsonb;
ALTER TABLE marketplace_submissions ADD COLUMN IF NOT EXISTS guide_markdown text;
ALTER TABLE marketplace_submissions ADD COLUMN IF NOT EXISTS extracted_files jsonb;
ALTER TABLE marketplace_submissions ADD COLUMN IF NOT EXISTS extracted_examples jsonb;
