import type { ToolDefinition, ToolHandler, ToolExecutionResult } from '../types.js';
import type { SummaryStore } from '../../storage/summary-store.js';
import type { ToolResultStore } from '../../storage/tool-result-store.js';
import type { ToolExecutionContext } from '../types.js';

export interface MemoryRetrieveParams {
  sessionId?: string;
  userId?: string;
  limit?: number;
}

export interface MemoryRecordResult {
  summaryId: string;
  summaryType: string;
  summary: string;
  sourceRefs?: Record<string, unknown>;
  createdAt: string;
}

export interface MemoryRetrieveResult {
  memories: MemoryRecordResult[];
  total: number;
  [key: string]: unknown;
}

const LARGE_RESULT_THRESHOLD = 10000;

export function createMemoryRetrieveTool(
  summaryStore: SummaryStore,
  toolResultStore?: ToolResultStore
): ToolDefinition {
  const handler: ToolHandler = async (
    params: unknown,
    context: ToolExecutionContext
  ): Promise<ToolExecutionResult> => {
    const typedParams = params as MemoryRetrieveParams;

    if (!typedParams.sessionId && !typedParams.userId) {
      return {
        success: false,
        error: {
          code: 'MISSING_PARAMETERS',
          message: 'Either sessionId or userId must be provided',
          recoverable: true,
        },
      };
    }

    const limit = typedParams.limit ?? 10;
    const memories: MemoryRecordResult[] = [];

    if (typedParams.sessionId) {
      const sessionMemory = summaryStore.getSessionMemory(typedParams.sessionId);
      if (sessionMemory) {
        memories.push({
          summaryId: sessionMemory.summaryId,
          summaryType: sessionMemory.summaryType,
          summary: sessionMemory.summary,
          sourceRefs: sessionMemory.sourceRefs,
          createdAt: sessionMemory.createdAt,
        });
      }
    }

    const result: MemoryRetrieveResult = {
      memories: memories.slice(0, limit),
      total: memories.length,
    };

    const resultJson = JSON.stringify(result);
    let resultRef: string | undefined;

    if (resultJson.length > LARGE_RESULT_THRESHOLD && toolResultStore) {
      const stored = toolResultStore.create({
        resultRef: `mem_${Date.now()}`,
        toolCallId: context.toolCallId,
        toolName: 'memory.retrieve',
        userId: context.userId,
        sessionId: context.sessionId,
        preview: resultJson.slice(0, 500),
        structuredContent: result,
        sensitivity: 'medium',
      });
      resultRef = stored.resultRef;
    }

    return {
      success: true,
      data: result,
      resultPreview: `Retrieved ${result.memories.length} memory record(s)${resultRef ? ' (large result stored)' : ''}`,
      resultRef,
      structuredContent: result,
    };
  };

  return {
    name: 'memory.retrieve',
    description: 'Retrieve memory records from session or user memory',
    category: 'read',
    sensitivity: 'medium',
    schema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Session ID to retrieve memories for' },
        userId: { type: 'string', description: 'User ID to retrieve memories for' },
        limit: { type: 'number', description: 'Maximum number of records to return' },
      },
      required: [],
    },
    handler,
  };
}
