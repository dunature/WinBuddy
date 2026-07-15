import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { convertDelimitedToSpreadsheetPreview } from './file-preview-service'

const fixtureDir = join(tmpdir(), 'proma-preview', 'spreadsheet-preview-test')

describe('file-preview / CSV TSV 结构化预览', () => {
  beforeAll(() => {
    rmSync(fixtureDir, { recursive: true, force: true })
    mkdirSync(fixtureDir, { recursive: true })
  })

  afterAll(() => {
    rmSync(fixtureDir, { recursive: true, force: true })
  })

  test('Given CSV 包含引号和多行单元格 When 解析 Then 保留单元格结构', async () => {
    const filePath = join(fixtureDir, 'sample.csv')
    writeFileSync(filePath, 'name,note\nAlice,"第一行\n第二行"\nBob,"包含,逗号"', 'utf-8')

    const result = await convertDelimitedToSpreadsheetPreview(filePath)
    expect(result?.sheets).toHaveLength(1)
    const sheet = result!.sheets[0]!
    expect(sheet.cells.find((cell) => cell.row === 1 && cell.column === 1)?.value).toBe('第一行\n第二行')
    expect(sheet.cells.find((cell) => cell.row === 2 && cell.column === 1)?.value).toBe('包含,逗号')
  })

  test('Given TSV When 解析 Then 使用制表符分列', async () => {
    const filePath = join(fixtureDir, 'sample.tsv')
    writeFileSync(filePath, 'city\tamount\n上海\t12\n北京\t18', 'utf-8')

    const result = await convertDelimitedToSpreadsheetPreview(filePath)
    const sheet = result!.sheets[0]!
    expect(sheet.columnCount).toBe(2)
    expect(sheet.cells.find((cell) => cell.row === 2 && cell.column === 0)?.value).toBe('北京')
    expect(result?.text).toContain('上海\t12')
  })
})
