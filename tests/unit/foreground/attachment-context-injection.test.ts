/**
 * Tests for attachment context injection in foreground context bundle builder.
 *
 * Validates that:
 * - Text-like uploads with generated previews include bounded preview text
 * - Image/PDF/binary attachments include metadata but not content bytes
 * - storageRef is never exposed in context
 * - Preview text is truncated at the configured limit
 * - Missing/invalid attachments are silently skipped
 */

import { describe, it, expect } from 'vitest'
import {
  buildAttachmentContextItems,
  buildContextBundleFromForegroundState,
  createStoreAttachmentResolver,
  type ResolvedAttachment,
  type AttachmentResolver,
} from '../../../src/foreground/context-bundle-builder.js'
import type { ForegroundSessionState } from '../../../src/foreground/types.js'
import type { ForegroundTurnInput } from '../../../src/foreground/foreground-runner-types.js'
import type { HydratedSessionState } from '../../../src/gateway/types.js'

// ── Helpers ────────────────────────────────────────────────────────────────

function createMockState(): ForegroundSessionState {
  return {
    hydratedSession: {
      userContext: { userId: 'user-1', sessionId: 'session-1', preferences: {} },
      sessionContext: {
        messageCount: 1,
        lastActivityAt: '2024-01-15T10:00:00.000Z',
        activePlannerRunIds: [],
        activeBackgroundRunIds: [],
      },
      activeWorkRefs: { pendingApprovals: [], activeRuns: [] },
    } as HydratedSessionState,
    activeWorkRefs: { pendingApprovals: [], activeRuns: [] },
    currentPersona: {
      personaId: 'default',
      name: 'Assistant',
      directDelegationPolicy: {
        estimatedStepsGte: 3,
        maxComplexity: 'medium' as const,
        allowedToolCategories: ['read', 'search', 'internal'],
      },
    },
    effectivePolicy: {
      estimatedStepsGte: 3,
      maxComplexity: 'medium' as const,
      allowedToolCategories: ['read', 'search', 'internal'],
    },
    conversationHistory: [],
  }
}

function createMockInput(overrides?: Partial<ForegroundTurnInput>): ForegroundTurnInput {
  const state = createMockState()
  return {
    userId: 'user-1',
    sessionId: 'session-1',
    turnId: 'turn-001',
    message: 'Hello!',
    timestamp: '2024-01-15T10:00:00.000Z',
    hydratedState: state.hydratedSession,
    foregroundState: state,
    ...overrides,
  }
}

function makeTextAttachment(overrides?: Partial<ResolvedAttachment>): ResolvedAttachment {
  return {
    sanitizedName: 'readme.txt',
    mimeType: 'text/plain',
    sizeBytes: 2048,
    previewText: 'Hello, this is a preview of the text file content.',
    previewStatus: 'generated',
    ...overrides,
  }
}

function makeImageAttachment(overrides?: Partial<ResolvedAttachment>): ResolvedAttachment {
  return {
    sanitizedName: 'photo.png',
    mimeType: 'image/png',
    sizeBytes: 102400,
    previewStatus: 'skipped',
    ...overrides,
  }
}

function makePdfAttachment(overrides?: Partial<ResolvedAttachment>): ResolvedAttachment {
  return {
    sanitizedName: 'document.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 512000,
    previewStatus: 'skipped',
    ...overrides,
  }
}

// ── buildAttachmentContextItems ────────────────────────────────────────────

describe('buildAttachmentContextItems', () => {
  it('text-like upload with generated preview includes filename, MIME, size, and bounded preview', () => {
    const items = buildAttachmentContextItems([makeTextAttachment()])

    expect(items).toHaveLength(1)
    const item = items[0]!

    expect(item.sourceType).toBe('attachment')
    expect(item.semanticType).toBe('attachment_ref')
    expect(item.content).toContain('readme.txt')
    expect(item.content).toContain('text/plain')
    expect(item.content).toContain('2.0 KB')
    expect(item.content).toContain('Hello, this is a preview')
    expect(item.estimatedTokens).toBeGreaterThan(0)
  })

  it('image attachment includes metadata but not content bytes', () => {
    const items = buildAttachmentContextItems([makeImageAttachment()])

    expect(items).toHaveLength(1)
    const item = items[0]!

    expect(item.sourceType).toBe('attachment')
    expect(item.semanticType).toBe('attachment_ref')
    expect(item.content).toContain('photo.png')
    expect(item.content).toContain('image/png')
    expect(item.content).toContain('100.0 KB')
    expect(item.content).toContain('Content bytes were not included')
    expect(item.content).not.toContain('base64')
  })

  it('PDF attachment includes metadata but not content bytes', () => {
    const items = buildAttachmentContextItems([makePdfAttachment()])

    expect(items).toHaveLength(1)
    const item = items[0]!

    expect(item.sourceType).toBe('attachment')
    expect(item.content).toContain('document.pdf')
    expect(item.content).toContain('application/pdf')
    expect(item.content).toContain('500.0 KB')
    expect(item.content).toContain('Content bytes were not included')
  })

  it('text-like upload with skipped preview includes metadata but not content', () => {
    const items = buildAttachmentContextItems([
      makeTextAttachment({ previewStatus: 'skipped', previewText: undefined }),
    ])

    expect(items).toHaveLength(1)
    expect(items[0]!.content).toContain('Content bytes were not included')
    expect(items[0]!.content).toContain('readme.txt')
  })

  it('text-like upload with failed preview includes metadata but not content', () => {
    const items = buildAttachmentContextItems([
      makeTextAttachment({ previewStatus: 'failed', previewText: undefined }),
    ])

    expect(items).toHaveLength(1)
    expect(items[0]!.content).toContain('Content bytes were not included')
  })

  it('preview text is truncated at MAX_PREVIEW_CHARS (8000) with notice', () => {
    const longPreview = 'x'.repeat(10000)
    const items = buildAttachmentContextItems([
      makeTextAttachment({ previewText: longPreview }),
    ])

    expect(items).toHaveLength(1)
    expect(items[0]!.content).toContain('truncated')
    // The content should be shorter than the original 10000 chars + header
    expect(items[0]!.content.length).toBeLessThan(10000 + 200)
    // But should still contain the first 8000 chars of preview
    expect(items[0]!.content).toContain('x'.repeat(8000))
  })

  it('multiple attachments produce multiple context items', () => {
    const items = buildAttachmentContextItems([
      makeTextAttachment(),
      makeImageAttachment(),
      makePdfAttachment(),
    ])

    expect(items).toHaveLength(3)
    expect(items[0]!.content).toContain('readme.txt')
    expect(items[1]!.content).toContain('photo.png')
    expect(items[2]!.content).toContain('document.pdf')
  })

  it('empty attachments array produces empty items', () => {
    const items = buildAttachmentContextItems([])
    expect(items).toHaveLength(0)
  })

  it('JSON upload with generated preview is treated as text-like', () => {
    const items = buildAttachmentContextItems([
      makeTextAttachment({
        sanitizedName: 'config.json',
        mimeType: 'application/json',
        previewText: '{"key": "value"}',
      }),
    ])

    expect(items).toHaveLength(1)
    expect(items[0]!.content).toContain('{"key": "value"}')
    expect(items[0]!.content).not.toContain('Content bytes were not included')
  })

  it('CSV upload with generated preview is treated as text-like', () => {
    const items = buildAttachmentContextItems([
      makeTextAttachment({
        sanitizedName: 'data.csv',
        mimeType: 'application/csv',
        previewText: 'name,age\nAlice,30',
      }),
    ])

    expect(items).toHaveLength(1)
    expect(items[0]!.content).toContain('name,age')
  })

  it('no storageRef ever appears in context items', () => {
    const items = buildAttachmentContextItems([
      makeTextAttachment(),
      makeImageAttachment(),
    ])

    for (const item of items) {
      expect(item.content).not.toContain('storageRef')
      expect(item.content).not.toContain('storage_ref')
      expect(item.content).not.toContain('/tmp/')
      expect(item.content).not.toContain('s3://')
    }
  })
})

// ── buildContextBundleFromForegroundState with attachments ─────────────────

describe('buildContextBundleFromForegroundState with attachments', () => {
  it('text attachment context appears in orderedItems after current message', () => {
    const resolver: AttachmentResolver = () => [makeTextAttachment()]
    const input = createMockInput({ attachmentIds: ['file-001'] })
    const state = createMockState()

    const bundle = buildContextBundleFromForegroundState(state, input, undefined, resolver)

    // Should have: current_message + attachment item
    expect(bundle.orderedItems.length).toBeGreaterThanOrEqual(2)

    const attachmentItem = bundle.orderedItems.find((i) => i.sourceType === 'attachment')
    expect(attachmentItem).toBeDefined()
    expect(attachmentItem!.content).toContain('readme.txt')
    expect(attachmentItem!.content).toContain('Hello, this is a preview')

    // Attachment should come after the current message
    const currentMsgIndex = bundle.orderedItems.findIndex((i) => i.itemId === 'current_message')
    const attachmentIndex = bundle.orderedItems.findIndex((i) => i.sourceType === 'attachment')
    expect(attachmentIndex).toBeGreaterThan(currentMsgIndex)
  })

  it('image attachment context includes metadata but no bytes', () => {
    const resolver: AttachmentResolver = () => [makeImageAttachment()]
    const input = createMockInput({ attachmentIds: ['file-002'] })
    const state = createMockState()

    const bundle = buildContextBundleFromForegroundState(state, input, undefined, resolver)

    const attachmentItem = bundle.orderedItems.find((i) => i.sourceType === 'attachment')
    expect(attachmentItem).toBeDefined()
    expect(attachmentItem!.content).toContain('photo.png')
    expect(attachmentItem!.content).toContain('image/png')
    expect(attachmentItem!.content).toContain('Content bytes were not included')
  })

  it('no attachment items when attachmentIds is empty', () => {
    const resolver: AttachmentResolver = () => [makeTextAttachment()]
    const input = createMockInput({ attachmentIds: [] })
    const state = createMockState()

    const bundle = buildContextBundleFromForegroundState(state, input, undefined, resolver)

    const attachmentItems = bundle.orderedItems.filter((i) => i.sourceType === 'attachment')
    expect(attachmentItems).toHaveLength(0)
  })

  it('no attachment items when attachmentIds is undefined', () => {
    const resolver: AttachmentResolver = () => [makeTextAttachment()]
    const input = createMockInput() // no attachmentIds
    const state = createMockState()

    const bundle = buildContextBundleFromForegroundState(state, input, undefined, resolver)

    const attachmentItems = bundle.orderedItems.filter((i) => i.sourceType === 'attachment')
    expect(attachmentItems).toHaveLength(0)
  })

  it('no attachment items when resolver is not provided', () => {
    const input = createMockInput({ attachmentIds: ['file-001'] })
    const state = createMockState()

    const bundle = buildContextBundleFromForegroundState(state, input)

    const attachmentItems = bundle.orderedItems.filter((i) => i.sourceType === 'attachment')
    expect(attachmentItems).toHaveLength(0)
  })

  it('token estimate includes attachment items', () => {
    const resolver: AttachmentResolver = () => [makeTextAttachment()]
    const input = createMockInput({ attachmentIds: ['file-001'] })
    const state = createMockState()

    const bundleWithAttachment = buildContextBundleFromForegroundState(state, input, undefined, resolver)
    const bundleWithout = buildContextBundleFromForegroundState(state, createMockInput())

    expect(bundleWithAttachment.tokenEstimate).toBeGreaterThan(bundleWithout.tokenEstimate)
  })

  it('no storageRef in any bundle item', () => {
    const resolver: AttachmentResolver = () => [
      makeTextAttachment(),
      makeImageAttachment(),
    ]
    const input = createMockInput({ attachmentIds: ['file-001', 'file-002'] })
    const state = createMockState()

    const bundle = buildContextBundleFromForegroundState(state, input, undefined, resolver)

    for (const item of bundle.orderedItems) {
      expect(item.content).not.toContain('storageRef')
      expect(item.content).not.toContain('storage_ref')
    }
    for (const item of bundle.pinnedItems) {
      expect(item.content).not.toContain('storageRef')
      expect(item.content).not.toContain('storage_ref')
    }
  })

  it('resolver returning empty array produces no attachment items', () => {
    const resolver: AttachmentResolver = () => []
    const input = createMockInput({ attachmentIds: ['file-nonexistent'] })
    const state = createMockState()

    const bundle = buildContextBundleFromForegroundState(state, input, undefined, resolver)

    const attachmentItems = bundle.orderedItems.filter((i) => i.sourceType === 'attachment')
    expect(attachmentItems).toHaveLength(0)
  })
})

// ── createStoreAttachmentResolver ──────────────────────────────────────────

describe('createStoreAttachmentResolver', () => {
  it('resolves valid ready attachments from store', () => {
    const mockStore = {
      getById: (fileId: string) => {
        if (fileId === 'file-001') {
          return {
            fileId: 'file-001',
            userId: 'user-1',
            sessionId: 'session-1',
            tenantId: 'tenant-1',
            originalFilename: 'readme.txt',
            sanitizedName: 'readme.txt',
            mimeType: 'text/plain',
            extension: '.txt',
            sizeBytes: 2048,
            checksum: 'abc123',
            storageRef: '/tmp/secret-path/should-not-leak',
            previewText: 'File preview content here',
            previewStatus: 'generated' as const,
            sensitivity: 'low' as const,
            status: 'ready' as const,
            createdAt: '2024-01-15T10:00:00.000Z',
            updatedAt: '2024-01-15T10:00:00.000Z',
            deletedAt: undefined,
          }
        }
        return undefined
      },
    }

    const resolver = createStoreAttachmentResolver(mockStore as any, { userId: 'user-1' })
    const results = resolver(['file-001'])

    expect(results).toHaveLength(1)
    expect(results[0]!.sanitizedName).toBe('readme.txt')
    expect(results[0]!.mimeType).toBe('text/plain')
    expect(results[0]!.sizeBytes).toBe(2048)
    expect(results[0]!.previewText).toBe('File preview content here')
    expect(results[0]!.previewStatus).toBe('generated')

    // Verify storageRef is NOT included in the resolved attachment
    expect((results[0] as any).storageRef).toBeUndefined()
  })

  it('skips attachments not found in store', () => {
    const mockStore = {
      getById: () => undefined,
    }

    const resolver = createStoreAttachmentResolver(mockStore as any, { userId: 'user-1' })
    const results = resolver(['file-nonexistent'])

    expect(results).toHaveLength(0)
  })

  it('skips attachments with non-ready status', () => {
    const mockStore = {
      getById: () => ({
        fileId: 'file-001',
        sanitizedName: 'deleted.txt',
        mimeType: 'text/plain',
        sizeBytes: 100,
        previewText: undefined,
        previewStatus: 'skipped' as const,
        status: 'deleted' as const,
      }),
    }

    const resolver = createStoreAttachmentResolver(mockStore as any, { userId: 'user-1' })
    const results = resolver(['file-001'])

    expect(results).toHaveLength(0)
  })

  it('handles multiple attachment IDs', () => {
    const mockStore = {
      getById: (fileId: string) => {
        if (fileId === 'file-001') {
          return {
            sanitizedName: 'a.txt',
            mimeType: 'text/plain',
            sizeBytes: 100,
            previewText: 'content a',
            previewStatus: 'generated' as const,
            status: 'ready' as const,
          }
        }
        if (fileId === 'file-002') {
          return {
            sanitizedName: 'b.png',
            mimeType: 'image/png',
            sizeBytes: 200,
            previewText: undefined,
            previewStatus: 'skipped' as const,
            status: 'ready' as const,
          }
        }
        return undefined
      },
    }

    const resolver = createStoreAttachmentResolver(mockStore as any, { userId: 'user-1' })
    const results = resolver(['file-001', 'file-002', 'file-999'])

    expect(results).toHaveLength(2)
    expect(results[0]!.sanitizedName).toBe('a.txt')
    expect(results[1]!.sanitizedName).toBe('b.png')
  })
})

// ── Malicious/large text preview truncation ────────────────────────────────

describe('security: large text preview truncation', () => {
  it('extremely large preview text is truncated and does not include raw storageRef', () => {
    const hugePreview = 'A'.repeat(100_000) // 100KB of text
    const items = buildAttachmentContextItems([
      makeTextAttachment({ previewText: hugePreview }),
    ])

    expect(items).toHaveLength(1)
    // Should be truncated to ~8000 chars + header + truncation notice
    expect(items[0]!.content.length).toBeLessThan(9000)
    expect(items[0]!.content).toContain('truncated')
    // Should NOT contain the full 100KB
    expect(items[0]!.content).not.toContain('A'.repeat(100_000))
    // No storage reference
    expect(items[0]!.content).not.toContain('storageRef')
  })

  it('preview with path traversal attempts does not leak paths', () => {
    const items = buildAttachmentContextItems([
      makeTextAttachment({
        sanitizedName: '../../../etc/passwd',
        previewText: 'root:x:0:0:root:/root:/bin/bash',
      }),
    ])

    expect(items).toHaveLength(1)
    // The sanitized name is what the store provides — context includes it as-is
    // but no storageRef or internal path is leaked
    expect(items[0]!.content).not.toContain('storageRef')
    expect(items[0]!.content).not.toContain('storage_ref')
  })
})
