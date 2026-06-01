import type { ToolDefinition, ToolHandler, ToolExecutionResult } from '../types.js';
import type { SessionStore } from '../../storage/session-store.js';
import type { TranscriptStore, TurnTranscript } from '../../storage/transcript-store.js';
import type { ToolExecutionContext } from '../types.js';
import {
  SESSION_HISTORY_DEFAULT_LIMIT,
  SESSION_HISTORY_MAX_LIMIT,
} from './safe-paths.js';

export interface SessionHistoryParams {
  sessionId: string;
  limit?: number;
  offset?: number;
}

export interface HistoryMessage {
  turnId: string;
  role: 'user' | 'assistant' | 'tool' | 'thinking' | 'system_status' | 'approval' | 'artifact' | 'error';
  summaryOrContent: string;
  createdAt: string;
}

export interface SessionHistoryResult {
  sessionId: string;
  messages: HistoryMessage[];
  total: number;
  limit: number;
  offset: number;
  truncated: boolean;
}

function extractSummaryOrContent(turn: TurnTranscript): string {
  // Prefer user message summary for user turns
  if (turn.input.userMessageSummary) {
    return turn.input.userMessageSummary;
  }

  // Extract first visible message content as fallback
  const firstVisible = turn.output.visibleMessages[0];
  if (firstVisible) {
    // Truncate long content for v1
    const maxLen = 500;
    if (firstVisible.content.length > maxLen) {
      return firstVisible.content.slice(0, maxLen) + '...';
    }
    return firstVisible.content;
  }

  return '(no content)';
}

export function createSessionHistoryTool(
  sessionStore: SessionStore,
  transcriptStore: TranscriptStore
): ToolDefinition {
  const handler: ToolHandler = async (
    params: unknown,
    context: ToolExecutionContext
  ): Promise<ToolExecutionResult> => {
    const typedParams = params as SessionHistoryParams;

    if (!typedParams.sessionId) {
      return {
        success: false,
        error: {
          code: 'MISSING_SESSION_ID',
          message: 'sessionId is required',
          recoverable: true,
        },
      };
    }

    // Verify session belongs to current user - prevent cross-user access
    const session = sessionStore.getById(typedParams.sessionId);
    if (!session) {
      return {
        success: false,
        error: {
          code: 'SESSION_NOT_FOUND',
          message: 'Session not found',
          recoverable: false,
        },
      };
    }

    if (session.userId !== context.userId) {
      return {
        success: false,
        error: {
          code: 'ACCESS_DENIED',
          message: 'Cannot access another user\'s session',
          recoverable: false,
        },
      };
    }

    // Apply defaults and enforce limits
    const limit = Math.min(
      typedParams.limit ?? SESSION_HISTORY_DEFAULT_LIMIT,
      SESSION_HISTORY_MAX_LIMIT
    );
    const offset = typedParams.offset ?? 0;

    // Fetch transcripts for the session
    const transcripts = transcriptStore.findBySession(typedParams.sessionId, {
      limit,
      offset,
    });

    // Get total count (approximate - use messageCount from session)
    const total = session.messageCount;

    // Build history messages from transcripts
    const messages: HistoryMessage[] = [];
    for (const turn of transcripts) {
      // Use first visible message role as turn role
      const firstVisible = turn.output.visibleMessages[0];
      const role = firstVisible?.role ?? 'user';

      messages.push({
        turnId: turn.turnId,
        role,
        summaryOrContent: extractSummaryOrContent(turn),
        createdAt: turn.createdAt,
      });
    }

    const truncated = total > limit + offset;

    const result: SessionHistoryResult = {
      sessionId: typedParams.sessionId,
      messages,
      total,
      limit,
      offset,
      truncated,
    };

    return {
      success: true,
      data: result,
      resultPreview: `Retrieved ${messages.length} message(s) from session${truncated ? ' (truncated)' : ''}`,
      structuredContent: result as unknown as Record<string, unknown>,
    };
  };

  return {
    name: 'session_history',
    description: 'Retrieve message history for a session with pagination and truncation',
    category: 'read',
    sensitivity: 'medium',
    schema: {
      type: 'object',
      properties: {
        sessionId: {
          type: 'string',
          description: 'Session ID to retrieve history for',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of messages to return (default: 50, max: 200)',
        },
        offset: {
          type: 'number',
          description: 'Number of messages to skip for pagination',
        },
      },
      required: ['sessionId'],
    },
    handler,
  };
}