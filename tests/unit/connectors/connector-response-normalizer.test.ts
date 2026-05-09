import { describe, it, expect } from 'vitest';
import {
  normalizeConnectorResponse,
  createCancelledResponse,
  createTimeoutResponse,
} from '../../../src/connectors/runtime/connector-response-normalizer.js';
import type { ConnectorResponse } from '../../../src/connectors/types.js';

describe('connector-response-normalizer', () => {
  const requestId = 'req-123';
  const connectorInstanceId = 'conn-456';

  describe('success status', () => {
    it('should map success to completed with data', () => {
      const response: ConnectorResponse = {
        status: 'success',
        requestId,
        connectorInstanceId,
        data: { result: 'ok' },
      };

      const result = normalizeConnectorResponse(response);

      expect(result.status).toBe('completed');
      expect(result.data).toEqual({ result: 'ok' });
      expect(result.error).toBeUndefined();
      expect(result.recoverability).toBeUndefined();
    });

    it('should include sensitivity in metadata when provided', () => {
      const response: ConnectorResponse = {
        status: 'success',
        requestId,
        connectorInstanceId,
        data: 'test',
      };

      const result = normalizeConnectorResponse(response, { sensitivity: 'high' });

      expect(result.metadata?.sensitivity).toBe('high');
    });
  });

  describe('started_async status', () => {
    it('should map started_async to waiting with operationRef', () => {
      const response: ConnectorResponse = {
        status: 'started_async',
        requestId,
        connectorInstanceId,
        metadata: { operationId: 'op-789' },
      };

      const result = normalizeConnectorResponse(response);

      expect(result.status).toBe('waiting');
      expect(result.metadata?.operationRef).toBe('op-789');
      expect(result.error).toBeUndefined();
    });

    it('should use empty string for operationRef when not provided', () => {
      const response: ConnectorResponse = {
        status: 'started_async',
        requestId,
        connectorInstanceId,
      };

      const result = normalizeConnectorResponse(response);

      expect(result.metadata?.operationRef).toBe('');
    });
  });

  describe('partial_success status', () => {
    it('should map partial_success to completed with warning', () => {
      const response: ConnectorResponse = {
        status: 'partial_success',
        requestId,
        connectorInstanceId,
        data: { items: [1, 2, 3] },
        error: {
          code: 'partial_failure',
          message: 'Some items failed',
          recoverable: false,
        },
      };

      const result = normalizeConnectorResponse(response);

      expect(result.status).toBe('completed');
      expect(result.data).toEqual({ items: [1, 2, 3] });
      expect(result.metadata?.warning).toBe('Some items failed');
    });

    it('should use default warning message when error not provided', () => {
      const response: ConnectorResponse = {
        status: 'partial_success',
        requestId,
        connectorInstanceId,
        data: 'test',
      };

      const result = normalizeConnectorResponse(response);

      expect(result.metadata?.warning).toBe('Partial success with warnings');
    });
  });

  describe('auth_required status', () => {
    it('should map auth_required to failed with recoverable_with_user', () => {
      const response: ConnectorResponse = {
        status: 'auth_required',
        requestId,
        connectorInstanceId,
        error: {
          code: 'token_expired',
          message: 'Your token has expired',
          recoverable: true,
        },
      };

      const result = normalizeConnectorResponse(response);

      expect(result.status).toBe('failed');
      expect(result.error?.code).toBe('token_expired');
      expect(result.error?.message).toBe('Your token has expired');
      expect(result.error?.recoverable).toBe(true);
      expect(result.recoverability).toBe('recoverable_with_user');
      expect(result.metadata?.authChallenge).toBeDefined();
      expect(result.metadata?.authChallenge?.message).toBe('Your token has expired');
    });

    it('should use default auth challenge when error not provided', () => {
      const response: ConnectorResponse = {
        status: 'auth_required',
        requestId,
        connectorInstanceId,
      };

      const result = normalizeConnectorResponse(response);

      expect(result.error?.code).toBe('auth_required');
      expect(result.metadata?.authChallenge?.message).toBe('Please authenticate to continue');
    });
  });

  describe('permission_denied status', () => {
    it('should map permission_denied to denied with recoverable_with_user', () => {
      const response: ConnectorResponse = {
        status: 'permission_denied',
        requestId,
        connectorInstanceId,
        error: {
          code: 'insufficient_scope',
          message: 'Missing required scope: write',
          recoverable: true,
        },
      };

      const result = normalizeConnectorResponse(response);

      expect(result.status).toBe('denied');
      expect(result.error?.code).toBe('permission_denied');
      expect(result.error?.message).toBe('Missing required scope: write');
      expect(result.error?.recoverable).toBe(true);
      expect(result.recoverability).toBe('recoverable_with_user');
    });

    it('should use default message when error not provided', () => {
      const response: ConnectorResponse = {
        status: 'permission_denied',
        requestId,
        connectorInstanceId,
      };

      const result = normalizeConnectorResponse(response);

      expect(result.error?.message).toBe('Permission denied');
    });
  });

  describe('rate_limited status', () => {
    it('should map rate_limited to failed with retryable_later', () => {
      const response: ConnectorResponse = {
        status: 'rate_limited',
        requestId,
        connectorInstanceId,
        error: {
          code: 'rate_limit_exceeded',
          message: 'Too many requests',
          recoverable: true,
        },
        metadata: {
          retryAfterMs: 5000,
          rateLimitRemaining: 0,
          rateLimitResetAt: '2024-01-01T00:00:00Z',
        },
      };

      const result = normalizeConnectorResponse(response);

      expect(result.status).toBe('failed');
      expect(result.error?.code).toBe('rate_limited');
      expect(result.recoverability).toBe('retryable_later');
      expect(result.metadata?.retryAfterMs).toBe(5000);
      expect(result.metadata?.rateLimitInfo?.remaining).toBe(0);
      expect(result.metadata?.rateLimitInfo?.resetAt).toBe('2024-01-01T00:00:00Z');
    });

    it('should use default retryAfterMs when not provided', () => {
      const response: ConnectorResponse = {
        status: 'rate_limited',
        requestId,
        connectorInstanceId,
      };

      const result = normalizeConnectorResponse(response);

      expect(result.metadata?.retryAfterMs).toBe(60000);
    });

    it('should use custom defaultRetryAfterMs from options', () => {
      const response: ConnectorResponse = {
        status: 'rate_limited',
        requestId,
        connectorInstanceId,
      };

      const result = normalizeConnectorResponse(response, { defaultRetryAfterMs: 30000 });

      expect(result.metadata?.retryAfterMs).toBe(30000);
    });
  });

  describe('failed status', () => {
    it('should map failed to failed with error from connector', () => {
      const response: ConnectorResponse = {
        status: 'failed',
        requestId,
        connectorInstanceId,
        error: {
          code: 'service_unavailable',
          message: 'Service is temporarily unavailable',
          recoverable: true,
        },
      };

      const result = normalizeConnectorResponse(response);

      expect(result.status).toBe('failed');
      expect(result.error?.code).toBe('service_unavailable');
      expect(result.error?.message).toBe('Service is temporarily unavailable');
      expect(result.error?.recoverable).toBe(true);
      expect(result.recoverability).toBe('retryable_later');
    });

    it('should map non_recoverable error codes correctly', () => {
      const response: ConnectorResponse = {
        status: 'failed',
        requestId,
        connectorInstanceId,
        error: {
          code: 'resource_not_found',
          message: 'Resource not found',
          recoverable: true,
        },
      };

      const result = normalizeConnectorResponse(response);

      expect(result.recoverability).toBe('non_recoverable');
    });

    it('should map user-recoverable error codes correctly', () => {
      const response: ConnectorResponse = {
        status: 'failed',
        requestId,
        connectorInstanceId,
        error: {
          code: 'invalid_credentials',
          message: 'Invalid credentials',
          recoverable: true,
        },
      };

      const result = normalizeConnectorResponse(response);

      expect(result.recoverability).toBe('recoverable_with_user');
    });

    it('should use default values when error not provided', () => {
      const response: ConnectorResponse = {
        status: 'failed',
        requestId,
        connectorInstanceId,
      };

      const result = normalizeConnectorResponse(response);

      expect(result.error?.code).toBe('execution_failed');
      expect(result.error?.message).toBe('Connector execution failed');
      expect(result.error?.recoverable).toBe(false);
      expect(result.recoverability).toBe('non_recoverable');
    });
  });

  describe('timeout status', () => {
    it('should map timeout to timeout with retryable_later', () => {
      const response: ConnectorResponse = {
        status: 'timeout',
        requestId,
        connectorInstanceId,
        error: {
          code: 'operation_timeout',
          message: 'Operation timed out after 30000ms',
          recoverable: true,
        },
      };

      const result = normalizeConnectorResponse(response);

      expect(result.status).toBe('timeout');
      expect(result.error?.code).toBe('connector_timeout');
      expect(result.error?.message).toBe('Operation timed out after 30000ms');
      expect(result.error?.recoverable).toBe(true);
      expect(result.recoverability).toBe('retryable_later');
    });

    it('should use default message when error not provided', () => {
      const response: ConnectorResponse = {
        status: 'timeout',
        requestId,
        connectorInstanceId,
      };

      const result = normalizeConnectorResponse(response);

      expect(result.error?.message).toBe('Connector operation timed out');
    });
  });

  describe('cancelled status', () => {
    it('should map cancelled to cancelled with synthetic=true', () => {
      const response: ConnectorResponse = {
        status: 'cancelled',
        requestId,
        connectorInstanceId,
      };

      const result = normalizeConnectorResponse(response);

      expect(result.status).toBe('cancelled');
      expect(result.synthetic).toBe(true);
      expect(result.error).toBeUndefined();
    });
  });

  describe('createCancelledResponse', () => {
    it('should create a cancelled response', () => {
      const response = createCancelledResponse(requestId, connectorInstanceId);

      expect(response.status).toBe('cancelled');
      expect(response.requestId).toBe(requestId);
      expect(response.connectorInstanceId).toBe(connectorInstanceId);
    });
  });

  describe('createTimeoutResponse', () => {
    it('should create a timeout response with correct message', () => {
      const response = createTimeoutResponse(requestId, connectorInstanceId, 30000);

      expect(response.status).toBe('timeout');
      expect(response.requestId).toBe(requestId);
      expect(response.connectorInstanceId).toBe(connectorInstanceId);
      expect(response.error?.code).toBe('connector_timeout');
      expect(response.error?.message).toBe('Operation timed out after 30000ms');
      expect(response.error?.recoverable).toBe(true);
    });
  });
});
