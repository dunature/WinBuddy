import { MARKETPLACE_IPC_CHANNELS } from '@proma/shared'
import type {
  MarketplaceInstalledSkillRequest,
  MarketplaceToggleInstalledSkillRequest,
} from '@proma/shared'
import type { MarketplaceSkillLifecycle } from './marketplace-skill-lifecycle'

export type MarketplaceSkillLifecycleIpcHandler = (...args: unknown[]) => unknown
export type MarketplaceSkillLifecycleIpcRegistrar = (
  channel: string,
  handler: MarketplaceSkillLifecycleIpcHandler,
) => void

export function registerMarketplaceSkillLifecycleIpc(
  register: MarketplaceSkillLifecycleIpcRegistrar,
  lifecycle: MarketplaceSkillLifecycle,
): void {
  register(MARKETPLACE_IPC_CHANNELS.LIST_INSTALLED_SKILLS, (workspaceSlug) => (
    lifecycle.listInstalled(workspaceSlug as string)
  ))
  register(MARKETPLACE_IPC_CHANNELS.GET_INSTALLED_SKILL, (request) => (
    lifecycle.getInstalled(request as MarketplaceInstalledSkillRequest)
  ))
  register(MARKETPLACE_IPC_CHANNELS.SET_INSTALLED_SKILL_ENABLED, (request) => (
    lifecycle.setEnabled(request as MarketplaceToggleInstalledSkillRequest)
  ))
  register(MARKETPLACE_IPC_CHANNELS.UNINSTALL_SKILL, (request) => (
    lifecycle.uninstall(request as MarketplaceInstalledSkillRequest)
  ))
}
