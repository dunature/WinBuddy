export type PreviewKind =
  | 'markdown'
  | 'text'
  | 'pdf'
  | 'docx'
  | 'spreadsheet'
  | 'presentation'
  | 'legacy-office'
  | 'markup'
  | 'svg'
  | 'image'
  | 'binary'

const MD_EXTS = new Set(['.md', '.markdown'])
const PLAIN_TEXT_EDIT_EXTS = new Set(['.txt', '.text', '.log'])
const PDF_EXTS = new Set(['.pdf'])
const DOCX_EXTS = new Set(['.docx'])
const SPREADSHEET_EXTS = new Set(['.csv', '.tsv', '.xlsx'])
const PRESENTATION_EXTS = new Set(['.pptx'])
const LEGACY_OFFICE_EXTS = new Set(['.doc', '.xls', '.ppt'])
const MARKUP_EXTS = new Set(['.html', '.htm'])
const SVG_EXTS = new Set(['.svg'])
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico'])

export function getExtension(filePath: string): string {
  const dot = filePath.lastIndexOf('.')
  return dot >= 0 ? filePath.slice(dot).toLowerCase() : ''
}

export function getPreviewKind(filePath: string): PreviewKind {
  const ext = getExtension(filePath)
  if (MD_EXTS.has(ext)) return 'markdown'
  if (PLAIN_TEXT_EDIT_EXTS.has(ext)) return 'text'
  if (PDF_EXTS.has(ext)) return 'pdf'
  if (DOCX_EXTS.has(ext)) return 'docx'
  if (SPREADSHEET_EXTS.has(ext)) return 'spreadsheet'
  if (PRESENTATION_EXTS.has(ext)) return 'presentation'
  if (LEGACY_OFFICE_EXTS.has(ext)) return 'legacy-office'
  if (MARKUP_EXTS.has(ext)) return 'markup'
  if (SVG_EXTS.has(ext)) return 'svg'
  if (IMAGE_EXTS.has(ext)) return 'image'
  return 'binary'
}

export function isEditableTextPreview(kind: PreviewKind): boolean {
  return kind === 'markdown' || kind === 'text'
}

export function canUseCodePreview(kind: PreviewKind): boolean {
  return kind === 'binary'
}
