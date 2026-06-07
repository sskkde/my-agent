import type { ToolDefinition, ToolRegistry } from '../types.js'

export interface BuiltinToolDeps {
  webSearchExecutor?: (params: { query: string; maxResults?: number }) => Promise<unknown>
}

export function createWebSearchTool(deps: BuiltinToolDeps): ToolDefinition {
  return {
    name: 'web_search',
    description: 'Search the web',
    category: 'search',
    sensitivity: 'medium',
    schema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        maxResults: { type: 'number' },
      },
      required: ['query'],
      additionalProperties: false,
    },
    idempotent: true,
    handler: async (params) => {
      const { query, maxResults } = params as { query: string; maxResults?: number }
      if (!query || typeof query !== 'string') {
        return {
          success: false,
          error: {
            code: 'INVALID_PARAMS',
            message: 'query is required',
            recoverable: false,
          },
        }
      }
      if (!deps.webSearchExecutor) {
        return {
          success: false,
          error: {
            code: 'WEB_SEARCH_NOT_CONFIGURED',
            message: 'Web search executor not configured',
            recoverable: false,
          },
        }
      }
      try {
        const result: any = await deps.webSearchExecutor({ query, maxResults })
        return {
          success: true,
          data: result,
        }
      } catch (err: any) {
        return {
          success: false,
          error: {
            code: 'EXECUTION_FAILED',
            message: err?.message || String(err),
            recoverable: false,
          },
        }
      }
    },
  }
}

export function createWebFetchTool(): ToolDefinition {
  return {
    name: 'web_fetch',
    description: 'Fetch the contents of a web page',
    category: 'read',
    sensitivity: 'medium',
    schema: {
      type: 'object',
      properties: {
        url: { type: 'string' },
        maxBytes: { type: 'number' },
      },
      required: ['url'],
      additionalProperties: false,
    },
    idempotent: true,
    handler: async (params) => {
      const { url, maxBytes } = params as { url: string; maxBytes?: number }
      if (!url || typeof url !== 'string') {
        return {
          success: false,
          error: {
            code: 'INVALID_PARAMS',
            message: 'url is required',
            recoverable: false,
          },
        }
      }
      try {
        const parsed = new URL(url)
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          return {
            success: false,
            error: {
              code: 'INVALID_URL',
              message: 'Only http and https URLs are allowed',
              recoverable: false,
            },
          }
        }
        const bytesLimit = typeof maxBytes === 'number' ? maxBytes : 12000
        const response = await fetch(url)
        const text = await response.text()
        const truncated = text.length > bytesLimit
        const preview = truncated ? text.slice(0, bytesLimit) : text
        return {
          success: true,
          data: {
            url,
            status: response.status,
            contentType: response.headers.get('content-type'),
            textPreview: preview,
            truncated,
          },
          resultPreview: preview,
        }
      } catch (err: any) {
        return {
          success: false,
          error: {
            code: 'EXECUTION_FAILED',
            message: err?.message || String(err),
            recoverable: false,
          },
        }
      }
    },
  }
}

export function registerBuiltinTools(registry: ToolRegistry, deps: BuiltinToolDeps): void {
  registry.register(createWebSearchTool(deps))
  registry.register(createWebFetchTool())
}
