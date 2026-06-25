/**
 * Messaging connector definitions — registers five provider connectors
 * (Feishu, Telegram, DingTalk, QQ, WeChat) with capabilities and config schemas.
 *
 * Definitions contain NO secret values — only schema descriptions.
 */

import type { ConnectorStore, ConnectorDefinition } from '../../storage/connector-store.js'
import type { ConnectorCapability } from '../types.js'
import type { MessagingProviderId } from './types.js'

// ---------------------------------------------------------------------------
// Provider metadata
// ---------------------------------------------------------------------------

interface MessagingProviderDef {
  connectorId: string
  name: string
  description: string
  configSchema: Record<string, unknown>
}

const PROVIDER_DEFS: readonly MessagingProviderDef[] = [
  {
    connectorId: 'feishu',
    name: 'Feishu',
    description:
      'Lark/Feishu bot connector for receiving and sending messages via Feishu Open Platform webhooks.',
    configSchema: {
      type: 'object',
      required: ['appId', 'appSecret'],
      properties: {
        appId: { type: 'string', description: 'Feishu app ID from developer console' },
        appSecret: { type: 'string', description: 'Feishu app secret (store securely)', isSecret: true },
        verificationToken: { type: 'string', description: 'Webhook verification token' },
        encryptKey: { type: 'string', description: 'Event encryption key' },
      },
    },
  },
  {
    connectorId: 'telegram',
    name: 'Telegram',
    description:
      'Telegram Bot API connector for receiving updates via polling/webhook and sending messages.',
    configSchema: {
      type: 'object',
      required: ['botToken'],
      properties: {
        botToken: { type: 'string', description: 'Telegram bot token from @BotFather (store securely)', isSecret: true },
        webhookSecret: { type: 'string', description: 'Optional webhook secret token for verification' },
      },
    },
  },
  {
    connectorId: 'dingtalk',
    name: 'DingTalk',
    description:
      'DingTalk robot connector for receiving group and private messages via DingTalk Open Platform.',
    configSchema: {
      type: 'object',
      required: ['appId', 'appSecret'],
      properties: {
        appId: { type: 'string', description: 'DingTalk app key from developer console' },
        appSecret: { type: 'string', description: 'DingTalk app secret (store securely)', isSecret: true },
        robotCode: { type: 'string', description: 'DingTalk robot code for outbound messaging' },
      },
    },
  },
  {
    connectorId: 'qq',
    name: 'QQ',
    description:
      'QQ Official Bot connector for receiving and sending messages via QQ Open Platform.',
    configSchema: {
      type: 'object',
      required: ['appId', 'appSecret'],
      properties: {
        appId: { type: 'string', description: 'QQ bot app ID from QQ Open Platform' },
        appSecret: { type: 'string', description: 'QQ bot app secret (store securely)', isSecret: true },
        token: { type: 'string', description: 'Bot token for API authentication' },
        sandbox: { type: 'boolean', description: 'Whether to use sandbox environment', default: false },
      },
    },
  },
  {
    connectorId: 'wechat',
    name: 'WeChat',
    description:
      'WeChat Official Account / Mini-Program connector for receiving and sending messages via WeChat MP platform.',
    configSchema: {
      type: 'object',
      required: ['appId', 'appSecret'],
      properties: {
        appId: { type: 'string', description: 'WeChat app ID from MP management platform' },
        appSecret: { type: 'string', description: 'WeChat app secret (store securely)', isSecret: true },
        encodingAesKey: { type: 'string', description: 'Message encryption key from MP platform' },
        token: { type: 'string', description: 'Server verification token' },
      },
    },
  },
] as const

// ---------------------------------------------------------------------------
// Capability templates
// ---------------------------------------------------------------------------

const TEXT_INBOUND: Omit<ConnectorCapability, 'capabilityId'> = {
  name: 'Receive Text Messages',
  description: 'Inbound text message reception from messaging provider webhooks',
  category: 'read',
  riskLevel: 'low',
  inputSchema: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'Message text content' },
      senderId: { type: 'string', description: 'External sender identifier' },
      conversationId: { type: 'string', description: 'External conversation identifier' },
    },
  },
  requiresAuth: true,
  supportedOperations: ['receive_text'],
}

const TEXT_OUTBOUND: Omit<ConnectorCapability, 'capabilityId'> = {
  name: 'Send Text Messages',
  description: 'Outbound text message delivery through messaging provider API',
  category: 'send',
  riskLevel: 'medium',
  inputSchema: {
    type: 'object',
    required: ['text', 'targetConversationId'],
    properties: {
      text: { type: 'string', description: 'Message text to send' },
      targetConversationId: { type: 'string', description: 'Destination conversation identifier' },
    },
  },
  requiresAuth: true,
  supportedOperations: ['send_text'],
}

// ---------------------------------------------------------------------------
// Definitions array (exported for test inspection)
// ---------------------------------------------------------------------------

export type MessagingConnectorDefinitionInput = Omit<
  ConnectorDefinition,
  'id' | 'createdAt' | 'updatedAt'
>

export const MESSAGING_CONNECTOR_DEFINITIONS: readonly MessagingConnectorDefinitionInput[] =
  PROVIDER_DEFS.map((p) => ({
    connectorId: p.connectorId,
    name: p.name,
    connectorType: 'messaging' as const,
    version: '1.0.0',
    description: p.description,
    capabilities: ['text-inbound', 'text-outbound'],
    configSchema: p.configSchema,
    status: 'active' as const,
  }))

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/**
 * Register all five messaging connector definitions into the store.
 * Idempotent — skips providers that are already registered.
 */
export function registerMessagingDefinitions(connectorStore: ConnectorStore): void {
  for (const def of MESSAGING_CONNECTOR_DEFINITIONS) {
    const existing = connectorStore.findDefinitionByConnectorId(def.connectorId)
    if (existing) {
      continue
    }
    connectorStore.createDefinition(def)
  }
}

// ---------------------------------------------------------------------------
// Capability lookup
// ---------------------------------------------------------------------------

const PROVIDER_CAPABILITY_MAP: Record<MessagingProviderId, ConnectorCapability[]> = {
  feishu: [
    { capabilityId: 'feishu:receive-text', ...TEXT_INBOUND },
    { capabilityId: 'feishu:send-text', ...TEXT_OUTBOUND },
  ],
  telegram: [
    { capabilityId: 'telegram:receive-text', ...TEXT_INBOUND },
    { capabilityId: 'telegram:send-text', ...TEXT_OUTBOUND },
  ],
  dingtalk: [
    { capabilityId: 'dingtalk:receive-text', ...TEXT_INBOUND },
    { capabilityId: 'dingtalk:send-text', ...TEXT_OUTBOUND },
  ],
  qq: [
    { capabilityId: 'qq:receive-text', ...TEXT_INBOUND },
    { capabilityId: 'qq:send-text', ...TEXT_OUTBOUND },
  ],
  wechat: [
    { capabilityId: 'wechat:receive-text', ...TEXT_INBOUND },
    { capabilityId: 'wechat:send-text', ...TEXT_OUTBOUND },
  ],
}

/**
 * Return `ConnectorCapability[]` for a connectorId (e.g. 'feishu').
 * Returns an empty array if the connectorId is not a known messaging provider.
 */
export function getMessagingCapabilities(connectorId: string): ConnectorCapability[] {
  const provider = connectorId as MessagingProviderId
  return PROVIDER_CAPABILITY_MAP[provider] ?? []
}
