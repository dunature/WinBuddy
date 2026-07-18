import { describe, expect, test } from 'bun:test'
import { createStore } from 'jotai/vanilla'
import type { AgentSessionMeta } from '@proma/shared'
import { agentSessionDraftHtmlAtom, agentSessionDraftsAtom } from '@/atoms/agent-atoms'
import {
  buildMarketplaceSkillDraft,
  prefillMarketplaceSkillDraftAtom,
  selectMarketplaceAgentSession,
} from './marketplace-agent-use'

function session(input: Pick<AgentSessionMeta, 'id' | 'workspaceId'>): AgentSessionMeta {
  return {
    id: input.id,
    title: input.id,
    workspaceId: input.workspaceId,
    createdAt: 1,
    updatedAt: 1,
  }
}

describe('marketplace Agent use', () => {
  test('Given workspace sessions, When choosing a target, Then prefers current matching session and otherwise the newest matching session', () => {
    const sessions = [
      session({ id: 'newest-a', workspaceId: 'workspace-a' }),
      session({ id: 'current-b', workspaceId: 'workspace-b' }),
      session({ id: 'older-a', workspaceId: 'workspace-a' }),
    ]

    expect(selectMarketplaceAgentSession(sessions, 'older-a', 'workspace-a')?.id).toBe('older-a')
    expect(selectMarketplaceAgentSession(sessions, 'current-b', 'workspace-a')?.id).toBe('newest-a')
  })

  test('Given an existing draft, When prefilling a Skill, Then preserves text without duplicating the reference', () => {
    expect(buildMarketplaceSkillDraft('research', '请分析这份材料')).toBe('/skill:research 请分析这份材料')
    expect(buildMarketplaceSkillDraft('research', '/skill:research 请分析这份材料'))
      .toBe('/skill:research 请分析这份材料')
  })

  test('Given a real Agent session, When prefilling through Jotai, Then updates markdown draft and clears stale HTML', () => {
    const store = createStore()
    store.set(agentSessionDraftsAtom, new Map([['session-a', '请分析这份材料']]))
    store.set(agentSessionDraftHtmlAtom, new Map([['session-a', '<p>旧草稿</p>']]))

    store.set(prefillMarketplaceSkillDraftAtom, {
      sessionId: 'session-a',
      identifier: 'research',
    })

    expect(store.get(agentSessionDraftsAtom).get('session-a'))
      .toBe('/skill:research 请分析这份材料')
    expect(store.get(agentSessionDraftHtmlAtom).has('session-a')).toBe(false)
  })
})
