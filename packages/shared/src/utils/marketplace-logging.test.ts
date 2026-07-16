import { describe, expect, test } from 'bun:test'
import { formatMarketplaceLog, sanitizeMarketplaceLogFields } from './marketplace-logging.ts'

describe('Marketplace 日志净化', () => {
  test('只保留允许的遥测字段', () => {
    expect(sanitizeMarketplaceLogFields({
      requestId: 'req-1', errorCode: 'FAILED', skillId: 'skill-1', version: '1.0.0', platform: 'darwin', result: 'failed',
      prompt: '机密提示词', localPath: '/Users/name/private', fileBody: '正文', token: 'secret', objectKey: 'quarantine/private.zip',
    })).toEqual({ requestId: 'req-1', errorCode: 'FAILED', skillId: 'skill-1', version: '1.0.0', platform: 'darwin', result: 'failed' })
    const output = formatMarketplaceLog('操作失败', { prompt: 'secret', localPath: '/tmp/private' })
    expect(output).not.toContain('secret')
    expect(output).not.toContain('/tmp')
  })
})
