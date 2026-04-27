import type {
  ConnectorAdapter,
  ConnectorCapability,
  ConnectorCallRequest,
} from '../types.js';
import type { ConnectorInstance } from '../../storage/connector-store.js';

const mockEmails = [
  {
    id: 'email-001',
    threadId: 'thread-001',
    subject: 'Welcome to Gmail Mock',
    from: 'admin@example.com',
    to: 'user@example.com',
    body: 'Welcome to the Gmail mock connector. This is a test email.',
    date: '2024-01-15T10:00:00Z',
    labels: ['INBOX', 'UNREAD'],
  },
  {
    id: 'email-002',
    threadId: 'thread-002',
    subject: 'Meeting Tomorrow',
    from: 'boss@company.com',
    to: 'user@example.com',
    body: 'Hi, let us meet tomorrow at 2pm to discuss the project.',
    date: '2024-01-16T14:30:00Z',
    labels: ['INBOX', 'IMPORTANT'],
  },
  {
    id: 'email-003',
    threadId: 'thread-002',
    subject: 'Re: Meeting Tomorrow',
    from: 'user@example.com',
    to: 'boss@company.com',
    body: 'Sure, I will be there.',
    date: '2024-01-16T15:00:00Z',
    labels: ['SENT'],
  },
];

const mockDrafts: Array<{
  id: string;
  to: string;
  subject: string;
  body: string;
  createdAt: string;
}> = [];

export interface GmailSearchParams {
  query?: string;
  maxResults?: number;
}

export interface GmailReadParams {
  emailId: string;
}

export interface GmailCreateDraftParams {
  to: string;
  subject: string;
  body: string;
}

export interface GmailSendDraftParams {
  draftId: string;
}

export class GmailConnectorAdapter implements ConnectorAdapter {
  async execute(
    _instance: ConnectorInstance,
    request: ConnectorCallRequest
  ): Promise<unknown> {
    const { operation, params } = request;

    switch (operation) {
      case 'search_emails':
        return this.searchEmails(params as unknown as GmailSearchParams);
      case 'read_email':
        return this.readEmail(params as unknown as GmailReadParams);
      case 'create_draft':
        return this.createDraft(params as unknown as GmailCreateDraftParams);
      case 'send_draft':
        return this.sendDraft(params as unknown as GmailSendDraftParams);
      default:
        throw new Error(`Unknown operation: ${operation}`);
    }
  }

  discoverCapabilities(_instance: ConnectorInstance): ConnectorCapability[] {
    return [
      {
        capabilityId: 'gmail.search_emails',
        name: 'Search Emails',
        description: 'Search emails by query string',
        category: 'search',
        riskLevel: 'low',
        inputSchema: {
          query: { type: 'string', description: 'Search query' },
          maxResults: { type: 'number', description: 'Maximum results to return' },
        },
        requiresAuth: true,
        supportedOperations: ['search_emails'],
      },
      {
        capabilityId: 'gmail.read_email',
        name: 'Read Email',
        description: 'Read a specific email by ID',
        category: 'read',
        riskLevel: 'low',
        inputSchema: {
          emailId: { type: 'string', required: true, description: 'Email ID to read' },
        },
        requiresAuth: true,
        supportedOperations: ['read_email'],
      },
      {
        capabilityId: 'gmail.create_draft',
        name: 'Create Draft',
        description: 'Create a new email draft',
        category: 'write',
        riskLevel: 'medium',
        inputSchema: {
          to: { type: 'string', required: true, description: 'Recipient email' },
          subject: { type: 'string', required: true, description: 'Email subject' },
          body: { type: 'string', required: true, description: 'Email body' },
        },
        requiresAuth: true,
        supportedOperations: ['create_draft'],
      },
      {
        capabilityId: 'gmail.send_draft',
        name: 'Send Draft',
        description: 'Send an existing email draft',
        category: 'write',
        riskLevel: 'medium',
        inputSchema: {
          draftId: { type: 'string', required: true, description: 'Draft ID to send' },
        },
        requiresAuth: true,
        supportedOperations: ['send_draft'],
      },
    ];
  }

  checkHealth(_instance: ConnectorInstance): { healthy: boolean; message?: string } {
    return { healthy: true, message: 'Gmail mock connector is healthy' };
  }

  private searchEmails(params: GmailSearchParams): {
    emails: typeof mockEmails;
    totalResults: number;
  } {
    const { query, maxResults = 10 } = params;

    let results = [...mockEmails];

    if (query) {
      const lowerQuery = query.toLowerCase();
      results = results.filter(
        (email) =>
          email.subject.toLowerCase().includes(lowerQuery) ||
          email.body.toLowerCase().includes(lowerQuery) ||
          email.from.toLowerCase().includes(lowerQuery) ||
          email.to.toLowerCase().includes(lowerQuery)
      );
    }

    return {
      emails: results.slice(0, maxResults),
      totalResults: results.length,
    };
  }

  private readEmail(params: GmailReadParams): (typeof mockEmails)[0] | null {
    const { emailId } = params;
    const email = mockEmails.find((e) => e.id === emailId);
    return email || null;
  }

  private createDraft(params: GmailCreateDraftParams): {
    draftId: string;
    to: string;
    subject: string;
    createdAt: string;
  } {
    const { to, subject, body } = params;
    const draftId = `draft-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const createdAt = new Date().toISOString();

    mockDrafts.push({
      id: draftId,
      to,
      subject,
      body,
      createdAt,
    });

    return {
      draftId,
      to,
      subject,
      createdAt,
    };
  }

  private sendDraft(params: GmailSendDraftParams): {
    success: boolean;
    messageId: string;
    sentAt: string;
  } {
    const { draftId } = params;
    const draftIndex = mockDrafts.findIndex((d) => d.id === draftId);

    if (draftIndex === -1) {
      throw new Error(`Draft not found: ${draftId}`);
    }

    mockDrafts.splice(draftIndex, 1);

    const messageId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    return {
      success: true,
      messageId,
      sentAt: new Date().toISOString(),
    };
  }
}

export function createGmailConnectorAdapter(): GmailConnectorAdapter {
  return new GmailConnectorAdapter();
}
