import { randomUUID } from 'node:crypto'
import { getVoiceStylePacksPath } from './config-paths'
import { readJsonFileSafe, writeJsonFileAtomic } from './safe-file'
import { BUILTIN_VOICE_STYLE_PACKS } from './voice-style-pack-builtins'
import type { VoiceStylePack, VoiceStylePackInput } from '../../types'

interface VoiceStylePackStore {
  version: 1
  packs: VoiceStylePack[]
}

function readStore(): VoiceStylePackStore {
  return readJsonFileSafe<VoiceStylePackStore>(getVoiceStylePacksPath()) ?? {
    version: 1,
    packs: [],
  }
}

function writeStore(store: VoiceStylePackStore): void {
  writeJsonFileAtomic(getVoiceStylePacksPath(), store)
}

function normalizeExamples(input: VoiceStylePackInput): VoiceStylePack['examples'] {
  return (input.examples ?? [])
    .filter((example) => example.input.trim() && example.output.trim())
    .slice(0, 3)
    .map((example) => ({
      input: example.input.trim(),
      output: example.output.trim(),
    }))
}

export function listVoiceStylePacks(): VoiceStylePack[] {
  const custom = readStore().packs
  return [
    ...BUILTIN_VOICE_STYLE_PACKS,
    ...custom.map((pack) => ({ ...pack, isBuiltin: false })),
  ]
}

export function getVoiceStylePack(id: string): VoiceStylePack | null {
  return listVoiceStylePacks().find((pack) => pack.id === id) ?? null
}

export function upsertVoiceStylePack(input: VoiceStylePackInput): VoiceStylePack {
  const name = input.name.trim()
  const instruction = input.instruction.trim()
  if (!name) throw new Error('风格包名称不能为空')
  if (!instruction) throw new Error('风格包指令不能为空')

  const store = readStore()
  const existing = input.id
    ? store.packs.find((pack) => pack.id === input.id)
    : undefined
  const timestamp = Date.now()
  const pack: VoiceStylePack = {
    id: existing?.id ?? randomUUID(),
    name,
    mode: input.mode,
    description: input.description.trim(),
    instruction,
    examples: normalizeExamples(input),
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
  }

  store.packs = existing
    ? store.packs.map((item) => (item.id === pack.id ? pack : item))
    : [...store.packs, pack]
  writeStore(store)
  return pack
}

export function deleteVoiceStylePack(id: string): void {
  if (BUILTIN_VOICE_STYLE_PACKS.some((pack) => pack.id === id)) {
    throw new Error('内置风格包不能删除')
  }
  const store = readStore()
  store.packs = store.packs.filter((pack) => pack.id !== id)
  writeStore(store)
}
