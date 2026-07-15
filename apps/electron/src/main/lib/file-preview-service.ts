/**
 * 文件预览服务 — 内联预览支持
 *
 * 提供文件路径解析、PDF 预览 HTML 生成、DOCX 转 HTML 等功能，
 * 供 PreviewPanel 内联面板使用。
 */

import { basename, join, dirname, extname, resolve, posix as pathPosix } from 'node:path'
import { readFileSync, readdirSync, statSync, mkdirSync, existsSync, writeFileSync, unlinkSync, mkdtempSync, rmSync, realpathSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import AdmZip from 'adm-zip'
import { DOMParser } from '@xmldom/xmldom'
import type {
  FilePreviewNotice,
  LibreOfficeStatus,
  MarkupPreviewResult,
  OfficePreviewResult,
  PdfPreviewResult,
  SpreadsheetCell,
  SpreadsheetPreviewResult,
  SpreadsheetSheetPreview,
} from '@proma/shared'

const require = createRequire(__filename)
const PDFJS_PACKAGE = 'pdfjs-dist'

/** 文件大小限制：50MB */
const MAX_FILE_SIZE = 50 * 1024 * 1024
const MAX_XLSX_SHEETS = 8
const MAX_SPREADSHEET_CELLS = 100_000
const MAX_ZIP_ENTRIES = 8_000
const MAX_ZIP_UNCOMPRESSED_BYTES = 180 * 1024 * 1024
const MAX_PPTX_SLIDES = 80
const LIBREOFFICE_TIMEOUT_MS = 45_000
let libreOfficeQueue: Promise<void> = Promise.resolve()

// ─── 临时文件 ───

function getPreviewTmpDir(): string {
  const dir = join(tmpdir(), 'proma-preview')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

function writeTempHtml(html: string): string {
  const tmpDir = getPreviewTmpDir()
  const contentHash = createHash('md5').update(html).digest('hex').slice(0, 16)
  const tmpFile = join(tmpDir, `preview-${contentHash}.html`)
  if (!existsSync(tmpFile)) {
    writeFileSync(tmpFile, html, 'utf-8')
  }
  return tmpFile
}

/** 清理所有临时预览文件 */
export function cleanPreviewTmpDir(): number {
  const dir = join(tmpdir(), 'proma-preview')
  if (!existsSync(dir)) return 0
  let count = 0
  try {
    for (const f of readdirSync(dir)) {
      try { unlinkSync(join(dir, f)); count++ } catch { /* skip */ }
    }
  } catch { /* skip */ }
  return count
}

// ─── 路径解析 ───

/**
 * 在目录中递归搜索指定文件名
 */
function searchFileInDir(dir: string, targetName: string, maxDepth = 8): string | null {
  const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.next', '__pycache__', '.venv', 'build', '.cache', 'target'])
  let scanned = 0
  const MAX_SCANNED = 500

  function walk(current: string, depth: number): string | null {
    if (depth > maxDepth || scanned > MAX_SCANNED) return null
    try {
      const entries = readdirSync(current, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.isFile() && entry.name === targetName) {
          return join(current, entry.name)
        }
      }
      for (const entry of entries) {
        if (entry.isDirectory() && !SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
          scanned++
          const found = walk(join(current, entry.name), depth + 1)
          if (found) return found
        }
      }
    } catch { /* permission denied etc */ }
    return null
  }

  return walk(dir, 0)
}

/**
 * 解析待预览的文件路径
 * - 绝对路径：直接 resolve，不存在时 fallback 搜索
 * - 相对路径：依次尝试 basePaths，返回第一个存在的；都不存在则 fallback 搜索
 */
export function resolveTargetPath(filePath: string, basePaths?: string[]): string {
  if (filePath.startsWith('/') || /^[A-Za-z]:[\\/]/.test(filePath)) {
    const direct = resolve(filePath)
    if (existsSync(direct)) return direct
    const name = basename(direct)
    if (basePaths) {
      for (const base of basePaths) {
        if (!base) continue
        const found = searchFileInDir(base, name)
        if (found) return found
      }
    }
    const awIdx = filePath.indexOf('agent-workspaces')
    if (awIdx !== -1) {
      const wsRoot = filePath.slice(0, awIdx + 'agent-workspaces'.length)
      if (existsSync(wsRoot)) {
        const found = searchFileInDir(wsRoot, name)
        if (found) return found
      }
    }
    return direct
  }
  if (basePaths && basePaths.length > 0) {
    const firstSegment = filePath.split('/')[0]
    if (firstSegment) {
      for (const base of basePaths) {
        if (!base) continue
        if (basename(base) === firstSegment) {
          const candidate = resolve(dirname(base), filePath)
          if (existsSync(candidate)) return candidate
        }
      }
    }
    for (const base of basePaths) {
      if (!base) continue
      const candidate = resolve(base, filePath)
      if (existsSync(candidate)) return candidate
    }
    const home = homedir()
    const homeCandidate = resolve(home, filePath)
    if (existsSync(homeCandidate)) return homeCandidate
    const rootCandidate = resolve('/', filePath)
    if (existsSync(rootCandidate)) return rootCandidate
    const name = basename(filePath)
    for (const base of basePaths) {
      if (!base) continue
      const found = searchFileInDir(base, name)
      if (found) return found
    }
    return resolve(basePaths[0]!, filePath)
  }
  const homeCandidate = resolve(homedir(), filePath)
  if (existsSync(homeCandidate)) return homeCandidate
  const rootCandidate = resolve('/', filePath)
  if (existsSync(rootCandidate)) return rootCandidate
  return resolve(filePath)
}

// ─── Office Open XML 预览 ───

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function parseXml(xml: string): Document {
  return new DOMParser().parseFromString(xml, 'application/xml')
}

function getElementsByLocalName(root: Node, localName: string): Element[] {
  const result: Element[] = []

  function walk(node: Node): void {
    const children = node.childNodes
    if (!children) return
    for (let i = 0; i < children.length; i++) {
      const child = children.item(i)
      if (child.nodeType === 1) {
        const element = child as Element
        if (element.localName === localName || element.nodeName === localName) {
          result.push(element)
        }
      }
      walk(child)
    }
  }

  walk(root)
  return result
}

function getDirectChildElementsByLocalName(root: Element | Document, localName: string): Element[] {
  const result: Element[] = []
  const children = root.childNodes
  if (!children) return result
  for (let i = 0; i < children.length; i++) {
    const child = children.item(i)
    if (child.nodeType !== 1) continue
    const element = child as Element
    if (element.localName === localName || element.nodeName === localName) {
      result.push(element)
    }
  }
  return result
}

function getFirstTextByLocalName(root: Element, localName: string): string {
  return getElementsByLocalName(root, localName)[0]?.textContent ?? ''
}

function readZipText(zip: AdmZip, path: string): string | null {
  const entry = zip.getEntry(path)
  return entry ? entry.getData().toString('utf-8') : null
}

function assertZipWithinPreviewLimits(zip: AdmZip): void {
  const entries = zip.getEntries()
  if (entries.length > MAX_ZIP_ENTRIES) {
    throw new Error(`压缩包条目过多，无法安全预览（${entries.length} > ${MAX_ZIP_ENTRIES}）`)
  }
  const totalSize = entries.reduce((sum, entry) => sum + entry.header.size, 0)
  if (totalSize > MAX_ZIP_UNCOMPRESSED_BYTES) {
    throw new Error('压缩包解压后体积过大，已停止预览')
  }
}

function normalizeZipTarget(baseDir: string, target: string): string {
  const normalizedTarget = target.replace(/\\/g, '/')
  if (normalizedTarget.startsWith('/')) return normalizedTarget.slice(1)
  return pathPosix.normalize(pathPosix.join(baseDir, normalizedTarget))
}

function parseRelationships(zip: AdmZip, relsPath: string, baseDir: string): Map<string, string> {
  const relsXml = readZipText(zip, relsPath)
  const rels = new Map<string, string>()
  if (!relsXml) return rels

  const relsDoc = parseXml(relsXml)
  for (const rel of getElementsByLocalName(relsDoc, 'Relationship')) {
    const id = rel.getAttribute('Id')
    const target = rel.getAttribute('Target')
    if (!id || !target) continue
    rels.set(id, normalizeZipTarget(baseDir, target))
  }
  return rels
}

function parseSharedStrings(zip: AdmZip): string[] {
  const sharedXml = readZipText(zip, 'xl/sharedStrings.xml')
  if (!sharedXml) return []

  const doc = parseXml(sharedXml)
  return getElementsByLocalName(doc, 'si').map((si) => (
    getElementsByLocalName(si, 't').map((node) => node.textContent ?? '').join('')
  ))
}

function isDateNumFmtId(numFmtId: number): boolean {
  return (
    (numFmtId >= 14 && numFmtId <= 22) ||
    (numFmtId >= 27 && numFmtId <= 36) ||
    (numFmtId >= 45 && numFmtId <= 47) ||
    (numFmtId >= 50 && numFmtId <= 58)
  )
}

function isDateFormatCode(formatCode: string): boolean {
  const normalized = formatCode
    .replace(/"[^"]*"/g, '')
    .replace(/\\./g, '')
    .replace(/\[[^\]]*]/g, '')
    .toLowerCase()
  return /[ymdhHsS]/.test(normalized)
}

function parseXlsxDateStyleIndexes(zip: AdmZip): Set<number> {
  const stylesXml = readZipText(zip, 'xl/styles.xml')
  const dateStyleIndexes = new Set<number>()
  if (!stylesXml) return dateStyleIndexes

  const doc = parseXml(stylesXml)
  const customFormats = new Map<number, string>()
  for (const numFmt of getElementsByLocalName(doc, 'numFmt')) {
    const id = Number(numFmt.getAttribute('numFmtId'))
    const code = numFmt.getAttribute('formatCode') ?? ''
    if (Number.isFinite(id) && code) customFormats.set(id, code)
  }

  const cellXfs = getElementsByLocalName(doc, 'cellXfs')[0]
  if (!cellXfs) return dateStyleIndexes

  getDirectChildElementsByLocalName(cellXfs, 'xf').forEach((xf, index) => {
    const numFmtId = Number(xf.getAttribute('numFmtId'))
    if (!Number.isFinite(numFmtId)) return
    const customFormatCode = customFormats.get(numFmtId)
    if (isDateNumFmtId(numFmtId) || (customFormatCode && isDateFormatCode(customFormatCode))) {
      dateStyleIndexes.add(index)
    }
  })

  return dateStyleIndexes
}

function formatExcelSerialDate(rawValue: string): string {
  const serial = Number(rawValue)
  if (!Number.isFinite(serial)) return rawValue

  const millis = Math.round((serial - 25569) * 86400 * 1000)
  const date = new Date(millis)
  if (Number.isNaN(date.getTime())) return rawValue

  const year = date.getUTCFullYear()
  if (year < 1900 || year > 9999) return rawValue

  const pad = (value: number) => String(value).padStart(2, '0')
  const dateText = `${year}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
  const hasTime = Math.abs(serial - Math.floor(serial)) > 0.000001
  if (!hasTime) return dateText
  return `${dateText} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`
}

function columnIndexFromCellRef(cellRef: string): number {
  const letters = cellRef.match(/[A-Za-z]+/)?.[0]?.toUpperCase()
  if (!letters) return 0
  let index = 0
  for (const char of letters) {
    index = index * 26 + (char.charCodeAt(0) - 64)
  }
  return Math.max(0, index - 1)
}

function columnNameFromIndex(index: number): string {
  let value = index + 1
  let name = ''
  while (value > 0) {
    const remainder = (value - 1) % 26
    name = String.fromCharCode(65 + remainder) + name
    value = Math.floor((value - 1) / 26)
  }
  return name
}

function getXlsxCellValue(cell: Element, sharedStrings: string[], dateStyleIndexes: Set<number>): { value: string; formula?: string } {
  const type = cell.getAttribute('t')
  const formula = getFirstTextByLocalName(cell, 'f') || undefined
  if (type === 'inlineStr') {
    return { value: getElementsByLocalName(cell, 't').map((node) => node.textContent ?? '').join(''), formula }
  }

  const value = getFirstTextByLocalName(cell, 'v')
  if (!value) return { value: '', formula }

  if (type === 's') {
    const sharedIndex = Number(value)
    return { value: Number.isInteger(sharedIndex) ? sharedStrings[sharedIndex] ?? '' : '', formula }
  }
  if (type === 'b') return { value: value === '1' ? 'TRUE' : 'FALSE', formula }

  const styleIndex = Number(cell.getAttribute('s'))
  if (!type && Number.isInteger(styleIndex) && dateStyleIndexes.has(styleIndex)) {
    return { value: formatExcelSerialDate(value), formula }
  }

  return { value, formula }
}

function parseXlsxSheetRows(
  zip: AdmZip,
  sheetPath: string,
  sharedStrings: string[],
  dateStyleIndexes: Set<number>,
  sheetIndex: number,
  sheetName: string,
  remainingCells: number,
): { sheet: SpreadsheetSheetPreview; textRows: string[]; usedCells: number; truncated: boolean } {
  const sheetXml = readZipText(zip, sheetPath)
  if (!sheetXml) {
    return {
      sheet: { name: sheetName, index: sheetIndex, rowCount: 0, columnCount: 0, cells: [], truncated: false },
      textRows: [],
      usedCells: 0,
      truncated: false,
    }
  }

  const doc = parseXml(sheetXml)
  const cells: SpreadsheetCell[] = []
  const textRowMap = new Map<number, string[]>()
  let maxRow = 0
  let maxColumn = 0
  let usedCells = 0
  let truncated = false

  for (const row of getElementsByLocalName(doc, 'row')) {
    for (const cell of getDirectChildElementsByLocalName(row, 'c')) {
      const cellRef = cell.getAttribute('r') ?? ''
      const colIndex = columnIndexFromCellRef(cellRef)
      const rowIndexRaw = Number(cellRef.match(/\d+/)?.[0])
      const rowIndex = Number.isInteger(rowIndexRaw) && rowIndexRaw > 0 ? rowIndexRaw - 1 : 0
      const parsed = getXlsxCellValue(cell, sharedStrings, dateStyleIndexes)
      if (!parsed.value.trim() && !parsed.formula) continue

      if (usedCells >= remainingCells) {
        truncated = true
        break
      }

      cells.push({
        row: rowIndex,
        column: colIndex,
        value: parsed.value,
        ...(parsed.formula ? { formula: parsed.formula } : {}),
      })
      const textRow = textRowMap.get(rowIndex) ?? []
      textRow[colIndex] = parsed.value
      textRowMap.set(rowIndex, textRow)
      maxRow = Math.max(maxRow, rowIndex + 1)
      maxColumn = Math.max(maxColumn, colIndex + 1)
      usedCells++
    }
    if (truncated) break
  }

  const textRows = Array.from(textRowMap.entries())
    .sort(([a], [b]) => a - b)
    .map(([, row]) => {
      while (row.length > 0 && !row[row.length - 1]) row.pop()
      return row.join('\t')
    })

  return {
    sheet: {
      name: sheetName,
      index: sheetIndex,
      rowCount: maxRow,
      columnCount: maxColumn,
      cells,
      truncated,
    },
    textRows,
    usedCells,
    truncated,
  }
}

function renderXlsxTable(rows: string[][]): string {
  if (rows.length === 0) {
    return '<div class="office-empty">这个工作表没有可预览的数据</div>'
  }

  const columnCount = Math.max(...rows.map((row) => row.length), 1)
  const headerCells = Array.from({ length: columnCount }, (_, index) => (
    `<th>${escapeHtml(columnNameFromIndex(index))}</th>`
  )).join('')
  const bodyRows = rows.map((row, rowIndex) => {
    const cells = Array.from({ length: columnCount }, (_, index) => (
      `<td>${escapeHtml(row[index] ?? '')}</td>`
    )).join('')
    return `<tr><th class="office-row-heading">${rowIndex + 1}</th>${cells}</tr>`
  }).join('')

  return `<div class="office-table-wrap"><table><thead><tr><th></th>${headerCells}</tr></thead><tbody>${bodyRows}</tbody></table></div>`
}

function sheetPreviewToRows(sheet: SpreadsheetSheetPreview, maxRows = 100, maxColumns = 40): string[][] {
  const visibleRows = Math.min(sheet.rowCount, maxRows)
  const visibleColumns = Math.min(sheet.columnCount, maxColumns)
  const rows = Array.from({ length: visibleRows }, () => Array.from({ length: visibleColumns }, () => ''))
  for (const cell of sheet.cells) {
    if (cell.row < visibleRows && cell.column < visibleColumns) {
      rows[cell.row]![cell.column] = cell.value
    }
  }
  return rows.filter((row) => row.some((value) => value.trim().length > 0))
}

function renderSpreadsheetPreviewHtml(filePath: string, preview: SpreadsheetPreviewResult): string {
  const title = escapeHtml(basename(filePath))
  const notices = preview.notices.map((notice) => notice.message)
  const noticeHtml = notices.length > 0
    ? `<div class="office-preview-notice">${escapeHtml(notices.join('，'))}</div>`
    : ''
  const htmlParts = preview.sheets.map((sheet) => (
    `<section class="office-sheet"><h3>${escapeHtml(sheet.name)}</h3>${renderXlsxTable(sheetPreviewToRows(sheet))}</section>`
  ))
  return `<div class="office-preview office-preview-spreadsheet"><div class="office-preview-title">${title}</div>${noticeHtml}${htmlParts.join('')}</div>`
}

function convertXlsxToSpreadsheetPreview(resolvedPath: string): SpreadsheetPreviewResult {
  const zip = new AdmZip(resolvedPath)
  assertZipWithinPreviewLimits(zip)
  const workbookXml = readZipText(zip, 'xl/workbook.xml')
  if (!workbookXml) throw new Error('Invalid XLSX: workbook.xml missing')

  const workbookDoc = parseXml(workbookXml)
  const relationships = parseRelationships(zip, 'xl/_rels/workbook.xml.rels', 'xl')
  const sharedStrings = parseSharedStrings(zip)
  const dateStyleIndexes = parseXlsxDateStyleIndexes(zip)
  const sheets = getElementsByLocalName(workbookDoc, 'sheet')

  const notices: FilePreviewNotice[] = []
  const textParts: string[] = []
  const sheetPreviews: SpreadsheetSheetPreview[] = []
  let remainingCells = MAX_SPREADSHEET_CELLS

  sheets.slice(0, MAX_XLSX_SHEETS).forEach((sheet, sheetIndex) => {
    if (remainingCells <= 0) return
    const name = sheet.getAttribute('name') || `Sheet ${sheetIndex + 1}`
    const relationshipId = sheet.getAttribute('r:id') ?? sheet.getAttribute('id')
    const sheetPath = relationshipId ? relationships.get(relationshipId) : undefined
    if (!sheetPath) return

    const parsed = parseXlsxSheetRows(zip, sheetPath, sharedStrings, dateStyleIndexes, sheetIndex, name, remainingCells)
    remainingCells -= parsed.usedCells
    textParts.push(`[${name}]`)
    textParts.push(...parsed.textRows)
    sheetPreviews.push(parsed.sheet)
    if (parsed.truncated) {
      notices.push({ kind: 'truncated', message: `表格达到 ${MAX_SPREADSHEET_CELLS} 个非空单元格上限，后续内容已截断` })
    }
  })

  if (sheetPreviews.length === 0) {
    throw new Error('Invalid XLSX: no worksheet data resolved')
  }

  if (sheets.length > MAX_XLSX_SHEETS) {
    notices.push({ kind: 'truncated', message: `仅解析前 ${MAX_XLSX_SHEETS} 个工作表` })
  }

  return {
    resolvedPath,
    kind: 'spreadsheet',
    sheets: sheetPreviews,
    notices,
    text: textParts.join('\n').trim(),
  }
}

function convertXlsxToHtml(filePath: string, resolvedPath: string): OfficePreviewResult {
  const spreadsheet = convertXlsxToSpreadsheetPreview(resolvedPath)
  return {
    resolvedPath,
    kind: 'spreadsheet',
    html: renderSpreadsheetPreviewHtml(filePath, spreadsheet),
    text: spreadsheet.text,
    notices: spreadsheet.notices,
    spreadsheet,
  }
}

export async function convertDelimitedToSpreadsheetPreview(filePath: string): Promise<SpreadsheetPreviewResult | null> {
  if (!existsSync(filePath)) return null
  const st = statSync(filePath)
  if (st.size > MAX_FILE_SIZE) return null

  const ext = extname(filePath).toLowerCase()
  const delimiter = ext === '.tsv' ? '\t' : undefined
  const source = readFileSync(filePath, 'utf-8')
  const Papa = await import('papaparse')
  const parsed = Papa.parse<string[]>(source, {
    delimiter,
    skipEmptyLines: false,
  })
  const notices: FilePreviewNotice[] = []
  if (parsed.errors.length > 0) {
    notices.push({ kind: 'fallback', message: `解析过程中发现 ${parsed.errors.length} 个 CSV/TSV 格式问题，已尽量展示可读内容` })
  }

  const cells: SpreadsheetCell[] = []
  let usedCells = 0
  let rowCount = 0
  let columnCount = 0
  let truncated = false

  for (let rowIndex = 0; rowIndex < parsed.data.length; rowIndex++) {
    const row = parsed.data[rowIndex] ?? []
    rowCount = Math.max(rowCount, rowIndex + 1)
    columnCount = Math.max(columnCount, row.length)
    for (let columnIndex = 0; columnIndex < row.length; columnIndex++) {
      const value = String(row[columnIndex] ?? '')
      if (!value.trim()) continue
      if (usedCells >= MAX_SPREADSHEET_CELLS) {
        truncated = true
        break
      }
      cells.push({ row: rowIndex, column: columnIndex, value })
      usedCells++
    }
    if (truncated) break
  }

  if (truncated) {
    notices.push({ kind: 'truncated', message: `表格达到 ${MAX_SPREADSHEET_CELLS} 个非空单元格上限，后续内容已截断` })
  }

  const sheet: SpreadsheetSheetPreview = {
    name: basename(filePath),
    index: 0,
    rowCount,
    columnCount,
    cells,
    truncated,
  }

  return {
    resolvedPath: filePath,
    kind: 'spreadsheet',
    sheets: [sheet],
    notices,
    text: parsed.data.map((row) => row.join('\t')).join('\n'),
  }
}

function getPptxSlidePaths(zip: AdmZip): string[] {
  const presentationXml = readZipText(zip, 'ppt/presentation.xml')
  const relationships = parseRelationships(zip, 'ppt/_rels/presentation.xml.rels', 'ppt')
  if (presentationXml) {
    const doc = parseXml(presentationXml)
    const slidePaths = getElementsByLocalName(doc, 'sldId')
      .map((slide) => slide.getAttribute('r:id') ?? slide.getAttribute('id'))
      .map((relationshipId) => relationshipId ? relationships.get(relationshipId) : undefined)
      .filter((path): path is string => Boolean(path))
    if (slidePaths.length > 0) return slidePaths
  }

  return zip.getEntries()
    .map((entry) => entry.entryName)
    .filter((entryName) => /^ppt\/slides\/slide\d+\.xml$/.test(entryName))
    .sort((a, b) => {
      const aIndex = Number(a.match(/slide(\d+)\.xml$/)?.[1] ?? 0)
      const bIndex = Number(b.match(/slide(\d+)\.xml$/)?.[1] ?? 0)
      return aIndex - bIndex
    })
}

function getPptxSlideText(zip: AdmZip, slidePath: string): string[] {
  const slideXml = readZipText(zip, slidePath)
  if (!slideXml) return []

  const doc = parseXml(slideXml)
  return getElementsByLocalName(doc, 'p')
    .map((paragraph) => getElementsByLocalName(paragraph, 't').map((textNode) => textNode.textContent ?? '').join('').trim())
    .filter(Boolean)
}

function convertPptxToHtml(filePath: string, resolvedPath: string): OfficePreviewResult {
  const zip = new AdmZip(resolvedPath)
  const slidePaths = getPptxSlidePaths(zip)
  const visibleSlidePaths = slidePaths.slice(0, MAX_PPTX_SLIDES)
  const textParts: string[] = []
  const slideHtml = visibleSlidePaths.map((slidePath, index) => {
    const lines = getPptxSlideText(zip, slidePath)
    textParts.push(`幻灯片 ${index + 1}`)
    textParts.push(...lines)
    const title = lines[0] || '（无标题）'
    const body = lines.length > 1
      ? `<ul>${lines.slice(1).map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>`
      : '<div class="office-empty">这页没有更多可提取文本</div>'
    return `<section class="office-slide"><div class="office-slide-index">幻灯片 ${index + 1}</div><h3>${escapeHtml(title)}</h3>${body}</section>`
  }).join('')

  const noticeHtml = slidePaths.length > MAX_PPTX_SLIDES
    ? `<div class="office-preview-notice">仅显示前 ${MAX_PPTX_SLIDES} 页幻灯片</div>`
    : ''
  const emptyHtml = slideHtml || '<div class="office-empty">这个 PPTX 没有可提取的文本内容</div>'
  const title = escapeHtml(basename(filePath))
  const html = `<div class="office-preview office-preview-presentation"><div class="office-preview-title">${title}</div>${noticeHtml}${emptyHtml}</div>`

  return {
    resolvedPath,
    kind: 'presentation',
    html,
    text: textParts.join('\n').trim(),
  }
}

// ─── 导出：内联预览 API ───

/** 解析文件路径并读取内容（供内联文本/代码预览使用） */
export function resolveAndReadFile(filePath: string, basePaths?: string[]): { resolvedPath: string; content: string } | null {
  const safePath = resolveTargetPath(filePath, basePaths)
  if (!existsSync(safePath)) return null
  try {
    const st = statSync(safePath)
    if (st.size > MAX_FILE_SIZE) return null
    const content = readFileSync(safePath, 'utf-8')
    return { resolvedPath: safePath, content }
  } catch {
    return null
  }
}

/** 读取 HTML/SVG 源码，并签发同目录资源 base URL */
export async function prepareMarkupPreview(filePath: string): Promise<MarkupPreviewResult | null> {
  if (!existsSync(filePath)) return null
  try {
    const st = statSync(filePath)
    if (st.size > MAX_FILE_SIZE) return null
    const { registerPromaDirectoryPath } = await import('./local-file-protocol')
    const source = readFileSync(filePath, 'utf-8')
    const baseUrl = `${registerPromaDirectoryPath(dirname(filePath))}/`
    return {
      resolvedPath: filePath,
      source,
      baseUrl,
      previewUrl: baseUrl,
      notices: [],
    }
  } catch (err) {
    console.error('[file-preview] prepareMarkupPreview failed:', err)
    return null
  }
}

/** 仅解析文件路径（不读取内容），供图片等用 proma-file:// 协议加载的场景使用 */
export function resolveFilePath(filePath: string, basePaths?: string[]): string | null {
  const safePath = resolveTargetPath(filePath, basePaths)
  return existsSync(safePath) ? safePath : null
}

/** 为内联 PDF 预览生成临时 HTML 文件（使用 proma-file:// 加载 PDF，无体积膨胀） */
export async function preparePdfPreview(filePath: string, basePaths?: string[]): Promise<PdfPreviewResult | null> {
  const safePath = resolveTargetPath(filePath, basePaths)
  if (!existsSync(safePath)) return null
  const st = statSync(safePath)
  if (st.size > MAX_FILE_SIZE) return null

  let fileUrl: string
  let pdfScriptUrl: string
  let pdfWorkerUrl: string
  let pdfViewerUrl: string
  let pdfViewerCssUrl: string
  let standardFontDataUrl: string
  let registerFilePath: (path: string) => string
  try {
    const { registerPromaDirectoryPath, registerPromaFilePath } = await import('./local-file-protocol')
    registerFilePath = registerPromaFilePath
    fileUrl = registerPromaFilePath(safePath)
    pdfScriptUrl = registerPromaFilePath(require.resolve(`${PDFJS_PACKAGE}/build/pdf.min.mjs`))
    pdfWorkerUrl = registerPromaFilePath(require.resolve(`${PDFJS_PACKAGE}/build/pdf.worker.min.mjs`))
    pdfViewerUrl = registerPromaFilePath(require.resolve(`${PDFJS_PACKAGE}/web/pdf_viewer.mjs`))
    pdfViewerCssUrl = registerPromaFilePath(require.resolve(`${PDFJS_PACKAGE}/web/pdf_viewer.css`))
    const pdfPackageDir = dirname(require.resolve(`${PDFJS_PACKAGE}/package.json`))
    standardFontDataUrl = `${registerPromaDirectoryPath(join(pdfPackageDir, 'standard_fonts'))}/`
  } catch (err) {
    console.error('[file-preview] preparePdfPreview asset resolution failed:', err)
    return null
  }

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' proma-file:; style-src 'unsafe-inline' proma-file:; img-src proma-file: data: blob:; font-src proma-file: data:; connect-src proma-file:; worker-src proma-file: blob:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'">
<link rel="stylesheet" href="${pdfViewerCssUrl}">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 100%; height: 100%; overflow: hidden; background: transparent; color: #d4d4d8; font: 12px/1.4 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  #toolbar { position: fixed; inset: 8px 10px auto 10px; z-index: 20; display: flex; align-items: center; gap: 8px; min-height: 34px; padding: 5px 8px; border: 1px solid rgba(148,163,184,.25); border-radius: 8px; background: rgba(24,24,27,.84); backdrop-filter: blur(10px); box-shadow: 0 8px 24px rgba(0,0,0,.18); }
  #toolbar button, #toolbar input { height: 24px; border: 1px solid rgba(148,163,184,.24); border-radius: 6px; background: rgba(255,255,255,.06); color: inherit; }
  #toolbar button { min-width: 26px; padding: 0 8px; cursor: pointer; }
  #toolbar input { width: min(260px, 34vw); padding: 0 8px; outline: none; }
  #toolbar .spacer { flex: 1; }
  #status, #matches { color: #a1a1aa; white-space: nowrap; font-variant-numeric: tabular-nums; }
  #viewerContainer { position: absolute; inset: 0; padding-top: 52px; overflow: auto; }
  #viewer.viewer { --scale-factor: 1; }
  .pdfViewer .page { margin: 10px auto; border: 0; box-shadow: 0 8px 22px rgba(0,0,0,.18); }
  .loading, .error { padding: 72px 20px; text-align: center; color: #a1a1aa; }
  .error { color: #f87171; }
</style>
</head><body>
  <div id="toolbar">
    <button type="button" id="zoomOut" title="缩小">−</button>
    <span id="zoomLabel">100%</span>
    <button type="button" id="zoomIn" title="放大">+</button>
    <span id="status">正在加载 PDF...</span>
    <span class="spacer"></span>
    <input id="findInput" placeholder="搜索 PDF" autocomplete="off">
    <button type="button" id="findPrev" title="上一个">↑</button>
    <button type="button" id="findNext" title="下一个">↓</button>
    <span id="matches"></span>
  </div>
  <div id="viewerContainer">
    <div id="viewer" class="pdfViewer"></div>
  </div>
  <script type="module">
    const container = document.getElementById('viewerContainer');
    const viewerElement = document.getElementById('viewer');
    const status = document.getElementById('status');
    const matches = document.getElementById('matches');
    const zoomLabel = document.getElementById('zoomLabel');
    const findInput = document.getElementById('findInput');
    const fileUrl = ${JSON.stringify(fileUrl)};
    const pdfScriptUrl = ${JSON.stringify(pdfScriptUrl)};
    const pdfWorkerUrl = ${JSON.stringify(pdfWorkerUrl)};
    const pdfViewerUrl = ${JSON.stringify(pdfViewerUrl)};
    const standardFontDataUrl = ${JSON.stringify(standardFontDataUrl)};
    const STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];
    let stepIdx = 2;
    let pdfViewer = null;
    let eventBus = null;

    function notifyZoom() {
      const zoom = Math.round(STEPS[stepIdx] * 100);
      zoomLabel.textContent = zoom + '%';
      window.parent.postMessage({ type: 'pdf-zoom-changed', zoom }, '*');
    }

    function setScale() {
      if (!pdfViewer) return;
      pdfViewer.currentScale = STEPS[stepIdx];
      notifyZoom();
    }

    function dispatchFind(previous = false) {
      if (!eventBus) return;
      eventBus.dispatch('find', {
        source: window,
        type: '',
        query: findInput.value,
        phraseSearch: true,
        caseSensitive: false,
        entireWord: false,
        highlightAll: true,
        findPrevious: previous,
      });
    }

    window.addEventListener('message', (e) => {
      if (e.source !== window.parent || !e.data || e.data.type !== 'pdf-zoom') return;
      if (e.data.direction === 'in' && stepIdx < STEPS.length - 1) { stepIdx++; setScale(); }
      if (e.data.direction === 'out' && stepIdx > 0) { stepIdx--; setScale(); }
    });

    document.getElementById('zoomOut').addEventListener('click', () => {
      if (stepIdx > 0) { stepIdx--; setScale(); }
    });
    document.getElementById('zoomIn').addEventListener('click', () => {
      if (stepIdx < STEPS.length - 1) { stepIdx++; setScale(); }
    });
    document.getElementById('findPrev').addEventListener('click', () => dispatchFind(true));
    document.getElementById('findNext').addEventListener('click', () => dispatchFind(false));
    findInput.addEventListener('input', () => dispatchFind(false));
    findInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        dispatchFind(event.shiftKey);
      }
    });

    try {
      const pdfjsLib = await import(pdfScriptUrl);
      const pdfViewerLib = await import(pdfViewerUrl);
      pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
      eventBus = new pdfViewerLib.EventBus();
      const linkService = new pdfViewerLib.PDFLinkService({ eventBus });
      const findController = new pdfViewerLib.PDFFindController({ eventBus, linkService });
      pdfViewer = new pdfViewerLib.PDFViewer({
        container,
        viewer: viewerElement,
        eventBus,
        linkService,
        findController,
        textLayerMode: 2,
      });
      linkService.setViewer(pdfViewer);
      eventBus.on('pagesinit', () => setScale());
      eventBus.on('pagechanging', (event) => {
        status.textContent = event.pageNumber + ' / ' + pdfViewer.pagesCount + ' 页';
      });
      eventBus.on('updatefindmatchescount', (event) => {
        const total = event.matchesCount?.total ?? 0;
        const current = event.matchesCount?.current ?? 0;
        matches.textContent = total > 0 ? current + ' / ' + total : '';
      });
      const pdfDoc = await pdfjsLib.getDocument({
        url: fileUrl,
        standardFontDataUrl,
      }).promise;
      pdfViewer.setDocument(pdfDoc);
      linkService.setDocument(pdfDoc, null);
      findController.setDocument(pdfDoc);
      status.textContent = '1 / ' + pdfDoc.numPages + ' 页';
    } catch (err) {
      container.innerHTML = '<div class="error">PDF 加载失败: ' + (err?.message || String(err)) + '<\\/div>';
      status.textContent = 'PDF 加载失败';
    }
  <\/script>
<\/body><\/html>`
  const tmpHtmlPath = writeTempHtml(html)
  const tmpHtmlUrl = registerFilePath(tmpHtmlPath)
  return { resolvedPath: safePath, sourceUrl: fileUrl, tmpHtmlUrl, notices: [] }
}

/** 将 DOCX 文件转换为 HTML（供内联预览使用） */
export async function convertDocxToHtml(filePath: string, basePaths?: string[]): Promise<{ resolvedPath: string; html: string } | null> {
  const safePath = resolveTargetPath(filePath, basePaths)
  if (!existsSync(safePath)) return null
  try {
    const st = statSync(safePath)
    if (st.size > MAX_FILE_SIZE) return null
    const mammoth = await import('mammoth')
    const result = await mammoth.convertToHtml({ path: safePath })
    return { resolvedPath: safePath, html: result.value }
  } catch (err) {
    console.error('[file-preview] convertDocxToHtml failed:', err)
    return null
  }
}

function renderOfficeTextFallback(filePath: string, text: string, kind: OfficePreviewResult['kind']): string {
  const title = escapeHtml(basename(filePath))
  const paragraphs = text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
  const body = paragraphs.length > 0
    ? paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`).join('')
    : '<div class="office-empty">没有可提取的文本内容</div>'
  return `<div class="office-preview office-preview-${kind}"><div class="office-preview-title">${title}</div>${body}</div>`
}

function findLibreOfficeExecutable(): string | null {
  const candidates = process.platform === 'darwin'
    ? [
        '/Applications/LibreOffice.app/Contents/MacOS/soffice',
        '/opt/homebrew/bin/soffice',
        '/usr/local/bin/soffice',
        '/usr/bin/soffice',
      ]
    : process.platform === 'win32'
      ? [
          'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
          'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe',
        ]
      : ['/usr/bin/soffice', '/usr/local/bin/soffice', '/snap/bin/libreoffice', '/usr/bin/libreoffice']

  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

export function getLibreOfficeStatus(): LibreOfficeStatus {
  const executablePath = findLibreOfficeExecutable()
  return { available: Boolean(executablePath), executablePath }
}

function execFileWithTimeout(command: string, args: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = execFile(command, args, { timeout: timeoutMs, shell: false }, (error) => {
      if (error) {
        reject(error)
        return
      }
      resolvePromise()
    })
    child.on('error', reject)
  })
}

async function runLibreOfficeJob(job: () => Promise<void>): Promise<void> {
  const previous = libreOfficeQueue
  let release!: () => void
  libreOfficeQueue = new Promise((resolveRelease) => {
    release = resolveRelease
  })
  await previous.catch(() => undefined)
  try {
    await job()
  } finally {
    release()
  }
}

async function convertWithLibreOfficeToPdf(filePath: string): Promise<{ pdfPath: string; notices: FilePreviewNotice[]; libreOffice: LibreOfficeStatus } | null> {
  const libreOffice = getLibreOfficeStatus()
  if (!libreOffice.available || !libreOffice.executablePath) return null

  const st = statSync(filePath)
  const cacheKey = createHash('sha256')
    .update(`${realpathSync(filePath)}:${st.mtimeMs}:${st.size}:pdf`)
    .digest('hex')
    .slice(0, 24)
  const cacheDir = join(getPreviewTmpDir(), 'office-pdf-cache')
  if (!existsSync(cacheDir)) mkdirSync(cacheDir, { recursive: true })
  const cachedPdfPath = join(cacheDir, `${cacheKey}.pdf`)
  if (existsSync(cachedPdfPath)) {
    return {
      pdfPath: cachedPdfPath,
      notices: [{ kind: 'fallback', message: '已使用 LibreOffice 转换缓存' }],
      libreOffice,
    }
  }

  const outDir = mkdtempSync(join(tmpdir(), 'proma-lo-out-'))
  const profileDir = mkdtempSync(join(tmpdir(), 'proma-lo-profile-'))
  const profileUrl = `file://${profileDir.replace(/\\/g, '/')}`
  try {
    await runLibreOfficeJob(() => execFileWithTimeout(libreOffice.executablePath!, [
        '--headless',
        '--nologo',
        '--nofirststartwizard',
        '--nodefault',
        '--nolockcheck',
        `-env:UserInstallation=${profileUrl}`,
        '--convert-to',
        'pdf',
        '--outdir',
        outDir,
        filePath,
      ], LIBREOFFICE_TIMEOUT_MS))

    const generated = readdirSync(outDir).find((entry) => entry.toLowerCase().endsWith('.pdf'))
    if (!generated) {
      throw new Error('LibreOffice 没有生成 PDF')
    }
    const generatedPath = join(outDir, generated)
    writeFileSync(cachedPdfPath, readFileSync(generatedPath))
    return { pdfPath: cachedPdfPath, notices: [], libreOffice }
  } catch (err) {
    console.warn('[file-preview] LibreOffice 转换失败:', err instanceof Error ? err.message : err)
    return {
      pdfPath: '',
      notices: [{
        kind: err instanceof Error && /timed out|timeout/i.test(err.message) ? 'conversion-timeout' : 'conversion-failed',
        message: err instanceof Error && /timed out|timeout/i.test(err.message)
          ? 'LibreOffice 转换超时，已切换到文本预览'
          : 'LibreOffice 转换失败，已切换到文本预览',
      }],
      libreOffice,
    }
  } finally {
    try { rmSync(outDir, { recursive: true, force: true }) } catch { /* skip */ }
    try { rmSync(profileDir, { recursive: true, force: true }) } catch { /* skip */ }
  }
}

/** 将 XLSX/PPTX 转成可内联展示的 HTML 预览 */
export async function convertOfficeToHtml(filePath: string, basePaths?: string[]): Promise<OfficePreviewResult | null> {
  const safePath = resolveTargetPath(filePath, basePaths)
  if (!existsSync(safePath)) return null

  try {
    const st = statSync(safePath)
    if (st.size > MAX_FILE_SIZE) return null

    const ext = extname(safePath).toLowerCase()
    if (ext === '.xlsx') return convertXlsxToHtml(filePath, safePath)
    if (ext === '.pptx' || ext === '.doc' || ext === '.xls' || ext === '.ppt') {
      const converted = await convertWithLibreOfficeToPdf(safePath)
      if (converted?.pdfPath) {
        const pdf = await preparePdfPreview(converted.pdfPath)
        if (pdf) {
          return {
            resolvedPath: safePath,
            kind: ext === '.pptx' || ext === '.ppt' ? 'presentation' : 'legacy',
            html: '',
            text: '',
            presentationMode: 'pdf',
            pdf,
            libreOffice: converted.libreOffice,
            notices: converted.notices,
          }
        }
      }
      if (ext === '.pptx') {
        const fallback = convertPptxToHtml(filePath, safePath)
        return {
          ...fallback,
          presentationMode: 'text',
          libreOffice: converted?.libreOffice ?? getLibreOfficeStatus(),
          notices: [
            ...(converted?.notices ?? [{ kind: 'conversion-unavailable' as const, message: '未检测到 LibreOffice，已使用 PPTX 文本预览' }]),
          ],
        }
      }
      if (ext === '.doc') {
        const wordExtractor = await import('word-extractor')
        const extractor = new wordExtractor.default()
        const doc = await extractor.extract(safePath)
        const text = doc.getBody()
        return {
          resolvedPath: safePath,
          kind: 'legacy',
          html: renderOfficeTextFallback(filePath, text, 'legacy'),
          text,
          presentationMode: 'text',
          libreOffice: converted?.libreOffice ?? getLibreOfficeStatus(),
          notices: [
            ...(converted?.notices ?? [{ kind: 'conversion-unavailable' as const, message: '未检测到 LibreOffice，已使用 Word 文本降级预览' }]),
          ],
        }
      }
      return {
        resolvedPath: safePath,
        kind: 'legacy',
        html: renderOfficeTextFallback(filePath, '', 'legacy'),
        text: '',
        presentationMode: 'text',
        libreOffice: converted?.libreOffice ?? getLibreOfficeStatus(),
        notices: [
          ...(converted?.notices ?? [{ kind: 'conversion-unavailable' as const, message: '未检测到 LibreOffice，无法内联预览旧版 Office 文件' }]),
        ],
      }
    }
    if (ext === '.pptx') return convertPptxToHtml(filePath, safePath)
    return null
  } catch (err) {
    console.error('[file-preview] convertOfficeToHtml structured preview failed:', err)
    try {
      const officeParser = await import('officeparser')
      const text = await officeParser.parseOfficeAsync(safePath)
      const ext = extname(safePath).toLowerCase()
      const kind: OfficePreviewResult['kind'] = ext === '.pptx' ? 'presentation' : 'spreadsheet'
      return {
        resolvedPath: safePath,
        kind,
        html: renderOfficeTextFallback(filePath, text, kind),
        text,
      }
    } catch (fallbackErr) {
      console.error('[file-preview] convertOfficeToHtml text fallback failed:', fallbackErr)
      return null
    }
  }
}
