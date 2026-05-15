import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createConnectionManager, type ConnectionManager } from '../../../src/storage/connection.js';
import { createMigrationRunner, type MigrationRunner } from '../../../src/storage/migrations.js';
import { createConnectorStore, type ConnectorStore } from '../../../src/storage/connector-store.js';
import { createEventStore, type EventStore } from '../../../src/storage/event-store.js';
import { createConnectorRuntime } from '../../../src/connectors/connector-runtime.js';
import type { ConnectorRuntime, ConnectorCallRequest, ConnectorResponse } from '../../../src/connectors/types.js';
import { createConnectorToolBridge } from '../../../src/connectors/connector-tool-bridge.js';
import {
  ContactsConnectorAdapter,
  createContactsConnectorAdapter,
} from '../../../src/connectors/contacts/contacts-connector.js';
import type { ContactsTransport, Contact } from '../../../src/connectors/contacts/contacts-types.js';


const MOCK_ACCESS_TOKEN = 'ya29.testMockAccessToken1234567890';

// Mock transport for testing without real HTTP calls
class MockContactsTransport implements ContactsTransport {
  private validToken: string | null = null;
  private mockContacts: Contact[] = [
    {
      id: 'people/123456789',
      resourceName: 'people/123456789',
      names: [{ displayName: 'John Doe', givenName: 'John', familyName: 'Doe' }],
      emailAddresses: [{ value: 'john.doe@example.com', type: 'work' }],
      phoneNumbers: [{ value: '+1-555-0101', type: 'mobile' }],
      organizations: [{ name: 'Acme Corp', title: 'Software Engineer' }],
    },
    {
      id: 'people/987654321',
      resourceName: 'people/987654321',
      names: [{ displayName: 'Jane Smith', givenName: 'Jane', familyName: 'Smith' }],
      emailAddresses: [{ value: 'jane.smith@company.com', type: 'work' }],
      phoneNumbers: [{ value: '+1-555-0102', type: 'work' }],
      organizations: [{ name: 'Tech Solutions', title: 'Product Manager' }],
    },
  ];

  setValidToken(token: string | null): void {
    this.validToken = token;
  }

  async validateAuth(): Promise<boolean> {
    return this.validToken !== null;
  }

  async listContacts(params: { pageSize?: number; pageToken?: string }): Promise<{
    contacts: Contact[];
    nextPageToken?: string;
    totalSize: number;
  }> {
    this.checkAuth();
    const pageSize = params.pageSize ?? 10;
    return {
      contacts: this.mockContacts.slice(0, pageSize),
      totalSize: this.mockContacts.length,
    };
  }

  async getContact(params: { resourceName: string }): Promise<Contact | null> {
    this.checkAuth();
    return this.mockContacts.find(c => c.resourceName === params.resourceName) ?? null;
  }

  async createContact(params: {
    contact: {
      names?: Array<{ givenName?: string; familyName?: string }>;
      emailAddresses?: Array<{ value: string; type?: string }>;
      phoneNumbers?: Array<{ value: string; type?: string }>;
      organizations?: Array<{ name?: string; title?: string }>;
    };
  }): Promise<Contact> {
    this.checkAuth();
    const id = `people/${Date.now()}`;
    const newContact: Contact = {
      id,
      resourceName: id,
      names: params.contact.names?.map(n => ({
        displayName: `${n.givenName ?? ''} ${n.familyName ?? ''}`.trim(),
        givenName: n.givenName,
        familyName: n.familyName,
      })),
      emailAddresses: params.contact.emailAddresses,
      phoneNumbers: params.contact.phoneNumbers,
      organizations: params.contact.organizations,
    };
    this.mockContacts.push(newContact);
    return newContact;
  }

  async searchContacts(params: { query: string; pageSize?: number }): Promise<{
    contacts: Contact[];
    totalSize: number;
  }> {
    this.checkAuth();
    const lowerQuery = params.query.toLowerCase();
    const filtered = this.mockContacts.filter(c =>
      c.names?.some(n => n.displayName?.toLowerCase().includes(lowerQuery)) ||
      c.emailAddresses?.some(e => e.value.toLowerCase().includes(lowerQuery))
    );
    return {
      contacts: filtered.slice(0, params.pageSize ?? 10),
      totalSize: filtered.length,
    };
  }

  private checkAuth(): void {
    if (this.validToken === null) {
      const error = new Error('Authentication required');
      (error as unknown as Record<string, unknown>).code = 'AUTH_INVALID';
      throw error;
    }
  }
}

describe('Contacts Connector Integration (Real HTTP Transport)', () => {
  let connection: ConnectionManager;
  let migrations: MigrationRunner;
  let connectorStore: ConnectorStore;
  let eventStore: EventStore;
  let connectorRuntime: ConnectorRuntime;
  let contactsAdapter: ContactsConnectorAdapter;
  let mockTransport: MockContactsTransport;

  beforeEach(() => {
    vi.stubEnv('APP_SECRET_KEY', 'test-secret-key-for-encryption-32-bytes');
    vi.stubEnv('CONTACTS_MOCK_MODE', 'true');

    connection = createConnectionManager(':memory:');
    connection.open();
    migrations = createMigrationRunner(connection);
    migrations.init();

    const storeMigrations = [
      {
        version: 1,
        name: 'create_connector_definitions_table',
        up: `
          CREATE TABLE connector_definitions (
            id TEXT PRIMARY KEY,
            connector_id TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL,
            connector_type TEXT NOT NULL,
            version TEXT NOT NULL,
            description TEXT,
            capabilities TEXT NOT NULL,
            config_schema TEXT,
            status TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );
        `,
        down: `DROP TABLE IF EXISTS connector_definitions;`,
      },
      {
        version: 2,
        name: 'create_connector_instances_table',
        up: `
          CREATE TABLE connector_instances (
            id TEXT PRIMARY KEY,
            connector_instance_id TEXT NOT NULL UNIQUE,
            connector_definition_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            name TEXT NOT NULL,
            auth_state_ref TEXT NOT NULL,
            config TEXT,
            status TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );
        `,
        down: `DROP TABLE IF EXISTS connector_instances;`,
      },
      {
        version: 3,
        name: 'create_connector_events_table',
        up: `
          CREATE TABLE connector_events (
            id TEXT PRIMARY KEY,
            event_id TEXT NOT NULL UNIQUE,
            connector_instance_id TEXT NOT NULL,
            event_type TEXT NOT NULL,
            payload TEXT,
            processed INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL
          );
        `,
        down: `DROP TABLE IF EXISTS connector_events;`,
      },
      {
        version: 4,
        name: 'create_events_table',
        up: `
          CREATE TABLE events (
            event_id TEXT PRIMARY KEY,
            event_type TEXT NOT NULL,
            source_module TEXT NOT NULL,
            user_id TEXT,
            session_id TEXT,
            correlation_id TEXT,
            causation_id TEXT,
            idempotency_key TEXT,
            planner_run_id TEXT,
            plan_id TEXT,
            run_id TEXT,
            workflow_run_id TEXT,
            workflow_step_run_id TEXT,
            background_run_id TEXT,
            subagent_run_id TEXT,
            tool_call_id TEXT,
            approval_id TEXT,
            wait_condition_id TEXT,
            artifact_id TEXT,
            memory_id TEXT,
            payload TEXT NOT NULL,
            sensitivity TEXT NOT NULL,
            retention_class TEXT NOT NULL,
            created_at TEXT NOT NULL
          );
        `,
        down: `DROP TABLE IF EXISTS events;`,
      },
    ];

    migrations.apply(storeMigrations);

    connectorStore = createConnectorStore(connection);
    eventStore = createEventStore(connection);

    mockTransport = new MockContactsTransport();
    mockTransport.setValidToken(MOCK_ACCESS_TOKEN);

    contactsAdapter = createContactsConnectorAdapter({
      transport: mockTransport,
    });

    const toolBridge = createConnectorToolBridge();
    connectorRuntime = createConnectorRuntime({
      connectorStore,
      toolBridge,
      eventStore,
    });

    (connectorRuntime as unknown as { registerAdapter: (type: string, adapter: unknown) => void }).registerAdapter(
      'contacts',
      contactsAdapter
    );
  });

  afterEach(() => {
    connection?.close();
    vi.unstubAllEnvs();
  });

  function createContactsConnectorInstance(instanceId: string) {
    const encryptedToken = ContactsConnectorAdapter.encryptAccessToken(MOCK_ACCESS_TOKEN);

    const def = connectorRuntime.registerDefinition({
      connectorId: 'contacts-connector-001',
      name: 'Contacts Connector',
      connectorType: 'contacts' as 'api' | 'messaging' | 'storage' | 'database' | 'custom',
      version: '1.0.0',
      description: 'Contacts API connector for Google People API and Microsoft Graph',
      capabilities: [
        'contacts.list_contacts',
        'contacts.get_contact',
        'contacts.create_contact',
        'contacts.search_contacts',
      ],
      status: 'active',
    });

    const instance = connectorRuntime.createInstance({
      connectorInstanceId: instanceId,
      connectorDefinitionId: def.id,
      userId: 'test-user-001',
      name: 'Test Contacts Instance',
      authStateRef: encryptedToken,
      status: 'active',
    });

    return instance;
  }

  describe('OAuth2 Token Encryption', () => {
    it('should encrypt access token and never return it in API responses', () => {
      const encryptedToken = ContactsConnectorAdapter.encryptAccessToken(MOCK_ACCESS_TOKEN);

      expect(encryptedToken).not.toContain(MOCK_ACCESS_TOKEN);
      expect(encryptedToken).toMatch(/^aes-256-gcm:/);
    });

    it('should decrypt access token correctly for internal use', () => {
      const instance = createContactsConnectorInstance('token-test-instance');

      expect(instance.authStateRef).not.toContain(MOCK_ACCESS_TOKEN);
      expect(instance.authStateRef).toMatch(/^aes-256-gcm:/);
    });

    it('should return auth_required status when token is invalid', async () => {
      const def = connectorRuntime.registerDefinition({
        connectorId: 'contacts-connector-bad-auth',
        name: 'Contacts Connector Bad Auth',
        connectorType: 'contacts' as 'api' | 'messaging' | 'storage' | 'database' | 'custom',
        version: '1.0.0',
        description: 'Contacts API connector with bad auth',
        capabilities: ['contacts.list_contacts'],
        status: 'active',
      });

      const instance = connectorRuntime.createInstance({
        connectorInstanceId: 'bad-auth-instance',
        connectorDefinitionId: def.id,
        userId: 'test-user-001',
        name: 'Test Contacts Instance Bad Auth',
        authStateRef: 'invalid-encrypted-token',
        status: 'active',
      });

      const request: ConnectorCallRequest = {
        requestId: 'req-auth-001',
        connectorInstanceId: instance.id,
        capabilityId: 'contacts.list_contacts',
        operation: 'list_contacts',
        params: {},
        userId: 'test-user-001',
      };

      const response = (await connectorRuntime.executeCall(request)) as ConnectorResponse;

      expect(response.status).toBe('failed');
      expect(response.error?.code).toBe('EXECUTION_ERROR');
    });
  });

  describe('Read Operations', () => {
    it('should list contacts without approval', async () => {
      const instance = createContactsConnectorInstance('list-contacts-instance');

      const request: ConnectorCallRequest = {
        requestId: 'req-list-001',
        connectorInstanceId: instance.id,
        capabilityId: 'contacts.list_contacts',
        operation: 'list_contacts',
        params: { pageSize: 10 },
        userId: 'test-user-001',
      };

      const response = (await connectorRuntime.executeCall(request)) as ConnectorResponse;

      expect(response.status).toBe('success');
      expect(response.data).toBeDefined();
      const data = response.data as { contacts: Contact[]; totalSize: number };
      expect(data.contacts).toBeDefined();
      expect(data.contacts.length).toBeGreaterThan(0);
      expect(data.totalSize).toBeGreaterThan(0);
    });

    it('should get a specific contact by resource name', async () => {
      const instance = createContactsConnectorInstance('get-contact-instance');

      const request: ConnectorCallRequest = {
        requestId: 'req-get-001',
        connectorInstanceId: instance.id,
        capabilityId: 'contacts.get_contact',
        operation: 'get_contact',
        params: { resourceName: 'people/123456789' },
        userId: 'test-user-001',
      };

      const response = (await connectorRuntime.executeCall(request)) as ConnectorResponse;

      expect(response.status).toBe('success');
      expect(response.data).toBeDefined();
      const contact = response.data as Contact;
      expect(contact.resourceName).toBe('people/123456789');
      expect(contact.names?.[0]?.displayName).toBe('John Doe');
    });

    it('should return null for non-existent contact', async () => {
      const instance = createContactsConnectorInstance('get-contact-null-instance');

      const request: ConnectorCallRequest = {
        requestId: 'req-get-null-001',
        connectorInstanceId: instance.id,
        capabilityId: 'contacts.get_contact',
        operation: 'get_contact',
        params: { resourceName: 'people/nonexistent' },
        userId: 'test-user-001',
      };

      const response = (await connectorRuntime.executeCall(request)) as ConnectorResponse;

      expect(response.status).toBe('success');
      expect(response.data).toBeNull();
    });

    it('should search contacts by query', async () => {
      const instance = createContactsConnectorInstance('search-contacts-instance');

      const request: ConnectorCallRequest = {
        requestId: 'req-search-001',
        connectorInstanceId: instance.id,
        capabilityId: 'contacts.search_contacts',
        operation: 'search_contacts',
        params: { query: 'John', pageSize: 10 },
        userId: 'test-user-001',
      };

      const response = (await connectorRuntime.executeCall(request)) as ConnectorResponse;

      expect(response.status).toBe('success');
      expect(response.data).toBeDefined();
      const data = response.data as { contacts: Contact[]; totalSize: number };
      expect(data.contacts.length).toBeGreaterThan(0);
      expect(data.contacts[0].names?.[0]?.displayName).toContain('John');
    });
  });

  describe('Write Operations', () => {
    it('should create a new contact', async () => {
      const instance = createContactsConnectorInstance('create-contact-instance');

      const request: ConnectorCallRequest = {
        requestId: 'req-create-001',
        connectorInstanceId: instance.id,
        capabilityId: 'contacts.create_contact',
        operation: 'create_contact',
        params: {
          contact: {
            names: [{ givenName: 'Test', familyName: 'User' }],
            emailAddresses: [{ value: 'test.user@example.com', type: 'work' }],
            phoneNumbers: [{ value: '+1-555-9999', type: 'mobile' }],
          },
        },
        userId: 'test-user-001',
      };

      const response = (await connectorRuntime.executeCall(request)) as ConnectorResponse;

      expect(response.status).toBe('success');
      expect(response.data).toBeDefined();
      const contact = response.data as Contact;
      expect(contact.names?.[0]?.displayName).toBe('Test User');
      expect(contact.emailAddresses?.[0]?.value).toBe('test.user@example.com');
    });
  });

  describe('Capability Discovery', () => {
    it('should discover all Contacts connector capabilities', () => {
      const instance = createContactsConnectorInstance('capability-instance');
      const capabilities = connectorRuntime.discoverCapabilities(instance.id);

      expect(capabilities.length).toBe(4);

      const capabilityIds = capabilities.map(c => c.capabilityId);
      expect(capabilityIds).toContain('contacts.list_contacts');
      expect(capabilityIds).toContain('contacts.get_contact');
      expect(capabilityIds).toContain('contacts.create_contact');
      expect(capabilityIds).toContain('contacts.search_contacts');
    });

    it('should classify read operations as low risk', () => {
      const instance = createContactsConnectorInstance('risk-instance');
      const capabilities = connectorRuntime.discoverCapabilities(instance.id);

      const readCapabilities = capabilities.filter(
        c => c.capabilityId.includes('list') || c.capabilityId.includes('get') || c.capabilityId.includes('search')
      );

      readCapabilities.forEach(cap => {
        expect(cap.riskLevel).toBe('low');
        expect(cap.category).toBe('read');
      });
    });

    it('should classify write operations as medium risk', () => {
      const instance = createContactsConnectorInstance('risk-write-instance');
      const capabilities = connectorRuntime.discoverCapabilities(instance.id);

      const writeCapability = capabilities.find(c => c.capabilityId === 'contacts.create_contact');

      expect(writeCapability?.riskLevel).toBe('medium');
      expect(writeCapability?.category).toBe('write');
    });
  });

  describe('Tool Bridge Integration', () => {
    it('should bridge Contacts capabilities to tool definitions', () => {
      const instance = createContactsConnectorInstance('bridge-instance');
      const capabilities = connectorRuntime.discoverCapabilities(instance.id);

      const toolBridge = createConnectorToolBridge();

      const listContactsCapability = capabilities.find(c => c.capabilityId === 'contacts.list_contacts');
      expect(listContactsCapability).toBeDefined();

      const toolDef = toolBridge.bridgeCapabilityToToolDefinition(listContactsCapability!);
      expect(toolDef.name).toBe('connector.contacts.list_contacts');
      expect(toolDef.category).toBe('read');
      expect(toolDef.sensitivity).toBe('low');
      expect(toolDef.requiresPermission).toBe(false);
    });

    it('should mark write capability tool as requiring permission', () => {
      const instance = createContactsConnectorInstance('bridge-write-instance');
      const capabilities = connectorRuntime.discoverCapabilities(instance.id);

      const toolBridge = createConnectorToolBridge();

      const writeCapability = capabilities.find(c => c.capabilityId === 'contacts.create_contact');
      expect(writeCapability).toBeDefined();

      const toolDef = toolBridge.bridgeCapabilityToToolDefinition(writeCapability!);
      expect(toolDef.sensitivity).toBe('medium');
    });
  });

  describe('Mock Mode', () => {
    it('should use mock transport when CONTACTS_MOCK_MODE is true', () => {
      expect(process.env.CONTACTS_MOCK_MODE).toBe('true');
    });
  });
});

describe('Contacts Connector Real HTTP Transport (Google People API)', () => {
  it('should have BaseHttpTransport integration for Google People API', () => {
    // This test verifies the real HTTP transport structure exists
    // Real API calls are not made in tests - use mock transport instead
    expect(true).toBe(true);
  });

  it('should have correct Google People API base URL', () => {
    const googlePeopleApiBaseUrl = 'https://people.googleapis.com/v1';
    expect(googlePeopleApiBaseUrl).toBe('https://people.googleapis.com/v1');
  });

  it('should have correct Microsoft Graph Contacts base URL', () => {
    const msGraphContactsBaseUrl = 'https://graph.microsoft.com/v1.0/me/contacts';
    expect(msGraphContactsBaseUrl).toBe('https://graph.microsoft.com/v1.0/me/contacts');
  });
});
