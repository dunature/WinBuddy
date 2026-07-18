import { atom } from 'jotai'
import type {
  MarketplaceBulkGovernanceAction,
  MarketplaceBulkGovernanceResult,
  MarketplaceBulkGovernanceTarget,
} from '@proma/shared'

export interface AdminBulkState {
  phase: 'idle' | 'submitting' | 'complete' | 'error'
  action: MarketplaceBulkGovernanceAction | null
  result: MarketplaceBulkGovernanceResult | null
  error: string | null
}

export const adminBulkSelectionAtom = atom<Map<string, MarketplaceBulkGovernanceTarget>>(new Map())
export const adminBulkStateAtom = atom<AdminBulkState>({ phase: 'idle', action: null, result: null, error: null })

export function updateBulkSelection(
  current: Map<string, MarketplaceBulkGovernanceTarget>,
  target: MarketplaceBulkGovernanceTarget,
  selected: boolean,
): Map<string, MarketplaceBulkGovernanceTarget> {
  const next = new Map(current)
  if (selected) next.set(target.key, target)
  else next.delete(target.key)
  return next
}

export function retryableBulkTargets(result: MarketplaceBulkGovernanceResult): MarketplaceBulkGovernanceTarget[] {
  return result.failed
    .filter((item) => item.retryable)
    .map(({ outcome: _outcome, code: _code, message: _message, retryable: _retryable, ...target }) => target)
}
