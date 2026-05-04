import { describe, it, expect, beforeEach } from 'vitest';
import { createGateway, type Gateway } from '../../../src/gateway/gateway.js';
import type { Stores } from '../../../src/gateway/types.js';
import type { ApprovalResponse } from '../../../src/permissions/types.js';
import type { EventRecord } from '../../../src/storage/event-store.js';

describe('Gateway Integration Tests', () => {
  let gateway: Gateway;
  let mockStores: Stores;
  let capturedEvents: EventRecord[];
  let capturedGatewayEvents: unknown[];

  beforeEach(() => {
    capturedEvents = [];
    capturedGatewayEvents = [];

    mockStores = {
      eventStore: {
        append: (event: unknown) => {
          capturedEvents.push(event as EventRecord);
        },
        query: (filters: { sessionId?: string; eventType?: string }) => {
          return capturedEvents.filter(e => {
            if (filters.sessionId && e.sessionId !== filters.sessionId) return false;
            if (filters.eventType && e.eventType !== filters.eventType) return false;
            return true;
          });
        },
      },
      summaryStore: {
        getSessionMemory: (_sessionId: string) => {
          return {
            structuredState: {
              preferences: { theme: 'dark', notifications: true },
            },
          };
        },
      },
      transcriptStore: {
        findBySession: (_sessionId: string) => {
          return [
            { turnId: 'turn-1', createdAt: '2024-01-15T10:00:00Z' },
            { turnId: 'turn-2', createdAt: '2024-01-15T10:05:00Z' },
          ];
        },
      },
      runtimeActionStore: {
        findBySessionId: (_sessionId: string) => {
          return [
            {
              actionId: 'action-1',
              status: 'waiting_for_approval',
              targetRef: { approvalId: 'approval-123' },
            },
            {
              actionId: 'action-2',
              status: 'created',
              targetRef: { runId: 'run-456' },
            },
          ];
        },
      },
    };

    gateway = createGateway({
      stores: mockStores,
      emitBoundaryEvent: (event) => {
        capturedGatewayEvents.push(event);
      },
    });
  });

  describe('receiveUserMessage', () => {
    it('should normalize human message into InboundEnvelope', () => {
      const envelope = gateway.receiveUserMessage('user-123', 'session-456', 'Hello, world!');

      expect(envelope).toBeDefined();
      expect(envelope.eventType).toBe('human_message');
      expect(envelope.payload.text).toBe('Hello, world!');
      expect(envelope.userId).toBe('user-123');
      expect(envelope.sessionId).toBe('session-456');
      expect(envelope.envelopeId).toBeDefined();
      expect(envelope.timestamp).toBeDefined();
      expect(envelope.sourceChannel).toBe('default');
    });

    it('should emit gateway.inbound_received event to EventStore', () => {
      const envelope = gateway.receiveUserMessage('user-123', 'session-456', 'Hello!');

      const gatewayEvents = capturedEvents.filter(e => e.eventType === 'gateway_inbound_received');
      expect(gatewayEvents).toHaveLength(1);
      expect(gatewayEvents[0].userId).toBe('user-123');
      expect(gatewayEvents[0].sessionId).toBe('session-456');
      expect(gatewayEvents[0].correlationId).toBe(envelope.envelopeId);
    });

    it('should record sourceChannel in gateway.inbound_received event payload', () => {
      const envelope = gateway.receiveUserMessage('user-123', 'session-456', 'Hello via WebUI!', 'webui');

      const gatewayEvents = capturedEvents.filter(e => e.eventType === 'gateway_inbound_received');
      expect(gatewayEvents).toHaveLength(1);
      expect(gatewayEvents[0].payload).toMatchObject({
        envelopeType: 'human_message',
        textLength: 'Hello via WebUI!'.length,
        sourceChannel: 'webui',
      });
      expect(envelope.sourceChannel).toBe('webui');
    });
  });

  describe('normalizeInbound', () => {
    it('should normalize external event into InboundEnvelope', () => {
      const rawPayload = {
        eventType: 'external_event' as const,
        sourceChannel: 'slack',
        payload: {
          externalEvent: { type: 'webhook', data: { action: 'deploy' } },
        },
        userId: 'user-123',
        sessionId: 'session-456',
        metadata: { source: 'slack_webhook' },
      };

      const envelope = gateway.normalizeInbound(rawPayload);

      expect(envelope.eventType).toBe('external_event');
      expect(envelope.sourceChannel).toBe('slack');
      expect(envelope.payload.externalEvent).toEqual({ type: 'webhook', data: { action: 'deploy' } });
      expect(envelope.metadata).toEqual({ source: 'slack_webhook' });
    });

    it('should normalize approval response into InboundEnvelope', () => {
      const approvalResponse: ApprovalResponse = {
        requestId: 'approval-123',
        responseType: 'approve_once',
        respondedBy: 'user-123',
        respondedAt: '2024-01-15T10:00:00Z',
      };

      const rawPayload = {
        eventType: 'approval_response' as const,
        sourceChannel: 'cli',
        payload: { approvalResponse },
        userId: 'user-123',
        sessionId: 'session-456',
      };

      const envelope = gateway.normalizeInbound(rawPayload);

      expect(envelope.eventType).toBe('approval_response');
      expect(envelope.payload.approvalResponse).toEqual(approvalResponse);
    });
  });

  describe('assembleHydratedState', () => {
    it('should hydrate session state with user context', () => {
      const state = gateway.assembleHydratedState('user-123', 'session-456', mockStores);

      expect(state.userContext.userId).toBe('user-123');
      expect(state.userContext.sessionId).toBe('session-456');
      expect(state.userContext.preferences).toEqual({ theme: 'dark', notifications: true });
    });

    it('should hydrate session state with session context', () => {
      const state = gateway.assembleHydratedState('user-123', 'session-456', mockStores);

      expect(state.sessionContext.messageCount).toBe(2);
      expect(state.sessionContext.lastActivityAt).toBe('2024-01-15T10:05:00Z');
    });

    it('should hydrate session state with active work refs', () => {
      const state = gateway.assembleHydratedState('user-123', 'session-456', mockStores);

      expect(state.activeWorkRefs.pendingApprovals).toContain('approval-123');
      expect(state.activeWorkRefs.activeRuns).toContain('run-456');
    });

    it('should emit gateway.hydration_complete event', () => {
      gateway.assembleHydratedState('user-123', 'session-456', mockStores);

      const hydrationEvents = capturedEvents.filter(e => e.eventType === 'gateway_hydration_complete');
      expect(hydrationEvents).toHaveLength(1);
      expect(hydrationEvents[0].payload).toMatchObject({
        messageCount: 2,
        pendingApprovalsCount: 1,
        activeRunsCount: 1,
      });
    });
  });

  describe('formatOutbound', () => {
    it('should format text response into OutboundEnvelope', () => {
      const envelope = gateway.formatOutbound(
        'text',
        { text: 'Here is your result' },
        { userId: 'user-123', sessionId: 'session-456', channel: 'cli' },
        'corr-123'
      );

      expect(envelope.messageType).toBe('text');
      expect(envelope.content.text).toBe('Here is your result');
      expect(envelope.recipient.userId).toBe('user-123');
      expect(envelope.recipient.channel).toBe('cli');
      expect(envelope.correlationId).toBe('corr-123');
      expect(envelope.envelopeId).toBeDefined();
      expect(envelope.timestamp).toBeDefined();
    });

    it('should format status_update response into OutboundEnvelope', () => {
      const envelope = gateway.formatOutbound(
        'status_update',
        { status: 'Processing... 50% complete' },
        { userId: 'user-123', sessionId: 'session-456' },
        'corr-456'
      );

      expect(envelope.messageType).toBe('status_update');
      expect(envelope.content.status).toBe('Processing... 50% complete');
    });

    it('should format notification response into OutboundEnvelope', () => {
      const envelope = gateway.formatOutbound(
        'notification',
        { notification: 'Task completed successfully' },
        { userId: 'user-123', sessionId: 'session-456' },
        'corr-789'
      );

      expect(envelope.messageType).toBe('notification');
      expect(envelope.content.notification).toBe('Task completed successfully');
    });

    it('should format approval_request response into OutboundEnvelope', () => {
      const envelope = gateway.formatOutbound(
        'approval_request',
        { approvalRequest: { id: 'approval-123', action: 'deploy', resource: 'production' } },
        { userId: 'user-123', sessionId: 'session-456' },
        'corr-abc'
      );

      expect(envelope.messageType).toBe('approval_request');
      expect(envelope.content.approvalRequest).toEqual({ id: 'approval-123', action: 'deploy', resource: 'production' });
    });

    it('should emit gateway.outbound_sent event to EventStore', () => {
      gateway.formatOutbound(
        'text',
        { text: 'Response' },
        { userId: 'user-123', sessionId: 'session-456' },
        'corr-123'
      );

      const outboundEvents = capturedEvents.filter(e => e.eventType === 'gateway_outbound_sent');
      expect(outboundEvents).toHaveLength(1);
      expect(outboundEvents[0].payload).toEqual({ messageType: 'text' });
    });
  });

  describe('getApprovalRoutingHint', () => {
    it('should return routing hint for approval response', () => {
      const hint = gateway.getApprovalRoutingHint('approval-123');

      expect(hint.preferredPath).toBe('/approvals/approval-123');
      expect(hint.targetModule).toBe('permission');
      expect(hint.priority).toBe('high');
    });
  });
});
