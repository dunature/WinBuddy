import type { Sql } from 'postgres'
import { createMarketplaceApp } from '../../marketplace-api/src/app'
import { createMarketplaceDatabase } from '../../marketplace-api/src/database/client'
import { runMarketplaceMigrations } from '../../marketplace-api/src/database/migrate'
import { createMarketplaceTestDatabase } from '../../marketplace-api/tests/test-database'
import { cleanupTrackedE2eDatabase, writeE2eDatabaseState } from './database-state'

const adminDatabaseUrl = Bun.env.MARKETPLACE_TEST_ADMIN_DATABASE_URL
if (!adminDatabaseUrl) throw new Error('E2E 缺少 MARKETPLACE_TEST_ADMIN_DATABASE_URL')

async function seedCatalog(sql: Sql): Promise<void> {
  await sql`
    INSERT INTO categories (id, name, icon)
    VALUES
      ('research', '研究分析', 'search'),
      ('docs', '文档创作', 'file-text'),
      ('automation', '效率自动化', 'workflow')
  `

  await sql`
    INSERT INTO skills (
      id, identifier, name, tagline, description, author_name, category_id,
      tags, icon, featured, installs, status, updated_at
    ) VALUES (
      'skill-deep-research', 'deep-research', '深度研究助手', '生成可追溯的研究报告',
      '从公开资料出发，整理证据、结论与引用。', 'Proma Labs', 'research',
      ARRAY['研究', '报告'], 'search', true, 1280, 'published', '2026-07-18T08:00:00.000Z'
    )
  `
  await sql`
    INSERT INTO skill_versions (
      id, skill_id, version, changelog, sha256, size, file_count, status, published_at
    ) VALUES
      ('version-deep-current', 'skill-deep-research', '1.2.0', '增强引用追踪与报告结构。', 'sha-current', 42000, 2, 'published', '2026-07-18T08:00:00.000Z'),
      ('version-deep-history', 'skill-deep-research', '1.1.0', '首个稳定研究流程。', 'sha-history', 39000, 2, 'unpublished', '2026-06-18T08:00:00.000Z'),
      ('version-deep-candidate', 'skill-deep-research', '1.3.0', '候选版本。', 'sha-candidate', 43000, 1, 'pending_review', NULL)
  `
  await sql`
    UPDATE skills SET current_published_version_id = 'version-deep-current'
    WHERE id = 'skill-deep-research'
  `
  await sql`
    INSERT INTO version_files (version_id, path, size, is_text, content) VALUES
      ('version-deep-current', 'SKILL.md', 180, true, '# 深度研究助手\n\n当前版本提供**证据追踪**与结构化研究流程。\n\n![远程示例](https://example.invalid/tracker.png)\n\n<script>globalThis.pwned = true</script>\n\n[危险链接](javascript:alert(1))'),
      ('version-deep-current', 'references/guide.md', 34, true, '# 引用指南\n\n只引用可验证的公开来源。'),
      ('version-deep-history', 'SKILL.md', 48, true, '# 深度研究助手\n\n这是 1.1.0 历史版本。'),
      ('version-deep-history', 'references/guide.md', 28, true, '# 引用指南\n\n保留来源链接。')
  `

  for (let index = 1; index <= 17; index += 1) {
    const skillId = `skill-${index}`
    const versionId = `version-${index}`
    const identifier = `workflow-${String(index).padStart(2, '0')}`
    const category = index % 2 === 0 ? 'docs' : 'automation'
    const featured = index % 5 === 0
    const publishedAt = `2026-07-${String(index).padStart(2, '0')}T08:00:00.000Z`
    await sql`
      INSERT INTO skills (
        id, identifier, name, tagline, description, author_name, category_id,
        tags, icon, featured, installs, status, updated_at
      ) VALUES (
        ${skillId}, ${identifier}, ${`工作流工具 ${index}`}, ${`处理日常任务 ${index}`},
        ${`面向日常工作的公开技能 ${index}。`}, 'Proma Community', ${category},
        ARRAY['工作流'], 'workflow', ${featured}, ${index * 37}, 'published', ${publishedAt}
      )
    `
    await sql`
      INSERT INTO skill_versions (
        id, skill_id, version, changelog, sha256, size, file_count, status, published_at
      ) VALUES (${versionId}, ${skillId}, '1.0.0', '首次发布。', ${`sha-${index}`}, 1024, 1, 'published', ${publishedAt})
    `
    await sql`UPDATE skills SET current_published_version_id = ${versionId} WHERE id = ${skillId}`
    await sql`
      INSERT INTO version_files (version_id, path, size, is_text, content)
      VALUES (${versionId}, 'SKILL.md', 32, true, ${`# 工作流工具 ${index}\n\n公开说明。`})
    `
  }
}

await cleanupTrackedE2eDatabase(adminDatabaseUrl)
const testDatabase = await createMarketplaceTestDatabase(adminDatabaseUrl)
await writeE2eDatabaseState(testDatabase.databaseUrl)
const database = createMarketplaceDatabase(testDatabase.databaseUrl)
await runMarketplaceMigrations(database.sql)
await seedCatalog(database.sql)

const webRoot = new URL('../dist', import.meta.url).pathname
const app = createMarketplaceApp({ database, webRoot })
const server = Bun.serve({ hostname: '127.0.0.1', port: 4320, fetch: app.fetch })
console.log(`[技能市场 Web E2E] 已启动: ${server.url}`)

let closing = false
async function close(): Promise<void> {
  if (closing) return
  closing = true
  server.stop(true)
  await database.sql.end()
  await cleanupTrackedE2eDatabase(adminDatabaseUrl)
  process.exit(0)
}

process.on('SIGINT', () => { void close() })
process.on('SIGTERM', () => { void close() })
