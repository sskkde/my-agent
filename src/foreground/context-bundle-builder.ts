/**
 * Context Bundle Builder for Foreground Runner
 * Builds ContextBundle from ForegroundSessionState and ForegroundTurnInput.
 *
 * @module foreground/context-bundle-builder
 */

import type { ForegroundSessionState } from './types.js'
import type { ForegroundTurnInput } from './foreground-runner-types.js'
import type { ContextBundle, ContextItem } from '../context/types.js'
import type { FileUploadStore, FileUploadAccessor } from '../storage/file-upload-store.js'
import { projectActiveTodosToContext } from '../todo/context-projection.js'
import { generateForegroundCompactHints } from './compact-hints.js'

/**
 * Maximum characters allowed for attachment preview text in context.
 * ~2000 tokens worth of content. Prevents oversized context injection.
 */
const MAX_PREVIEW_CHARS = 8000

/**
 * Resolved attachment metadata for context injection.
 * Contains only safe, user-facing fields — no storageRef or internal IDs.
 */
export interface ResolvedAttachment {
  sanitizedName: string
  mimeType: string
  sizeBytes: number
  previewText?: string
  previewStatus: 'pending' | 'generated' | 'skipped' | 'failed'
}

/**
 * Resolves attachment IDs to their metadata for context injection.
 */
export type AttachmentResolver = (attachmentIds: string[]) => ResolvedAttachment[]

/**
 * Creates an AttachmentResolver backed by a FileUploadStore.
 *
 * @param store - The file upload store to query
 * @param accessor - Ownership context (userId and/or sessionId)
 * @returns An AttachmentResolver function
 */
export function createStoreAttachmentResolver(
  store: FileUploadStore,
  accessor: FileUploadAccessor,
): AttachmentResolver {
  return (attachmentIds: string[]): ResolvedAttachment[] => {
    const results: ResolvedAttachment[] = []
    for (const fileId of attachmentIds) {
      const record = store.getById(fileId, accessor)
      if (record && record.status === 'ready') {
        results.push({
          sanitizedName: record.sanitizedName,
          mimeType: record.mimeType,
          sizeBytes: record.sizeBytes,
          previewText: record.previewText,
          previewStatus: record.previewStatus,
        })
      }
    }
    return results
  }
}

/**
 * Determines whether a MIME type represents a text-like content type
 * whose preview text is meaningful for the model.
 */
function isTextLikeMime(mimeType: string): boolean {
  const textPrefixes = [
    'text/',
    'application/json',
    'application/xml',
    'application/javascript',
    'application/typescript',
    'application/x-yaml',
    'application/yaml',
    'application/toml',
    'application/csv',
    'application/x-sh',
    'application/x-typescript',
  ]
  return textPrefixes.some((prefix) => mimeType.startsWith(prefix))
}

/**
 * Formats a byte count into a human-readable size string.
 */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Truncates preview text to the configured maximum, appending a notice if truncated.
 */
function boundedPreview(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text
  }
  return text.slice(0, maxChars) + '\n[... truncated — preview exceeds limit ...]'
}

/**
 * Builds context items from resolved attachment metadata.
 *
 * For text-like uploads with `previewStatus: 'generated'`, includes
 * filename, MIME, size, and bounded preview text.
 *
 * For images, PDFs, binaries, or skipped/failed previews, includes
 * filename, MIME, size, and a note that content was not included.
 *
 * No storageRef is ever included in the context.
 *
 * @param attachments - Resolved attachment metadata
 * @returns Array of ContextItems representing the attachments
 */
export function buildAttachmentContextItems(attachments: ResolvedAttachment[]): ContextItem[] {
  return attachments.map((att, index) => {
    const header = `[Attachment: ${att.sanitizedName} | ${att.mimeType} | ${formatFileSize(att.sizeBytes)}]`

    let body: string
    if (att.previewStatus === 'generated' && att.previewText && isTextLikeMime(att.mimeType)) {
      body = boundedPreview(att.previewText, MAX_PREVIEW_CHARS)
    } else {
      body = '[Content bytes were not included in context. Only metadata is available.]'
    }

    return {
      itemId: `attachment-${index}-${att.sanitizedName}`,
      sourceType: 'attachment' as const,
      semanticType: 'attachment_ref' as const,
      content: `${header}\n${body}`,
      estimatedTokens: estimateTokens(header) + estimateTokens(body),
    }
  })
}

/**
 * Helper function to estimate token count from text.
 * Uses a simple heuristic: ~4 characters per token.
 */
function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4))
}

/**
 * Generates a simple bundle ID.
 * Format: cb-{timestamp}
 */
function generateBundleId(): string {
  return `cb-${Date.now()}`
}

/**
 * Builds a ContextBundle from ForegroundSessionState and ForegroundTurnInput.
 *
 * This function maps foreground session state to the context bundle format
 * expected by the kernel's context management system.
 *
 * @param state - The foreground session state
 * @param input - The foreground turn input
 * @param activeTodos - Optional active todos to project into context
 * @param attachmentResolver - Optional resolver for turning attachmentIds into context items
 * @returns A ContextBundle ready for kernel processing
 */
export function buildContextBundleFromForegroundState(
  state: ForegroundSessionState,
  input: ForegroundTurnInput,
  activeTodos?: Array<{
    todoId: string
    sessionId: string
    tenantId: string
    parentTodoId?: string
    position: number
    status: 'pending' | 'in_progress' | 'completed' | 'cancelled'
    priority: 'high' | 'medium' | 'low'
    content: string
    createdAt: string
    updatedAt: string
  }>,
  tokenBudget?: number,
  attachmentResolver?: AttachmentResolver,
): ContextBundle {
  const pinnedItems: ContextItem[] = buildPinnedItems(state)
  const todoContextItems: ContextItem[] = activeTodos
    ? projectActiveTodosToContext({ sessionId: input.sessionId, todos: activeTodos }).contextItems
    : []
  const attachmentContextItems: ContextItem[] =
    input.attachmentIds && input.attachmentIds.length > 0 && attachmentResolver
      ? buildAttachmentContextItems(attachmentResolver(input.attachmentIds))
      : []
  const workdirContextItems: ContextItem[] = input.workDirName
    ? buildWorkdirContextItems(input.workDirName)
    : []
  const orderedItems: ContextItem[] = [
    ...buildOrderedItems(input),
    ...workdirContextItems,
    ...attachmentContextItems,
    ...todoContextItems,
  ]
  const totalTokens =
    pinnedItems.reduce((sum, item) => sum + (item.estimatedTokens ?? 0), 0) +
    orderedItems.reduce((sum, item) => sum + (item.estimatedTokens ?? 0), 0) +
    100

  return {
    bundleId: generateBundleId(),
    runId: input.turnId,
    agentId: 'foreground',
    agentType: 'main',
    userId: input.userId,
    invocationSource: 'gateway_intent',
    pinnedItems,
    orderedItems,
    summaryBlocks: [],
    planView: undefined,
    workflowStepView: undefined,
    tokenEstimate: totalTokens,
    compactHints: tokenBudget !== undefined
      ? generateForegroundCompactHints([...pinnedItems, ...orderedItems], tokenBudget)
      : undefined,
    ...(input.workDirRoot ? { workDirRoot: input.workDirRoot } : {}),
    ...(input.workDirId ? { workDirId: input.workDirId } : {}),
  }
}

/**
 * Builds pinned items from conversation history.
 * Each history entry becomes a ContextItem representing past context.
 */
function buildPinnedItems(state: ForegroundSessionState): ContextItem[] {
  const history = state.conversationHistory
  if (!history || history.length === 0) {
    return []
  }

  return history.map((entry) => ({
    itemId: `ch-${entry.turnId}`,
    sourceType: 'session_history' as const,
    semanticType: 'fact' as const,
    content: entry.message,
    estimatedTokens: estimateTokens(entry.message),
    freshnessTs: entry.timestamp,
    isPinned: true,
  }))
}

/**
 * Builds ordered items from the current message input.
 * Creates a single ContextItem representing the user's current instruction.
 */
function buildOrderedItems(input: ForegroundTurnInput): ContextItem[] {
  return [
    {
      itemId: 'current_message',
      sourceType: 'conversation_state' as const,
      semanticType: 'instruction' as const,
      content: input.message,
      estimatedTokens: estimateTokens(input.message),
    },
  ]
}

function buildWorkdirContextItems(workDirName: string): ContextItem[] {
  const content =
    `[Active Work Directory: "${workDirName}"]\n` +
    `All file read/write/edit/search operations are scoped to this work directory. ` +
    `Do not attempt to access files outside this directory.`
  return [
    {
      itemId: 'active_workdir',
      sourceType: 'system_note' as const,
      semanticType: 'constraint' as const,
      content,
      estimatedTokens: estimateTokens(content),
      isPinned: true,
    },
  ]
}
