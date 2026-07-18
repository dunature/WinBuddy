import { describe, expect, test } from 'bun:test'
import { loadMarketplaceConfig } from './config'

describe('Marketplace API 配置', () => {
  test('Given 完整环境变量 When 加载配置 Then 返回经过校验的监听参数', () => {
    expect(loadMarketplaceConfig({
      MARKETPLACE_DATABASE_URL: 'postgres://localhost/marketplace',
      MARKETPLACE_HOST: '0.0.0.0',
      MARKETPLACE_PORT: '4318',
      MARKETPLACE_WEB_DIR: '/tmp/marketplace-web',
    })).toEqual({
      databaseUrl: 'postgres://localhost/marketplace',
      host: '0.0.0.0',
      port: 4318,
      webRoot: '/tmp/marketplace-web',
    })
  })

  test('Given 缺少数据库 URL 或端口越界 When 加载配置 Then 在启动前返回中文错误', () => {
    expect(() => loadMarketplaceConfig({})).toThrow('缺少 MARKETPLACE_DATABASE_URL')
    expect(() => loadMarketplaceConfig({
      MARKETPLACE_DATABASE_URL: 'postgres://localhost/marketplace',
      MARKETPLACE_PORT: '70000',
    })).toThrow('MARKETPLACE_PORT 必须是 1 到 65535')
    expect(() => loadMarketplaceConfig({
      MARKETPLACE_DATABASE_URL: 'postgres://localhost/marketplace',
      MARKETPLACE_PORT: '4318abc',
    })).toThrow('MARKETPLACE_PORT 必须是 1 到 65535')
  })
})
