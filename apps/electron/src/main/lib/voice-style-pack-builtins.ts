import type { VoiceStylePack } from '../../types'

const now = 0

export const RAW_STYLE_PACK_ID = 'builtin-raw'
export const DEFAULT_STYLE_PACK_ID = 'builtin-light'

export const BUILTIN_VOICE_STYLE_PACKS: VoiceStylePack[] = [
  {
    id: RAW_STYLE_PACK_ID,
    name: '原始转写',
    mode: 'raw',
    description: '不调用模型，直接提交 ASR 原文。',
    instruction: '保持原始转写文本，不进行任何整理。',
    examples: [],
    isBuiltin: true,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: DEFAULT_STYLE_PACK_ID,
    name: '轻度整理',
    mode: 'light',
    description: '修正明显标点、断句和口语冗余，尽量保持原文表达。',
    instruction: '轻度整理语音转写文本：修正标点、分句和少量口语填充词，不改变原意，不新增事实。',
    examples: [],
    isBuiltin: true,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'builtin-ai-prompt',
    name: 'AI Prompt',
    mode: 'structured',
    description: '把语音内容整理成可直接发送给 AI 的任务提示词。',
    instruction: '将语音转写整理成清晰的 AI 任务提示词，补足目标、背景、约束和期望输出格式，但不得编造用户未提供的需求。',
    examples: [],
    isBuiltin: true,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'builtin-meeting-notes',
    name: '会议纪要',
    mode: 'structured',
    description: '整理为会议记录、结论和待办事项。',
    instruction: '将语音转写整理为会议纪要，保留明确提到的议题、结论、责任人和待办；不确定的信息保持原样或省略。',
    examples: [],
    isBuiltin: true,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'builtin-professional-email',
    name: '专业邮件',
    mode: 'formal',
    description: '整理为语气清晰、正式的邮件草稿。',
    instruction: '将语音转写整理为专业邮件草稿，保持用户意图和语气边界，不代替用户承诺未说明的事项。',
    examples: [],
    isBuiltin: true,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'builtin-technical-doc',
    name: '技术文档',
    mode: 'structured',
    description: '整理为技术说明、步骤或问题记录。',
    instruction: '将语音转写整理为技术文档风格，突出问题、环境、步骤、约束和验收标准；不得虚构版本号、文件名或错误信息。',
    examples: [],
    isBuiltin: true,
    createdAt: now,
    updatedAt: now,
  },
]
