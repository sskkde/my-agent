import type { ConnectorAdapter, ConnectorCapability, ConnectorCallRequest } from '../types.js'
import type { ConnectorInstance } from '../../storage/connector-store.js'
import type {
  DocsTransport,
  DocsDocument,
  DocsListItem,
  ListDocsParams,
  GetDocParams,
  CreateDocParams,
  UpdateDocParams,
  SearchDocsParams,
  DocsProvider,
  DocsError,
} from './docs-types.js'
import {
  encryptSecret,
  decryptSecret,
  deserializeEncryptedSecret,
  serializeEncryptedSecret,
} from '../../storage/provider-crypto.js'
import { BaseHttpTransport, TransportError } from '../base-http-transport.js'
import type { HttpTransportAuth } from '../base-http-transport-types.js'
import { DocsMockTransport } from './docs-mock-transport.js'

const DOCS_CAPABILITIES: ConnectorCapability[] = [
  {
    capabilityId: 'docs.list_docs',
    name: 'List Documents',
    description: 'List documents from the connected provider',
    category: 'read',
    riskLevel: 'low',
    inputSchema: {
      maxResults: { type: 'number', description: 'Maximum results to return' },
      pageToken: { type: 'string', description: 'Token for pagination' },
      folderId: { type: 'string', description: 'Folder to list from' },
    },
    requiresAuth: true,
    supportedOperations: ['list_docs'],
  },
  {
    capabilityId: 'docs.get_doc',
    name: 'Get Document',
    description: 'Retrieve a specific document by ID',
    category: 'read',
    riskLevel: 'low',
    inputSchema: {
      docId: { type: 'string', required: true, description: 'Document ID' },
      includeContent: { type: 'boolean', description: 'Include full content' },
    },
    requiresAuth: true,
    supportedOperations: ['get_doc'],
  },
  {
    capabilityId: 'docs.create_doc',
    name: 'Create Document',
    description: 'Create a new document',
    category: 'write',
    riskLevel: 'medium',
    inputSchema: {
      title: { type: 'string', required: true, description: 'Document title' },
      content: { type: 'string', description: 'Initial content' },
      folderId: { type: 'string', description: 'Parent folder ID' },
    },
    requiresAuth: true,
    supportedOperations: ['create_doc'],
  },
  {
    capabilityId: 'docs.update_doc',
    name: 'Update Document',
    description: 'Update an existing document',
    category: 'write',
    riskLevel: 'medium',
    inputSchema: {
      docId: { type: 'string', required: true, description: 'Document ID' },
      content: { type: 'string', required: true, description: 'New content' },
      title: { type: 'string', description: 'New title (optional)' },
    },
    requiresAuth: true,
    supportedOperations: ['update_doc'],
  },
  {
    capabilityId: 'docs.search_docs',
    name: 'Search Documents',
    description: 'Search documents by query',
    category: 'read',
    riskLevel: 'low',
    inputSchema: {
      query: { type: 'string', required: true, description: 'Search query' },
      maxResults: { type: 'number', description: 'Maximum results to return' },
    },
    requiresAuth: true,
    supportedOperations: ['search_docs'],
  },
]

export interface DocsConnectorConfig {
  transport?: DocsTransport
  useMock?: boolean
}

interface ParsedAuthState {
  provider: DocsProvider
  credentials: string
}

export class DocsConnectorAdapter implements ConnectorAdapter {
  private defaultTransport: DocsTransport | null = null
  private useMock: boolean

  constructor(config: DocsConnectorConfig) {
    this.useMock = config.useMock ?? process.env.DOCS_MOCK_MODE === 'true'

    if (this.useMock || config.transport instanceof DocsMockTransport) {
      this.defaultTransport = config.transport ?? new DocsMockTransport()
    } else if (config.transport) {
      this.defaultTransport = config.transport
    }
  }

  private getTransport(instance: ConnectorInstance): DocsTransport {
    if (this.defaultTransport) {
      return this.defaultTransport
    }

    const authState = this.parseAuthState(instance)

    if (this.useMock) {
      return new DocsMockTransport()
    }

    if (authState.provider === 'notion') {
      return createNotionTransport(authState.credentials)
    }

    if (authState.provider === 'google') {
      return createGoogleDocsTransport(authState.credentials)
    }

    throw new Error(`Unsupported provider: ${authState.provider}`)
  }

  async execute(instance: ConnectorInstance, request: ConnectorCallRequest): Promise<unknown> {
    const transport = this.getTransport(instance)

    const { operation, params } = request

    switch (operation) {
      case 'list_docs':
        return transport.listDocs(params as unknown as ListDocsParams)

      case 'get_doc':
        return transport.getDoc(params as unknown as GetDocParams)

      case 'create_doc':
        return transport.createDoc(params as unknown as CreateDocParams)

      case 'update_doc':
        return transport.updateDoc(params as unknown as UpdateDocParams)

      case 'search_docs':
        return transport.searchDocs(params as unknown as SearchDocsParams)

      default:
        throw new Error(`Unknown operation: ${operation}`)
    }
  }

  discoverCapabilities(_instance: ConnectorInstance): ConnectorCapability[] {
    return DOCS_CAPABILITIES
  }

  checkHealth(_instance: ConnectorInstance): { healthy: boolean; message?: string } {
    return { healthy: true, message: 'Docs connector is healthy' }
  }

  private parseAuthState(instance: ConnectorInstance): ParsedAuthState {
    if (!instance.authStateRef) {
      throw this.createAuthError('No authentication configured')
    }

    try {
      const deserialized = deserializeEncryptedSecret(instance.authStateRef)
      const decrypted = decryptSecret(deserialized.encrypted, deserialized.iv, deserialized.authTag)
      const parsed = JSON.parse(decrypted) as ParsedAuthState

      if (!parsed.provider || !parsed.credentials) {
        throw new Error('Invalid auth state format')
      }

      return parsed
    } catch {
      throw this.createAuthError('Failed to decrypt credentials')
    }
  }

  static encryptAuth(credentials: string, provider: DocsProvider): string {
    const authState: ParsedAuthState = { provider, credentials }
    const encrypted = encryptSecret(JSON.stringify(authState))
    return serializeEncryptedSecret(encrypted)
  }

  private createAuthError(message: string): DocsError {
    const error = new Error(message) as Error & DocsError
    error.code = 'AUTH_INVALID'
    error.message = message
    error.recoverable = false
    throw error
  }
}

export function createDocsConnectorAdapter(config: DocsConnectorConfig): DocsConnectorAdapter {
  return new DocsConnectorAdapter(config)
}

export function createNotionTransport(apiKey: string): DocsTransport {
  return new NotionHttpTransport(apiKey)
}

export function createGoogleDocsTransport(oauthToken: string): DocsTransport {
  return new GoogleDocsHttpTransport(oauthToken)
}

class NotionHttpTransport implements DocsTransport {
  private http: BaseHttpTransport

  constructor(apiKey: string) {
    const auth: HttpTransportAuth = {
      type: 'bearer',
      credentials: apiKey,
    }

    this.http = new BaseHttpTransport({
      baseURL: 'https://api.notion.com/v1',
      auth,
      headers: {
        'Notion-Version': '2022-06-28',
      },
    })
  }

  async listDocs(
    params: ListDocsParams,
  ): Promise<{ docs: DocsListItem[]; totalResults: number; nextPageToken?: string }> {
    const { maxResults = 10, pageToken } = params

    try {
      const response = await this.http.post<{
        results: Array<{
          id: string
          properties: Record<string, unknown>
          url: string
          created_time: string
          last_edited_time: string
        }>
        has_more: boolean
        next_cursor?: string
      }>('/search', {
        page_size: maxResults,
        start_cursor: pageToken,
      })

      const docs: DocsListItem[] =
        response.body?.results.map((page) => ({
          id: page.id,
          title: this.extractTitle(page.properties) || 'Untitled',
          updatedAt: page.last_edited_time,
          owner: 'notion-user',
          url: page.url,
        })) ?? []

      return {
        docs,
        totalResults: docs.length,
        nextPageToken: response.body?.has_more ? response.body.next_cursor : undefined,
      }
    } catch (err) {
      throw this.handleError(err)
    }
  }

  async getDoc(params: GetDocParams): Promise<DocsDocument | null> {
    const { docId } = params

    try {
      const [pageResponse, blocksResponse] = await Promise.all([
        this.http.get<{
          id: string
          properties: Record<string, unknown>
          url: string
          created_time: string
          last_edited_time: string
        }>(`/pages/${docId}`),
        this.http.get<{
          results: Array<{ type: string; [key: string]: unknown }>
        }>(`/blocks/${docId}/children`),
      ])

      if (!pageResponse.body) return null

      const content = this.blocksToContent(blocksResponse.body?.results ?? [])

      return {
        id: pageResponse.body.id,
        title: this.extractTitle(pageResponse.body.properties) || 'Untitled',
        content,
        createdAt: pageResponse.body.created_time,
        updatedAt: pageResponse.body.last_edited_time,
        owner: 'notion-user',
        url: pageResponse.body.url,
      }
    } catch (err) {
      if (err instanceof TransportError && err.statusCode === 404) {
        return null
      }
      throw this.handleError(err)
    }
  }

  async createDoc(
    params: CreateDocParams,
  ): Promise<{ id: string; title: string; createdAt: string; updatedAt: string }> {
    const { title, content = '' } = params

    try {
      const response = await this.http.post<{
        id: string
        created_time: string
        last_edited_time: string
      }>('/pages', {
        parent: { page_id: null },
        properties: {
          title: [{ text: { content: title } }],
        },
        children: this.contentToBlocks(content),
      })

      return {
        id: response.body?.id ?? '',
        title,
        createdAt: response.body?.created_time ?? new Date().toISOString(),
        updatedAt: response.body?.last_edited_time ?? new Date().toISOString(),
      }
    } catch (err) {
      throw this.handleError(err)
    }
  }

  async updateDoc(
    params: UpdateDocParams,
  ): Promise<{ id: string; title: string; updatedAt: string; success: boolean }> {
    const { docId, content, title } = params

    try {
      await this.http.patch(`/pages/${docId}`, {
        properties: title ? { title: [{ text: { content: title } }] } : undefined,
      })

      await this.http.patch(`/blocks/${docId}/children`, {
        children: this.contentToBlocks(content),
      })

      return {
        id: docId,
        title: title || 'Untitled',
        updatedAt: new Date().toISOString(),
        success: true,
      }
    } catch (err) {
      throw this.handleError(err)
    }
  }

  async searchDocs(params: SearchDocsParams): Promise<{ docs: DocsListItem[]; totalResults: number }> {
    const { query, maxResults = 10 } = params

    try {
      const response = await this.http.post<{
        results: Array<{ id: string; properties: Record<string, unknown>; url: string; last_edited_time: string }>
      }>('/search', {
        query,
        page_size: maxResults,
      })

      const docs: DocsListItem[] =
        response.body?.results.map((page) => ({
          id: page.id,
          title: this.extractTitle(page.properties) || 'Untitled',
          updatedAt: page.last_edited_time,
          owner: 'notion-user',
          url: page.url,
        })) ?? []

      return {
        docs,
        totalResults: docs.length,
      }
    } catch (err) {
      throw this.handleError(err)
    }
  }

  async validateAuth(): Promise<boolean> {
    try {
      await this.http.get('/users/me')
      return true
    } catch {
      return false
    }
  }

  private extractTitle(properties: Record<string, unknown>): string | null {
    const titleProp = properties.title ?? properties.Name ?? properties.name
    if (Array.isArray(titleProp)) {
      const textItem = titleProp[0]
      if (textItem && typeof textItem === 'object' && 'text' in textItem) {
        return (textItem.text as { content: string }).content ?? null
      }
    }
    return null
  }

  private blocksToContent(blocks: Array<{ type: string; [key: string]: unknown }>): string {
    return blocks
      .map((block) => {
        const typeData = block[block.type as keyof typeof block]
        if (typeData && typeof typeData === 'object' && 'rich_text' in typeData) {
          const richText = typeData.rich_text as Array<{ text?: { content: string } }>
          return richText.map((rt) => rt.text?.content ?? '').join('')
        }
        return ''
      })
      .filter(Boolean)
      .join('\n')
  }

  private contentToBlocks(content: string): unknown[] {
    return content.split('\n').map((line) => ({
      type: 'paragraph',
      paragraph: {
        rich_text: [{ text: { content: line } }],
      },
    }))
  }

  private handleError(err: unknown): DocsError {
    if (err instanceof TransportError) {
      const error = new Error(err.message) as Error & DocsError
      error.code = this.mapErrorCode(err.type)
      error.recoverable = err.retryable
      throw error
    }
    const error = new Error('Unknown error') as Error & DocsError
    error.code = 'UNKNOWN_ERROR'
    error.recoverable = false
    throw error
  }

  private mapErrorCode(type: string): DocsError['code'] {
    const mapping: Record<string, DocsError['code']> = {
      auth: 'AUTH_INVALID',
      rate_limit: 'RATE_LIMITED',
      timeout: 'NETWORK_ERROR',
      network: 'NETWORK_ERROR',
      server: 'UNKNOWN_ERROR',
      parse: 'VALIDATION_ERROR',
    }
    return mapping[type] ?? 'UNKNOWN_ERROR'
  }
}

class GoogleDocsHttpTransport implements DocsTransport {
  private http: BaseHttpTransport
  private driveHttp: BaseHttpTransport

  constructor(oauthToken: string) {
    const auth: HttpTransportAuth = {
      type: 'oauth2',
      credentials: oauthToken,
    }

    this.http = new BaseHttpTransport({
      baseURL: 'https://docs.googleapis.com/v1',
      auth,
    })

    this.driveHttp = new BaseHttpTransport({
      baseURL: 'https://www.googleapis.com/drive/v3',
      auth,
    })
  }

  async listDocs(
    params: ListDocsParams,
  ): Promise<{ docs: DocsListItem[]; totalResults: number; nextPageToken?: string }> {
    const { maxResults = 10, pageToken, folderId } = params

    try {
      const query = folderId ? `'${folderId}' in parents` : undefined
      const searchParams: Record<string, string> = {
        pageSize: String(maxResults),
        fields: 'files(id,name,mimeType,modifiedTime,owners,webViewLink),nextPageToken',
      }
      if (query) searchParams.q = query
      if (pageToken) searchParams.pageToken = pageToken

      const response = await this.driveHttp.get<{
        files: Array<{
          id: string
          name: string
          mimeType: string
          modifiedTime: string
          owners: Array<{ emailAddress: string }>
          webViewLink: string
        }>
        nextPageToken?: string
      }>('/files', searchParams)

      const docs: DocsListItem[] =
        response.body?.files.map((file) => ({
          id: file.id,
          title: file.name,
          updatedAt: file.modifiedTime,
          owner: file.owners[0]?.emailAddress ?? 'unknown',
          mimeType: file.mimeType,
          url: file.webViewLink,
        })) ?? []

      return {
        docs,
        totalResults: docs.length,
        nextPageToken: response.body?.nextPageToken,
      }
    } catch (err) {
      throw this.handleError(err)
    }
  }

  async getDoc(params: GetDocParams): Promise<DocsDocument | null> {
    const { docId } = params

    try {
      const [driveResponse, docsResponse] = await Promise.all([
        this.driveHttp.get<{
          id: string
          name: string
          createdTime: string
          modifiedTime: string
          owners: Array<{ emailAddress: string }>
          webViewLink: string
        }>(`/files/${docId}`, { fields: 'id,name,createdTime,modifiedTime,owners,webViewLink' }),
        this.http.get<{
          documentId: string
          title: string
          body?: { content: unknown[] }
        }>(`/documents/${docId}`),
      ])

      if (!driveResponse.body) return null

      const content = this.extractContent(docsResponse.body?.body?.content ?? [])

      return {
        id: driveResponse.body.id,
        title: driveResponse.body.name,
        content,
        createdAt: driveResponse.body.createdTime,
        updatedAt: driveResponse.body.modifiedTime,
        owner: driveResponse.body.owners[0]?.emailAddress ?? 'unknown',
        url: driveResponse.body.webViewLink,
      }
    } catch (err) {
      if (err instanceof TransportError && err.statusCode === 404) {
        return null
      }
      throw this.handleError(err)
    }
  }

  async createDoc(
    params: CreateDocParams,
  ): Promise<{ id: string; title: string; createdAt: string; updatedAt: string }> {
    const { title, content = '' } = params

    try {
      const docsResponse = await this.http.post<{ documentId: string; title: string }>('/documents', {
        title,
      })

      if (content && docsResponse.body?.documentId) {
        await this.http.post(`/documents/${docsResponse.body.documentId}:batchUpdate`, {
          requests: this.contentToRequests(content),
        })
      }

      const now = new Date().toISOString()
      return {
        id: docsResponse.body?.documentId ?? '',
        title,
        createdAt: now,
        updatedAt: now,
      }
    } catch (err) {
      throw this.handleError(err)
    }
  }

  async updateDoc(
    params: UpdateDocParams,
  ): Promise<{ id: string; title: string; updatedAt: string; success: boolean }> {
    const { docId, content, title } = params

    try {
      if (title) {
        await this.driveHttp.patch(`/files/${docId}`, { name: title })
      }

      await this.http.post(`/documents/${docId}:batchUpdate`, {
        requests: this.contentToRequests(content, true),
      })

      return {
        id: docId,
        title: title || 'Untitled',
        updatedAt: new Date().toISOString(),
        success: true,
      }
    } catch (err) {
      throw this.handleError(err)
    }
  }

  async searchDocs(params: SearchDocsParams): Promise<{ docs: DocsListItem[]; totalResults: number }> {
    const { query, maxResults = 10 } = params

    try {
      const response = await this.driveHttp.get<{
        files: Array<{
          id: string
          name: string
          mimeType: string
          modifiedTime: string
          owners: Array<{ emailAddress: string }>
          webViewLink: string
        }>
      }>('/files', {
        q: `fullText contains '${query}'`,
        pageSize: String(maxResults),
        fields: 'files(id,name,mimeType,modifiedTime,owners,webViewLink)',
      })

      const docs: DocsListItem[] =
        response.body?.files.map((file) => ({
          id: file.id,
          title: file.name,
          updatedAt: file.modifiedTime,
          owner: file.owners[0]?.emailAddress ?? 'unknown',
          mimeType: file.mimeType,
          url: file.webViewLink,
        })) ?? []

      return {
        docs,
        totalResults: docs.length,
      }
    } catch (err) {
      throw this.handleError(err)
    }
  }

  async validateAuth(): Promise<boolean> {
    try {
      await this.driveHttp.get('/about', { fields: 'user' })
      return true
    } catch {
      return false
    }
  }

  private extractContent(content: unknown[]): string {
    const text: string[] = []
    for (const element of content) {
      if (element && typeof element === 'object' && 'paragraph' in element) {
        const paragraph = element.paragraph as { elements?: Array<{ textRun?: { content: string } }> }
        if (paragraph.elements) {
          for (const el of paragraph.elements) {
            if (el.textRun?.content) {
              text.push(el.textRun.content)
            }
          }
          text.push('\n')
        }
      }
    }
    return text.join('')
  }

  private contentToRequests(content: string, replaceAll = false): unknown[] {
    const requests: unknown[] = []

    if (replaceAll) {
      requests.push({
        deleteContentRange: {
          range: {
            startIndex: 1,
            endIndex: 999999,
          },
        },
      })
    }

    requests.push({
      insertText: {
        location: { index: 1 },
        text: content,
      },
    })

    return requests
  }

  private handleError(err: unknown): DocsError {
    if (err instanceof TransportError) {
      const error = new Error(err.message) as Error & DocsError
      error.code = this.mapErrorCode(err.type)
      error.recoverable = err.retryable
      throw error
    }
    const error = new Error('Unknown error') as Error & DocsError
    error.code = 'UNKNOWN_ERROR'
    error.recoverable = false
    throw error
  }

  private mapErrorCode(type: string): DocsError['code'] {
    const mapping: Record<string, DocsError['code']> = {
      auth: 'AUTH_INVALID',
      rate_limit: 'RATE_LIMITED',
      timeout: 'NETWORK_ERROR',
      network: 'NETWORK_ERROR',
      server: 'UNKNOWN_ERROR',
      parse: 'VALIDATION_ERROR',
    }
    return mapping[type] ?? 'UNKNOWN_ERROR'
  }
}
