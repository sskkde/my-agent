import type {
  HttpTransportConfig,
  HttpTransportRequest,
  HttpTransportResponse,
  HttpTransportErrorType,
  IHttpTransport,
} from './base-http-transport-types.js';

export type { HttpTransportError } from './base-http-transport-types.js';
export type { HttpTransportErrorType as HttpTransportError_ } from './base-http-transport-types.js';

const DEFAULT_TIMEOUT = 30000;
const DEFAULT_RETRIES = 3;
const DEFAULT_RETRY_DELAY = 1000;

export interface BaseHttpTransportOptions {
  apiKeyInQuery?: boolean;
}

export class TransportError extends Error {
  type: HttpTransportErrorType;
  statusCode?: number;
  retryable: boolean;

  constructor(type: HttpTransportErrorType, message: string, opts: { statusCode?: number; retryable: boolean }) {
    super(message);
    this.name = 'TransportError';
    this.type = type;
    this.statusCode = opts.statusCode;
    this.retryable = opts.retryable;
  }
}

export class BaseHttpTransport implements IHttpTransport {
  private readonly baseURL: string;
  private readonly timeout: number;
  private readonly retries: number;
  private readonly retryDelay: number;
  private readonly defaultHeaders: Record<string, string>;
  private readonly auth?: HttpTransportConfig['auth'];
  private readonly apiKeyInQuery: boolean;

  constructor(config: HttpTransportConfig, options?: BaseHttpTransportOptions) {
    this.baseURL = config.baseURL.replace(/\/+$/, '');
    this.timeout = config.timeout ?? DEFAULT_TIMEOUT;
    this.retries = config.retries ?? DEFAULT_RETRIES;
    this.retryDelay = config.retryDelay ?? DEFAULT_RETRY_DELAY;
    this.defaultHeaders = { ...config.headers };
    this.auth = config.auth;
    this.apiKeyInQuery = options?.apiKeyInQuery ?? false;
  }

  async request<T>(req: HttpTransportRequest): Promise<HttpTransportResponse<T>> {
    const url = this.buildUrl(req.path, req.params);
    const headers = this.buildHeaders(req.headers, req.method, req.body);
    const body = this.serializeBody(req.body);

    let lastError: TransportError | undefined;
    const maxAttempts = 1 + this.retries;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (attempt > 0) {
        await this.delay(attempt);
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const startTime = Date.now();

      try {
        const response = await fetch(url, {
          method: req.method,
          headers,
          body,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);
        const duration = Date.now() - startTime;
        const responseHeaders = this.extractHeaders(response.headers);

        if (response.ok) {
          const parsedBody = await this.parseResponseBody<T>(response);
          return {
            status: response.status,
            headers: responseHeaders,
            body: parsedBody,
            duration,
          };
        }

        const error = this.classifyError(response.status, responseHeaders);

        if (!error.retryable || attempt >= this.retries) {
          throw new TransportError(error.type, error.message, {
            statusCode: response.status,
            retryable: error.retryable,
          });
        }

        lastError = new TransportError(error.type, error.message, {
          statusCode: response.status,
          retryable: error.retryable,
        });
      } catch (err) {
        clearTimeout(timeoutId);

        if (err instanceof TransportError) {
          if (!err.retryable || attempt >= this.retries) {
            throw err;
          }
          lastError = err;
          continue;
        }

        const classified = this.classifyFetchError(err);
        if (!classified.retryable || attempt >= this.retries) {
          throw new TransportError(classified.type, classified.message, {
            retryable: classified.retryable,
          });
        }
        lastError = new TransportError(classified.type, classified.message, {
          retryable: classified.retryable,
        });
      }
    }

    throw lastError ?? new TransportError('network', 'Request failed after retries', { retryable: false });
  }

  async get<T>(path: string, params?: Record<string, string>): Promise<HttpTransportResponse<T>> {
    return this.request<T>({ method: 'GET', path, params });
  }

  async post<T>(path: string, body?: unknown): Promise<HttpTransportResponse<T>> {
    return this.request<T>({ method: 'POST', path, body });
  }

  async put<T>(path: string, body?: unknown): Promise<HttpTransportResponse<T>> {
    return this.request<T>({ method: 'PUT', path, body });
  }

  async patch<T>(path: string, body?: unknown): Promise<HttpTransportResponse<T>> {
    return this.request<T>({ method: 'PATCH', path, body });
  }

  async delete<T>(path: string): Promise<HttpTransportResponse<T>> {
    return this.request<T>({ method: 'DELETE', path });
  }

  private buildUrl(path: string, params?: Record<string, string>): string {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    let url = `${this.baseURL}${normalizedPath}`;

    const allParams = new URLSearchParams();

    if (this.apiKeyInQuery && this.auth?.type === 'api_key') {
      allParams.set('api_key', this.auth.credentials);
    }

    if (params) {
      for (const [key, value] of Object.entries(params)) {
        allParams.set(key, value);
      }
    }

    const queryString = allParams.toString();
    if (queryString) {
      const separator = url.includes('?') ? '&' : '?';
      url = `${url}${separator}${queryString}`;
    }

    return url;
  }

  private buildHeaders(
    requestHeaders?: Record<string, string>,
    method?: string,
    body?: unknown
  ): Record<string, string> {
    const headers: Record<string, string> = { ...this.defaultHeaders };

    if (body !== undefined && method !== 'GET' && method !== 'DELETE') {
      headers['Content-Type'] = 'application/json';
    }

    if (this.auth) {
      const authHeader = this.buildAuthHeader();
      if (authHeader) {
        Object.assign(headers, authHeader);
      }
    }

    if (requestHeaders) {
      Object.assign(headers, requestHeaders);
    }

    return headers;
  }

  private buildAuthHeader(): Record<string, string> | null {
    if (!this.auth) return null;

    switch (this.auth.type) {
      case 'bearer':
        return { Authorization: `Bearer ${this.auth.credentials}` };
      case 'oauth2':
        return { Authorization: `Bearer ${this.auth.credentials}` };
      case 'basic': {
        const encoded = btoa(this.auth.credentials);
        return { Authorization: `Basic ${encoded}` };
      }
      case 'api_key':
        if (!this.apiKeyInQuery) {
          return { 'X-API-Key': this.auth.credentials };
        }
        return null;
      default:
        return null;
    }
  }

  private serializeBody(body: unknown): string | undefined {
    if (body === undefined) return undefined;
    return JSON.stringify(body);
  }

  private async parseResponseBody<T>(response: Response): Promise<T | undefined> {
    const contentType = response.headers.get('content-type') ?? '';

    if (response.status === 204 || response.headers.get('content-length') === '0') {
      return undefined;
    }

    if (contentType.includes('application/json')) {
      try {
        const text = await response.text();
        if (!text) return undefined;
        return JSON.parse(text) as T;
      } catch {
        throw new TransportError('parse', 'Failed to parse JSON response', { retryable: false });
      }
    }

    if (contentType.startsWith('text/')) {
      return (await response.text()) as T;
    }

    try {
      const text = await response.text();
      if (!text) return undefined;
      return JSON.parse(text) as T;
    } catch {
      return (await response.text()) as T;
    }
  }

  private extractHeaders(headers: Headers): Record<string, string> {
    const result: Record<string, string> = {};
    headers.forEach((value, key) => {
      result[key] = value;
    });
    return result;
  }

  private classifyError(statusCode: number, _headers: Record<string, string>): { type: HttpTransportErrorType; message: string; retryable: boolean } {
    if (statusCode === 401 || statusCode === 403) {
      return { type: 'auth', message: `Authentication error: ${statusCode}`, retryable: false };
    }

    if (statusCode === 429) {
      return { type: 'rate_limit', message: 'Rate limit exceeded', retryable: true };
    }

    if (statusCode >= 400 && statusCode < 500) {
      return { type: 'auth', message: `Client error: ${statusCode}`, retryable: false };
    }

    if (statusCode >= 500) {
      return { type: 'server', message: `Server error: ${statusCode}`, retryable: true };
    }

    return { type: 'network', message: `Unexpected status: ${statusCode}`, retryable: true };
  }

  private classifyFetchError(err: unknown): { type: HttpTransportErrorType; message: string; retryable: boolean } {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return { type: 'timeout', message: `Request timed out after ${this.timeout}ms`, retryable: true };
    }

    if (err instanceof TypeError) {
      return { type: 'network', message: err.message, retryable: true };
    }

    return { type: 'network', message: err instanceof Error ? err.message : 'Unknown network error', retryable: true };
  }

  private delay(attempt: number): Promise<void> {
    const baseDelay = this.retryDelay * Math.pow(2, attempt - 1);
    const jitter = Math.random() * baseDelay * 0.1;
    return new Promise((resolve) => setTimeout(resolve, baseDelay + jitter));
  }
}

export function createBaseHttpTransport(config: HttpTransportConfig, options?: BaseHttpTransportOptions): BaseHttpTransport {
  return new BaseHttpTransport(config, options);
}
