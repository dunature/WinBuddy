import { sql } from 'drizzle-orm'
import { boolean, integer, jsonb, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core'
import type { MarketplaceSkillStatus, MarketplaceVersionStatus } from '@proma/marketplace-domain'

export const categories = pgTable('categories', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  icon: text('icon').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const skills = pgTable('skills', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull().unique(),
  name: text('name').notNull(),
  tagline: text('tagline').notNull(),
  description: text('description').notNull(),
  authorName: text('author_name').notNull(),
  authorUrl: text('author_url'),
  categoryId: text('category_id').notNull().references(() => categories.id),
  tags: text('tags').array().notNull().default(sql`'{}'::text[]`),
  icon: text('icon').notNull(),
  featured: boolean('featured').notNull().default(false),
  installs: integer('installs').notNull().default(0),
  status: text('status').$type<MarketplaceSkillStatus>().notNull(),
  currentPublishedVersionId: text('current_published_version_id'),
  revision: integer('revision').notNull().default(1),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  deletedBy: text('deleted_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const skillVersions = pgTable('skill_versions', {
  id: text('id').primaryKey(),
  skillId: text('skill_id').notNull().references(() => skills.id),
  version: text('version').notNull(),
  changelog: text('changelog').notNull().default(''),
  sha256: text('sha256').notNull(),
  size: integer('size').notNull(),
  fileCount: integer('file_count').notNull(),
  status: text('status').$type<MarketplaceVersionStatus>().notNull(),
  revision: integer('revision').notNull().default(1),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const versionFiles = pgTable('version_files', {
  versionId: text('version_id').notNull().references(() => skillVersions.id, { onDelete: 'cascade' }),
  path: text('path').notNull(),
  size: integer('size').notNull(),
  isText: boolean('is_text').notNull(),
  content: text('content'),
}, (table) => [primaryKey({ columns: [table.versionId, table.path] })])

export const admins = pgTable('admins', {
  id: text('id').primaryKey(),
  username: text('username').notNull(),
  normalizedUsername: text('normalized_username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  mustChangePassword: boolean('must_change_password').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const adminSessions = pgTable('admin_sessions', {
  id: text('id').primaryKey(),
  adminId: text('admin_id').notNull().references(() => admins.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  csrfTokenHash: text('csrf_token_hash').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  invalidatedAt: timestamp('invalidated_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const auditEntries = pgTable('audit_entries', {
  id: text('id').primaryKey(),
  actorId: text('actor_id').references(() => admins.id, { onDelete: 'set null' }),
  actorIdentifier: text('actor_identifier'),
  action: text('action').notNull(),
  requestId: text('request_id').notNull(),
  ipAddress: text('ip_address'),
  beforeState: jsonb('before_state'),
  afterState: jsonb('after_state'),
  reason: text('reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})
