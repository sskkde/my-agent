/**
 * Phase 3 Mock Connectors
 *
 * Reusable mock connector instances for testing without real external API keys.
 * Each mock connector provides deterministic responses for testing:
 * - connector, MCP, workflow, trigger, memory, replay, and permission tests
 *
 * Usage:
 * ```typescript
 * import { createMockEmailConnector, createMockCalendarConnector } from '../fixtures/phase3-mock-connectors.js';
 *
 * const emailConnector = createMockEmailConnector({ userId: 'user_001' });
 * const response = await emailConnector.execute('search_emails', { query: 'test' });
 * ```
 */

import type {
  ConnectorCapability,
  ConnectorCallRequest,
  ConnectorResponse,
  ConnectorAdapter,
} from '../../src/connectors/types.js'
import type { ConnectorInstance } from '../../src/storage/connector-store.js'

// ============================================================================
// Mock Connector Configuration Types
// ============================================================================

export interface MockConnectorConfig {
  userId: string
  instanceId?: string
  definitionId?: string
  name?: string
  authState?: 'authenticated' | 'unauthenticated' | 'expired'
  rateLimitMode?: 'none' | 'limited' | 'exhausted'
  errorMode?: 'none' | 'transient' | 'permanent'
  deterministicData?: Record<string, unknown>
}

export interface MockConnectorAdapter extends ConnectorAdapter {
  getCapabilities(): ConnectorCapability[]
  setAuthState(state: 'authenticated' | 'unauthenticated' | 'expired'): void
  setRateLimitMode(mode: 'none' | 'limited' | 'exhausted'): void
  setErrorMode(mode: 'none' | 'transient' | 'permanent'): void
  setDeterministicData(data: Record<string, unknown>): void
}

// ============================================================================
// Base Mock Connector Adapter
// ============================================================================

abstract class BaseMockConnector implements MockConnectorAdapter {
  protected authState: 'authenticated' | 'unauthenticated' | 'expired' = 'authenticated'
  protected rateLimitMode: 'none' | 'limited' | 'exhausted' = 'none'
  protected errorMode: 'none' | 'transient' | 'permanent' = 'none'
  protected deterministicData: Record<string, unknown> = {}
  protected callCount: number = 0

  abstract getCapabilities(): ConnectorCapability[]
  abstract execute(instance: ConnectorInstance, request: ConnectorCallRequest): Promise<unknown>

  discoverCapabilities(_instance: ConnectorInstance): ConnectorCapability[] {
    return this.getCapabilities()
  }

  checkHealth(_instance: ConnectorInstance): { healthy: boolean; message?: string } {
    if (this.errorMode === 'permanent') {
      return { healthy: false, message: 'Permanent error mode' }
    }
    return { healthy: true }
  }

  setAuthState(state: 'authenticated' | 'unauthenticated' | 'expired'): void {
    this.authState = state
  }

  setRateLimitMode(mode: 'none' | 'limited' | 'exhausted'): void {
    this.rateLimitMode = mode
  }

  setErrorMode(mode: 'none' | 'transient' | 'permanent'): void {
    this.errorMode = mode
  }

  setDeterministicData(data: Record<string, unknown>): void {
    this.deterministicData = { ...this.deterministicData, ...data }
  }

  protected checkPreconditions(): ConnectorResponse | null {
    this.callCount++

    if (this.authState === 'unauthenticated') {
      return {
        status: 'auth_required',
        requestId: `req_${this.callCount}`,
        connectorInstanceId: 'mock',
        error: {
          code: 'AUTH_REQUIRED',
          message: 'Authentication required',
          recoverable: true,
        },
      }
    }

    if (this.authState === 'expired') {
      return {
        status: 'auth_required',
        requestId: `req_${this.callCount}`,
        connectorInstanceId: 'mock',
        error: {
          code: 'AUTH_EXPIRED',
          message: 'Authentication expired',
          recoverable: true,
        },
      }
    }

    if (this.rateLimitMode === 'exhausted') {
      return {
        status: 'rate_limited',
        requestId: `req_${this.callCount}`,
        connectorInstanceId: 'mock',
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Rate limit exceeded',
          recoverable: true,
        },
        metadata: {
          retryAfterMs: 60000,
        },
      }
    }

    if (this.errorMode === 'transient' && this.callCount % 3 === 0) {
      return {
        status: 'failed',
        requestId: `req_${this.callCount}`,
        connectorInstanceId: 'mock',
        error: {
          code: 'TRANSIENT_ERROR',
          message: 'Temporary failure',
          recoverable: true,
        },
      }
    }

    if (this.errorMode === 'permanent') {
      return {
        status: 'failed',
        requestId: `req_${this.callCount}`,
        connectorInstanceId: 'mock',
        error: {
          code: 'PERMANENT_ERROR',
          message: 'Permanent failure',
          recoverable: false,
        },
      }
    }

    return null
  }

  protected createSuccessResponse(data: unknown): ConnectorResponse {
    return {
      status: 'success',
      requestId: `req_${this.callCount}`,
      connectorInstanceId: 'mock',
      data,
      metadata: this.rateLimitMode === 'limited' ? { rateLimitRemaining: 10 - (this.callCount % 10) } : undefined,
    }
  }
}

// ============================================================================
// Mock Email Connector
// ============================================================================

class MockEmailConnector extends BaseMockConnector {
  private emails: Array<{
    id: string
    subject: string
    from: string
    to: string[]
    body: string
    date: string
    read: boolean
  }>

  constructor(config: MockConnectorConfig = { userId: 'user_001' }) {
    super()
    this.emails = [
      {
        id: 'email_001',
        subject: 'Test Email 1',
        from: 'sender@example.com',
        to: [config.userId],
        body: 'This is test email 1',
        date: '2024-01-01T10:00:00Z',
        read: false,
      },
      {
        id: 'email_002',
        subject: 'Test Email 2',
        from: 'sender2@example.com',
        to: [config.userId],
        body: 'This is test email 2',
        date: '2024-01-02T11:00:00Z',
        read: true,
      },
    ]
  }

  getCapabilities(): ConnectorCapability[] {
    return [
      {
        capabilityId: 'search_emails',
        name: 'Search Emails',
        description: 'Search for emails matching criteria',
        category: 'search',
        riskLevel: 'low',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string' },
            limit: { type: 'number' },
          },
        },
        requiresAuth: true,
        supportedOperations: ['search'],
      },
      {
        capabilityId: 'send_email',
        name: 'Send Email',
        description: 'Send an email to recipients',
        category: 'send',
        riskLevel: 'medium',
        inputSchema: {
          type: 'object',
          properties: {
            to: { type: 'array', items: { type: 'string' } },
            subject: { type: 'string' },
            body: { type: 'string' },
          },
          required: ['to', 'subject', 'body'],
        },
        requiresAuth: true,
        supportedOperations: ['send'],
      },
      {
        capabilityId: 'get_email',
        name: 'Get Email',
        description: 'Get a specific email by ID',
        category: 'read',
        riskLevel: 'low',
        inputSchema: {
          type: 'object',
          properties: {
            emailId: { type: 'string' },
          },
          required: ['emailId'],
        },
        requiresAuth: true,
        supportedOperations: ['read'],
      },
    ]
  }

  async execute(_instance: ConnectorInstance, request: ConnectorCallRequest): Promise<unknown> {
    const preconditionError = this.checkPreconditions()
    if (preconditionError) return preconditionError

    const { operation, params } = request

    switch (operation) {
      case 'search_emails':
        return this.searchEmails(params as { query?: string; limit?: number })
      case 'send_email':
        return this.sendEmail(params as { to: string[]; subject: string; body: string })
      case 'get_email':
        return this.getEmail(params as { emailId: string })
      default:
        return {
          status: 'failed',
          requestId: `req_${this.callCount}`,
          connectorInstanceId: 'mock',
          error: {
            code: 'UNKNOWN_OPERATION',
            message: `Unknown operation: ${operation}`,
            recoverable: false,
          },
        }
    }
  }

  private searchEmails(params: { query?: string; limit?: number }) {
    const limit = params.limit ?? 10
    let results = this.emails
    if (params.query) {
      const query = params.query.toLowerCase()
      results = results.filter((e) => e.subject.toLowerCase().includes(query) || e.body.toLowerCase().includes(query))
    }
    return this.createSuccessResponse({
      emails: results.slice(0, limit),
      total: results.length,
    })
  }

  private sendEmail(params: { to: string[]; subject: string; body: string }) {
    const newEmail = {
      id: `email_${this.emails.length + 1}`,
      subject: params.subject,
      from: 'mock@example.com',
      to: params.to,
      body: params.body,
      date: new Date().toISOString(),
      read: true,
    }
    this.emails.push(newEmail)
    return this.createSuccessResponse({
      emailId: newEmail.id,
      status: 'sent',
    })
  }

  private getEmail(params: { emailId: string }) {
    const email = this.emails.find((e) => e.id === params.emailId)
    if (!email) {
      return {
        status: 'failed',
        requestId: `req_${this.callCount}`,
        connectorInstanceId: 'mock',
        error: {
          code: 'EMAIL_NOT_FOUND',
          message: `Email not found: ${params.emailId}`,
          recoverable: false,
        },
      }
    }
    return this.createSuccessResponse(email)
  }
}

// ============================================================================
// Mock Calendar Connector
// ============================================================================

class MockCalendarConnector extends BaseMockConnector {
  private events: Array<{
    id: string
    title: string
    start: string
    end: string
    attendees: string[]
    location?: string
  }>

  constructor(config: MockConnectorConfig = { userId: 'user_001' }) {
    super()
    this.events = [
      {
        id: 'event_001',
        title: 'Test Meeting 1',
        start: '2024-01-15T09:00:00Z',
        end: '2024-01-15T10:00:00Z',
        attendees: [config.userId],
        location: 'Room A',
      },
      {
        id: 'event_002',
        title: 'Test Meeting 2',
        start: '2024-01-16T14:00:00Z',
        end: '2024-01-16T15:00:00Z',
        attendees: [config.userId, 'other@example.com'],
      },
    ]
  }

  getCapabilities(): ConnectorCapability[] {
    return [
      {
        capabilityId: 'search_events',
        name: 'Search Events',
        description: 'Search for calendar events',
        category: 'search',
        riskLevel: 'low',
        inputSchema: {
          type: 'object',
          properties: {
            startDate: { type: 'string' },
            endDate: { type: 'string' },
          },
        },
        requiresAuth: true,
        supportedOperations: ['search'],
      },
      {
        capabilityId: 'create_event',
        name: 'Create Event',
        description: 'Create a new calendar event',
        category: 'write',
        riskLevel: 'medium',
        inputSchema: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            start: { type: 'string' },
            end: { type: 'string' },
            attendees: { type: 'array', items: { type: 'string' } },
            location: { type: 'string' },
          },
          required: ['title', 'start', 'end'],
        },
        requiresAuth: true,
        supportedOperations: ['create'],
      },
      {
        capabilityId: 'update_event',
        name: 'Update Event',
        description: 'Update an existing calendar event',
        category: 'write',
        riskLevel: 'medium',
        inputSchema: {
          type: 'object',
          properties: {
            eventId: { type: 'string' },
            title: { type: 'string' },
            start: { type: 'string' },
            end: { type: 'string' },
          },
          required: ['eventId'],
        },
        requiresAuth: true,
        supportedOperations: ['update'],
      },
    ]
  }

  async execute(_instance: ConnectorInstance, request: ConnectorCallRequest): Promise<unknown> {
    const preconditionError = this.checkPreconditions()
    if (preconditionError) return preconditionError

    const { operation, params } = request

    switch (operation) {
      case 'search_events':
        return this.searchEvents(params as { startDate?: string; endDate?: string })
      case 'create_event':
        return this.createEvent(
          params as { title: string; start: string; end: string; attendees?: string[]; location?: string },
        )
      case 'update_event':
        return this.updateEvent(params as { eventId: string; [key: string]: unknown })
      default:
        return {
          status: 'failed',
          requestId: `req_${this.callCount}`,
          connectorInstanceId: 'mock',
          error: {
            code: 'UNKNOWN_OPERATION',
            message: `Unknown operation: ${operation}`,
            recoverable: false,
          },
        }
    }
  }

  private searchEvents(params: { startDate?: string; endDate?: string }) {
    let results = this.events
    if (params.startDate) {
      results = results.filter((e) => e.start >= params.startDate!)
    }
    if (params.endDate) {
      results = results.filter((e) => e.end <= params.endDate!)
    }
    return this.createSuccessResponse({
      events: results,
      total: results.length,
    })
  }

  private createEvent(params: { title: string; start: string; end: string; attendees?: string[]; location?: string }) {
    const newEvent = {
      id: `event_${this.events.length + 1}`,
      title: params.title,
      start: params.start,
      end: params.end,
      attendees: params.attendees ?? [],
      location: params.location,
    }
    this.events.push(newEvent)
    return this.createSuccessResponse({
      eventId: newEvent.id,
      status: 'created',
    })
  }

  private updateEvent(params: { eventId: string; [key: string]: unknown }) {
    const index = this.events.findIndex((e) => e.id === params.eventId)
    if (index === -1) {
      return {
        status: 'failed',
        requestId: `req_${this.callCount}`,
        connectorInstanceId: 'mock',
        error: {
          code: 'EVENT_NOT_FOUND',
          message: `Event not found: ${params.eventId}`,
          recoverable: false,
        },
      }
    }
    this.events[index] = { ...this.events[index], ...params }
    return this.createSuccessResponse({
      eventId: params.eventId,
      status: 'updated',
    })
  }
}

// ============================================================================
// Mock Contacts Connector
// ============================================================================

class MockContactsConnector extends BaseMockConnector {
  private contacts: Array<{
    id: string
    name: string
    email: string
    phone?: string
    organization?: string
  }>

  constructor(_config: MockConnectorConfig = { userId: 'user_001' }) {
    super()
    this.contacts = [
      {
        id: 'contact_001',
        name: 'John Doe',
        email: 'john@example.com',
        phone: '+1-555-0100',
        organization: 'Acme Corp',
      },
      {
        id: 'contact_002',
        name: 'Jane Smith',
        email: 'jane@example.com',
      },
    ]
  }

  getCapabilities(): ConnectorCapability[] {
    return [
      {
        capabilityId: 'search_contacts',
        name: 'Search Contacts',
        description: 'Search for contacts by name or email',
        category: 'search',
        riskLevel: 'low',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string' },
          },
        },
        requiresAuth: true,
        supportedOperations: ['search'],
      },
      {
        capabilityId: 'create_contact',
        name: 'Create Contact',
        description: 'Create a new contact',
        category: 'write',
        riskLevel: 'low',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            email: { type: 'string' },
            phone: { type: 'string' },
            organization: { type: 'string' },
          },
          required: ['name', 'email'],
        },
        requiresAuth: true,
        supportedOperations: ['create'],
      },
    ]
  }

  async execute(_instance: ConnectorInstance, request: ConnectorCallRequest): Promise<unknown> {
    const preconditionError = this.checkPreconditions()
    if (preconditionError) return preconditionError

    const { operation, params } = request

    switch (operation) {
      case 'search_contacts':
        return this.searchContacts(params as { query?: string })
      case 'create_contact':
        return this.createContact(params as { name: string; email: string; phone?: string; organization?: string })
      default:
        return {
          status: 'failed',
          requestId: `req_${this.callCount}`,
          connectorInstanceId: 'mock',
          error: {
            code: 'UNKNOWN_OPERATION',
            message: `Unknown operation: ${operation}`,
            recoverable: false,
          },
        }
    }
  }

  private searchContacts(params: { query?: string }) {
    let results = this.contacts
    if (params.query) {
      const query = params.query.toLowerCase()
      results = results.filter((c) => c.name.toLowerCase().includes(query) || c.email.toLowerCase().includes(query))
    }
    return this.createSuccessResponse({
      contacts: results,
      total: results.length,
    })
  }

  private createContact(params: { name: string; email: string; phone?: string; organization?: string }) {
    const newContact = {
      id: `contact_${this.contacts.length + 1}`,
      name: params.name,
      email: params.email,
      phone: params.phone,
      organization: params.organization,
    }
    this.contacts.push(newContact)
    return this.createSuccessResponse({
      contactId: newContact.id,
      status: 'created',
    })
  }
}

// ============================================================================
// Mock Docs Connector (Async Capable)
// ============================================================================

class MockDocsConnector extends BaseMockConnector {
  private docs: Array<{
    id: string
    title: string
    content: string
    createdAt: string
    updatedAt: string
    async?: boolean
  }>

  private asyncOperations: Map<string, { status: string; progress: number; result?: unknown }>

  constructor(_config: MockConnectorConfig = { userId: 'user_001' }) {
    super()
    this.docs = [
      {
        id: 'doc_001',
        title: 'Test Document 1',
        content: 'Content of test document 1',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      },
    ]
    this.asyncOperations = new Map()
  }

  getCapabilities(): ConnectorCapability[] {
    return [
      {
        capabilityId: 'search_docs',
        name: 'Search Documents',
        description: 'Search for documents',
        category: 'search',
        riskLevel: 'low',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string' },
          },
        },
        requiresAuth: true,
        supportedOperations: ['search'],
      },
      {
        capabilityId: 'create_doc',
        name: 'Create Document',
        description: 'Create a new document',
        category: 'write',
        riskLevel: 'medium',
        inputSchema: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            content: { type: 'string' },
          },
          required: ['title'],
        },
        requiresAuth: true,
        supportedOperations: ['create'],
      },
      {
        capabilityId: 'export_doc',
        name: 'Export Document',
        description: 'Export a document (async operation)',
        category: 'read',
        riskLevel: 'low',
        inputSchema: {
          type: 'object',
          properties: {
            docId: { type: 'string' },
            format: { type: 'string' },
          },
          required: ['docId'],
        },
        requiresAuth: true,
        supportedOperations: ['export'],
        rateLimitInfo: {
          requestsPerMinute: 10,
        },
      },
    ]
  }

  async execute(_instance: ConnectorInstance, request: ConnectorCallRequest): Promise<unknown> {
    const preconditionError = this.checkPreconditions()
    if (preconditionError) return preconditionError

    const { operation, params } = request

    switch (operation) {
      case 'search_docs':
        return this.searchDocs(params as { query?: string })
      case 'create_doc':
        return this.createDoc(params as { title: string; content?: string })
      case 'export_doc':
        return this.exportDoc(params as { docId: string; format?: string })
      default:
        return {
          status: 'failed',
          requestId: `req_${this.callCount}`,
          connectorInstanceId: 'mock',
          error: {
            code: 'UNKNOWN_OPERATION',
            message: `Unknown operation: ${operation}`,
            recoverable: false,
          },
        }
    }
  }

  private searchDocs(params: { query?: string }) {
    let results = this.docs
    if (params.query) {
      const query = params.query.toLowerCase()
      results = results.filter((d) => d.title.toLowerCase().includes(query) || d.content.toLowerCase().includes(query))
    }
    return this.createSuccessResponse({
      docs: results,
      total: results.length,
    })
  }

  private createDoc(params: { title: string; content?: string }) {
    const now = new Date().toISOString()
    const newDoc = {
      id: `doc_${this.docs.length + 1}`,
      title: params.title,
      content: params.content ?? '',
      createdAt: now,
      updatedAt: now,
    }
    this.docs.push(newDoc)
    return this.createSuccessResponse({
      docId: newDoc.id,
      status: 'created',
    })
  }

  private exportDoc(params: { docId: string; format?: string }) {
    const doc = this.docs.find((d) => d.id === params.docId)
    if (!doc) {
      return {
        status: 'failed',
        requestId: `req_${this.callCount}`,
        connectorInstanceId: 'mock',
        error: {
          code: 'DOC_NOT_FOUND',
          message: `Document not found: ${params.docId}`,
          recoverable: false,
        },
      }
    }

    // Return async operation reference
    const operationId = `op_${Date.now()}`
    this.asyncOperations.set(operationId, {
      status: 'pending',
      progress: 0,
    })

    return {
      status: 'async_started',
      requestId: `req_${this.callCount}`,
      connectorInstanceId: 'mock',
      metadata: {
        operationId,
      },
    }
  }

  // Helper to simulate async operation completion
  completeAsyncOperation(operationId: string, result: unknown) {
    this.asyncOperations.set(operationId, {
      status: 'completed',
      progress: 100,
      result,
    })
  }

  getAsyncOperationStatus(operationId: string) {
    return this.asyncOperations.get(operationId)
  }
}

// ============================================================================
// Mock Search Connector
// ============================================================================

class MockSearchConnector extends BaseMockConnector {
  private searchResults: Array<{
    title: string
    url: string
    snippet: string
  }>

  constructor(_config: MockConnectorConfig = { userId: 'user_001' }) {
    super()
    this.searchResults = [
      {
        title: 'Test Result 1',
        url: 'https://example.com/1',
        snippet: 'This is a test search result',
      },
      {
        title: 'Test Result 2',
        url: 'https://example.com/2',
        snippet: 'Another test search result',
      },
    ]
  }

  getCapabilities(): ConnectorCapability[] {
    return [
      {
        capabilityId: 'web_search',
        name: 'Web Search',
        description: 'Search the web',
        category: 'search',
        riskLevel: 'low',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string' },
            limit: { type: 'number' },
          },
          required: ['query'],
        },
        requiresAuth: false,
        supportedOperations: ['search'],
      },
      {
        capabilityId: 'news_search',
        name: 'News Search',
        description: 'Search news articles',
        category: 'search',
        riskLevel: 'low',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string' },
            limit: { type: 'number' },
          },
          required: ['query'],
        },
        requiresAuth: false,
        supportedOperations: ['search'],
      },
    ]
  }

  async execute(_instance: ConnectorInstance, request: ConnectorCallRequest): Promise<unknown> {
    const preconditionError = this.checkPreconditions()
    if (preconditionError) return preconditionError

    const { operation, params } = request

    switch (operation) {
      case 'web_search':
      case 'news_search':
        return this.search(params as { query: string; limit?: number })
      default:
        return {
          status: 'failed',
          requestId: `req_${this.callCount}`,
          connectorInstanceId: 'mock',
          error: {
            code: 'UNKNOWN_OPERATION',
            message: `Unknown operation: ${operation}`,
            recoverable: false,
          },
        }
    }
  }

  private search(params: { query: string; limit?: number }) {
    const limit = params.limit ?? 10
    // Return deterministic results based on query
    const results = this.searchResults.map((r, i) => ({
      ...r,
      title: `${r.title} - ${params.query}`,
      rank: i + 1,
    }))
    return this.createSuccessResponse({
      results: results.slice(0, limit),
      query: params.query,
      total: results.length,
    })
  }
}

// ============================================================================
// Web Connector Definition
// ============================================================================

export interface WebConnectorDefinition {
  connectorId: string
  name: string
  capabilities: string[]
}

export const WEB_CONNECTOR_DEFINITION: WebConnectorDefinition = {
  connectorId: 'web',
  name: 'Web Connector',
  capabilities: ['web_search', 'news_search', 'web_fetch'],
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a mock email connector adapter
 */
export function createMockEmailConnector(config?: MockConnectorConfig): MockConnectorAdapter {
  return new MockEmailConnector(config)
}

/**
 * Create a mock calendar connector adapter
 */
export function createMockCalendarConnector(config?: MockConnectorConfig): MockConnectorAdapter {
  return new MockCalendarConnector(config)
}

/**
 * Create a mock contacts connector adapter
 */
export function createMockContactsConnector(config?: MockConnectorConfig): MockConnectorAdapter {
  return new MockContactsConnector(config)
}

/**
 * Create a mock docs connector adapter (async capable)
 */
export function createMockDocsConnector(config?: MockConnectorConfig): MockDocsConnector {
  return new MockDocsConnector(config)
}

/**
 * Create a mock search connector adapter
 */
export function createMockSearchConnector(config?: MockConnectorConfig): MockConnectorAdapter {
  return new MockSearchConnector(config)
}

/**
 * Create all mock connectors at once
 */
export function createAllMockConnectors(config?: MockConnectorConfig): {
  email: MockConnectorAdapter
  calendar: MockConnectorAdapter
  contacts: MockConnectorAdapter
  docs: MockDocsConnector
  search: MockConnectorAdapter
} {
  return {
    email: createMockEmailConnector(config),
    calendar: createMockCalendarConnector(config),
    contacts: createMockContactsConnector(config),
    docs: createMockDocsConnector(config),
    search: createMockSearchConnector(config),
  }
}

/**
 * Create mock connector instance for use with connector runtime
 */
export function createMockConnectorInstance(config: MockConnectorConfig): ConnectorInstance {
  return {
    id: `mock_inst_${Date.now()}`,
    connectorInstanceId: config.instanceId ?? `mock_inst_${Date.now()}`,
    connectorDefinitionId: config.definitionId ?? 'mock_def',
    userId: config.userId,
    name: config.name ?? 'Mock Connector Instance',
    authStateRef: 'mock_auth_ref',
    config: config.deterministicData,
    status: 'active',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}
