import { sql } from 'drizzle-orm'
import { boolean, integer, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core'

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
  status: text('status').notNull(),
  currentPublishedVersionId: text('current_published_version_id'),
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
  status: text('status').notNull(),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const versionFiles = pgTable('version_files', {
  versionId: text('version_id').notNull().references(() => skillVersions.id, { onDelete: 'cascade' }),
  path: text('path').notNull(),
  size: integer('size').notNull(),
  isText: boolean('is_text').notNull(),
  content: text('content'),
}, (table) => [primaryKey({ columns: [table.versionId, table.path] })])
