import type {
  ConnectorAdapter,
  ConnectorCapability,
  ConnectorCallRequest,
} from '../types.js';
import type { ConnectorInstance } from '../../storage/connector-store.js';

const mockDocs = [
  {
    id: 'doc-001',
    title: 'Project Proposal',
    content: 'This is the project proposal document.\n\n## Overview\nWe propose building a new system.\n\n## Timeline\nQ1 2024: Planning\nQ2 2024: Development',
    createdAt: '2024-01-10T10:00:00Z',
    updatedAt: '2024-01-12T14:30:00Z',
    owner: 'user@example.com',
    sharedWith: ['team@company.com'],
  },
  {
    id: 'doc-002',
    title: 'Meeting Notes - Jan 15',
    content: 'Meeting Notes\n\nAttendees: John, Jane, Bob\n\nAction Items:\n1. John to send follow-up email\n2. Jane to update project timeline',
    createdAt: '2024-01-15T15:00:00Z',
    updatedAt: '2024-01-15T15:00:00Z',
    owner: 'user@example.com',
    sharedWith: [],
  },
  {
    id: 'doc-003',
    title: 'Budget Spreadsheet 2024',
    content: 'Budget Summary\n\nQ1: $50,000\nQ2: $75,000\nQ3: $60,000\nQ4: $45,000\n\nTotal: $230,000',
    createdAt: '2024-01-05T09:00:00Z',
    updatedAt: '2024-01-08T11:00:00Z',
    owner: 'finance@company.com',
    sharedWith: ['user@example.com'],
  },
];

export interface DocsSearchParams {
  query?: string;
  maxResults?: number;
}

export interface DocsReadParams {
  docId: string;
}

export interface DocsCreateParams {
  title: string;
  content?: string;
}

export interface DocsUpdateParams {
  docId: string;
  content: string;
}

export class DocsConnectorAdapter implements ConnectorAdapter {
  private createdDocs: Array<(typeof mockDocs)[0]> = [];

  async execute(
    _instance: ConnectorInstance,
    request: ConnectorCallRequest
  ): Promise<unknown> {
    const { operation, params } = request;

    switch (operation) {
      case 'search_docs':
        return this.searchDocs(params as unknown as DocsSearchParams);
      case 'read_doc':
        return this.readDoc(params as unknown as DocsReadParams);
      case 'create_doc':
        return this.createDoc(params as unknown as DocsCreateParams);
      case 'update_doc':
        return this.updateDoc(params as unknown as DocsUpdateParams);
      default:
        throw new Error(`Unknown operation: ${operation}`);
    }
  }

  discoverCapabilities(_instance: ConnectorInstance): ConnectorCapability[] {
    return [
      {
        capabilityId: 'docs.search_docs',
        name: 'Search Documents',
        description: 'Search documents by title or content',
        category: 'search',
        riskLevel: 'low',
        inputSchema: {
          query: { type: 'string', description: 'Search query' },
          maxResults: { type: 'number', description: 'Maximum results to return' },
        },
        requiresAuth: true,
        supportedOperations: ['search_docs'],
      },
      {
        capabilityId: 'docs.read_doc',
        name: 'Read Document',
        description: 'Read a document by ID',
        category: 'read',
        riskLevel: 'low',
        inputSchema: {
          docId: { type: 'string', required: true, description: 'Document ID' },
        },
        requiresAuth: true,
        supportedOperations: ['read_doc'],
      },
      {
        capabilityId: 'docs.create_doc',
        name: 'Create Document',
        description: 'Create a new document',
        category: 'write',
        riskLevel: 'medium',
        inputSchema: {
          title: { type: 'string', required: true, description: 'Document title' },
          content: { type: 'string', description: 'Initial document content' },
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
          docId: { type: 'string', required: true, description: 'Document ID to update' },
          content: { type: 'string', required: true, description: 'New document content' },
        },
        requiresAuth: true,
        supportedOperations: ['update_doc'],
      },
    ];
  }

  checkHealth(_instance: ConnectorInstance): { healthy: boolean; message?: string } {
    return { healthy: true, message: 'Docs mock connector is healthy' };
  }

  private searchDocs(params: DocsSearchParams): {
    docs: Array<{ id: string; title: string; updatedAt: string; owner: string }>;
    totalResults: number;
  } {
    const { query, maxResults = 10 } = params;

    const allDocs = [...mockDocs, ...this.createdDocs];
    let results = [...allDocs];

    if (query) {
      const lowerQuery = query.toLowerCase();
      results = results.filter(
        (doc) =>
          doc.title.toLowerCase().includes(lowerQuery) ||
          doc.content.toLowerCase().includes(lowerQuery)
      );
    }

    return {
      docs: results.slice(0, maxResults).map((doc) => ({
        id: doc.id,
        title: doc.title,
        updatedAt: doc.updatedAt,
        owner: doc.owner,
      })),
      totalResults: results.length,
    };
  }

  private readDoc(params: DocsReadParams): (typeof mockDocs)[0] | null {
    const { docId } = params;
    const allDocs = [...mockDocs, ...this.createdDocs];
    const doc = allDocs.find((d) => d.id === docId);
    return doc || null;
  }

  private createDoc(params: DocsCreateParams): {
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
  } {
    const { title, content = '' } = params;
    const now = new Date().toISOString();

    const newDoc = {
      id: `doc-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      title,
      content,
      createdAt: now,
      updatedAt: now,
      owner: 'user@example.com',
      sharedWith: [],
    };

    this.createdDocs.push(newDoc);

    return {
      id: newDoc.id,
      title: newDoc.title,
      createdAt: newDoc.createdAt,
      updatedAt: newDoc.updatedAt,
    };
  }

  private updateDoc(params: DocsUpdateParams): {
    id: string;
    title: string;
    updatedAt: string;
    success: boolean;
  } {
    const { docId, content } = params;

    const mockIndex = mockDocs.findIndex((d) => d.id === docId);
    const createdIndex = this.createdDocs.findIndex((d) => d.id === docId);

    if (mockIndex === -1 && createdIndex === -1) {
      throw new Error(`Document not found: ${docId}`);
    }

    const now = new Date().toISOString();

    if (mockIndex !== -1) {
      mockDocs[mockIndex].content = content;
      mockDocs[mockIndex].updatedAt = now;
      return {
        id: docId,
        title: mockDocs[mockIndex].title,
        updatedAt: now,
        success: true,
      };
    }

    this.createdDocs[createdIndex].content = content;
    this.createdDocs[createdIndex].updatedAt = now;

    return {
      id: docId,
      title: this.createdDocs[createdIndex].title,
      updatedAt: now,
      success: true,
    };
  }
}

export function createDocsConnectorAdapter(): DocsConnectorAdapter {
  return new DocsConnectorAdapter();
}
