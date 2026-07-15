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
}

export function loadMarketplaceApiConfig(env: Record<string, string | undefined>): MarketplaceApiConfig {
  const parsed = configSchema.safeParse(env)
  if (!parsed.success) {
    const fields = parsed.error.issues.map((item) => item.path.join('.')).filter(Boolean).join('、')
    throw new Error(`Marketplace API 配置无效，请检查：${fields || '环境变量'}`)
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
  }
}
