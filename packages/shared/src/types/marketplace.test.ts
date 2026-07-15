import { describe, expect, test } from 'bun:test'
import type { MarketplaceInstallState } from './marketplace-ipc'
import { MARKETPLACE_IPC_CHANNELS } from './marketplace-ipc'

function stateLabel(state: MarketplaceInstallState): string {
  switch (state.status) {
    case 'idle': return '等待安装'
    case 'downloading': return '下载安装包'
    case 'verifying': return '安全校验'
    case 'conflict': return '需要处理冲突'
    case 'committing': return '写入工作区'
    case 'success': return '安装成功'
    case 'error': return state.error.message
    case 'cancelled': return '安装已取消'
  }
}

describe('Marketplace contracts', () => {
  test('安装状态可以穷尽匹配', () => {
    expect(stateLabel({ status: 'verifying', installId: 'install-1', step: 'hash' })).toBe('安全校验')
  })

  test('IPC 通道使用独立命名空间', () => {
    expect(Object.values(MARKETPLACE_IPC_CHANNELS).every((channel) => channel.startsWith('marketplace:'))).toBe(true)
  })
})
