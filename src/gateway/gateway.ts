import type {
  InboundEnvelope,
  OutboundEnvelope,
  HydratedSessionState,
  GatewayEvent,
  RoutingHints,
  Stores,
  EventType,
  MessageType,
  ActiveWorkRefs,
} from './types.js';
import type { ApprovalResponse } from '../permissions/types.js';
import type { EventRecord, SourceModule } from '../storage/event-store.js';

export interface Gateway {
  receiveUserMessage(userId: string, sessionId: string, text: string, channel?: string): InboundEnvelope;
  normalizeInbound(rawPayload: {
    eventType: EventType;
    sourceChannel: string;
    payload: {
      text?: string;
      approvalResponse?: ApprovalResponse;
      externalEvent?: Record<string, unknown>;
    };
    userId: string;
    sessionId: string;
    metadata?: Record<string, unknown>;
  }): InboundEnvelope;
  assembleHydratedState(userId: string, sessionId: string, stores: Stores): HydratedSessionState;
  formatOutbound(
    responseType: MessageType,
    content: {
      text?: string;
      status?: string;
      notification?: string;
      approvalRequest?: Record<string, unknown>;
      error?: { code: string; message: string };
    },
    recipient: { userId: string; sessionId: string; channel?: string },
    correlationId: string
  ): OutboundEnvelope;
  getApprovalRoutingHint(approvalId: string): RoutingHints;
}

export interface GatewayOptions {
  stores: Stores;
  emitBoundaryEvent?: (event: GatewayEvent) => void;
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

export function createGateway(options: GatewayOptions): Gateway {
  const { stores, emitBoundaryEvent } = options;

  function emitGatewayEvent(
    eventType: GatewayEvent['eventType'],
    userId: string,
    sessionId: string,
    correlationId: string,
    payload: Record<string, unknown>
  ): void {
    if (emitBoundaryEvent) {
      const event: GatewayEvent = {
        eventId: generateId(),
        eventType,
        userId,
        sessionId,
        correlationId,
        payload,
        timestamp: new Date().toISOString(),
      };
      emitBoundaryEvent(event);
    }

    const eventRecord: EventRecord = {
      eventId: generateId(),
      eventType: eventType.replace('gateway.', 'gateway_'),
      sourceModule: 'gateway' as SourceModule,
      userId,
      sessionId,
      correlationId,
      payload,
      sensitivity: 'low',
      retentionClass: 'short',
      createdAt: new Date().toISOString(),
    };
    stores.eventStore.append(eventRecord);
  }

  return {
    receiveUserMessage(userId: string, sessionId: string, text: string, channel = 'default'): InboundEnvelope {
      const envelope: InboundEnvelope = {
        envelopeId: generateId(),
        eventType: 'human_message',
        sourceChannel: channel,
        payload: { text },
        userId,
        sessionId,
        timestamp: new Date().toISOString(),
        metadata: {},
      };

      emitGatewayEvent(
        'gateway.inbound_received',
        userId,
        sessionId,
        envelope.envelopeId,
        { envelopeType: 'human_message', textLength: text.length, sourceChannel: channel }
      );

      return envelope;
    },

    normalizeInbound(rawPayload): InboundEnvelope {
      const envelope: InboundEnvelope = {
        envelopeId: generateId(),
        eventType: rawPayload.eventType,
        sourceChannel: rawPayload.sourceChannel,
        payload: rawPayload.payload,
        userId: rawPayload.userId,
        sessionId: rawPayload.sessionId,
        timestamp: new Date().toISOString(),
        metadata: rawPayload.metadata || {},
      };

      emitGatewayEvent(
        'gateway.inbound_received',
        rawPayload.userId,
        rawPayload.sessionId,
        envelope.envelopeId,
        { envelopeType: rawPayload.eventType, sourceChannel: rawPayload.sourceChannel }
      );

      return envelope;
    },

    assembleHydratedState(userId: string, sessionId: string, stores: Stores): HydratedSessionState {
      const sessionMemory = stores.summaryStore.getSessionMemory(sessionId);
      const preferences = sessionMemory?.structuredState?.preferences as Record<string, unknown> | undefined;

      const transcripts = stores.transcriptStore.findBySession(sessionId);
      const messageCount = transcripts.length;
      const lastActivityAt = transcripts.length > 0
        ? transcripts[transcripts.length - 1].createdAt
        : new Date().toISOString();

      const activeWorkRefs: ActiveWorkRefs = {
        pendingApprovals: [],
        activeRuns: [],
      };

      if (stores.runtimeActionStore.findBySessionId) {
        const actions = stores.runtimeActionStore.findBySessionId(sessionId);
        for (const action of actions) {
          if (action.status === 'waiting_for_approval' && action.targetRef?.approvalId) {
            activeWorkRefs.pendingApprovals.push(action.targetRef.approvalId as string);
          }
          if (['created', 'validated', 'queued', 'dispatching', 'waiting_for_target'].includes(action.status)) {
            if (action.targetRef?.runId) {
              activeWorkRefs.activeRuns.push(action.targetRef.runId as string);
            }
            if (action.targetRef?.plannerRunId) {
              activeWorkRefs.activeRuns.push(action.targetRef.plannerRunId as string);
            }
            if (action.targetRef?.backgroundRunId) {
              activeWorkRefs.activeRuns.push(action.targetRef.backgroundRunId as string);
            }
          }
        }
      }

      const events = stores.eventStore.query({ sessionId }) as Array<{ eventType: string; relatedRefs?: { plannerRunId?: string; backgroundRunId?: string } }>;
      const activePlannerRunIds: string[] = [];
      const activeBackgroundRunIds: string[] = [];

      for (const event of events) {
        if (event.relatedRefs?.plannerRunId && !activePlannerRunIds.includes(event.relatedRefs.plannerRunId)) {
          activePlannerRunIds.push(event.relatedRefs.plannerRunId);
        }
        if (event.relatedRefs?.backgroundRunId && !activeBackgroundRunIds.includes(event.relatedRefs.backgroundRunId)) {
          activeBackgroundRunIds.push(event.relatedRefs.backgroundRunId);
        }
      }

      const state: HydratedSessionState = {
        userContext: {
          userId,
          sessionId,
          preferences,
        },
        sessionContext: {
          messageCount,
          lastActivityAt,
          activePlannerRunIds,
          activeBackgroundRunIds,
        },
        activeWorkRefs,
      };

      emitGatewayEvent(
        'gateway.hydration_complete',
        userId,
        sessionId,
        generateId(),
        {
          messageCount,
          pendingApprovalsCount: activeWorkRefs.pendingApprovals.length,
          activeRunsCount: activeWorkRefs.activeRuns.length,
        }
      );

      return state;
    },

    formatOutbound(responseType, content, recipient, correlationId): OutboundEnvelope {
      const envelope: OutboundEnvelope = {
        envelopeId: generateId(),
        messageType: responseType,
        recipient,
        content,
        correlationId,
        timestamp: new Date().toISOString(),
        metadata: {},
      };

      emitGatewayEvent(
        'gateway.outbound_sent',
        recipient.userId,
        recipient.sessionId,
        correlationId,
        { messageType: responseType }
      );

      return envelope;
    },

    getApprovalRoutingHint(approvalId: string): RoutingHints {
      return {
        preferredPath: `/approvals/${approvalId}`,
        targetModule: 'permission',
        priority: 'high',
      };
    },
  };
}
