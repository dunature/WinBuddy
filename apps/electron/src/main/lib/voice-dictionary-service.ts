import { randomUUID } from 'node:crypto'
import { getVoiceDictionaryPath } from './config-paths'
import { readJsonFileSafe, writeJsonFileAtomic } from './safe-file'
import type { VoiceDictionaryEntry, VoiceDictionaryEntryInput } from '../../types'

const HOTWORD_SEPARATOR_PATTERN = /[\n,，、;；]+/u
const MAX_ENABLED_DICTIONARY_ENTRIES = 100

interface VoiceDictionaryStore {
  version: 1
  migratedFromCustomHotwords: boolean
  entries: VoiceDictionaryEntry[]
}

function normalizeTerm(value: string): string {
  return value.trim()
}

function splitHotwords(value: string): string[] {
  const seen = new Set<string>()
  const terms: string[] = []
  for (const raw of value.split(HOTWORD_SEPARATOR_PATTERN)) {
    const term = normalizeTerm(raw)
    const key = term.toLowerCase()
    if (!term || seen.has(key)) continue
    seen.add(key)
    terms.push(term)
  }
  return terms
}

function readStore(): VoiceDictionaryStore {
  return readJsonFileSafe<VoiceDictionaryStore>(getVoiceDictionaryPath()) ?? {
    version: 1,
    migratedFromCustomHotwords: false,
    entries: [],
  }
}

function writeStore(store: VoiceDictionaryStore): void {
  writeJsonFileAtomic(getVoiceDictionaryPath(), store)
}

function migrateCustomHotwords(store: VoiceDictionaryStore, customHotwords: string): VoiceDictionaryStore {
  if (store.migratedFromCustomHotwords || !customHotwords.trim()) return store

  const existing = new Set(store.entries.map((entry) => entry.term.toLowerCase()))
  const timestamp = Date.now()
  const migrated = splitHotwords(customHotwords)
    .filter((term) => !existing.has(term.toLowerCase()))
    .map((term): VoiceDictionaryEntry => ({
      id: randomUUID(),
      term,
      aliases: [],
      category: '旧热词',
      description: '',
      enabled: true,
      usageCount: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    }))

  const next = {
    ...store,
    migratedFromCustomHotwords: true,
    entries: [...store.entries, ...migrated],
  }
  writeStore(next)
  return next
}

export function listVoiceDictionaryEntries(customHotwords = ''): VoiceDictionaryEntry[] {
  return migrateCustomHotwords(readStore(), customHotwords).entries
}

export function upsertVoiceDictionaryEntry(input: VoiceDictionaryEntryInput): VoiceDictionaryEntry {
  const term = normalizeTerm(input.term)
  if (!term) throw new Error('规范术语不能为空')

  const store = readStore()
  const existing = input.id
    ? store.entries.find((entry) => entry.id === input.id)
    : undefined
  const aliases = (input.aliases ?? [])
    .map(normalizeTerm)
    .filter(Boolean)
  const timestamp = Date.now()
  const entry: VoiceDictionaryEntry = {
    id: existing?.id ?? randomUUID(),
    term,
    aliases,
    category: input.category?.trim() ?? existing?.category ?? '',
    description: input.description?.trim() ?? existing?.description ?? '',
    enabled: input.enabled ?? existing?.enabled ?? true,
    usageCount: existing?.usageCount ?? 0,
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
  }

  const nextEntries = existing
    ? store.entries.map((item) => (item.id === entry.id ? entry : item))
    : [...store.entries, entry]
  const enabledCount = nextEntries.filter((item) => item.enabled).length
  if (enabledCount > MAX_ENABLED_DICTIONARY_ENTRIES) {
    throw new Error('启用词条不能超过 100 条')
  }

  store.entries = nextEntries
  writeStore(store)
  return entry
}

export function deleteVoiceDictionaryEntry(id: string): void {
  const store = readStore()
  store.entries = store.entries.filter((entry) => entry.id !== id)
  writeStore(store)
}

export function getEnabledVoiceDictionaryEntries(customHotwords = ''): VoiceDictionaryEntry[] {
  const entries = listVoiceDictionaryEntries(customHotwords).filter((entry) => entry.enabled)
  if (entries.length > MAX_ENABLED_DICTIONARY_ENTRIES) {
    throw new Error('启用词条不能超过 100 条')
  }
  return entries.slice(0, MAX_ENABLED_DICTIONARY_ENTRIES)
}

export function getVoiceAsrHotwords(customHotwords = ''): string[] {
  return getEnabledVoiceDictionaryEntries(customHotwords).map((entry) => entry.term)
}
