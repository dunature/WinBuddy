export interface MarketplaceGuideHeading {
  depth: 2 | 3
  text: string
  id: string
}

export function createHeadingSlugger(): (value: string) => string {
  const counts = new Map<string, number>()
  return (value: string): string => {
    const base = value
      .toLocaleLowerCase()
      .trim()
      .replace(/[^\p{Letter}\p{Number}\s-]/gu, '')
      .replace(/[\s-]+/g, '-')
      .replace(/^-|-$/g, '') || 'section'
    const count = counts.get(base) ?? 0
    counts.set(base, count + 1)
    return count === 0 ? base : `${base}-${count + 1}`
  }
}

export function extractGuideHeadings(markdown: string): MarketplaceGuideHeading[] {
  const slug = createHeadingSlugger()
  const headings: MarketplaceGuideHeading[] = []
  let inFence = false
  for (const line of markdown.split('\n')) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    const match = /^(##|###)\s+(.+?)\s*#*\s*$/.exec(line)
    if (!match) continue
    const text = match[2]?.trim() ?? ''
    headings.push({ depth: match[1] === '##' ? 2 : 3, text, id: slug(text) })
  }
  return headings
}
