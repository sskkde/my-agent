// AgentlyMail CLI type contract
// Pure type definitions — no runtime logic, no subprocess execution.
// Derived from upstream: .omo/drafts/agently-mail-upstream-evidence.md

// ─── Operations ───────────────────────────────────────────────────────────────

export type AgentlyMailOperation =
  | 'auth_login'
  | 'auth_logout'
  | 'auth_status'
  | 'me'
  | 'list_messages'
  | 'read_message'
  | 'search_messages'
  | 'send_message'
  | 'reply_message'
  | 'forward_message'
  | 'trash_message'
  | 'download_attachment'

// ─── Exit codes ───────────────────────────────────────────────────────────────

export type AgentlyMailExitCode = 0 | 1 | 2 | 3 | 4 | 6 | 7 | 8

export const AGENTLY_MAIL_EXIT_DESCRIPTIONS: Record<AgentlyMailExitCode, string> = {
  0: 'success',
  1: 'server_error_or_network_fluctuation',
  2: 'invalid_parameters',
  3: 'auth_expired',
  4: 'local_network_error',
  6: 'permanent_business_rejection',
  7: 'rate_limited',
  8: 'missing_confirmation_token',
} as const

// ─── Branded ID types ─────────────────────────────────────────────────────────

export type MessageId = string & { readonly __brand: 'MessageId' }
export type AttachmentId = string & { readonly __brand: 'AttachmentId' }

/** `ctk_xxx` token from two-stage write confirmation. Valid 5 minutes. */
export type AgentlyMailConfirmationToken = string & { readonly __brand: 'ConfirmationToken' }

// ─── CLI envelope ─────────────────────────────────────────────────────────────

export interface AgentlyMailCliSuccessEnvelope<T = unknown> {
  data: T
}

export interface AgentlyMailCliErrorEnvelope {
  error: {
    code: string
    message: string
  }
}

export type AgentlyMailCliEnvelope<T = unknown> =
  | AgentlyMailCliSuccessEnvelope<T>
  | AgentlyMailCliErrorEnvelope

// ─── DTOs (untrusted external data) ──────────────────────────────────────────

export interface AgentlyMailAttachment {
  untrusted: true
  attachment_id: AttachmentId | null
  filename: string
  mime_type: string
  size: number
  /** Present only for oversized attachments that cannot be downloaded via CLI. */
  download_url: string | null
}

export interface AgentlyMailContact {
  untrusted: true
  name: string
  address: string
}

export interface AgentlyMailMessage {
  untrusted: true
  id: MessageId
  subject: string
  from: AgentlyMailContact
  to: readonly AgentlyMailContact[]
  cc: readonly AgentlyMailContact[]
  body: string
  date: string
  is_read: boolean
  folder: string
  attachments: readonly AgentlyMailAttachment[]
}

// ─── Operation input types ────────────────────────────────────────────────────

export interface ConfirmationActionInput {
  confirmationToken?: AgentlyMailConfirmationToken
}

export interface ListMessagesInput {
  dir?: 'inbox' | 'sent' | 'trash' | 'spam'
  limit?: number
  cursor?: string
  after?: string
  before?: string
  hasAttachments?: boolean
  isUnread?: boolean
}

export interface ReadMessageInput {
  id: MessageId
}

export interface SearchMessagesInput {
  q: string
  searchIn?: 'SEARCH_IN_ALL' | 'SEARCH_IN_SUBJECT' | 'SEARCH_IN_CONTENT'
  from?: string
  to?: string
  dir?: 'inbox' | 'sent' | 'trash' | 'spam'
  after?: string
  before?: string
  hasAttachments?: boolean
  isUnread?: boolean
  limit?: number
  cursor?: string
}

export interface SendMessageInput extends ConfirmationActionInput {
  to: readonly string[]
  subject: string
  body: string
  cc?: readonly string[]
  bcc?: readonly string[]
  bodyFormat?: 'html'
  attachments?: readonly string[]
}

export interface ReplyMessageInput extends ConfirmationActionInput {
  id: MessageId
  body: string
  bodyFormat?: 'html'
  replyAll?: boolean
  cc?: readonly string[]
  bcc?: readonly string[]
  attachments?: readonly string[]
}

export interface ForwardMessageInput extends ConfirmationActionInput {
  id: MessageId
  to: readonly string[]
  body?: string
  bodyFormat?: 'html'
  cc?: readonly string[]
  bcc?: readonly string[]
  includeAttachments?: boolean
  attachments?: readonly string[]
}

export interface TrashMessageInput extends ConfirmationActionInput {
  id: MessageId
}

export interface DownloadAttachmentInput {
  msg: MessageId
  att: AttachmentId
  output?: string
}

// ─── Operation → input map + discriminated request ────────────────────────────

export interface AgentlyMailOperationInputMap {
  auth_login: Record<string, never>
  auth_logout: Record<string, never>
  auth_status: Record<string, never>
  me: Record<string, never>
  list_messages: ListMessagesInput
  read_message: ReadMessageInput
  search_messages: SearchMessagesInput
  send_message: SendMessageInput
  reply_message: ReplyMessageInput
  forward_message: ForwardMessageInput
  trash_message: TrashMessageInput
  download_attachment: DownloadAttachmentInput
}

export type AgentlyMailCliRequest = {
  [K in AgentlyMailOperation]: {
    readonly operation: K
    readonly params: AgentlyMailOperationInputMap[K]
  }
}[AgentlyMailOperation]
