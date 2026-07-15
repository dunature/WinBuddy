import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  ensureResolvedPathAllowed,
  filterAllowedCandidateBasePaths,
} from './preview-access-core'

const previewRoot = join(tmpdir(), 'proma-preview', 'preview-access-test')
const outsideRoot = join(tmpdir(), 'proma-preview-outside-test')

describe('file-preview / 路径授权', () => {
  beforeAll(() => {
    rmSync(previewRoot, { recursive: true, force: true })
    rmSync(outsideRoot, { recursive: true, force: true })
    mkdirSync(previewRoot, { recursive: true })
    mkdirSync(outsideRoot, { recursive: true })
    writeFileSync(join(previewRoot, 'allowed.txt'), '允许访问', 'utf-8')
    writeFileSync(join(outsideRoot, 'secret.txt'), '禁止访问', 'utf-8')
    if (!existsSync(join(previewRoot, 'secret-link.txt'))) {
      symlinkSync(join(outsideRoot, 'secret.txt'), join(previewRoot, 'secret-link.txt'))
    }
  })

  afterAll(() => {
    rmSync(previewRoot, { recursive: true, force: true })
    rmSync(outsideRoot, { recursive: true, force: true })
  })

  test('Given 授权目录内文件 When 请求预览 Then 返回 realpath', async () => {
    const result = ensureResolvedPathAllowed(join(previewRoot, 'allowed.txt'), [previewRoot])
    expect(result).toBe(realpathSync(join(previewRoot, 'allowed.txt')))
  })

  test('Given 授权 candidate base When 使用相对路径 Then 允许解析', async () => {
    const result = filterAllowedCandidateBasePaths([previewRoot], [previewRoot])
    expect(result).toEqual([previewRoot])
  })

  test('Given 未授权绝对路径 When 请求预览 Then 拒绝访问', async () => {
    const result = ensureResolvedPathAllowed(join(outsideRoot, 'secret.txt'), [previewRoot])
    expect(result).toBeNull()
  })

  test('Given 符号链接指向授权目录外 When 请求预览 Then 按最终 realpath 拒绝', async () => {
    const result = ensureResolvedPathAllowed(join(previewRoot, 'secret-link.txt'), [previewRoot])
    expect(result).toBeNull()
  })

  test('Given candidate base 中包含未授权目录 When 使用相对路径 Then 不使用该目录', async () => {
    const result = filterAllowedCandidateBasePaths([outsideRoot], [previewRoot])
    expect(result).toBeUndefined()
  })
})
