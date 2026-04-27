import type {
  ConnectorAdapter,
  ConnectorCapability,
  ConnectorCallRequest,
} from '../types.js';
import type { ConnectorInstance } from '../../storage/connector-store.js';

const mockContacts = [
  {
    id: 'contact-001',
    name: 'John Doe',
    email: 'john.doe@example.com',
    phone: '+1-555-0101',
    company: 'Acme Corp',
    jobTitle: 'Software Engineer',
    notes: 'Met at conference 2023',
  },
  {
    id: 'contact-002',
    name: 'Jane Smith',
    email: 'jane.smith@company.com',
    phone: '+1-555-0102',
    company: 'Tech Solutions',
    jobTitle: 'Product Manager',
    notes: 'Key stakeholder',
  },
  {
    id: 'contact-003',
    name: 'Bob Johnson',
    email: 'bob.j@partner.com',
    phone: '+1-555-0103',
    company: 'Partner LLC',
    jobTitle: 'Sales Director',
    notes: 'Quarterly review contact',
  },
  {
    id: 'contact-004',
    name: 'Alice Williams',
    email: 'alice.w@external.com',
    phone: '+1-555-0104',
    company: 'External Consulting',
    jobTitle: 'Consultant',
    notes: 'Project advisor',
  },
];

export interface ContactsSearchParams {
  query?: string;
  maxResults?: number;
}

export class ContactsConnectorAdapter implements ConnectorAdapter {
  async execute(
    _instance: ConnectorInstance,
    request: ConnectorCallRequest
  ): Promise<unknown> {
    const { operation, params } = request;

    switch (operation) {
      case 'search_contacts':
        return this.searchContacts(params as unknown as ContactsSearchParams);
      default:
        throw new Error(`Unknown operation: ${operation}`);
    }
  }

  discoverCapabilities(_instance: ConnectorInstance): ConnectorCapability[] {
    return [
      {
        capabilityId: 'contacts.search_contacts',
        name: 'Search Contacts',
        description: 'Search contacts by name, email, or company',
        category: 'search',
        riskLevel: 'low',
        inputSchema: {
          query: { type: 'string', description: 'Search query' },
          maxResults: { type: 'number', description: 'Maximum results to return' },
        },
        requiresAuth: true,
        supportedOperations: ['search_contacts'],
      },
    ];
  }

  checkHealth(_instance: ConnectorInstance): { healthy: boolean; message?: string } {
    return { healthy: true, message: 'Contacts mock connector is healthy' };
  }

  private searchContacts(params: ContactsSearchParams): {
    contacts: typeof mockContacts;
    totalResults: number;
  } {
    const { query, maxResults = 10 } = params;

    let results = [...mockContacts];

    if (query) {
      const lowerQuery = query.toLowerCase();
      results = results.filter(
        (contact) =>
          contact.name.toLowerCase().includes(lowerQuery) ||
          contact.email.toLowerCase().includes(lowerQuery) ||
          contact.company.toLowerCase().includes(lowerQuery) ||
          contact.jobTitle.toLowerCase().includes(lowerQuery)
      );
    }

    return {
      contacts: results.slice(0, maxResults),
      totalResults: results.length,
    };
  }
}

export function createContactsConnectorAdapter(): ContactsConnectorAdapter {
  return new ContactsConnectorAdapter();
}
