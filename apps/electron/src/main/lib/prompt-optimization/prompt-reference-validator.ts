export interface ProtectedReference {
  placeholder: string
  rawText: string
  html?: string
  char?: string
  label?: string
  id?: string
}

const TEXT_REFERENCE_PATTERN = /(?<!\S)([@/#&][^\s，。！？；：,!?;:]+)/g

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function extractAttrs(value: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  for (const match of value.matchAll(/([\w:-]+)="([^"]*)"/g)) {
    attrs[match[1]!] = match[2]!
  }
  return attrs
}

function extractHtmlReferences(html: string | undefined): Array<Omit<ProtectedReference, 'placeholder'>> {
  if (!html) return []
  const refs: Array<Omit<ProtectedReference, 'placeholder'>> = []
  for (const match of html.matchAll(/<span\b[^>]*data-type="mention"[^>]*>[\s\S]*?<\/span>/g)) {
    const span = match[0]!
    const attrs = extractAttrs(span)
    const char = attrs['data-mention-suggestion-char'] ?? '@'
    const label = attrs['data-label'] || attrs['data-id'] || span.replace(/<[^>]+>/g, '')
    refs.push({
      rawText: `${char}${label}`,
      html: span,
      char,
      label,
      id: attrs['data-id'],
    })
  }
  return refs
}

export function protectPromptReferences(input: { text: string; html?: string }): {
  protectedText: string
  references: ProtectedReference[]
} {
  const references: ProtectedReference[] = []
  const byRaw = new Set<string>()
  for (const htmlRef of extractHtmlReferences(input.html)) {
    if (byRaw.has(htmlRef.rawText)) continue
    byRaw.add(htmlRef.rawText)
    references.push({
      ...htmlRef,
      placeholder: `[[PROMA_REF_${String(references.length + 1).padStart(3, '0')}]]`,
    })
  }

  for (const match of input.text.matchAll(TEXT_REFERENCE_PATTERN)) {
    const rawText = match[1]!
    if (byRaw.has(rawText)) continue
    byRaw.add(rawText)
    references.push({
      rawText,
      placeholder: `[[PROMA_REF_${String(references.length + 1).padStart(3, '0')}]]`,
    })
  }

  let protectedText = input.text
  for (const reference of references) {
    protectedText = protectedText.split(reference.rawText).join(reference.placeholder)
    if (reference.label) {
      protectedText = protectedText.split(reference.label).join(reference.placeholder)
    }
  }

  return { protectedText, references }
}

export function validateReferencePlaceholders(text: string, references: ProtectedReference[]): {
  valid: boolean
  expected: number
  actual: number
  failures: string[]
} {
  const failures: string[] = []
  let actual = 0
  let previousIndex = -1
  for (const reference of references) {
    const matches = [...text.matchAll(new RegExp(reference.placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))]
    actual += matches.length
    if (matches.length !== 1) {
      failures.push(`引用 ${reference.rawText} 出现 ${matches.length} 次，预期 1 次`)
      continue
    }
    const currentIndex = matches[0]!.index ?? -1
    if (currentIndex < previousIndex) {
      failures.push(`引用 ${reference.rawText} 顺序被改变`)
    }
    previousIndex = currentIndex
  }
  return {
    valid: failures.length === 0,
    expected: references.length,
    actual,
    failures,
  }
}

function textToHtmlWithReferences(text: string, references: ProtectedReference[]): string {
  const lookup = new Map(references.map((reference) => [reference.placeholder, reference]))
  const tokenPattern = /\[\[PROMA_REF_\d{3}\]\]/g
  const paragraphs = text.split(/\n{2,}/).map((paragraph) => {
    let cursor = 0
    let html = ''
    for (const match of paragraph.matchAll(tokenPattern)) {
      const token = match[0]!
      const index = match.index ?? 0
      html += escapeHtml(paragraph.slice(cursor, index)).replace(/\n/g, '<br>')
      const reference = lookup.get(token)
      html += reference?.html ?? escapeHtml(reference?.rawText ?? token)
      cursor = index + token.length
    }
    html += escapeHtml(paragraph.slice(cursor)).replace(/\n/g, '<br>')
    return `<p>${html || '<br>'}</p>`
  })
  return paragraphs.join('')
}

export function restorePromptReferences(text: string, references: ProtectedReference[]): {
  text: string
  html: string
} {
  let restoredText = text
  for (const reference of references) {
    restoredText = restoredText.split(reference.placeholder).join(reference.rawText)
  }
  return {
    text: restoredText,
    html: textToHtmlWithReferences(text, references),
  }
}
