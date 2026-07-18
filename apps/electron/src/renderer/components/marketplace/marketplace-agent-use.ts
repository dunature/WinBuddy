import { atom } from 'jotai'
import type { AgentSessionMeta } from '@proma/shared'
import { agentSessionDraftHtmlAtom, agentSessionDraftsAtom } from '@/atoms/agent-atoms'

export function selectMarketplaceAgentSession(
  sessions: AgentSessionMeta[],
  currentSessionId: string | null,
  workspaceId: string,
): AgentSessionMeta | undefined {
  const available = sessions.filter((session) => (
    session.workspaceId === workspaceId && !session.archived
  ))
  return available.find((session) => session.id === currentSessionId) ?? available[0]
}

export function buildMarketplaceSkillDraft(identifier: string, currentDraft: string): string {
  const reference = `/skill:${identifier}`
  const existing = currentDraft.trimStart()
  if (existing === reference || existing.startsWith(`${reference} `)) return currentDraft
  return `${reference} ${existing}`
}

interface PrefillMarketplaceSkillDraftInput {
  sessionId: string
  identifier: string
}

export const prefillMarketplaceSkillDraftAtom = atom(
  null,
  (get, set, input: PrefillMarketplaceSkillDraftInput) => {
    const drafts = new Map(get(agentSessionDraftsAtom))
    drafts.set(
      input.sessionId,
      buildMarketplaceSkillDraft(input.identifier, drafts.get(input.sessionId) ?? ''),
    )
    set(agentSessionDraftsAtom, drafts)

    const htmlDrafts = get(agentSessionDraftHtmlAtom)
    if (htmlDrafts.has(input.sessionId)) {
      const nextHtmlDrafts = new Map(htmlDrafts)
      nextHtmlDrafts.delete(input.sessionId)
      set(agentSessionDraftHtmlAtom, nextHtmlDrafts)
    }
  },
)
