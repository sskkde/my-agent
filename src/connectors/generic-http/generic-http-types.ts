/**
 * Generic HTTP Connector Types — public API for connector configuration.
 */
import type { HttpTransportAuthType } from '../base-http-transport-types.js';

export interface GenericHttpAuth {
  type: HttpTransportAuthType;
  credentials: Record<string, string>;
}

export interface RequestTemplate {
  /** Unique operation identifier (e.g., "get_user", "list_items") */
  operationId: string;
  /** HTTP method */
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** URL path with {{variable}} placeholders (e.g., "/users/{{user_id}}") */
  path: string;
  /** Additional headers for this specific request, with {{variable}} placeholders */
  headers?: Record<string, string>;
  /** JSON body template with {{variable}} placeholders */
  bodyTemplate?: Record<string, unknown>;
  /** Description of what this operation does */
  description?: string;
  /** Category for capability classification */
  category?: 'read' | 'write' | 'execute' | 'admin';
  /** Risk level for this operation */
  riskLevel?: 'low' | 'medium' | 'high' | 'restricted';
}

export interface ResponseMapping {
  /** JSON path expression to extract a specific field (e.g., "data.items", "results") */
  jsonPath: string;
}

export interface OpenApiImport {
  /** URL to fetch the OpenAPI spec from */
  specUrl?: string;
  /** Inline OpenAPI spec object */
  specObject?: unknown;
  /** Override basePath from the spec */
  basePathOverride?: string;
}

export interface GenericHttpConfig {
  /** Base URL for all API requests */
  baseURL: string;
  /** Default headers applied to all requests */
  defaultHeaders?: Record<string, string>;
  /** Authentication configuration */
  auth?: GenericHttpAuth;
  /** Named request templates for operations */
  requestTemplates: RequestTemplate[];
  /** Response mappings keyed by operationId */
  responseMappings?: Record<string, ResponseMapping>;
  /** OpenAPI spec import configuration */
  openApiImport?: OpenApiImport;
  /** Request timeout in milliseconds */
  timeout?: number;
  /** Number of retries on failure */
  retries?: number;
  /** Health check endpoint path (default: "/health") */
  healthCheckPath?: string;
}

export interface ParsedOpenApiSpec {
  config: GenericHttpConfig;
  warnings: string[];
}
