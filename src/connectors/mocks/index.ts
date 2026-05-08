import type { ConnectorRuntime } from '../types.js';
import {
  createGmailConnectorAdapter,
  GmailConnectorAdapter,
} from './gmail-connector.js';
import {
  createCalendarConnectorAdapter,
  CalendarConnectorAdapter,
} from './calendar-connector.js';
import {
  createContactsConnectorAdapter,
  ContactsConnectorAdapter,
} from './contacts-connector.js';
import {
  createDocsConnectorAdapter,
  DocsConnectorAdapter,
} from './docs-connector.js';
import {
  GitHubConnectorAdapter,
} from '../github/github-connector.js';

export * from './gmail-connector.js';
export * from './calendar-connector.js';
export * from './contacts-connector.js';
export * from './docs-connector.js';
export { GitHubConnectorAdapter } from '../github/github-connector.js';

export interface MockConnectors {
  gmail: GmailConnectorAdapter;
  calendar: CalendarConnectorAdapter;
  contacts: ContactsConnectorAdapter;
  docs: DocsConnectorAdapter;
  github?: GitHubConnectorAdapter;
}

export function createMockConnectors(): MockConnectors {
  return {
    gmail: createGmailConnectorAdapter(),
    calendar: createCalendarConnectorAdapter(),
    contacts: createContactsConnectorAdapter(),
    docs: createDocsConnectorAdapter(),
  };
}

export function registerMockConnectors(runtime: ConnectorRuntime): MockConnectors {
  const connectors = createMockConnectors();

  (runtime as unknown as { registerAdapter: (type: string, adapter: unknown) => void }).registerAdapter(
    'gmail',
    connectors.gmail
  );
  (runtime as unknown as { registerAdapter: (type: string, adapter: unknown) => void }).registerAdapter(
    'calendar',
    connectors.calendar
  );
  (runtime as unknown as { registerAdapter: (type: string, adapter: unknown) => void }).registerAdapter(
    'contacts',
    connectors.contacts
  );
  (runtime as unknown as { registerAdapter: (type: string, adapter: unknown) => void }).registerAdapter(
    'docs',
    connectors.docs
  );

  return connectors;
}

export const MOCK_CONNECTOR_TYPES = {
  GMAIL: 'gmail',
  CALENDAR: 'calendar',
  CONTACTS: 'contacts',
  DOCS: 'docs',
  GITHUB: 'github',
} as const;
