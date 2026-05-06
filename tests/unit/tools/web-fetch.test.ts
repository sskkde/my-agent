import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createWebFetchTool, type WebFetchParams, type WebFetchResult } from '../../../src/tools/builtins/web-fetch.js';
import type { ToolDefinition, ToolExecutionContext } from '../../../src/tools/types.js';
import {
  WEB_FETCH_MAX_RESPONSE_BYTES,
  WEB_FETCH_MAX_RETURNED_CHARS,
} from '../../../src/tools/builtins/web-safety.js';

describe('web.fetch tool', () => {
  let tool: ToolDefinition;
  const originalFetch = global.fetch;

  const createToolContext = (overrides: Partial<ToolExecutionContext> = {}): ToolExecutionContext => ({
    toolCallId: 'tc-001',
    toolName: 'web.fetch',
    userId: 'user-123',
    sessionId: 'session-001',
    permissionContext: {
      userId: 'user-123',
      sessionId: 'session-001',
      mode: 'ask_on_write',
      grants: [],
    },
    executionStartTime: new Date().toISOString(),
    stores: {
      toolExecutionStore: {
        updateStatus: () => {},
        saveResult: () => {},
      },
    },
    ...overrides,
  });

  const mockFetch = (response: { status?: number; body?: string; headers?: Headers }) => {
    const body = response.body ?? '';
    const encoder = new TextEncoder();
    const bytes = encoder.encode(body);

    global.fetch = vi.fn().mockResolvedValue({
      status: response.status ?? 200,
      headers: response.headers ?? new Headers({
        'content-type': 'text/html',
        'content-length': String(bytes.length),
      }),
      body: {
        getReader: () => ({
          read: vi.fn()
            .mockResolvedValueOnce({ done: false, value: bytes })
            .mockResolvedValueOnce({ done: true }),
        }),
      },
    } as unknown as Response);
  };

  beforeEach(() => {
    tool = createWebFetchTool();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.clearAllMocks();
  });

  describe('Tool Definition', () => {
    it('should have correct name and metadata', () => {
      expect(tool.name).toBe('web.fetch');
      expect(tool.category).toBe('read');
      expect(tool.sensitivity).toBe('medium');
    });

    it('should have required url parameter in schema', () => {
      expect(tool.schema.required).toContain('url');
    });

    it('should support format and timeoutMs optional parameters', () => {
      expect(tool.schema.properties.url).toBeDefined();
      expect(tool.schema.properties.format).toBeDefined();
      expect(tool.schema.properties.timeoutMs).toBeDefined();
    });
  });

  describe('Safe HTTPS Fetch', () => {
    it('should successfully fetch content from a safe HTTPS URL', async () => {
      mockFetch({
        body: '<html><body><h1>Hello World</h1><p>Test content</p></body></html>',
        headers: new Headers({ 'content-type': 'text/html' }),
      });

      const params: WebFetchParams = {
        url: 'https://example.com/page',
      };

      const result = await tool.handler(params, createToolContext());

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      const data = result.data as WebFetchResult;
      expect(data.status).toBe(200);
      expect(data.contentType).toContain('text/html');
      expect(data.content).toContain('Hello World');
      expect(data.content).toContain('Test content');
    });

    it('should convert HTML to markdown by default', async () => {
      mockFetch({
        body: '<html><body><h1>Title</h1><p>Paragraph</p><a href="https://example.com">Link</a></body></html>',
        headers: new Headers({ 'content-type': 'text/html' }),
      });

      const params: WebFetchParams = {
        url: 'https://example.com',
      };

      const result = await tool.handler(params, createToolContext());

      expect(result.success).toBe(true);
      const data = result.data as WebFetchResult;
      expect(data.content).toContain('# Title');
      expect(data.content).toContain('[Link](https://example.com)');
    });

    it('should convert HTML to plain text when format is text', async () => {
      mockFetch({
        body: '<html><body><h1>Title</h1><p>Paragraph</p><a href="https://example.com">Link</a></body></html>',
        headers: new Headers({ 'content-type': 'text/html' }),
      });

      const params: WebFetchParams = {
        url: 'https://example.com',
        format: 'text',
      };

      const result = await tool.handler(params, createToolContext());

      expect(result.success).toBe(true);
      const data = result.data as WebFetchResult;
      expect(data.content).toContain('Title');
      expect(data.content).toContain('Link (https://example.com)');
      expect(data.content).not.toContain('# Title');
    });

    it('should return plain text content unchanged', async () => {
      mockFetch({
        body: 'Plain text content',
        headers: new Headers({ 'content-type': 'text/plain' }),
      });

      const params: WebFetchParams = {
        url: 'https://example.com/file.txt',
      };

      const result = await tool.handler(params, createToolContext());

      expect(result.success).toBe(true);
      const data = result.data as WebFetchResult;
      expect(data.content).toBe('Plain text content');
    });

    it('should include finalUrl in result', async () => {
      mockFetch({
        body: 'Content',
        headers: new Headers({ 'content-type': 'text/plain' }),
      });

      const params: WebFetchParams = {
        url: 'https://example.com/page',
      };

      const result = await tool.handler(params, createToolContext());

      expect(result.success).toBe(true);
      const data = result.data as WebFetchResult;
      expect(data.finalUrl).toBe('https://example.com/page');
    });
  });

  describe('URL Safety Validation', () => {
    it('should block localhost URLs', async () => {
      const params: WebFetchParams = {
        url: 'http://localhost:3000/api',
      };

      const result = await tool.handler(params, createToolContext());

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('LOCALHOST_BLOCKED');
    });

    it('should block private IP addresses', async () => {
      const params: WebFetchParams = {
        url: 'http://192.168.1.1/admin',
      };

      const result = await tool.handler(params, createToolContext());

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('PRIVATE_IP');
    });

    it('should block 127.0.0.1 loopback', async () => {
      const params: WebFetchParams = {
        url: 'http://127.0.0.1:8080/test',
      };

      const result = await tool.handler(params, createToolContext());

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('PRIVATE_IP');
    });

    it('should block metadata endpoint 169.254.169.254', async () => {
      const params: WebFetchParams = {
        url: 'http://169.254.169.254/latest/meta-data/',
      };

      const result = await tool.handler(params, createToolContext());

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('PRIVATE_IP');
    });

    it('should block non-HTTP protocols', async () => {
      const params: WebFetchParams = {
        url: 'file:///etc/passwd',
      };

      const result = await tool.handler(params, createToolContext());

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('BLOCKED_PROTOCOL');
    });

    it('should block ftp protocol', async () => {
      const params: WebFetchParams = {
        url: 'ftp://example.com/file',
      };

      const result = await tool.handler(params, createToolContext());

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('BLOCKED_PROTOCOL');
    });

    it('should reject invalid URL format', async () => {
      const params: WebFetchParams = {
        url: 'not-a-valid-url',
      };

      const result = await tool.handler(params, createToolContext());

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('INVALID_URL');
    });

    it('should reject missing URL parameter', async () => {
      const params = {} as WebFetchParams;

      const result = await tool.handler(params, createToolContext());

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('INVALID_URL');
    });
  });

  describe('Redirect Handling', () => {
    it('should follow redirects and validate redirect target', async () => {
      const redirectUrl = 'https://example.org/new-location';
      
      global.fetch = vi.fn()
        .mockResolvedValueOnce({
          status: 301,
          headers: new Headers({
            'location': redirectUrl,
          }),
          body: null,
        } as unknown as Response)
        .mockResolvedValueOnce({
          status: 200,
          headers: new Headers({
            'content-type': 'text/plain',
            'content-length': '7',
          }),
          body: {
            getReader: () => ({
              read: vi.fn()
                .mockResolvedValueOnce({ done: false, value: new TextEncoder().encode('Success') })
                .mockResolvedValueOnce({ done: true }),
            }),
          },
        } as unknown as Response);

      const params: WebFetchParams = {
        url: 'https://example.com/old',
      };

      const result = await tool.handler(params, createToolContext());

      expect(result.success).toBe(true);
      const data = result.data as WebFetchResult;
      expect(data.finalUrl).toBe(redirectUrl);
      expect(data.content).toBe('Success');
    });

    it('should block redirect to localhost', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        status: 302,
        headers: new Headers({
          'location': 'http://localhost:8080/admin',
        }),
        body: null,
      } as unknown as Response);

      const params: WebFetchParams = {
        url: 'https://example.com/redirect',
      };

      const result = await tool.handler(params, createToolContext());

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('REDIRECT_BLOCKED');
    });

    it('should block redirect to private IP', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        status: 301,
        headers: new Headers({
          'location': 'http://192.168.1.1/internal',
        }),
        body: null,
      } as unknown as Response);

      const params: WebFetchParams = {
        url: 'https://example.com/redirect',
      };

      const result = await tool.handler(params, createToolContext());

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('REDIRECT_BLOCKED');
    });

    it('should fail on too many redirects', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        status: 302,
        headers: new Headers({
          'location': 'https://example.com/redirect',
        }),
        body: null,
      } as unknown as Response);

      global.fetch = mockFetch;

      const params: WebFetchParams = {
        url: 'https://example.com/start',
      };

      const result = await tool.handler(params, createToolContext());

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('TOO_MANY_REDIRECTS');
    });
  });

  describe('Timeout Handling', () => {
    it('should timeout on slow response', async () => {
      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';

      global.fetch = vi.fn().mockImplementation(() => {
        return new Promise((_, reject) => {
          setTimeout(() => reject(abortError), 100);
        });
      });

      const params: WebFetchParams = {
        url: 'https://example.com/slow',
        timeoutMs: 50,
      };

      const result = await tool.handler(params, createToolContext());

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('TIMEOUT');
    });
  });

  describe('Response Size Limits', () => {
    it('should reject response exceeding max size via Content-Length', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        status: 200,
        headers: new Headers({
          'content-type': 'text/plain',
          'content-length': String(WEB_FETCH_MAX_RESPONSE_BYTES + 1),
        }),
        body: null,
      } as unknown as Response);

      const params: WebFetchParams = {
        url: 'https://example.com/large',
      };

      const result = await tool.handler(params, createToolContext());

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('RESPONSE_TOO_LARGE');
    });

    it('should truncate content exceeding max returned chars', async () => {
      const longContent = 'x'.repeat(WEB_FETCH_MAX_RETURNED_CHARS + 1000);
      const encoder = new TextEncoder();
      const bytes = encoder.encode(longContent);

      global.fetch = vi.fn().mockResolvedValue({
        status: 200,
        headers: new Headers({
          'content-type': 'text/plain',
          'content-length': String(bytes.length),
        }),
        body: {
          getReader: () => ({
            read: vi.fn()
              .mockResolvedValueOnce({ done: false, value: bytes })
              .mockResolvedValueOnce({ done: true }),
          }),
        },
      } as unknown as Response);

      const params: WebFetchParams = {
        url: 'https://example.com/long',
      };

      const result = await tool.handler(params, createToolContext());

      expect(result.success).toBe(true);
      const data = result.data as WebFetchResult;
      expect(data.truncated).toBe(true);
      expect(data.content.length).toBeLessThanOrEqual(WEB_FETCH_MAX_RETURNED_CHARS + 20);
      expect(data.content).toContain('[...truncated...]');
    });
  });

  describe('HTML Conversion', () => {
    it('should strip script tags', async () => {
      mockFetch({
        body: '<html><body><script>alert("xss")</script><p>Safe content</p></body></html>',
        headers: new Headers({ 'content-type': 'text/html' }),
      });

      const params: WebFetchParams = {
        url: 'https://example.com',
      };

      const result = await tool.handler(params, createToolContext());

      expect(result.success).toBe(true);
      const data = result.data as WebFetchResult;
      expect(data.content).not.toContain('alert');
      expect(data.content).not.toContain('script');
      expect(data.content).toContain('Safe content');
    });

    it('should strip style tags', async () => {
      mockFetch({
        body: '<html><head><style>body { color: red; }</style></head><body><p>Content</p></body></html>',
        headers: new Headers({ 'content-type': 'text/html' }),
      });

      const params: WebFetchParams = {
        url: 'https://example.com',
      };

      const result = await tool.handler(params, createToolContext());

      expect(result.success).toBe(true);
      const data = result.data as WebFetchResult;
      expect(data.content).not.toContain('color: red');
      expect(data.content).toContain('Content');
    });

    it('should decode HTML entities', async () => {
      mockFetch({
        body: '<html><body><p>&amp; &lt; &gt; &quot; &#39;</p></body></html>',
        headers: new Headers({ 'content-type': 'text/html' }),
      });

      const params: WebFetchParams = {
        url: 'https://example.com',
      };

      const result = await tool.handler(params, createToolContext());

      expect(result.success).toBe(true);
      const data = result.data as WebFetchResult;
      expect(data.content).toContain('& < > " \'');
    });

    it('should convert lists to markdown format', async () => {
      mockFetch({
        body: '<html><body><ul><li>Item 1</li><li>Item 2</li></ul></body></html>',
        headers: new Headers({ 'content-type': 'text/html' }),
      });

      const params: WebFetchParams = {
        url: 'https://example.com',
        format: 'markdown',
      };

      const result = await tool.handler(params, createToolContext());

      expect(result.success).toBe(true);
      const data = result.data as WebFetchResult;
      expect(data.content).toContain('- Item 1');
      expect(data.content).toContain('- Item 2');
    });

    it('should convert code blocks to markdown', async () => {
      mockFetch({
        body: '<html><body><pre><code>const x = 1;</code></pre></body></html>',
        headers: new Headers({ 'content-type': 'text/html' }),
      });

      const params: WebFetchParams = {
        url: 'https://example.com',
        format: 'markdown',
      };

      const result = await tool.handler(params, createToolContext());

      expect(result.success).toBe(true);
      const data = result.data as WebFetchResult;
      expect(data.content).toContain('```');
      expect(data.content).toContain('const x = 1;');
    });
  });

  describe('Error Handling', () => {
    it('should handle network errors', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      const params: WebFetchParams = {
        url: 'https://example.com/error',
      };

      const result = await tool.handler(params, createToolContext());

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('FETCH_FAILED');
      expect(result.error?.message).toContain('Network error');
    });

    it('should handle missing response body', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        status: 204,
        headers: new Headers({
          'content-type': 'text/plain',
        }),
        body: null,
      } as unknown as Response);

      const params: WebFetchParams = {
        url: 'https://example.com/no-content',
      };

      const result = await tool.handler(params, createToolContext());

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('NO_RESPONSE_BODY');
    });
  });
});
