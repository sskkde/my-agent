import type {
  DocsTransport,
  DocsDocument,
  DocsListItem,
  ListDocsParams,
  GetDocParams,
  CreateDocParams,
  UpdateDocParams,
  SearchDocsParams,
} from './docs-types.js';

const mockDocs: DocsDocument[] = [
  {
    id: 'doc-001',
    title: 'Project Proposal',
    content: 'This is the project proposal document.\n\n## Overview\nWe propose building a new system.\n\n## Timeline\nQ1 2024: Planning\nQ2 2024: Development',
    createdAt: '2024-01-10T10:00:00Z',
    updatedAt: '2024-01-12T14:30:00Z',
    owner: 'user@example.com',
    sharedWith: ['team@company.com'],
    mimeType: 'text/markdown',
    url: 'https://docs.example.com/doc-001',
  },
  {
    id: 'doc-002',
    title: 'Meeting Notes - Jan 15',
    content: 'Meeting Notes\n\nAttendees: John, Jane, Bob\n\nAction Items:\n1. John to send follow-up email\n2. Jane to update project timeline',
    createdAt: '2024-01-15T15:00:00Z',
    updatedAt: '2024-01-15T15:00:00Z',
    owner: 'user@example.com',
    sharedWith: [],
    mimeType: 'text/markdown',
    url: 'https://docs.example.com/doc-002',
  },
  {
    id: 'doc-003',
    title: 'Budget Spreadsheet 2024',
    content: 'Budget Summary\n\nQ1: $50,000\nQ2: $75,000\nQ3: $60,000\nQ4: $45,000\n\nTotal: $230,000',
    createdAt: '2024-01-05T09:00:00Z',
    updatedAt: '2024-01-08T11:00:00Z',
    owner: 'finance@company.com',
    sharedWith: ['user@example.com'],
    mimeType: 'text/csv',
    url: 'https://docs.example.com/doc-003',
  },
];

export class DocsMockTransport implements DocsTransport {
  private createdDocs: DocsDocument[] = [];
  private validAuth: string | null = null;

  setValidAuth(auth: string): void {
    this.validAuth = auth;
  }

  async listDocs(params: ListDocsParams): Promise<{ docs: DocsListItem[]; totalResults: number; nextPageToken?: string }> {
    const { maxResults = 10, pageToken } = params;
    const allDocs = [...mockDocs, ...this.createdDocs];

    let startIndex = 0;
    if (pageToken) {
      startIndex = parseInt(Buffer.from(pageToken, 'base64').toString(), 10) || 0;
    }

    const docs = allDocs.slice(startIndex, startIndex + maxResults).map(doc => ({
      id: doc.id,
      title: doc.title,
      updatedAt: doc.updatedAt,
      owner: doc.owner,
      mimeType: doc.mimeType,
      url: doc.url,
    }));

    const hasMore = startIndex + maxResults < allDocs.length;
    const nextPageToken = hasMore
      ? Buffer.from(String(startIndex + maxResults)).toString('base64')
      : undefined;

    return {
      docs,
      totalResults: allDocs.length,
      nextPageToken,
    };
  }

  async getDoc(params: GetDocParams): Promise<DocsDocument | null> {
    const { docId } = params;
    const allDocs = [...mockDocs, ...this.createdDocs];
    return allDocs.find(d => d.id === docId) || null;
  }

  async createDoc(params: CreateDocParams): Promise<{ id: string; title: string; createdAt: string; updatedAt: string }> {
    const { title, content = '', folderId: _folderId } = params;
    const now = new Date().toISOString();

    const newDoc: DocsDocument = {
      id: `doc-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      title,
      content,
      createdAt: now,
      updatedAt: now,
      owner: 'user@example.com',
      sharedWith: [],
      mimeType: 'text/markdown',
      url: `https://docs.example.com/${title.toLowerCase().replace(/\s+/g, '-')}`,
    };

    this.createdDocs.push(newDoc);

    return {
      id: newDoc.id,
      title: newDoc.title,
      createdAt: newDoc.createdAt,
      updatedAt: newDoc.updatedAt,
    };
  }

  async updateDoc(params: UpdateDocParams): Promise<{ id: string; title: string; updatedAt: string; success: boolean }> {
    const { docId, content, title } = params;
    const allDocs = [...mockDocs, ...this.createdDocs];

    const docIndex = allDocs.findIndex(d => d.id === docId);
    if (docIndex === -1) {
      throw new Error(`Document not found: ${docId}`);
    }

    const now = new Date().toISOString();
    const targetArray = docIndex < mockDocs.length ? mockDocs : this.createdDocs;
    const targetIndex = docIndex < mockDocs.length ? docIndex : docIndex - mockDocs.length;

    targetArray[targetIndex].content = content;
    targetArray[targetIndex].updatedAt = now;
    if (title) {
      targetArray[targetIndex].title = title;
    }

    return {
      id: docId,
      title: targetArray[targetIndex].title,
      updatedAt: now,
      success: true,
    };
  }

  async searchDocs(params: SearchDocsParams): Promise<{ docs: DocsListItem[]; totalResults: number }> {
    const { query, maxResults = 10 } = params;
    const allDocs = [...mockDocs, ...this.createdDocs];

    const lowerQuery = query.toLowerCase();
    const results = allDocs.filter(
      doc =>
        doc.title.toLowerCase().includes(lowerQuery) ||
        doc.content.toLowerCase().includes(lowerQuery)
    );

    return {
      docs: results.slice(0, maxResults).map(doc => ({
        id: doc.id,
        title: doc.title,
        updatedAt: doc.updatedAt,
        owner: doc.owner,
        mimeType: doc.mimeType,
        url: doc.url,
      })),
      totalResults: results.length,
    };
  }

  async validateAuth(): Promise<boolean> {
    return this.validAuth !== null;
  }
}

export function createDocsMockTransport(): DocsMockTransport {
  return new DocsMockTransport();
}
