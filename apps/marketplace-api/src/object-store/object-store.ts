export interface MarketplaceStoredObject {
  key: string
  size: number
  etag?: string
}

export interface MarketplaceObjectStore {
  putPackage(key: string, body: Uint8Array): Promise<MarketplaceStoredObject>
  putAsset(key: string, body: Uint8Array, contentType: string): Promise<MarketplaceStoredObject>
  getSignedDownloadUrl(key: string, expiresInSeconds: number): Promise<string>
  deleteObject(key: string): Promise<void>
}

export function quarantinePackageKey(submissionId: string): string {
  return `quarantine/submissions/${submissionId}/package.zip`
}

export function publishedPackageKey(skillId: string, version: string): string {
  return `skills/${skillId}/${version}/package.zip`
}
