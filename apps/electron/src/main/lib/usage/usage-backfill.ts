import type { SDKMessage, UsageRescanResult } from '@proma/shared'
import { listChannels } from '../channel-manager'
import { getAgentSessionSDKMessages, listAgentSessions } from '../agent-session-manager'
import { isSDKResultMessage, normalizeAgentUsage } from './usage-normalizer'
import { recordUsage } from './usage-recorder'

function getNumberField(record: SDKMessage, key: string): number | undefined {
  const value = (record as Record<string, unknown>)[key]
  return typeof value === 'number' ? value : undefined
}

export function rescanUsageHistory(): UsageRescanResult {
  const channels = listChannels()
  const channelById = new Map(channels.map((channel) => [channel.id, channel]))
  let scannedSessions = 0
  let insertedRecords = 0
  let skippedRecords = 0

  for (const session of listAgentSessions()) {
    scannedSessions++
    const channel = session.channelId ? channelById.get(session.channelId) : undefined
    for (const message of getAgentSessionSDKMessages(session.id)) {
      if (!isSDKResultMessage(message)) continue
      const timestamp = getNumberField(message, '_createdAt') ?? Date.now()
      const durationMs = getNumberField(message, '_durationMs')
      const record = normalizeAgentUsage({
        result: message,
        timestamp,
        durationMs,
        session: {
          sessionId: session.id,
          sessionTitleSnapshot: session.title,
          sessionType: session.sourceAutomationId && !session.automationGraduated ? 'automation' : 'agent',
          automationId: session.sourceAutomationId,
          workspaceId: session.workspaceId,
          channelId: session.channelId,
          provider: channel?.provider,
          modelId: session.modelId,
        },
      })
      if (!record) {
        skippedRecords++
        continue
      }
      if (recordUsage(record)) insertedRecords++
      else skippedRecords++
    }
  }

  return { scannedSessions, insertedRecords, skippedRecords }
}
