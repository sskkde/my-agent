import type { ToolDefinition, ToolHandler, ToolExecutionResult } from '../types.js'
import type { SummaryStore } from '../../storage/summary-store.js'
import type { ToolResultStore } from '../../storage/tool-result-store.js'
import type { LongTermMemoryStore } from '../../storage/long-term-memory-store.js'
import type { ToolExecutionContext } from '../types.js'
import { createLongTermMemoryRecallService } from '../../memory/long-term-memory-recall.js'

export interface MemoryRetrieveParams {
  sessionId?: string
  userId?: string
  query?: string
  limit?: number
  memoryTypes?: string[]
}

export type SessionMemoryResult = {
  source: 'session'
  summaryId: string
  summaryType: string
  summary: string
  sourceRefs?: Record<string, unknown>
  createdAt: string
}

export type LongTermMemoryResult = {
  source: 'long_term'
  memoryId: string
  userId: string
  memoryType: string
  content: {
    text: string
    structured?: Record<string, unknown>
  }
  confidence: number
  importance: string
  createdAt: string
}

export type MemoryRecordResult = SessionMemoryResult | LongTermMemoryResult

export interface MemoryRetrieveResult {
  memories: MemoryRecordResult[]
  total: number
  [key: string]: unknown
}

const LARGE_RESULT_THRESHOLD = 10000

export function createMemoryRetrieveTool(
  summaryStore: SummaryStore,
  longTermMemoryStore: LongTermMemoryStore,
  toolResultStore?: ToolResultStore,
): ToolDefinition {
  const handler: ToolHandler = async (params: unknown, context: ToolExecutionContext): Promise<ToolExecutionResult> => {
    const typedParams = params as MemoryRetrieveParams

    const effectiveUserId = typedParams.userId ?? context.userId

    if (!typedParams.sessionId && !effectiveUserId) {
      return {
        success: false,
        error: {
          code: 'MISSING_PARAMETERS',
          message: 'Either sessionId or userId must be provided',
          recoverable: true,
        },
      }
    }

    if (typedParams.userId && typedParams.userId !== context.userId) {
      return {
        success: false,
        error: {
          code: 'USER_MISMATCH',
          message: 'userId parameter must match the authenticated user',
          recoverable: false,
        },
      }
    }

    const limit = typedParams.limit ?? 10
    const memories: MemoryRecordResult[] = []

    if (typedParams.sessionId) {
      const sessionMemory = summaryStore.getSessionMemory(typedParams.sessionId)
      if (sessionMemory) {
        memories.push({
          source: 'session',
          summaryId: sessionMemory.summaryId,
          summaryType: sessionMemory.summaryType,
          summary: sessionMemory.summary,
          sourceRefs: sessionMemory.sourceRefs,
          createdAt: sessionMemory.createdAt,
        })
      }
    }

    if (effectiveUserId) {
      const recallService = createLongTermMemoryRecallService(longTermMemoryStore)
      const recallResult = await recallService.recall({
        userId: effectiveUserId,
        query: typedParams.query,
        limit: limit - memories.length,
        memoryTypes: typedParams.memoryTypes as never[] | undefined,
      })

      for (const mem of recallResult.memories) {
        memories.push({
          source: 'long_term',
          memoryId: mem.memoryId,
          userId: mem.userId,
          memoryType: mem.memoryType,
          content: mem.content,
          confidence: mem.confidence,
          importance: mem.importance,
          createdAt: mem.lifecycle.createdAt,
        })
      }
    }

    const result: MemoryRetrieveResult = {
      memories: memories.slice(0, limit),
      total: memories.length,
    }

    const resultJson = JSON.stringify(result)
    let resultRef: string | undefined

    if (resultJson.length > LARGE_RESULT_THRESHOLD && toolResultStore) {
      const stored = toolResultStore.create({
        resultRef: `mem_${Date.now()}`,
        toolCallId: context.toolCallId,
        toolName: 'memory_retrieve',
        userId: context.userId,
        sessionId: context.sessionId,
        preview: resultJson.slice(0, 500),
        structuredContent: result,
        sensitivity: 'medium',
      })
      resultRef = stored.resultRef
    }

    return {
      success: true,
      data: result,
      resultPreview: `Retrieved ${result.memories.length} memory record(s)${resultRef ? ' (large result stored)' : ''}`,
      resultRef,
      structuredContent: result,
    }
  }

  return {
    name: 'memory_retrieve',
    description: 'Retrieve memory records from session or user memory',
    category: 'read',
    sensitivity: 'medium',
    schema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Session ID to retrieve memories for' },
        userId: { type: 'string', description: 'User ID to retrieve memories for' },
        query: { type: 'string', description: 'Search query for lexical matching' },
        limit: { type: 'number', description: 'Maximum number of records to return' },
        memoryTypes: { type: 'array', items: { type: 'string' }, description: 'Filter by memory types' },
      },
      required: [],
    },
    handler,
  }
}
