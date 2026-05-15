import type {
  ConnectorAdapter,
  ConnectorCapability,
  ConnectorCallRequest,
  ConnectorResponse,
} from '../types.js';
import type { ConnectorInstance } from '../../storage/connector-store.js';
import { validateUrl } from './url-validator.js';

export interface RealWebConnectorConfig {
  fetchImpl?: typeof fetch;
  timeout?: number;
}

export interface WebFetchParams {
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers?: Record<string, string>;
  body?: unknown;
}

const DEFAULT_TIMEOUT = 30000;

export class RealWebConnectorAdapter implements ConnectorAdapter {
  private readonly fetchImpl: typeof fetch;
  private readonly timeout: number;

  constructor(config: RealWebConnectorConfig = {}) {
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch;
    this.timeout = config.timeout ?? DEFAULT_TIMEOUT;
  }

  async execute(
    _instance: ConnectorInstance,
    request: ConnectorCallRequest
  ): Promise<unknown> {
    const { operation, params } = request;
    const typedParams = params as unknown as WebFetchParams;

    switch (operation) {
      case 'web_fetch':
        return this.webFetch(typedParams, request);
      case 'web_post':
        return this.webFetch({ ...typedParams, method: 'POST' }, request);
      default:
        throw new Error(`Unknown operation: ${operation}`);
    }
  }

  private async webFetch(
    params: WebFetchParams,
    request: ConnectorCallRequest
  ): Promise<ConnectorResponse> {
    const { url, method = 'GET', headers = {}, body } = params;

    const urlValidation = validateUrl(url);
    if (!urlValidation.valid) {
      const errorCode = urlValidation.blockedReason === 'private_ip' 
        ? 'BLOCKED_PRIVATE_IP' 
        : 'INVALID_URL';
      
      return {
        status: 'failed',
        requestId: request.requestId,
        connectorInstanceId: request.connectorInstanceId,
        error: {
          code: errorCode,
          message: urlValidation.error ?? 'URL validation failed',
          recoverable: false,
        },
      };
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const fetchHeaders: Record<string, string> = {
        'User-Agent': 'Mozilla/5.0 (compatible; AgentPlatform/1.0)',
        ...headers,
      };

      const fetchOptions: RequestInit = {
        method,
        headers: fetchHeaders,
        signal: controller.signal,
      };

      if (body !== undefined && method !== 'GET' && method !== 'DELETE') {
        fetchOptions.body = typeof body === 'string' ? body : JSON.stringify(body);
        if (!fetchHeaders['Content-Type']) {
          fetchHeaders['Content-Type'] = 'application/json';
        }
      }

      const response = await this.fetchImpl(url, fetchOptions);
      clearTimeout(timeoutId);

      if (!response.ok) {
        return {
          status: 'failed',
          requestId: request.requestId,
          connectorInstanceId: request.connectorInstanceId,
          error: {
            code: 'HTTP_ERROR',
            message: `HTTP ${response.status}: ${response.statusText}`,
            recoverable: response.status >= 500 || response.status === 429,
          },
        };
      }

      const contentType = response.headers.get('content-type') ?? '';
      let data: unknown;

      if (contentType.includes('application/json')) {
        data = await response.json();
      } else if (contentType.startsWith('text/')) {
        data = await response.text();
      } else {
        const text = await response.text();
        try {
          data = JSON.parse(text);
        } catch {
          data = text;
        }
      }

      return {
        status: 'success',
        requestId: request.requestId,
        connectorInstanceId: request.connectorInstanceId,
        data,
      };
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof Error && error.name === 'AbortError') {
        return {
          status: 'timeout',
          requestId: request.requestId,
          connectorInstanceId: request.connectorInstanceId,
          error: {
            code: 'TIMEOUT',
            message: `Request timed out after ${this.timeout}ms`,
            recoverable: true,
          },
        };
      }

      return {
        status: 'failed',
        requestId: request.requestId,
        connectorInstanceId: request.connectorInstanceId,
        error: {
          code: 'NETWORK_ERROR',
          message: error instanceof Error ? error.message : 'Unknown network error',
          recoverable: true,
        },
      };
    }
  }

  discoverCapabilities(_instance: ConnectorInstance): ConnectorCapability[] {
    return [
      {
        capabilityId: 'web.web_fetch',
        name: 'Web Fetch',
        description: 'Fetch content from a URL using HTTP GET',
        category: 'read',
        riskLevel: 'low',
        inputSchema: {
          url: { type: 'string', required: true, description: 'URL to fetch' },
          method: { type: 'string', description: 'HTTP method (GET, POST, PUT, DELETE)' },
          headers: { type: 'object', description: 'Custom headers' },
          body: { type: 'object', description: 'Request body for POST/PUT' },
        },
        requiresAuth: false,
        supportedOperations: ['web_fetch'],
      },
      {
        capabilityId: 'web.web_post',
        name: 'Web POST',
        description: 'Send data to a URL using HTTP POST',
        category: 'write',
        riskLevel: 'medium',
        inputSchema: {
          url: { type: 'string', required: true, description: 'URL to POST to' },
          headers: { type: 'object', description: 'Custom headers' },
          body: { type: 'object', required: true, description: 'Request body' },
        },
        requiresAuth: false,
        supportedOperations: ['web_post'],
      },
    ];
  }

  checkHealth(_instance: ConnectorInstance): { healthy: boolean; message?: string } {
    return { healthy: true, message: 'Web connector is healthy' };
  }
}

export function createRealWebConnectorAdapter(config?: RealWebConnectorConfig): RealWebConnectorAdapter {
  return new RealWebConnectorAdapter(config);
}
