import { LineCounter, parseDocument } from 'yaml'
import { validateManifest } from '../validation/manifest-validator.ts'
import type { ManifestIssue, ParseManifestResult } from './types.ts'

const FRONTMATTER_BOUNDARY = '---'

interface FrontmatterParts {
  yaml: string
  body: string
  yamlStartOffset: number
}

function splitFrontmatter(source: string): FrontmatterParts | ManifestIssue {
  const normalized = source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  const lines = normalized.split('\n')

  if (lines[0] !== FRONTMATTER_BOUNDARY) {
    return {
      code: 'MANIFEST_FRONTMATTER_MISSING',
      message: 'SKILL.md 必须以 YAML Frontmatter 开始',
      severity: 'error',
      line: 1,
      column: 1,
    }
  }

  const closingIndex = lines.indexOf(FRONTMATTER_BOUNDARY, 1)
  if (closingIndex < 0) {
    return {
      code: 'MANIFEST_FRONTMATTER_UNCLOSED',
      message: 'SKILL.md 的 YAML Frontmatter 缺少结束分隔线',
      severity: 'error',
      line: 1,
      column: 1,
    }
  }

  return {
    yaml: lines.slice(1, closingIndex).join('\n'),
    body: lines.slice(closingIndex + 1).join('\n').replace(/^\n/, ''),
    yamlStartOffset: FRONTMATTER_BOUNDARY.length + 1,
  }
}

export function parseSkillManifest(source: string): ParseManifestResult {
  const parts = splitFrontmatter(source)
  if ('code' in parts) return { body: '', issues: [parts] }

  const lineCounter = new LineCounter()
  const document = parseDocument(parts.yaml, {
    lineCounter,
    prettyErrors: false,
    strict: true,
    uniqueKeys: true,
  })

  if (document.errors.length > 0) {
    return {
      body: parts.body,
      issues: document.errors.map((error) => {
        const position = lineCounter.linePos(error.pos[0] ?? 0)
        return {
          code: 'MANIFEST_YAML_INVALID',
          message: `YAML 解析失败：${error.message}`,
          severity: 'error' as const,
          line: position.line + 1,
          column: position.col,
        }
      }),
    }
  }

  const value: unknown = document.toJS()
  const validation = validateManifest(value)
  return {
    manifest: validation.manifest,
    body: parts.body,
    issues: validation.issues,
  }
}
