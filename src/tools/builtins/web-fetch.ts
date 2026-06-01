/**
 * Web Fetch Tool - Safe URL Fetcher
 * 
 * Fetches content from URLs with safety validation, redirect handling,
 * and HTML-to-text/markdown conversion.
 */

import type { ToolDefinition, ToolHandler, ToolExecutionResult } from '../types.js';
import type { ToolExecutionContext } from '../types.js';
import {
  validateUrlSafety,
  validateRedirectSafety,
  validateTimeout,
  truncateResponse,
  exceedsSizeLimit,
  WEB_FETCH_MAX_RESPONSE_BYTES,
} from './web-safety.js';

export interface WebFetchParams {
  url: string;
  format?: 'text' | 'markdown';
  timeoutMs?: number;
}

export interface WebFetchResult {
  url: string;
  finalUrl: string;
  status: number;
  contentType: string;
  bytes: number;
  content: string;
  truncated: boolean;
}

function htmlToText(html: string, format: 'text' | 'markdown'): string {
  let result = html;

  result = result.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  result = result.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  result = result.replace(/<!--[\s\S]*?-->/g, '');

  if (format === 'markdown') {
    result = result.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '# $1\n\n');
    result = result.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '## $1\n\n');
    result = result.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '### $1\n\n');
    result = result.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, '#### $1\n\n');
    result = result.replace(/<h5[^>]*>([\s\S]*?)<\/h5>/gi, '##### $1\n\n');
    result = result.replace(/<h6[^>]*>([\s\S]*?)<\/h6>/gi, '###### $1\n\n');
  } else {
    result = result.replace(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi, '\n$1\n\n');
  }

  if (format === 'markdown') {
    result = result.replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)');
  } else {
    result = result.replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '$2 ($1)');
  }

  result = result.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '$1\n\n');
  result = result.replace(/<br\s*\/?>/gi, '\n');

  if (format === 'markdown') {
    result = result.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '- $1\n');
  } else {
    result = result.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '• $1\n');
  }
  result = result.replace(/<\/?[ou]l[^>]*>/gi, '\n');

  result = result.replace(/<\/?div[^>]*>/gi, '\n');
  result = result.replace(/<\/?section[^>]*>/gi, '\n');

  if (format === 'markdown') {
    result = result.replace(/<(strong|b)[^>]*>([\s\S]*?)<\/(strong|b)>/gi, '**$2**');
    result = result.replace(/<(em|i)[^>]*>([\s\S]*?)<\/(em|i)>/gi, '*$2*');
  } else {
    result = result.replace(/<(strong|b)[^>]*>([\s\S]*?)<\/(strong|b)>/gi, '$2');
    result = result.replace(/<(em|i)[^>]*>([\s\S]*?)<\/(em|i)>/gi, '$2');
  }

  if (format === 'markdown') {
    result = result.replace(/<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi, '\n```\n$1\n```\n');
    result = result.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`');
  } else {
    result = result.replace(/<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi, '\n$1\n');
    result = result.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '$1');
  }

  result = result.replace(/<[^>]+>/g, '');

  result = result
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");

  result = result
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n/g, '\n\n')
    .replace(/^\s+/, '')
    .replace(/\s+$/, '');

  return result;
}

function isHtmlContentType(contentType: string): boolean {
  return contentType.includes('text/html') || contentType.includes('application/xhtml+xml');
}

async function fetchWithSafety(
  url: string,
  timeoutMs: number,
  maxRedirects: number = 10
): Promise<{
  response: Response;
  finalUrl: string;
  redirectChain: string[];
}> {
  const redirectChain: string[] = [];
  let currentUrl = url;
  let redirectCount = 0;

  while (redirectCount <= maxRedirects) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      response = await fetch(currentUrl, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; WebFetchTool/1.0)',
          'Accept': 'text/html,application/xhtml+xml,text/plain,text/markdown,*/*',
        },
      });
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('Request timeout');
      }
      throw error;
    }

    clearTimeout(timeoutId);

    const redirectStatus = [301, 302, 303, 307, 308];
    if (redirectStatus.includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) {
        throw new Error(`Redirect response (${response.status}) missing Location header`);
      }

      const redirectUrl = new URL(location, currentUrl).href;

      const redirectCheck = validateRedirectSafety(currentUrl, redirectUrl);
      if (!redirectCheck.safe) {
        throw new Error(`Redirect blocked: ${redirectCheck.error?.message}`);
      }

      redirectChain.push(currentUrl);
      currentUrl = redirectUrl;
      redirectCount++;

      if (redirectCount > maxRedirects) {
        throw new Error('Too many redirects');
      }

      continue;
    }

    return { response, finalUrl: currentUrl, redirectChain };
  }

  throw new Error('Too many redirects');
}

export function createWebFetchTool(): ToolDefinition {
  const handler: ToolHandler = async (
    params: unknown,
    _context: ToolExecutionContext
  ): Promise<ToolExecutionResult> => {
    const typedParams = params as WebFetchParams;

    if (!typedParams.url || typeof typedParams.url !== 'string') {
      return {
        success: false,
        error: {
          code: 'INVALID_URL',
          message: 'URL parameter is required and must be a string',
          recoverable: true,
        },
      };
    }

    const safetyCheck = validateUrlSafety(typedParams.url);
    if (!safetyCheck.safe) {
      return {
        success: false,
        error: {
          code: safetyCheck.error?.code ?? 'URL_UNSAFE',
          message: safetyCheck.error?.message ?? 'URL validation failed',
          recoverable: true,
        },
      };
    }

    const timeoutMs = validateTimeout(typedParams.timeoutMs);
    const format = typedParams.format ?? 'markdown';

    try {
      const { response, finalUrl } = await fetchWithSafety(safetyCheck.normalizedUrl!, timeoutMs);

      const contentType = response.headers.get('content-type') ?? 'application/octet-stream';

      const contentLength = response.headers.get('content-length');
      if (contentLength) {
        const size = parseInt(contentLength, 10);
        if (exceedsSizeLimit(size)) {
          return {
            success: false,
            error: {
              code: 'RESPONSE_TOO_LARGE',
              message: `Response size (${size} bytes) exceeds maximum allowed (${WEB_FETCH_MAX_RESPONSE_BYTES} bytes)`,
              recoverable: false,
            },
          };
        }
      }

      const reader = response.body?.getReader();
      if (!reader) {
        return {
          success: false,
          error: {
            code: 'NO_RESPONSE_BODY',
            message: 'Response has no body',
            recoverable: false,
          },
        };
      }

      const chunks: Uint8Array[] = [];
      let totalBytes = 0;
      let truncated = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        totalBytes += value.length;

        if (exceedsSizeLimit(totalBytes)) {
          truncated = true;
          break;
        }

        chunks.push(value);
      }

      const combinedArray = new Uint8Array(totalBytes);
      let offset = 0;
      for (const chunk of chunks) {
        combinedArray.set(chunk, offset);
        offset += chunk.length;
      }

      const decoder = new TextDecoder('utf-8');
      let content = decoder.decode(combinedArray);

      if (isHtmlContentType(contentType)) {
        content = htmlToText(content, format);
      }

      const truncatedContent = truncateResponse(content);
      if (truncatedContent !== content) {
        truncated = true;
      }

      const result: WebFetchResult = {
        url: typedParams.url,
        finalUrl,
        status: response.status,
        contentType,
        bytes: totalBytes,
        content: truncatedContent,
        truncated,
      };

      return {
        success: true,
        data: result,
        resultPreview: `Fetched ${totalBytes} bytes from ${finalUrl} (status: ${response.status})`,
        structuredContent: result as unknown as Record<string, unknown>,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      if (errorMessage.includes('timeout')) {
        return {
          success: false,
          error: {
            code: 'TIMEOUT',
            message: `Request timed out after ${timeoutMs}ms`,
            recoverable: true,
          },
        };
      }

      if (errorMessage.includes('Redirect blocked')) {
        return {
          success: false,
          error: {
            code: 'REDIRECT_BLOCKED',
            message: errorMessage,
            recoverable: false,
          },
        };
      }

      if (errorMessage.includes('Too many redirects')) {
        return {
          success: false,
          error: {
            code: 'TOO_MANY_REDIRECTS',
            message: 'Exceeded maximum number of redirects (10)',
            recoverable: false,
          },
        };
      }

      return {
        success: false,
        error: {
          code: 'FETCH_FAILED',
          message: errorMessage,
          recoverable: true,
        },
      };
    }
  };

  return {
    name: 'web_fetch',
    description: 'Fetch content from a URL with safety validation and HTML-to-text conversion',
    category: 'read',
    sensitivity: 'medium',
    schema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The URL to fetch (must be http or https)',
        },
        format: {
          type: 'string',
          enum: ['text', 'markdown'],
          description: 'Output format for HTML content (default: markdown)',
        },
        timeoutMs: {
          type: 'number',
          description: 'Request timeout in milliseconds (default: 10000, max: 30000)',
        },
      },
      required: ['url'],
    },
    handler,
  };
}