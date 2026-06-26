// AgentlyMail CLI argv builder for write operations.
// Converts typed input params into CLI argument arrays.
// Used by the confirmation manager for Stage 1 and Stage 2 calls.

import type {
  AgentlyMailOperation,
  AgentlyMailConfirmationToken,
  SendMessageInput,
  ReplyMessageInput,
  ForwardMessageInput,
  TrashMessageInput,
} from './types.js'

// ─── Public API ────────────────────────────────────────────────────────────────

/** Build CLI argv from operation params, appending --confirmation-token if present. */
export function buildArgv(
  operation: AgentlyMailOperation,
  params: Record<string, unknown>,
  confirmationToken?: AgentlyMailConfirmationToken,
): readonly string[] {
  const argv: string[] = []

  switch (operation) {
    case 'send_message':
      buildSendArgv(argv, params as unknown as SendMessageInput)
      break
    case 'reply_message':
      buildReplyArgv(argv, params as unknown as ReplyMessageInput)
      break
    case 'forward_message':
      buildForwardArgv(argv, params as unknown as ForwardMessageInput)
      break
    case 'trash_message':
      buildTrashArgv(argv, params as unknown as TrashMessageInput)
      break
  }

  if (confirmationToken) {
    argv.push('--confirmation-token', confirmationToken)
  }

  return argv
}

// ─── Private builders ──────────────────────────────────────────────────────────

function buildSendArgv(argv: string[], params: SendMessageInput): void {
  argv.push('message', '+send')
  for (const to of params.to) {
    argv.push('--to', to)
  }
  argv.push('--subject', params.subject, '--body', params.body)
  if (params.cc) for (const cc of params.cc) argv.push('--cc', cc)
  if (params.bcc) for (const bcc of params.bcc) argv.push('--bcc', bcc)
  if (params.bodyFormat === 'html') argv.push('--body-format', 'html')
  if (params.attachments) for (const att of params.attachments) argv.push('--attachment', att)
}

function buildReplyArgv(argv: string[], params: ReplyMessageInput): void {
  argv.push('message', '+reply')
  argv.push('--id', params.id, '--body', params.body)
  if (params.bodyFormat === 'html') argv.push('--body-format', 'html')
  if (params.replyAll) argv.push('--reply-all')
  if (params.cc) for (const cc of params.cc) argv.push('--cc', cc)
  if (params.bcc) for (const bcc of params.bcc) argv.push('--bcc', bcc)
  if (params.attachments) for (const att of params.attachments) argv.push('--attachment', att)
}

function buildForwardArgv(argv: string[], params: ForwardMessageInput): void {
  argv.push('message', '+forward')
  argv.push('--id', params.id)
  for (const to of params.to) argv.push('--to', to)
  if (params.body) argv.push('--body', params.body)
  if (params.bodyFormat === 'html') argv.push('--body-format', 'html')
  if (params.cc) for (const cc of params.cc) argv.push('--cc', cc)
  if (params.bcc) for (const bcc of params.bcc) argv.push('--bcc', bcc)
  if (params.includeAttachments) argv.push('--include-attachments')
  if (params.attachments) for (const att of params.attachments) argv.push('--attachment', att)
}

function buildTrashArgv(argv: string[], params: TrashMessageInput): void {
  argv.push('message', '+trash')
  argv.push('--id', params.id)
}
