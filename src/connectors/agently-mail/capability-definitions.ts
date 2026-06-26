// AgentlyMail capability definitions — pure data, no logic.
// allow: SIZE_OK - pure data table of static capability objects; no control flow or branching.
// Each entry is a const ConnectorCapability literal. Splitting would fragment a single concept.

import type { ConnectorCapability } from '../types.js'

// ── Read / info (low risk) ─────────────────────────────────────────────────

const ME_CAPABILITY: ConnectorCapability = {
  capabilityId: 'agently_mail.me',
  name: 'Get current user',
  description: 'Retrieve current authenticated user info and email aliases.',
  category: 'read',
  riskLevel: 'low',
  inputSchema: { type: 'object', properties: {}, required: [] },
  requiresAuth: true,
  supportedOperations: ['me'],
}

const AUTH_STATUS_CAPABILITY: ConnectorCapability = {
  capabilityId: 'agently_mail.auth_status',
  name: 'Check auth status',
  description: 'Inspect current OAuth credential and authentication status.',
  category: 'read',
  riskLevel: 'low',
  inputSchema: { type: 'object', properties: {}, required: [] },
  requiresAuth: true,
  supportedOperations: ['auth_status'],
}

const LIST_MESSAGES_CAPABILITY: ConnectorCapability = {
  capabilityId: 'agently_mail.list_messages',
  name: 'List messages',
  description:
    'List messages in a folder with optional pagination, date range, and filter flags.',
  category: 'read',
  riskLevel: 'low',
  inputSchema: {
    type: 'object',
    properties: {
      dir: {
        type: 'string',
        enum: ['inbox', 'sent', 'trash', 'spam'],
        description: 'Mail folder to list.',
      },
      limit: {
        type: 'number',
        description: 'Max messages to return (default 10).',
      },
      cursor: {
        type: 'string',
        description: 'Pagination cursor from a previous response.',
      },
      after: {
        type: 'string',
        description: 'Return messages after this ISO-8601 date.',
      },
      before: {
        type: 'string',
        description: 'Return messages before this ISO-8601 date.',
      },
      hasAttachments: {
        type: 'boolean',
        description: 'Filter to messages with attachments.',
      },
      isUnread: {
        type: 'boolean',
        description: 'Filter to unread messages only.',
      },
    },
    required: [],
  },
  requiresAuth: true,
  supportedOperations: ['list_messages'],
}

const READ_MESSAGE_CAPABILITY: ConnectorCapability = {
  capabilityId: 'agently_mail.read_message',
  name: 'Read message',
  description: 'Fetch full message content including body and attachment metadata.',
  category: 'read',
  riskLevel: 'low',
  inputSchema: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'Message ID (msg_xxx).',
      },
    },
    required: ['id'],
  },
  requiresAuth: true,
  supportedOperations: ['read_message'],
}

const SEARCH_MESSAGES_CAPABILITY: ConnectorCapability = {
  capabilityId: 'agently_mail.search_messages',
  name: 'Search messages',
  description: 'Keyword and multidimensional search across mailbox.',
  category: 'search',
  riskLevel: 'low',
  inputSchema: {
    type: 'object',
    properties: {
      q: {
        type: 'string',
        description: 'Search query string.',
      },
      searchIn: {
        type: 'string',
        enum: ['SEARCH_IN_ALL', 'SEARCH_IN_SUBJECT', 'SEARCH_IN_CONTENT'],
        description: 'Scope of search.',
      },
      from: { type: 'string', description: 'Filter by sender address.' },
      to: { type: 'string', description: 'Filter by recipient address.' },
      dir: {
        type: 'string',
        enum: ['inbox', 'sent', 'trash', 'spam'],
        description: 'Folder to search in.',
      },
      after: {
        type: 'string',
        description: 'Messages after this ISO-8601 date.',
      },
      before: {
        type: 'string',
        description: 'Messages before this ISO-8601 date.',
      },
      hasAttachments: {
        type: 'boolean',
        description: 'Filter to messages with attachments.',
      },
      isUnread: {
        type: 'boolean',
        description: 'Filter to unread messages only.',
      },
      limit: {
        type: 'number',
        description: 'Max results to return.',
      },
      cursor: {
        type: 'string',
        description: 'Pagination cursor from a previous search.',
      },
    },
    required: ['q'],
  },
  requiresAuth: true,
  supportedOperations: ['search_messages'],
}

// ── Write / send (medium risk — requires approval) ─────────────────────────

const SEND_MESSAGE_CAPABILITY: ConnectorCapability = {
  capabilityId: 'agently_mail.send_message',
  name: 'Send message',
  description: 'Compose and send a new email. Requires two-stage confirmation.',
  category: 'send',
  riskLevel: 'medium',
  inputSchema: {
    type: 'object',
    properties: {
      to: {
        type: 'array',
        items: { type: 'string' },
        description: 'Recipient addresses.',
      },
      subject: { type: 'string', description: 'Email subject.' },
      body: { type: 'string', description: 'Email body content.' },
      cc: {
        type: 'array',
        items: { type: 'string' },
        description: 'CC recipient addresses.',
      },
      bcc: {
        type: 'array',
        items: { type: 'string' },
        description: 'BCC recipient addresses.',
      },
      bodyFormat: {
        type: 'string',
        enum: ['html'],
        description: 'Set to "html" for HTML body.',
      },
      attachments: {
        type: 'array',
        items: { type: 'string' },
        description: 'Relative file paths to attach (max 3).',
      },
      confirmationToken: {
        type: 'string',
        description: 'Two-stage confirmation token (ctk_xxx).',
      },
    },
    required: ['to', 'subject', 'body'],
  },
  requiresAuth: true,
  supportedOperations: ['send_message'],
}

const REPLY_MESSAGE_CAPABILITY: ConnectorCapability = {
  capabilityId: 'agently_mail.reply_message',
  name: 'Reply to message',
  description: 'Reply or reply-all to an existing message. Requires two-stage confirmation.',
  category: 'send',
  riskLevel: 'medium',
  inputSchema: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'Message ID to reply to (msg_xxx).',
      },
      body: { type: 'string', description: 'Reply body content.' },
      bodyFormat: {
        type: 'string',
        enum: ['html'],
        description: 'Set to "html" for HTML body.',
      },
      replyAll: {
        type: 'boolean',
        description: 'Reply to all recipients.',
      },
      cc: {
        type: 'array',
        items: { type: 'string' },
        description: 'CC recipient addresses.',
      },
      bcc: {
        type: 'array',
        items: { type: 'string' },
        description: 'BCC recipient addresses.',
      },
      attachments: {
        type: 'array',
        items: { type: 'string' },
        description: 'Relative file paths to attach.',
      },
      confirmationToken: {
        type: 'string',
        description: 'Two-stage confirmation token (ctk_xxx).',
      },
    },
    required: ['id', 'body'],
  },
  requiresAuth: true,
  supportedOperations: ['reply_message'],
}

const FORWARD_MESSAGE_CAPABILITY: ConnectorCapability = {
  capabilityId: 'agently_mail.forward_message',
  name: 'Forward message',
  description: 'Forward a message to recipients. Requires two-stage confirmation.',
  category: 'send',
  riskLevel: 'medium',
  inputSchema: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'Message ID to forward (msg_xxx).',
      },
      to: {
        type: 'array',
        items: { type: 'string' },
        description: 'Recipient addresses.',
      },
      body: {
        type: 'string',
        description: 'Optional additional body text.',
      },
      bodyFormat: {
        type: 'string',
        enum: ['html'],
        description: 'Set to "html" for HTML body.',
      },
      cc: {
        type: 'array',
        items: { type: 'string' },
        description: 'CC recipient addresses.',
      },
      bcc: {
        type: 'array',
        items: { type: 'string' },
        description: 'BCC recipient addresses.',
      },
      includeAttachments: {
        type: 'boolean',
        description: 'Include original message attachments.',
      },
      attachments: {
        type: 'array',
        items: { type: 'string' },
        description: 'Additional relative file paths to attach.',
      },
      confirmationToken: {
        type: 'string',
        description: 'Two-stage confirmation token (ctk_xxx).',
      },
    },
    required: ['id', 'to'],
  },
  requiresAuth: true,
  supportedOperations: ['forward_message'],
}

// ── Delete (high risk) ─────────────────────────────────────────────────────

const TRASH_MESSAGE_CAPABILITY: ConnectorCapability = {
  capabilityId: 'agently_mail.trash_message',
  name: 'Trash message',
  description:
    'Move a message to trash (soft delete; real deletion after 30 days). Requires two-stage confirmation.',
  category: 'delete',
  riskLevel: 'high',
  inputSchema: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'Message ID to trash (msg_xxx).',
      },
      confirmationToken: {
        type: 'string',
        description: 'Two-stage confirmation token (ctk_xxx).',
      },
    },
    required: ['id'],
  },
  requiresAuth: true,
  supportedOperations: ['trash_message'],
}

// ── Attachment download (low risk) ─────────────────────────────────────────

const DOWNLOAD_ATTACHMENT_CAPABILITY: ConnectorCapability = {
  capabilityId: 'agently_mail.download_attachment',
  name: 'Download attachment',
  description: 'Download an attachment from a message to a local directory.',
  category: 'read',
  riskLevel: 'low',
  inputSchema: {
    type: 'object',
    properties: {
      msg: {
        type: 'string',
        description: 'Message ID (msg_xxx).',
      },
      att: {
        type: 'string',
        description: 'Attachment ID (att_xxx).',
      },
      output: {
        type: 'string',
        description: 'Relative output directory (default: current directory).',
      },
    },
    required: ['msg', 'att'],
  },
  requiresAuth: true,
  supportedOperations: ['download_attachment'],
}

// ── Exported array ─────────────────────────────────────────────────────────

export const AGENTLY_MAIL_CAPABILITIES: readonly ConnectorCapability[] = [
  ME_CAPABILITY,
  AUTH_STATUS_CAPABILITY,
  LIST_MESSAGES_CAPABILITY,
  READ_MESSAGE_CAPABILITY,
  SEARCH_MESSAGES_CAPABILITY,
  SEND_MESSAGE_CAPABILITY,
  REPLY_MESSAGE_CAPABILITY,
  FORWARD_MESSAGE_CAPABILITY,
  TRASH_MESSAGE_CAPABILITY,
  DOWNLOAD_ATTACHMENT_CAPABILITY,
]
