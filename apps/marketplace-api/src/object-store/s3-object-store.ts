import { CopyObjectCommand, DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
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

  async getSignedUploadUrl(key: string, expiresInSeconds: number, contentType: string): Promise<string> {
    return getSignedUrl(this.client, new PutObjectCommand({ Bucket: this.options.bucket, Key: key, ContentType: contentType }), { expiresIn: expiresInSeconds })
  }

  async getObject(key: string): Promise<Uint8Array> {
    const response = await this.client.send(new GetObjectCommand({ Bucket: this.options.bucket, Key: key }))
    if (!response.Body) throw new Error(`对象不存在：${key}`)
    return response.Body.transformToByteArray()
  }

  async headObject(key: string) {
    try {
      const response = await this.client.send(new HeadObjectCommand({ Bucket: this.options.bucket, Key: key }))
      return { key, size: response.ContentLength ?? 0, ...(response.ContentType ? { contentType: response.ContentType } : {}), ...(response.ETag ? { etag: response.ETag } : {}) }
    } catch (error) {
      if (typeof error === 'object' && error !== null && '$metadata' in error && (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) return undefined
      throw error
    }
  }

  async copyObject(sourceKey: string, destinationKey: string): Promise<void> {
    await this.client.send(new CopyObjectCommand({ Bucket: this.options.bucket, Key: destinationKey, CopySource: `${this.options.bucket}/${sourceKey}` }))
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
