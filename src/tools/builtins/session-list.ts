import type { ToolDefinition, ToolHandler, ToolExecutionResult } from '../types.js';
import type { SessionStore } from '../../storage/session-store.js';
import type { ToolExecutionContext } from '../types.js';
import {
  SESSION_LIST_DEFAULT_LIMIT,
  SESSION_LIST_MAX_LIMIT,
} from './safe-paths.js';

export interface SessionListParams {
  status?: 'active' | 'archived' | 'closed';
  limit?: number;
  offset?: number;
}

export interface SessionListItem {
  sessionId: string;
  title: string;
  status: 'active' | 'archived' | 'closed';
  createdAt: string;
  updatedAt: string;
}

export interface SessionListResult {
  sessions: SessionListItem[];
  total: number;
  limit: number;
  offset: number;
}

export function createSessionListTool(sessionStore: SessionStore): ToolDefinition {
  const handler: ToolHandler = async (
    params: unknown,
    context: ToolExecutionContext
  ): Promise<ToolExecutionResult> => {
    const typedParams = params as SessionListParams;

    // Apply defaults and enforce limits
    const limit = Math.min(
      typedParams.limit ?? SESSION_LIST_DEFAULT_LIMIT,
      SESSION_LIST_MAX_LIMIT
    );
    const offset = typedParams.offset ?? 0;

    // Scope to current user only
    const sessions = sessionStore.list({
      userId: context.userId,
      status: typedParams.status,
      limit,
      offset,
    });

    // Get total count for pagination metadata
    const total = sessionStore.getCount({
      userId: context.userId,
      status: typedParams.status,
    });

    const result: SessionListResult = {
      sessions: sessions.map((s) => ({
        sessionId: s.sessionId,
        title: s.title,
        status: s.status,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
      })),
      total,
      limit,
      offset,
    };

    return {
      success: true,
      data: result,
      resultPreview: `Found ${result.sessions.length} session(s) for user`,
      structuredContent: result as unknown as Record<string, unknown>,
    };
  };

  return {
    name: 'session.list',
    description: 'List sessions for the current user with optional status filter and pagination',
    category: 'read',
    sensitivity: 'medium',
    schema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['active', 'archived', 'closed'],
          description: 'Filter by session status',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of sessions to return (default: 20, max: 100)',
        },
        offset: {
          type: 'number',
          description: 'Number of sessions to skip for pagination',
        },
      },
      required: [],
    },
    handler,
  };
}
