import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { GetObjectCommand } from '@aws-sdk/client-s3'
import type { MarketplaceObjectStore, MarketplaceStoredObject } from './object-store.ts'

export interface S3MarketplaceObjectStoreOptions {
  bucket: string
  region: string
  endpoint?: string
  accessKeyId: string
  secretAccessKey: string
}

export class S3MarketplaceObjectStore implements MarketplaceObjectStore {
  private readonly client: S3Client

  constructor(private readonly options: S3MarketplaceObjectStoreOptions) {
    this.client = new S3Client({
      region: options.region,
      ...(options.endpoint ? { endpoint: options.endpoint, forcePathStyle: true } : {}),
      credentials: {
        accessKeyId: options.accessKeyId,
        secretAccessKey: options.secretAccessKey,
      },
    })
  }

  async putPackage(key: string, body: Uint8Array): Promise<MarketplaceStoredObject> {
    return this.put(key, body, 'application/zip')
  }

  async putAsset(key: string, body: Uint8Array, contentType: string): Promise<MarketplaceStoredObject> {
    return this.put(key, body, contentType)
  }

  async getSignedDownloadUrl(key: string, expiresInSeconds: number): Promise<string> {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.options.bucket, Key: key }), {
      expiresIn: expiresInSeconds,
    })
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.options.bucket, Key: key }))
  }

  private async put(key: string, body: Uint8Array, contentType: string): Promise<MarketplaceStoredObject> {
    const result = await this.client.send(new PutObjectCommand({
      Bucket: this.options.bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    }))
    return { key, size: body.byteLength, ...(result.ETag ? { etag: result.ETag } : {}) }
  }
}
