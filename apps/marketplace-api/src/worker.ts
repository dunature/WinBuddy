import { loadMarketplaceApiConfig } from './config.ts'
import { S3MarketplaceObjectStore } from './object-store/s3-object-store.ts'
import { MarketplaceValidationRunner, PostgresValidationRepository } from './validation/validation-runner.ts'
import { formatMarketplaceLog } from '@proma/shared'

const config = loadMarketplaceApiConfig(process.env)
const runner = new MarketplaceValidationRunner(new PostgresValidationRepository(config.databaseUrl), new S3MarketplaceObjectStore(config.objectStore))
console.log('[Marketplace Worker] 持久化校验 Worker 已启动')
setInterval(() => { void runner.runOnce().catch(() => console.error(formatMarketplaceLog('校验轮询失败', { errorCode: 'VALIDATION_RUN_FAILED' }))) }, 2_000)
