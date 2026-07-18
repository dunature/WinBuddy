import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import type { MarketplaceDatabase } from './database/client'
import { createMarketplaceApp } from './app'

describe('Marketplace Web SPA 静态交付', () => {
  let webRoot = ''

  beforeAll(async () => {
    webRoot = await mkdtemp(join(tmpdir(), 'proma-marketplace-web-'))
    await mkdir(join(webRoot, 'assets'))
    await Bun.write(join(webRoot, 'index.html'), '<!doctype html><div id="root">Proma Marketplace</div>')
    await Bun.write(join(webRoot, 'assets', 'app.js'), 'globalThis.marketplaceLoaded = true')
  })

  afterAll(async () => {
    await rm(webRoot, { recursive: true, force: true })
  })

  test('Given Web 构建产物 When 请求入口、静态资源和详情深链 Then API 在统一前缀下交付 SPA', async () => {
    const app = createMarketplaceApp({
      database: {} as MarketplaceDatabase,
      webRoot,
    })

    const redirect = await app.request('/agent/marketplace')
    const asset = await app.request('/agent/marketplace/assets/app.js')
    const deepLink = await app.request('/agent/marketplace/skills/deep-research?tab=files')

    expect(redirect.status).toBe(302)
    expect(redirect.headers.get('location')).toBe('/agent/marketplace/')
    expect(asset.status).toBe(200)
    expect(await asset.text()).toContain('marketplaceLoaded')
    expect(deepLink.status).toBe(200)
    expect(await deepLink.text()).toContain('Proma Marketplace')
  })
})
