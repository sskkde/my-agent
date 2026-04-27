import type { ToolDefinition, ToolHandler, ToolExecutionResult, ToolExecutionContext } from '../types.js';
import type { TranscriptStore, TurnTranscript } from '../../storage/transcript-store.js';
import type { ToolResultStore } from '../../storage/tool-result-store.js';

export interface TranscriptSearchParams {
  query: string;
  sessionId?: string;
  limit?: number;
}

export interface TranscriptSearchResult {
  results: Array<{
    turnId: string;
    sessionId: string;
    userMessageSummary?: string;
    assistantResponse?: string;
    createdAt: string;
  }>;
  total: number;
  [key: string]: unknown;
}

const LARGE_RESULT_THRESHOLD = 10000;

export function createTranscriptSearchTool(
  transcriptStore: TranscriptStore,
  toolResultStore?: ToolResultStore
): ToolDefinition {
  const handler: ToolHandler = async (
    params: unknown,
    context: ToolExecutionContext
  ): Promise<ToolExecutionResult> => {
    const typedParams = params as TranscriptSearchParams;

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

    const limit = typedParams.limit ?? 50;
    let transcripts: TurnTranscript[];

    if (typedParams.sessionId) {
      transcripts = transcriptStore.findBySession(typedParams.sessionId);
    } else {
      transcripts = transcriptStore.search(typedParams.query);
    }

    if (typedParams.sessionId && typedParams.query) {
      transcripts = transcripts.filter(t => 
        t.input.userMessageSummary?.includes(typedParams.query) ||
        t.output.visibleMessages.some(m => m.content.includes(typedParams.query))
      );
    }

    const results: TranscriptSearchResult['results'] = transcripts
      .slice(0, limit)
      .map(t => ({
        turnId: t.turnId,
        sessionId: t.sessionId,
        userMessageSummary: t.input.userMessageSummary,
        assistantResponse: t.output.visibleMessages[0]?.content,
        createdAt: t.createdAt,
      }));

    const result: TranscriptSearchResult = {
      results,
      total: transcripts.length,
    };

    const resultJson = JSON.stringify(result);
    let resultRef: string | undefined;
    let preview = `Found ${result.results.length} transcript(s)`;

    if (resultJson.length > LARGE_RESULT_THRESHOLD && toolResultStore) {
      const stored = toolResultStore.create({
        resultRef: `tr_${Date.now()}`,
        toolCallId: context.toolCallId,
        toolName: 'transcript.search',
        userId: context.userId,
        sessionId: context.sessionId,
        preview: preview,
        structuredContent: result,
        sensitivity: 'medium',
      });
      resultRef = stored.resultRef;
      preview += ` (preview - full results stored with ref: ${resultRef})`;
    }

    return {
      success: true,
      data: result,
      resultPreview: preview,
      resultRef,
      structuredContent: result,
    };
  };

  return {
    name: 'transcript.search',
    description: 'Search transcript records for matching content',
    category: 'search',
    sensitivity: 'medium',
    schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query string' },
        sessionId: { type: 'string', description: 'Optional session ID to limit search scope' },
        limit: { type: 'number', description: 'Maximum number of results to return' },
      },
      required: ['query'],
    },
    handler,
  };
}
