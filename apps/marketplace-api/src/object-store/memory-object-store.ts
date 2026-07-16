import type { MarketplaceObjectStore, MarketplaceStoredObject } from './object-store.ts'

interface MemoryObject {
  body: Uint8Array
  contentType: string
}

export class MemoryMarketplaceObjectStore implements MarketplaceObjectStore {
  readonly objects = new Map<string, MemoryObject>()

  async putPackage(key: string, body: Uint8Array): Promise<MarketplaceStoredObject> {
    return this.put(key, body, 'application/zip')
  }

  async putAsset(key: string, body: Uint8Array, contentType: string): Promise<MarketplaceStoredObject> {
    return this.put(key, body, contentType)
  }

  async getSignedDownloadUrl(key: string, expiresInSeconds: number): Promise<string> {
    if (!this.objects.has(key)) throw new Error(`对象不存在：${key}`)
    return `memory://marketplace/${encodeURIComponent(key)}?expires=${expiresInSeconds}`
  }

  async getSignedUploadUrl(key: string, expiresInSeconds: number, contentType: string): Promise<string> {
    return `memory://marketplace-upload/${encodeURIComponent(key)}?expires=${expiresInSeconds}&contentType=${encodeURIComponent(contentType)}`
  }

  async getObject(key: string): Promise<Uint8Array> {
    const object = this.objects.get(key)
    if (!object) throw new Error(`对象不存在：${key}`)
    return object.body.slice()
  }

  async headObject(key: string) {
    const object = this.objects.get(key)
    return object ? { key, size: object.body.byteLength, contentType: object.contentType } : undefined
  }

  async copyObject(sourceKey: string, destinationKey: string): Promise<void> {
    const object = this.objects.get(sourceKey)
    if (!object) throw new Error(`对象不存在：${sourceKey}`)
    this.objects.set(destinationKey, { body: object.body.slice(), contentType: object.contentType })
  }

  async deleteObject(key: string): Promise<void> {
    this.objects.delete(key)
  }

  private async put(key: string, body: Uint8Array, contentType: string): Promise<MarketplaceStoredObject> {
    this.objects.set(key, { body: body.slice(), contentType })
    return { key, size: body.byteLength }
  }
}
