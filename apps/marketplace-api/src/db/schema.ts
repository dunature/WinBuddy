import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

export const marketplaceVersionStatus = pgEnum('marketplace_version_status', [
  'draft', 'validating', 'pending_review', 'published', 'rejected', 'unlisted', 'archived',
])

export const marketplaceAuthors = pgTable('marketplace_authors', {
  id: uuid('id').primaryKey().defaultRandom(),
  handle: text('handle').notNull(),
  name: text('name').notNull(),
  official: boolean('official').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex('marketplace_authors_handle_uidx').on(table.handle)])

export const marketplaceCategories = pgTable('marketplace_categories', {
  slug: text('slug').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  order: integer('order_index').notNull(),
})

export const marketplaceSkills = pgTable('marketplace_skills', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull(),
  displayName: text('display_name').notNull(),
  description: text('description').notNull(),
  authorId: uuid('author_id').notNull().references(() => marketplaceAuthors.id),
  categorySlug: text('category_slug').notNull().references(() => marketplaceCategories.slug),
  latestPublishedVersionId: uuid('latest_published_version_id'),
  installCount: bigint('install_count', { mode: 'number' }).notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('marketplace_skills_slug_uidx').on(table.slug),
  index('marketplace_skills_category_idx').on(table.categorySlug),
])

export const marketplaceVersions = pgTable('marketplace_versions', {
  id: uuid('id').primaryKey().defaultRandom(),
  skillId: uuid('skill_id').notNull().references(() => marketplaceSkills.id),
  version: text('version').notNull(),
  status: marketplaceVersionStatus('status').notNull().default('draft'),
  guideMarkdown: text('guide_markdown').notNull(),
  changelog: text('changelog'),
  sha256: text('sha256').notNull(),
  packageSize: bigint('package_size', { mode: 'number' }).notNull(),
  objectKey: text('object_key').notNull(),
  manifest: jsonb('manifest').notNull(),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex('marketplace_versions_skill_version_uidx').on(table.skillId, table.version)])

export const marketplaceFiles = pgTable('marketplace_files', {
  id: uuid('id').primaryKey().defaultRandom(),
  versionId: uuid('version_id').notNull().references(() => marketplaceVersions.id),
  path: text('path').notNull(),
  kind: text('kind').notNull(),
  size: bigint('size', { mode: 'number' }).notNull(),
  content: text('content'),
  objectKey: text('object_key'),
}, (table) => [uniqueIndex('marketplace_files_version_path_uidx').on(table.versionId, table.path)])

export const marketplaceExamples = pgTable('marketplace_examples', {
  id: uuid('id').primaryKey().defaultRandom(),
  versionId: uuid('version_id').notNull().references(() => marketplaceVersions.id),
  title: text('title').notNull(),
  summary: text('summary').notNull(),
  featured: boolean('featured').notNull().default(false),
  content: jsonb('content').notNull(),
})

export const marketplaceSubmissions = pgTable('marketplace_submissions', {
  id: uuid('id').primaryKey().defaultRandom(),
  objectKey: text('object_key').notNull(),
  status: text('status').notNull(),
  submittedBy: text('submitted_by').notNull(),
  idempotencyKey: text('idempotency_key').notNull(),
  fileName: text('file_name').notNull().default('package.zip'),
  packageSize: bigint('package_size', { mode: 'number' }).notNull().default(0),
  sha256: text('sha256'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex('marketplace_submissions_idempotency_uidx').on(table.idempotencyKey)])

export const marketplaceValidationRuns = pgTable('marketplace_validation_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  submissionId: uuid('submission_id').notNull().references(() => marketplaceSubmissions.id),
  status: text('status').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  leaseOwner: text('lease_owner'),
  leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
  attempt: integer('attempt').notNull().default(0),
})

export const marketplaceValidationIssues = pgTable('marketplace_validation_issues', {
  id: uuid('id').primaryKey().defaultRandom(),
  runId: uuid('run_id').notNull().references(() => marketplaceValidationRuns.id),
  severity: text('severity').notNull(),
  code: text('code').notNull(),
  path: text('path'),
  message: text('message').notNull(),
})

export const marketplaceReviews = pgTable('marketplace_reviews', {
  id: uuid('id').primaryKey().defaultRandom(),
  submissionId: uuid('submission_id').notNull().references(() => marketplaceSubmissions.id),
  actor: text('actor').notNull(),
  decision: text('decision').notNull(),
  reason: text('reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const marketplaceInstallEvents = pgTable('marketplace_install_events', {
  eventId: uuid('event_id').primaryKey(),
  skillId: uuid('skill_id').notNull().references(() => marketplaceSkills.id),
  version: text('version').notNull(),
  platform: text('platform').notNull(),
  appVersion: text('app_version').notNull(),
  installedAt: timestamp('installed_at', { withTimezone: true }).notNull(),
})

export const marketplaceAuditLogs = pgTable('marketplace_audit_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  actor: text('actor').notNull(),
  action: text('action').notNull(),
  skillId: uuid('skill_id'),
  details: jsonb('details'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const marketplaceAdminUsers = pgTable('marketplace_admin_users', {
  githubLogin: text('github_login').primaryKey(),
  displayName: text('display_name').notNull().default(''),
  avatarUrl: text('avatar_url'),
  role: text('role').notNull().default('editor'),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const marketplaceAdminSessions = pgTable('marketplace_admin_sessions', {
  tokenHash: text('token_hash').primaryKey(),
  githubLogin: text('github_login').notNull().references(() => marketplaceAdminUsers.githubLogin),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})
