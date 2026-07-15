export function formatPromptOptimizationRecentContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (content === undefined || content === null) return ''
  try {
    const serialized = JSON.stringify(content)
    return typeof serialized === 'string' ? serialized.slice(0, 1000) : ''
  } catch {
    return ''
  }
}
