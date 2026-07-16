export interface MarketplaceStoredObject {
  key: string
  size: number
  etag?: string
}

export interface MarketplaceObjectMetadata { key: string; size: number; contentType?: string; etag?: string }

export interface MarketplaceObjectStore {
  putPackage(key: string, body: Uint8Array): Promise<MarketplaceStoredObject>
  putAsset(key: string, body: Uint8Array, contentType: string): Promise<MarketplaceStoredObject>
  getSignedDownloadUrl(key: string, expiresInSeconds: number): Promise<string>
  getSignedUploadUrl(key: string, expiresInSeconds: number, contentType: string): Promise<string>
  getObject(key: string): Promise<Uint8Array>
  headObject(key: string): Promise<MarketplaceObjectMetadata | undefined>
  copyObject(sourceKey: string, destinationKey: string): Promise<void>
  deleteObject(key: string): Promise<void>
}

export function quarantinePackageKey(submissionId: string): string {
  return `quarantine/submissions/${submissionId}/package.zip`
}

export function publishedPackageKey(skillId: string, version: string): string {
  return `skills/${skillId}/${version}/package.zip`
}
