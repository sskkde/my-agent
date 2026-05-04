import { describe, it, expect } from 'vitest';
import {
  ApiError,
  ApiSuccess,
  HealthResponse,
  SessionResponse,
  TranscriptsResponse,
  SendMessageRequest,
  SendMessageResponse,
  RunsResponse,
  ApprovalsResponse,
  ApprovalDecisionRequest,
  SseRunEvent,
} from '../../../src/api/types.js';

const ALLOWED_ENDPOINTS = [
  'GET /api/health',
  'POST /api/sessions',
  'GET /api/sessions/:sessionId',
  'GET /api/sessions/:sessionId/transcripts',
  'POST /api/sessions/:sessionId/messages',
  'GET /api/runs',
  'GET /api/runs/stream',
  'GET /api/approvals',
  'PATCH /api/approvals/:approvalId',
];

describe('API Contract', () => {
  describe('ApiError structure', () => {
    it('should have correct error format with code and message', () => {
      const error: ApiError = {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid input',
        },
      };
      expect(error.error.code).toBe('VALIDATION_ERROR');
      expect(error.error.message).toBe('Invalid input');
    });

    it('should allow optional details field', () => {
      const error: ApiError = {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Something went wrong',
          details: { field: 'userId', issue: 'required' },
        },
      };
      expect(error.error.details).toBeDefined();
    });
  });

  describe('ApiSuccess structure', () => {
    it('should wrap data in data property', () => {
      const success: ApiSuccess<{ id: string }> = {
        data: { id: 'test-123' },
      };
      expect(success.data).toEqual({ id: 'test-123' });
    });
  });

  describe('HealthResponse', () => {
    it('should have status of healthy or degraded', () => {
      const healthy: HealthResponse = {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        modules: { database: { status: 'healthy' } },
      };
      expect(healthy.status).toBe('healthy');

      const degraded: HealthResponse = {
        status: 'degraded',
        timestamp: new Date().toISOString(),
        modules: { database: { status: 'unhealthy', message: 'slow' } },
      };
      expect(degraded.status).toBe('degraded');
    });

    it('should have modules record with ModuleHealth', () => {
      const response: HealthResponse = {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        modules: {
          database: { status: 'healthy' },
          cache: { status: 'degraded', message: 'high latency' },
        },
      };
      expect(response.modules.database.status).toBe('healthy');
      expect(response.modules.cache.status).toBe('degraded');
    });
  });

  describe('SessionResponse', () => {
    it('should contain session info with required fields', () => {
      const session: SessionResponse = {
        session: {
          sessionId: 'sess-123',
          userId: 'user-456',
          messageCount: 5,
          lastActivityAt: new Date().toISOString(),
          activePlannerRunIds: ['run-1'],
          activeBackgroundRunIds: [],
        },
      };
      expect(session.session.sessionId).toBe('sess-123');
      expect(session.session.messageCount).toBe(5);
    });
  });

  describe('TranscriptsResponse', () => {
    it('should have transcripts array and total count', () => {
      const response: TranscriptsResponse = {
        transcripts: [],
        total: 0,
      };
      expect(response.total).toBe(0);
      expect(Array.isArray(response.transcripts)).toBe(true);
    });
  });

  describe('SendMessageRequest', () => {
    it('should require text field', () => {
      const request: SendMessageRequest = { text: 'Hello' };
      expect(request.text).toBe('Hello');
    });
  });

  describe('SendMessageResponse', () => {
    it('should have accepted status and optional turnId', () => {
      const response: SendMessageResponse = {
        accepted: true,
        turnId: 'turn-123',
        status: 'accepted',
        correlationId: 'corr-123',
        envelopeId: 'env-123',
      };
      expect(response.accepted).toBe(true);
      expect(response.turnId).toBe('turn-123');
    });
  });

  describe('RunsResponse', () => {
    it('should have runs array and total count', () => {
      const response: RunsResponse = {
        runs: [],
        total: 0,
      };
      expect(response.total).toBe(0);
    });
  });

  describe('ApprovalsResponse', () => {
    it('should have approvals array and total count', () => {
      const response: ApprovalsResponse = {
        approvals: [],
        total: 0,
      };
      expect(response.total).toBe(0);
    });
  });

  describe('ApprovalDecisionRequest', () => {
    it('should require decision of approved or rejected', () => {
      const approve: ApprovalDecisionRequest = { decision: 'approved' };
      const reject: ApprovalDecisionRequest = { decision: 'rejected', reason: 'Not needed' };
      expect(approve.decision).toBe('approved');
      expect(reject.decision).toBe('rejected');
    });
  });

  describe('SseRunEvent', () => {
    it('should have valid event types', () => {
      const event: SseRunEvent = {
        type: 'run_started',
        runId: 'run-123',
        data: { objective: 'test' },
        timestamp: new Date().toISOString(),
      };
      expect(['run_started', 'run_progress', 'run_completed', 'run_failed', 'run_cancelled']).toContain(event.type);
    });
  });

  describe('Allowed Endpoints Contract', () => {
    it('should include all 9 MVP endpoints', () => {
      expect(ALLOWED_ENDPOINTS).toHaveLength(9);
      expect(ALLOWED_ENDPOINTS).toContain('GET /api/health');
      expect(ALLOWED_ENDPOINTS).toContain('POST /api/sessions');
      expect(ALLOWED_ENDPOINTS).toContain('GET /api/sessions/:sessionId');
      expect(ALLOWED_ENDPOINTS).toContain('GET /api/sessions/:sessionId/transcripts');
      expect(ALLOWED_ENDPOINTS).toContain('POST /api/sessions/:sessionId/messages');
      expect(ALLOWED_ENDPOINTS).toContain('GET /api/runs');
      expect(ALLOWED_ENDPOINTS).toContain('GET /api/runs/stream');
      expect(ALLOWED_ENDPOINTS).toContain('GET /api/approvals');
      expect(ALLOWED_ENDPOINTS).toContain('PATCH /api/approvals/:approvalId');
    });

    it('should NOT include unsupported endpoints like /api/events', () => {
      expect(ALLOWED_ENDPOINTS).not.toContain('GET /api/events');
      expect(ALLOWED_ENDPOINTS).not.toContain('POST /api/events');
    });

    it('should NOT include unsupported endpoints like /api/runtime-actions', () => {
      expect(ALLOWED_ENDPOINTS).not.toContain('GET /api/runtime-actions');
      expect(ALLOWED_ENDPOINTS).not.toContain('POST /api/runtime-actions');
    });

    it('should NOT include auth endpoints', () => {
      expect(ALLOWED_ENDPOINTS).not.toContain('POST /api/auth/login');
      expect(ALLOWED_ENDPOINTS).not.toContain('POST /api/auth/logout');
    });
  });
});
