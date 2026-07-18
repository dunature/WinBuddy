export const MARKETPLACE_DEFAULT_PAGE_SIZE = 16
export const MARKETPLACE_MAX_PAGE_SIZE = 50
export const MARKETPLACE_MAX_TEXT_PREVIEW_BYTES = 1024 * 1024

export interface MarketplacePaginationInput {
  page?: string | number | null
  pageSize?: string | number | null
}

export interface MarketplacePagination {
  page: number
  pageSize: number
}

function positiveInteger(value: string | number | null | undefined, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number.parseInt(value ?? '', 10)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

export function normalizeMarketplacePagination(input: MarketplacePaginationInput): MarketplacePagination {
  return {
    page: positiveInteger(input.page, 1),
    pageSize: Math.min(MARKETPLACE_MAX_PAGE_SIZE, positiveInteger(input.pageSize, MARKETPLACE_DEFAULT_PAGE_SIZE)),
  }
}

interface MarketplaceStoredFile {
  path: string
  size: number
}

interface MutableFileNode {
  path: string
  name: string
  type: 'file' | 'directory'
  size: number
  children: Map<string, MutableFileNode>
}

export interface MarketplaceDomainFileNode {
  path: string
  name: string
  type: 'file' | 'directory'
  size: number
  children?: MarketplaceDomainFileNode[]
}

function publicFileNode(node: MutableFileNode): MarketplaceDomainFileNode {
  if (node.type === 'file') {
    return { path: node.path, name: node.name, type: 'file', size: node.size }
  }
  const children = [...node.children.values()]
    .sort((left, right) => left.type === right.type
      ? left.name.localeCompare(right.name)
      : left.type === 'directory' ? -1 : 1)
    .map(publicFileNode)
  return { path: node.path, name: node.name, type: 'directory', size: 0, children }
}

export function buildMarketplaceFileTree(files: readonly MarketplaceStoredFile[]): MarketplaceDomainFileNode[] {
  const roots = new Map<string, MutableFileNode>()

  for (const file of files) {
    const parts = file.path.split('/').filter(Boolean)
    let siblings = roots
    let currentPath = ''
    for (const [index, name] of parts.entries()) {
      currentPath = currentPath ? `${currentPath}/${name}` : name
      const isFile = index === parts.length - 1
      let node = siblings.get(name)
      if (!node) {
        node = {
          path: currentPath,
          name,
          type: isFile ? 'file' : 'directory',
          size: isFile ? file.size : 0,
          children: new Map(),
        }
        siblings.set(name, node)
      }
      siblings = node.children
    }
  }

  return [...roots.values()]
    .sort((left, right) => left.type === right.type
      ? left.name.localeCompare(right.name)
      : left.type === 'directory' ? -1 : 1)
    .map(publicFileNode)
}
