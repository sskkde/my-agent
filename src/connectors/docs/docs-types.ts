// Docs Connector Types
// Type definitions for Docs API responses and connector operations

// Document
export interface DocsDocument {
  id: string
  title: string
  content: string
  createdAt: string
  updatedAt: string
  owner: string
  sharedWith?: string[]
  mimeType?: string
  url?: string
}

// Document List Item (lighter weight for listing)
export interface DocsListItem {
  id: string
  title: string
  updatedAt: string
  owner: string
  mimeType?: string
  url?: string
}

// Operation Parameters
export interface ListDocsParams {
  maxResults?: number
  pageToken?: string
  folderId?: string
  orderBy?: 'created' | 'modified' | 'title'
}

export interface GetDocParams {
  docId: string
  includeContent?: boolean
}

export interface CreateDocParams {
  title: string
  content?: string
  folderId?: string
  mimeType?: string
}

export interface UpdateDocParams {
  docId: string
  content: string
  title?: string
}

export interface SearchDocsParams {
  query: string
  maxResults?: number
  pageToken?: string
  fields?: string[]
}

// Provider Types
export type DocsProvider = 'notion' | 'google'

// Authentication
export interface DocsAuthConfig {
  provider: DocsProvider
  credentials: string // API Key for Notion, OAuth token for Google
}

// Error Types
export type DocsErrorCode =
  | 'AUTH_INVALID'
  | 'AUTH_EXPIRED'
  | 'RATE_LIMITED'
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'VALIDATION_ERROR'
  | 'NETWORK_ERROR'
  | 'UNKNOWN_ERROR'

export interface DocsError {
  code: DocsErrorCode
  message: string
  recoverable: boolean
  details?: {
    statusCode?: number
    rateLimitRemaining?: number
    rateLimitResetAt?: string
  }
}

// Transport Interface (for mocking/real implementation)
export interface DocsTransport {
  listDocs(params: ListDocsParams): Promise<{ docs: DocsListItem[]; totalResults: number; nextPageToken?: string }>
  getDoc(params: GetDocParams): Promise<DocsDocument | null>
  createDoc(params: CreateDocParams): Promise<{ id: string; title: string; createdAt: string; updatedAt: string }>
  updateDoc(params: UpdateDocParams): Promise<{ id: string; title: string; updatedAt: string; success: boolean }>
  searchDocs(params: SearchDocsParams): Promise<{ docs: DocsListItem[]; totalResults: number }>
  validateAuth(): Promise<boolean>
}

// Notion-specific types
export interface NotionPage {
  id: string
  object: 'page'
  created_time: string
  last_edited_time: string
  archived: boolean
  properties: Record<string, unknown>
  url: string
}

export interface NotionBlock {
  id: string
  object: 'block'
  type: string
  [key: string]: unknown
}

export interface NotionSearchResult {
  object: 'page' | 'database'
  id: string
  properties?: Record<string, unknown>
  url: string
  created_time: string
  last_edited_time: string
}

// Google Docs-specific types
export interface GoogleDriveFile {
  id: string
  name: string
  mimeType: string
  createdTime: string
  modifiedTime: string
  owners: Array<{ emailAddress: string; displayName?: string }>
  webViewLink: string
}

export interface GoogleDocsDocument {
  documentId: string
  title: string
  body?: {
    content: unknown[]
  }
}
