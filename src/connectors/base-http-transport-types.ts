/**
 * Base HTTP Transport Types and Interfaces
 * Provides type definitions for HTTP transport layer used by connectors
 */

// HTTP Transport Configuration
export interface HttpTransportConfig {
  baseURL: string;
  timeout?: number;
  retries?: number;
  retryDelay?: number;
  headers?: Record<string, string>;
  auth?: HttpTransportAuth;
}

// HTTP Transport Authentication
export type HttpTransportAuthType = 'api_key' | 'bearer' | 'basic' | 'oauth2';

export interface HttpTransportAuth {
  type: HttpTransportAuthType;
  credentials: string;
}

// HTTP Transport Request
export type HttpTransportMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface HttpTransportRequest {
  method: HttpTransportMethod;
  path: string;
  headers?: Record<string, string>;
  body?: unknown;
  params?: Record<string, string>;
}

// HTTP Transport Response
export interface HttpTransportResponse<T> {
  status: number;
  headers: Record<string, string>;
  body?: T;
  duration: number;
}

// HTTP Transport Error
export type HttpTransportErrorType =
  | 'timeout'
  | 'network'
  | 'auth'
  | 'rate_limit'
  | 'server'
  | 'parse';

export interface HttpTransportError {
  type: HttpTransportErrorType;
  message: string;
  statusCode?: number;
  retryable: boolean;
}

// HTTP Transport Interface
export interface IHttpTransport {
  request<T>(req: HttpTransportRequest): Promise<HttpTransportResponse<T>>;
  get<T>(path: string, params?: Record<string, string>): Promise<HttpTransportResponse<T>>;
  post<T>(path: string, body?: unknown): Promise<HttpTransportResponse<T>>;
  put<T>(path: string, body?: unknown): Promise<HttpTransportResponse<T>>;
  patch<T>(path: string, body?: unknown): Promise<HttpTransportResponse<T>>;
  delete<T>(path: string): Promise<HttpTransportResponse<T>>;
}
