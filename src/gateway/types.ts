import type { ApprovalResponse } from '../permissions/types.js'

export type EventType = 'human_message' | 'approval_response' | 'external_event' | 'system_trigger'

export type MessageType = 'text' | 'status_update' | 'notification' | 'approval_request' | 'error'

export interface RoutingHints {
  preferredPath: string
  targetModule?: string
  priority?: 'high' | 'normal' | 'low'
}

export interface InboundEnvelope {
  envelopeId: string
  eventType: EventType
  sourceChannel: string
  payload: {
    text?: string
    approvalResponse?: ApprovalResponse
    externalEvent?: Record<string, unknown>
  }
  userId: string
  sessionId: string
  timestamp: string
  metadata?: Record<string, unknown>
}

export interface OutboundEnvelope {
  envelopeId: string
  messageType: MessageType
  recipient: {
    userId: string
    sessionId: string
    channel?: string
  }
  content: {
    text?: string
    status?: string
    notification?: string
    approvalRequest?: Record<string, unknown>
    error?: { code: string; message: string }
  }
  correlationId: string
  timestamp: string
  metadata?: Record<string, unknown>
}

export interface ActiveWorkRefs {
  pendingApprovals: string[]
  activeRuns: string[]
}

export interface HydratedSessionState {
  userContext: {
    userId: string
    sessionId: string
    preferences?: Record<string, unknown>
  }
  sessionContext: {
    messageCount: number
    lastActivityAt: string
    activePlannerRunIds: string[]
    activeBackgroundRunIds: string[]
  }
  activeWorkRefs: ActiveWorkRefs
  routingHints?: RoutingHints
}

export interface GatewayEvent {
  eventId: string
  eventType: 'gateway.inbound_received' | 'gateway.outbound_sent' | 'gateway.hydration_complete' | 'gateway.error'
  userId?: string
  sessionId?: string
  correlationId: string
  payload: Record<string, unknown>
  timestamp: string
}

export interface Stores {
  eventStore: {
    append: (event: unknown) => void
    query: (filters: { sessionId?: string; eventType?: string }) => unknown[]
  }
  summaryStore: {
    getSessionMemory: (sessionId: string) => { structuredState?: Record<string, unknown> } | null
  }
  transcriptStore: {
    findBySession: (sessionId: string) => Array<{ turnId: string; createdAt: string }>
  }
  runtimeActionStore: {
    findBySessionId?: (
      sessionId: string,
    ) => Array<{ actionId: string; status: string; targetRef?: Record<string, unknown> }>
  }
}
