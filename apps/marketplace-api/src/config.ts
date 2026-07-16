import { z } from 'zod'

const configSchema = z.object({
  MARKETPLACE_DATABASE_URL: z.string().url(),
  MARKETPLACE_OBJECT_BUCKET: z.string().min(1),
  MARKETPLACE_OBJECT_REGION: z.string().min(1),
  MARKETPLACE_OBJECT_ENDPOINT: z.string().url().optional(),
  MARKETPLACE_OBJECT_ACCESS_KEY_ID: z.string().min(1),
  MARKETPLACE_OBJECT_SECRET_ACCESS_KEY: z.string().min(1),
  MARKETPLACE_PUBLIC_ORIGINS: z.string().default('http://localhost:4173'),
  MARKETPLACE_PORT: z.coerce.number().int().min(1).max(65535).default(4310),
  MARKETPLACE_WEB_URL: z.string().url().default('http://localhost:4173'),
  MARKETPLACE_API_PUBLIC_URL: z.string().url().default('http://localhost:4310'),
  MARKETPLACE_GITHUB_CLIENT_ID: z.string().min(1).optional(),
  MARKETPLACE_GITHUB_CLIENT_SECRET: z.string().min(1).optional(),
  MARKETPLACE_SESSION_SECRET: z.string().min(32).optional(),
  MARKETPLACE_FEATURE_ADMIN: z.enum(['true', 'false']).default('false'),
  MARKETPLACE_FEATURE_BROWSE: z.enum(['true','false']).default('false'),
  MARKETPLACE_FEATURE_INSTALL: z.enum(['true','false']).default('false'),
  MARKETPLACE_FEATURE_COMMUNITY: z.enum(['true','false']).default('false'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
})

export interface MarketplaceApiConfig {
  databaseUrl: string
  objectStore: {
    bucket: string
    region: string
    endpoint?: string
    accessKeyId: string
    secretAccessKey: string
  }
  publicOrigins: string[]
  port: number
  environment: 'development' | 'test' | 'production'
  webUrl: string
  apiPublicUrl: string
  githubOAuth?: { clientId: string; clientSecret: string; sessionSecret: string }
  adminEnabled: boolean
  features: { browse:boolean;install:boolean;admin:boolean;community:boolean }
}

export function loadMarketplaceApiConfig(env: Record<string, string | undefined>): MarketplaceApiConfig {
  const parsed = configSchema.safeParse(env)
  if (!parsed.success) {
    const fields = parsed.error.issues.map((item) => item.path.join('.')).filter(Boolean).join('、')
    throw new Error(`Marketplace API 配置无效，请检查：${fields || '环境变量'}`)
  }

  const adminEnabled = parsed.data.MARKETPLACE_FEATURE_ADMIN === 'true'
  const oauthValues = [parsed.data.MARKETPLACE_GITHUB_CLIENT_ID, parsed.data.MARKETPLACE_GITHUB_CLIENT_SECRET, parsed.data.MARKETPLACE_SESSION_SECRET]
  if (adminEnabled && oauthValues.some((value) => !value)) {
    throw new Error('Marketplace API 配置无效，启用管理端时必须配置 GitHub OAuth 与 Session Secret')
  }
  return {
    databaseUrl: parsed.data.MARKETPLACE_DATABASE_URL,
    objectStore: {
      bucket: parsed.data.MARKETPLACE_OBJECT_BUCKET,
      region: parsed.data.MARKETPLACE_OBJECT_REGION,
      ...(parsed.data.MARKETPLACE_OBJECT_ENDPOINT ? { endpoint: parsed.data.MARKETPLACE_OBJECT_ENDPOINT } : {}),
      accessKeyId: parsed.data.MARKETPLACE_OBJECT_ACCESS_KEY_ID,
      secretAccessKey: parsed.data.MARKETPLACE_OBJECT_SECRET_ACCESS_KEY,
    },
    publicOrigins: parsed.data.MARKETPLACE_PUBLIC_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean),
    port: parsed.data.MARKETPLACE_PORT,
    environment: parsed.data.NODE_ENV,
    webUrl: parsed.data.MARKETPLACE_WEB_URL,
    apiPublicUrl: parsed.data.MARKETPLACE_API_PUBLIC_URL,
    adminEnabled,
    features:{browse:parsed.data.MARKETPLACE_FEATURE_BROWSE==='true',install:parsed.data.MARKETPLACE_FEATURE_INSTALL==='true',admin:adminEnabled,community:parsed.data.MARKETPLACE_FEATURE_COMMUNITY==='true'},
    ...(oauthValues.every(Boolean) ? { githubOAuth: { clientId: oauthValues[0]!, clientSecret: oauthValues[1]!, sessionSecret: oauthValues[2]! } } : {}),
  }
}
