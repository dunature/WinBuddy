import { describe, expect, test } from 'bun:test'
import { loadMarketplaceConfig, loadMarketplaceDatabaseUrl } from './config'

describe('Marketplace API 配置', () => {
  test('Given 仅有数据库 URL When 运行迁移配置 Then 不要求管理员初始化凭证', () => {
    expect(loadMarketplaceDatabaseUrl({
      MARKETPLACE_DATABASE_URL: 'postgres://localhost/marketplace',
    })).toBe('postgres://localhost/marketplace')
  })

  test('Given 完整环境变量 When 加载配置 Then 返回经过校验的监听参数', () => {
    expect(loadMarketplaceConfig({
      MARKETPLACE_DATABASE_URL: 'postgres://localhost/marketplace',
      MARKETPLACE_HOST: '0.0.0.0',
      MARKETPLACE_PORT: '4318',
      MARKETPLACE_WEB_DIR: '/tmp/marketplace-web',
      MARKETPLACE_STORAGE_DIR: '/tmp/marketplace-storage',
      MARKETPLACE_ADMIN_USERNAME: 'market-admin',
      MARKETPLACE_ADMIN_INITIAL_PASSWORD: 'initial-password-123',
      MARKETPLACE_ALLOWED_ORIGIN: 'https://marketplace.example.com',
      MARKETPLACE_DOWNLOAD_SIGNING_SECRET: 'download-signing-secret-with-32-bytes',
    })).toEqual({
      databaseUrl: 'postgres://localhost/marketplace',
      host: '0.0.0.0',
      port: 4318,
      webRoot: '/tmp/marketplace-web',
      storageDir: '/tmp/marketplace-storage',
      adminUsername: 'market-admin',
      adminInitialPassword: 'initial-password-123',
      allowedOrigin: 'https://marketplace.example.com',
      downloadSigningSecret: 'download-signing-secret-with-32-bytes',
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

  test('Given 管理员初始化参数缺失或来源非法 When 加载配置 Then 拒绝启动', () => {
    expect(() => loadMarketplaceConfig({
      MARKETPLACE_DATABASE_URL: 'postgres://localhost/marketplace',
    })).toThrow('缺少 MARKETPLACE_ADMIN_USERNAME')
    expect(() => loadMarketplaceConfig({
      MARKETPLACE_DATABASE_URL: 'postgres://localhost/marketplace',
      MARKETPLACE_ADMIN_USERNAME: 'admin',
    })).toThrow('缺少 MARKETPLACE_ADMIN_INITIAL_PASSWORD')
    expect(() => loadMarketplaceConfig({
      MARKETPLACE_DATABASE_URL: 'postgres://localhost/marketplace',
      MARKETPLACE_ADMIN_USERNAME: 'admin',
      MARKETPLACE_ADMIN_INITIAL_PASSWORD: 'too-short',
    })).toThrow('MARKETPLACE_ADMIN_INITIAL_PASSWORD 至少需要 12 个字符')
    expect(() => loadMarketplaceConfig({
      MARKETPLACE_DATABASE_URL: 'postgres://localhost/marketplace',
      MARKETPLACE_ADMIN_USERNAME: 'admin',
      MARKETPLACE_ADMIN_INITIAL_PASSWORD: 'initial-password-123',
      MARKETPLACE_ALLOWED_ORIGIN: 'javascript:alert(1)',
    })).toThrow('MARKETPLACE_ALLOWED_ORIGIN 必须是 HTTP(S) Origin')
    expect(() => loadMarketplaceConfig({
      MARKETPLACE_DATABASE_URL: 'postgres://localhost/marketplace',
      MARKETPLACE_ADMIN_USERNAME: 'admin',
      MARKETPLACE_ADMIN_INITIAL_PASSWORD: 'initial-password-123',
    })).toThrow('缺少 MARKETPLACE_STORAGE_DIR')
    expect(() => loadMarketplaceConfig({
      MARKETPLACE_DATABASE_URL: 'postgres://localhost/marketplace',
      MARKETPLACE_ADMIN_USERNAME: 'admin',
      MARKETPLACE_ADMIN_INITIAL_PASSWORD: 'initial-password-123',
      MARKETPLACE_STORAGE_DIR: '/tmp/marketplace-storage',
      MARKETPLACE_DOWNLOAD_SIGNING_SECRET: 'too-short',
    })).toThrow('MARKETPLACE_DOWNLOAD_SIGNING_SECRET 至少需要 32 个字符')
  })
})
