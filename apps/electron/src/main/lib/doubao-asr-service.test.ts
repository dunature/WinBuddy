import { describe, expect, test } from 'bun:test'
import type { VoiceDictationSettings } from '../../types'
import { buildDoubaoAsrAuthHeaders, resolveDoubaoAsrEndpoint } from './doubao-asr-service'

const baseSettings: VoiceDictationSettings = {
  enabled: true,
  provider: 'doubao',
  connectionMode: 'standard',
  appId: 'app-id',
  accessToken: 'access-token',
  resourceId: 'volc.seedasr.sauc.duration',
  language: '',
  endpointMode: 'async',
  outputMode: 'auto',
  customHotwords: '',
  polish: {
    enabled: false,
    stylePackId: 'builtin-light',
    previewBeforeCommit: false,
  },
}

describe('doubao ASR connection config', () => {
  test('standard mode uses existing ASR endpoint and app credentials', () => {
    expect(resolveDoubaoAsrEndpoint(baseSettings)).toBe('wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async')

    const headers = buildDoubaoAsrAuthHeaders(baseSettings)
    expect(headers['X-Api-App-Key']).toBe('app-id')
    expect(headers['X-Api-Access-Key']).toBe('access-token')
    expect(headers['X-Api-Key']).toBeUndefined()
  })

  test('Agent Plan mode uses plan endpoint and API Key credential', () => {
    const settings: VoiceDictationSettings = {
      ...baseSettings,
      connectionMode: 'ark-agent-plan',
      appId: '',
      accessToken: 'ark-api-key',
    }

    expect(resolveDoubaoAsrEndpoint(settings)).toBe('wss://openspeech.bytedance.com/api/v3/plan/sauc/bigmodel_async')

    const headers = buildDoubaoAsrAuthHeaders(settings)
    expect(headers['X-Api-Key']).toBe('ark-api-key')
    expect(headers['X-Api-Resource-Id']).toBe('volc.seedasr.sauc.duration')
    expect(headers['X-Api-Sequence']).toBe('-1')
    expect(headers['X-Api-App-Key']).toBeUndefined()
    expect(headers['X-Api-Access-Key']).toBeUndefined()
  })
})
