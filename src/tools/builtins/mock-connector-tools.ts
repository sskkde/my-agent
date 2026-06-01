import type { ToolDefinition, ToolHandler, ToolExecutionResult } from '../types.js';

// Email Search Tool
export interface EmailSearchParams {
  query: string;
  limit?: number;
}

export interface EmailSearchResultItem {
  id: string;
  subject: string;
  sender: string;
  snippet: string;
  date: string;
}

export interface EmailSearchResult {
  results: EmailSearchResultItem[];
  total: number;
  query: string;
  [key: string]: unknown;
}

// Email Send Draft Tool
export interface EmailSendDraftParams {
  to: string;
  subject: string;
  body: string;
  cc?: string[];
  bcc?: string[];
}

export interface EmailSendDraftResult {
  draftId: string;
  status: 'drafted';
  message: string;
  [key: string]: unknown;
}

// Calendar List Tool
export interface CalendarListParams {
  startDate?: string;
  endDate?: string;
  limit?: number;
}

export interface CalendarEvent {
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  location?: string;
  description?: string;
}

export interface CalendarListResult {
  events: CalendarEvent[];
  total: number;
  [key: string]: unknown;
}

// Calendar Create Event Tool
export interface CalendarCreateEventParams {
  title: string;
  startTime: string;
  endTime: string;
  location?: string;
  description?: string;
  attendees?: string[];
}

export interface CalendarCreateEventResult {
  eventId: string;
  status: 'created';
  message: string;
  [key: string]: unknown;
}

// Contacts Search Tool
export interface ContactsSearchParams {
  query: string;
  limit?: number;
}

export interface ContactResult {
  id: string;
  name: string;
  email: string;
  phone?: string;
  company?: string;
}

export interface ContactsSearchResult {
  results: ContactResult[];
  total: number;
  query: string;
  [key: string]: unknown;
}

// Docs Read Tool
export interface DocsReadParams {
  docId: string;
}

export interface DocsReadResult {
  docId: string;
  title: string;
  content: string;
  lastModified: string;
  [key: string]: unknown;
}

export function createMockConnectorTools(): ToolDefinition[] {
  // Email Search Handler
  const emailSearchHandler: ToolHandler = async (params: unknown): Promise<ToolExecutionResult> => {
    const typedParams = params as EmailSearchParams;

    if (!typedParams.query) {
      return {
        success: false,
        error: {
          code: 'MISSING_REQUIRED_FIELD',
          message: 'Missing required field: query',
          recoverable: true,
        },
      };
    }

    const limit = typedParams.limit ?? 10;
    const results: EmailSearchResultItem[] = Array.from({ length: Math.min(limit, 5) }, (_, i) => ({
      id: `email_${i + 1}`,
      subject: `Re: ${typedParams.query} discussion`,
      sender: `sender${i + 1}@example.com`,
      snippet: `This is a mock email about ${typedParams.query}...`,
      date: new Date(Date.now() - i * 86400000).toISOString(),
    }));

    const result: EmailSearchResult = {
      results,
      total: results.length,
      query: typedParams.query,
    };

    return {
      success: true,
      data: result,
      resultPreview: `Found ${results.length} emails matching "${typedParams.query}"`,
      structuredContent: result,
    };
  };

  // Email Send Draft Handler
  const emailSendDraftHandler: ToolHandler = async (params: unknown): Promise<ToolExecutionResult> => {
    const typedParams = params as EmailSendDraftParams;

    if (!typedParams.to || !typedParams.subject || !typedParams.body) {
      return {
        success: false,
        error: {
          code: 'MISSING_REQUIRED_FIELD',
          message: 'Missing required fields: to, subject, body',
          recoverable: true,
        },
      };
    }

    const result: EmailSendDraftResult = {
      draftId: `draft_${Date.now()}`,
      status: 'drafted',
      message: `Draft created for ${typedParams.to}`,
    };

    return {
      success: true,
      data: result,
      resultPreview: `Draft created: ${typedParams.subject}`,
      structuredContent: result,
    };
  };

  // Calendar List Handler
  const calendarListHandler: ToolHandler = async (params: unknown): Promise<ToolExecutionResult> => {
    const typedParams = params as CalendarListParams;
    const limit = typedParams.limit ?? 10;

    const events: CalendarEvent[] = Array.from({ length: Math.min(limit, 5) }, (_, i) => {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() + i);
      const endDate = new Date(startDate);
      endDate.setHours(endDate.getHours() + 1);

      return {
        id: `event_${i + 1}`,
        title: `Meeting ${i + 1}`,
        startTime: startDate.toISOString(),
        endTime: endDate.toISOString(),
        location: i % 2 === 0 ? 'Conference Room A' : undefined,
        description: `Mock event description ${i + 1}`,
      };
    });

    const result: CalendarListResult = {
      events,
      total: events.length,
    };

    return {
      success: true,
      data: result,
      resultPreview: `Found ${events.length} upcoming events`,
      structuredContent: result,
    };
  };

  // Calendar Create Event Handler
  const calendarCreateEventHandler: ToolHandler = async (params: unknown): Promise<ToolExecutionResult> => {
    const typedParams = params as CalendarCreateEventParams;

    if (!typedParams.title || !typedParams.startTime || !typedParams.endTime) {
      return {
        success: false,
        error: {
          code: 'MISSING_REQUIRED_FIELD',
          message: 'Missing required fields: title, startTime, endTime',
          recoverable: true,
        },
      };
    }

    const result: CalendarCreateEventResult = {
      eventId: `event_${Date.now()}`,
      status: 'created',
      message: `Event "${typedParams.title}" created successfully`,
    };

    return {
      success: true,
      data: result,
      resultPreview: `Event created: ${typedParams.title}`,
      structuredContent: result,
    };
  };

  // Contacts Search Handler
  const contactsSearchHandler: ToolHandler = async (params: unknown): Promise<ToolExecutionResult> => {
    const typedParams = params as ContactsSearchParams;

    if (!typedParams.query) {
      return {
        success: false,
        error: {
          code: 'MISSING_REQUIRED_FIELD',
          message: 'Missing required field: query',
          recoverable: true,
        },
      };
    }

    const limit = typedParams.limit ?? 10;
    const results: ContactResult[] = Array.from({ length: Math.min(limit, 5) }, (_, i) => ({
      id: `contact_${i + 1}`,
      name: `${typedParams.query} Contact ${i + 1}`,
      email: `contact${i + 1}@example.com`,
      phone: i % 2 === 0 ? `+1-555-000${i}` : undefined,
      company: i % 3 === 0 ? 'Acme Corp' : undefined,
    }));

    const result: ContactsSearchResult = {
      results,
      total: results.length,
      query: typedParams.query,
    };

    return {
      success: true,
      data: result,
      resultPreview: `Found ${results.length} contacts matching "${typedParams.query}"`,
      structuredContent: result,
    };
  };

  // Docs Read Handler
  const docsReadHandler: ToolHandler = async (params: unknown): Promise<ToolExecutionResult> => {
    const typedParams = params as DocsReadParams;

    if (!typedParams.docId) {
      return {
        success: false,
        error: {
          code: 'MISSING_REQUIRED_FIELD',
          message: 'Missing required field: docId',
          recoverable: true,
        },
      };
    }

    const result: DocsReadResult = {
      docId: typedParams.docId,
      title: `Document ${typedParams.docId}`,
      content: `This is mock content for document ${typedParams.docId}. Lorem ipsum dolor sit amet, consectetur adipiscing elit.`,
      lastModified: new Date().toISOString(),
    };

    return {
      success: true,
      data: result,
      resultPreview: `Read document: ${result.title}`,
      structuredContent: result,
    };
  };

  return [
    {
      name: 'email_search',
      description: 'Search emails matching a query (mock implementation)',
      category: 'search',
      sensitivity: 'medium',
      schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query for emails' },
          limit: { type: 'number', description: 'Maximum number of results to return' },
        },
        required: ['query'],
      },
      handler: emailSearchHandler,
    },
    {
      name: 'email_send_draft',
      description: 'Create an email draft (mock implementation)',
      category: 'write',
      sensitivity: 'high',
      schema: {
        type: 'object',
        properties: {
          to: { type: 'string', description: 'Recipient email address' },
          subject: { type: 'string', description: 'Email subject' },
          body: { type: 'string', description: 'Email body content' },
          cc: { type: 'array', items: { type: 'string' }, description: 'CC recipients' },
          bcc: { type: 'array', items: { type: 'string' }, description: 'BCC recipients' },
        },
        required: ['to', 'subject', 'body'],
      },
      handler: emailSendDraftHandler,
    },
    {
      name: 'calendar_list',
      description: 'List calendar events (mock implementation)',
      category: 'read',
      sensitivity: 'low',
      schema: {
        type: 'object',
        properties: {
          startDate: { type: 'string', description: 'Start date filter (ISO 8601)' },
          endDate: { type: 'string', description: 'End date filter (ISO 8601)' },
          limit: { type: 'number', description: 'Maximum number of events to return' },
        },
      },
      handler: calendarListHandler,
    },
    {
      name: 'calendar_create_event',
      description: 'Create a calendar event (mock implementation)',
      category: 'write',
      sensitivity: 'medium',
      schema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Event title' },
          startTime: { type: 'string', description: 'Event start time (ISO 8601)' },
          endTime: { type: 'string', description: 'Event end time (ISO 8601)' },
          location: { type: 'string', description: 'Event location' },
          description: { type: 'string', description: 'Event description' },
          attendees: { type: 'array', items: { type: 'string' }, description: 'Attendee email addresses' },
        },
        required: ['title', 'startTime', 'endTime'],
      },
      handler: calendarCreateEventHandler,
    },
    {
      name: 'contacts_search',
      description: 'Search contacts matching a query (mock implementation)',
      category: 'search',
      sensitivity: 'medium',
      schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query for contacts' },
          limit: { type: 'number', description: 'Maximum number of results to return' },
        },
        required: ['query'],
      },
      handler: contactsSearchHandler,
    },
    {
      name: 'docs_read',
      description: 'Read a document by ID (mock implementation)',
      category: 'read',
      sensitivity: 'low',
      schema: {
        type: 'object',
        properties: {
          docId: { type: 'string', description: 'Document ID to read' },
        },
        required: ['docId'],
      },
      handler: docsReadHandler,
    },
  ];
}
