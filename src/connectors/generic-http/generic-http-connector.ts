import type {
  ConnectorAdapter,
  ConnectorCapability,
  ConnectorCallRequest,
} from '../types.js';
import type { ConnectorInstance } from '../../storage/connector-store.js';
import type {
  GenericHttpConfig,
  RequestTemplate,
  GenericHttpAuth,
} from './generic-http-types.js';
import { BaseHttpTransport, TransportError } from '../base-http-transport.js';
import type { HttpTransportConfig, HttpTransportAuth } from '../base-http-transport-types.js';
import { parseOpenApiSpec } from './openapi-parser.js';

const PLACEHOLDER_PATTERN = /\{\{(\w+)\}\}/g;

function replacePlaceholders(
  template: string,
  params: Record<string, unknown>,
): string {
  return template.replace(PLACEHOLDER_PATTERN, (_match, key: string) => {
    const value = params[key];
    return value !== undefined ? String(value) : `{{${key}}}`;
  });
}

function replaceBodyPlaceholders(
  body: Record<string, unknown>,
  params: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (typeof value === 'string') {
      result[key] = replacePlaceholders(value, params);
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      result[key] = replaceBodyPlaceholders(value as Record<string, unknown>, params);
    } else if (Array.isArray(value)) {
      result[key] = value.map((item) => {
        if (typeof item === 'string') return replacePlaceholders(item, params);
        if (typeof item === 'object' && item !== null) {
          return replaceBodyPlaceholders(item as Record<string, unknown>, params);
        }
        return item;
      });
    } else {
      result[key] = value;
    }
  }
  return result;
}

function extractByJsonPath(data: unknown, jsonPath: string): unknown {
  if (data === null || data === undefined) return undefined;

  const segments = jsonPath.split('.');
  let current: unknown = data;

  for (const segment of segments) {
    if (current === null || current === undefined) return undefined;
    if (typeof current === 'object' && segment in (current as Record<string, unknown>)) {
      current = (current as Record<string, unknown>)[segment];
    } else {
      return undefined;
    }
  }

  return current;
}

function toTransportAuth(auth: GenericHttpAuth): HttpTransportAuth {
  switch (auth.type) {
    case 'bearer':
      return { type: 'bearer', credentials: auth.credentials.token ?? '' };
    case 'api_key':
      return { type: 'api_key', credentials: auth.credentials.api_key ?? auth.credentials.key ?? '' };
    case 'basic': {
      const username = auth.credentials.username ?? '';
      const password = auth.credentials.password ?? '';
      return { type: 'basic', credentials: `${username}:${password}` };
    }
    case 'oauth2':
      return { type: 'oauth2', credentials: auth.credentials.access_token ?? '' };
  }
}

function isMockMode(): boolean {
  return process.env.GENERIC_HTTP_MOCK_MODE === 'true';
}

function resolveConfig(instance: ConnectorInstance): GenericHttpConfig {
  const raw = instance.config;
  if (!raw) {
    throw new Error('Generic HTTP connector instance has no config');
  }

  const config = raw as unknown as GenericHttpConfig;

  if (config.openApiImport?.specObject) {
    const parsed = parseOpenApiSpec(config.openApiImport.specObject);
    const merged: GenericHttpConfig = {
      ...parsed.config,
      ...config,
      requestTemplates: [
        ...(config.requestTemplates ?? []),
        ...parsed.config.requestTemplates,
      ],
    };
    if (config.openApiImport.basePathOverride) {
      merged.baseURL = config.openApiImport.basePathOverride;
    }
    return merged;
  }

  return config;
}

const MOCK_RESPONSES: Record<string, unknown> = {
  GET: { status: 'ok', data: [], mock: true },
  POST: { status: 'created', id: 'mock-001', mock: true },
  PUT: { status: 'updated', mock: true },
  PATCH: { status: 'patched', mock: true },
  DELETE: { status: 'deleted', mock: true },
};

export class GenericHttpConnectorAdapter implements ConnectorAdapter {
  async execute(
    instance: ConnectorInstance,
    request: ConnectorCallRequest,
  ): Promise<unknown> {
    const config = resolveConfig(instance);
    const template = this.findTemplate(config, request.operation);

    if (!template) {
      throw new Error(`Unknown operation: ${request.operation}`);
    }

    if (isMockMode()) {
      const mockData = MOCK_RESPONSES[template.method] ?? { status: 'ok', mock: true };
      if (config.responseMappings?.[request.operation]) {
        return extractByJsonPath(mockData, config.responseMappings[request.operation].jsonPath);
      }
      return mockData;
    }

    const transport = this.createTransport(config);
    const resolvedPath = replacePlaceholders(template.path, request.params);
    const resolvedHeaders = template.headers
      ? this.resolveHeaders(template.headers, request.params)
      : undefined;
    const resolvedBody = template.bodyTemplate
      ? replaceBodyPlaceholders(template.bodyTemplate, request.params)
      : undefined;

    const transportRequest = {
      method: template.method,
      path: resolvedPath,
      headers: resolvedHeaders,
      body: resolvedBody,
      params: this.extractQueryParams(request.params, template),
    };

    try {
      const response = await transport.request<unknown>(transportRequest);
      const data = response.body;

      if (config.responseMappings?.[request.operation]) {
        return extractByJsonPath(data, config.responseMappings[request.operation].jsonPath);
      }

      return data;
    } catch (err) {
      if (err instanceof TransportError) {
        throw {
          code: err.type === 'auth' ? 'AUTH_ERROR' : 'TRANSPORT_ERROR',
          message: err.message,
          recoverable: err.retryable,
          statusCode: err.statusCode,
        };
      }
      throw err;
    }
  }

  discoverCapabilities(instance: ConnectorInstance): ConnectorCapability[] {
    const config = resolveConfig(instance);
    return config.requestTemplates.map((template) => {
      const inputSchema = buildInputSchemaFromTemplate(template);
      return {
        capabilityId: `generic_http.${template.operationId}`,
        name: template.description ?? template.operationId,
        description: template.description ?? `${template.method} ${template.path}`,
        category: template.category ?? 'execute',
        riskLevel: template.riskLevel ?? 'medium',
        inputSchema,
        requiresAuth: config.auth !== undefined,
        supportedOperations: [template.operationId],
      };
    });
  }

  checkHealth(instance: ConnectorInstance): { healthy: boolean; message?: string } {
    if (isMockMode()) {
      return { healthy: true, message: 'Mock mode active' };
    }

    try {
      const config = resolveConfig(instance);
      if (!config.baseURL) {
        return { healthy: false, message: 'No baseURL configured' };
      }
      return { healthy: true, message: 'Configuration valid' };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Health check failed';
      return { healthy: false, message };
    }
  }

  async probeHealth(instance: ConnectorInstance): Promise<{ healthy: boolean; message?: string }> {
    if (isMockMode()) {
      return { healthy: true, message: 'Mock mode active' };
    }

    const config = resolveConfig(instance);
    const healthPath = config.healthCheckPath ?? '/health';
    const transport = this.createTransport(config);

    try {
      await transport.get(healthPath);
      return { healthy: true, message: 'Connector is healthy' };
    } catch {
      try {
        await transport.get('/');
        return { healthy: true, message: 'Connector is healthy (root endpoint)' };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Health check failed';
        return { healthy: false, message };
      }
    }
  }

  private findTemplate(config: GenericHttpConfig, operation: string): RequestTemplate | undefined {
    return config.requestTemplates.find((t) => t.operationId === operation);
  }

  private createTransport(config: GenericHttpConfig): BaseHttpTransport {
    const transportConfig: HttpTransportConfig = {
      baseURL: config.baseURL,
      timeout: config.timeout,
      retries: config.retries,
      headers: config.defaultHeaders,
      auth: config.auth ? toTransportAuth(config.auth) : undefined,
    };
    return new BaseHttpTransport(transportConfig);
  }

  private resolveHeaders(
    headers: Record<string, string>,
    params: Record<string, unknown>,
  ): Record<string, string> {
    const resolved: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) {
      resolved[key] = replacePlaceholders(value, params);
    }
    return resolved;
  }

  private extractQueryParams(
    params: Record<string, unknown>,
    template: RequestTemplate,
  ): Record<string, string> | undefined {
    const pathParams = new Set<string>();
    const pathMatches = template.path.matchAll(/\{\{(\w+)\}\}/g);
    for (const match of pathMatches) {
      pathParams.add(match[1]);
    }

    const headerParams = new Set<string>();
    if (template.headers) {
      for (const value of Object.values(template.headers)) {
        const headerMatches = value.matchAll(/\{\{(\w+)\}\}/g);
        for (const match of headerMatches) {
          headerParams.add(match[1]);
        }
      }
    }

    const queryParams: Record<string, string> = {};
    for (const [key, value] of Object.entries(params)) {
      if (!pathParams.has(key) && !headerParams.has(key)) {
        queryParams[key] = String(value);
      }
    }

    return Object.keys(queryParams).length > 0 ? queryParams : undefined;
  }
}

function buildInputSchemaFromTemplate(template: RequestTemplate): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  const pathMatches = template.path.matchAll(/\{\{(\w+)\}\}/g);
  for (const match of pathMatches) {
    properties[match[1]] = { type: 'string', in: 'path' };
    required.push(match[1]);
  }

  if (template.headers) {
    for (const value of Object.values(template.headers)) {
      const headerMatches = value.matchAll(/\{\{(\w+)\}\}/g);
      for (const match of headerMatches) {
        properties[match[1]] = { type: 'string', in: 'header' };
      }
    }
  }

  if (template.bodyTemplate) {
    properties['body'] = { type: 'object', description: 'Request body' };
  }

  return {
    type: 'object',
    properties,
    ...(required.length > 0 && { required }),
  };
}

export function createGenericHttpConnectorAdapter(): GenericHttpConnectorAdapter {
  return new GenericHttpConnectorAdapter();
}
