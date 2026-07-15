const THINK_BLOCK_PATTERN = /<think>[\s\S]*?<\/think>/gi
const FENCE_PATTERN = /^```(?:[a-zA-Z0-9_-]+)?\s*\n([\s\S]*?)\n```\s*$/u
const PREFIX_PATTERNS = [
  /^整理如下[:：]\s*/u,
  /^润色如下[:：]\s*/u,
  /^优化如下[:：]\s*/u,
  /^以下是(?:整理|润色|优化)后的文本[:：]?\s*/u,
  /^好的[，,]\s*(?:整理|润色|优化)如下[:：]?\s*/u,
]

export function cleanVoicePolishOutput(value: string): string {
  let text = value.replace(THINK_BLOCK_PATTERN, '').trim()

  const fenceMatch = text.match(FENCE_PATTERN)
  if (fenceMatch?.[1]) {
    text = fenceMatch[1].trim()
  }

  for (const pattern of PREFIX_PATTERNS) {
    text = text.replace(pattern, '').trim()
  }

  return text.trim()
}
