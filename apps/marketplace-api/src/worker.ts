import { loadMarketplaceApiConfig } from './config.ts'
import { S3MarketplaceObjectStore } from './object-store/s3-object-store.ts'
import { MarketplaceValidationRunner, PostgresValidationRepository } from './validation/validation-runner.ts'

const config = loadMarketplaceApiConfig(process.env)
const runner = new MarketplaceValidationRunner(new PostgresValidationRepository(config.databaseUrl), new S3MarketplaceObjectStore(config.objectStore))
console.log('[Marketplace Worker] 持久化校验 Worker 已启动')
setInterval(() => { void runner.runOnce().catch((error: unknown) => console.error('[Marketplace Worker] 校验轮询失败：', error)) }, 2_000)
