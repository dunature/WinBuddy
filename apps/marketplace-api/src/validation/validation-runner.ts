import { randomUUID } from 'node:crypto'
import yauzl, { type Entry, type ZipFile } from 'yauzl'
import postgres from 'postgres'
import { parseSkillManifest, validateMarketplacePackageEntries, type MarketplacePackageIssue, type SkillManifestV1 } from '@proma/marketplace-domain'
import type { MarketplaceValidationIssue } from '@proma/shared'
import type { MarketplaceObjectStore } from '../object-store/object-store.ts'

export interface ValidationJob { runId: string; submissionId: string; objectKey: string }
export interface ValidationPayload { manifest?: SkillManifestV1; guideMarkdown: string; files: Array<{ path: string; size: number; kind: string; content?: string }>; examples: unknown[]; issues: MarketplaceValidationIssue[] }
export interface ValidationRepository {
  claim(workerId: string, leaseUntil: Date): Promise<ValidationJob | undefined>
  finish(job: ValidationJob, payload: ValidationPayload): Promise<void>
  fail(job: ValidationJob, issue: MarketplaceValidationIssue): Promise<void>
}

export class MarketplaceValidationRunner {
  constructor(private readonly repository: ValidationRepository, private readonly objects: MarketplaceObjectStore, private readonly workerId = randomUUID(), private readonly now: () => Date = () => new Date()) {}
  async runOnce(): Promise<boolean> {
    const job = await this.repository.claim(this.workerId, new Date(this.now().getTime() + 60_000))
    if (!job) return false
    try { await this.repository.finish(job, await validateSubmissionPackage(await this.objects.getObject(job.objectKey))) }
    catch (error) { await this.repository.fail(job, { severity: 'error', code: 'VALIDATION_RUN_FAILED', message: error instanceof Error ? error.message : '校验任务失败' }) }
    return true
  }
}

export async function validateSubmissionPackage(body: Uint8Array): Promise<ValidationPayload> {
  const zip = await openZip(Buffer.from(body))
  const entries: Entry[] = []
  const files: ValidationPayload['files'] = []
  let skillSource = ''
  await new Promise<void>((resolve, reject) => {
    zip.on('entry', (entry: Entry) => {
      entries.push(entry)
      const directory = /\/$/.test(entry.fileName)
      const kind = directory ? 'directory' : classifyFile(entry.fileName)
      const base = { path: entry.fileName, size: entry.uncompressedSize, kind }
      if (directory || entry.uncompressedSize > 256 * 1024) { files.push(base); zip.readEntry(); return }
      zip.openReadStream(entry, (error, stream) => {
        if (error || !stream) { reject(error ?? new Error('无法读取 ZIP 条目')); return }
        const chunks: Buffer[] = []
        stream.on('data', (chunk: Buffer) => chunks.push(chunk))
        stream.on('error', reject)
        stream.on('end', () => {
          const content = Buffer.concat(chunks).toString('utf8')
          if (entry.fileName === 'SKILL.md') skillSource = content
          files.push({ ...base, ...(kind !== 'binary' && kind !== 'image' ? { content } : {}) })
          zip.readEntry()
        })
      })
    })
    zip.on('end', resolve)
    zip.on('error', reject)
    zip.readEntry()
  })
  const packageResult = validateMarketplacePackageEntries(entries.map((entry) => ({ path: entry.fileName, compressedSize: entry.compressedSize, uncompressedSize: entry.uncompressedSize, isDirectory: /\/$/.test(entry.fileName), isSymbolicLink: (((entry.externalFileAttributes >>> 16) & 0o170000) === 0o120000) })))
  const issues = packageResult.issues.map(mapPackageIssue)
  if (!skillSource) issues.push({ severity: 'error', code: 'MANIFEST_MISSING', message: '包根目录缺少 SKILL.md', path: 'SKILL.md' })
  const parsed = skillSource ? parseSkillManifest(skillSource) : { body: '', issues: [] }
  issues.push(...parsed.issues.map((issue) => ({ severity: issue.severity, code: issue.code, message: issue.message, ...(issue.path ? { path: issue.path } : {}) })))
  return { ...(parsed.manifest ? { manifest: parsed.manifest } : {}), guideMarkdown: parsed.body, files, examples: readExamples(files), issues }
}

export class PostgresValidationRepository implements ValidationRepository {
  private readonly sql: postgres.Sql
  constructor(databaseUrl: string) { this.sql = postgres(databaseUrl) }
  async claim(workerId: string, leaseUntil: Date): Promise<ValidationJob | undefined> {
    return this.sql.begin(async (tx) => {
      const submissions = await tx<{ id: string; object_key: string }[]>`SELECT id, object_key FROM marketplace_submissions WHERE status='validating' AND NOT EXISTS (SELECT 1 FROM marketplace_validation_runs r WHERE r.submission_id=marketplace_submissions.id AND r.status='running' AND r.lease_expires_at > now()) ORDER BY updated_at FOR UPDATE SKIP LOCKED LIMIT 1`
      const submission = submissions[0]
      if (!submission) return undefined
      const runs = await tx<{ id: string }[]>`INSERT INTO marketplace_validation_runs (submission_id, status, lease_owner, lease_expires_at, attempt) VALUES (${submission.id}, 'running', ${workerId}, ${leaseUntil}, (SELECT count(*)::int + 1 FROM marketplace_validation_runs WHERE submission_id=${submission.id})) RETURNING id`
      return { runId: runs[0]!.id, submissionId: submission.id, objectKey: submission.object_key }
    })
  }
  async finish(job: ValidationJob, payload: ValidationPayload): Promise<void> {
    await this.sql.begin(async (tx) => {
      for (const issue of payload.issues) await tx`INSERT INTO marketplace_validation_issues (run_id, severity, code, path, message) VALUES (${job.runId}, ${issue.severity}, ${issue.code}, ${issue.path ?? null}, ${issue.message})`
      const hasErrors = payload.issues.some((issue) => issue.severity === 'error')
      await tx`UPDATE marketplace_validation_runs SET status=${hasErrors ? 'failed' : 'completed'}, completed_at=now(), lease_owner=null, lease_expires_at=null WHERE id=${job.runId}`
      await tx`UPDATE marketplace_submissions SET status=${hasErrors ? 'validation_failed' : 'pending_review'}, manifest=${tx.json(toJson(payload.manifest ?? null))}, guide_markdown=${payload.guideMarkdown}, extracted_files=${tx.json(toJson(payload.files))}, extracted_examples=${tx.json(toJson(payload.examples))}, updated_at=now() WHERE id=${job.submissionId}`
    })
  }
  async fail(job: ValidationJob, issue: MarketplaceValidationIssue): Promise<void> { await this.finish(job, { guideMarkdown: '', files: [], examples: [], issues: [issue] }) }
}

function openZip(buffer: Buffer): Promise<ZipFile> { return new Promise((resolve, reject) => yauzl.fromBuffer(buffer, { lazyEntries: true, decodeStrings: true, validateEntrySizes: true }, (error, zip) => error || !zip ? reject(error ?? new Error('无法打开 ZIP')) : resolve(zip))) }
function mapPackageIssue(issue: MarketplacePackageIssue): MarketplaceValidationIssue { return { severity: 'error', code: issue.code, message: issue.message, ...(issue.path ? { path: issue.path } : {}) } }
function classifyFile(path: string): string { const ext = path.split('.').pop()?.toLowerCase(); if (ext === 'md') return 'markdown'; if (['ts', 'tsx', 'js', 'jsx', 'py', 'sh'].includes(ext ?? '')) return 'code'; if (ext === 'json') return 'json'; if (['yaml', 'yml'].includes(ext ?? '')) return 'yaml'; if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'].includes(ext ?? '')) return 'image'; return ['txt', 'csv', 'html', 'css'].includes(ext ?? '') ? 'text' : 'binary' }
function readExamples(files: ValidationPayload['files']): unknown[] { return files.filter((file) => file.path.startsWith('examples/') && file.path.endsWith('.json') && file.content).flatMap((file) => { try { const value: unknown = JSON.parse(file.content!); return Array.isArray(value) ? value : [value] } catch { return [] } }) }
function toJson(value: unknown): postgres.JSONValue { return JSON.parse(JSON.stringify(value)) as postgres.JSONValue }
