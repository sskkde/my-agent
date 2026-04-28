export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export interface ApiSuccess<T> {
  data: T;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError;

export interface ModuleHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  message?: string;
}

export interface HealthResponse {
  status: 'healthy' | 'degraded';
  timestamp: string;
  modules: Record<string, ModuleHealth>;
}

export interface SessionInfo {
  sessionId: string;
  userId: string;
  messageCount: number;
  lastActivityAt: string;
  activePlannerRunIds: string[];
  activeBackgroundRunIds: string[];
}

export interface SessionResponse {
  session: SessionInfo;
}

export interface VisibleMessage {
  messageId: string;
  role: 'assistant' | 'system_status';
  content: string;
}

export interface TranscriptTurn {
  turnId: string;
  sessionId: string;
  userId: string;
  input: {
    inboundEventId?: string;
    userMessageSummary?: string;
    contentRefs?: string[];
  };
  output: {
    visibleMessages: VisibleMessage[];
    artifactRefs?: string[];
  };
  runtimeSummary?: {
    foregroundDecisionId?: string;
    plannerRunIds?: string[];
    runtimeActionIds?: string[];
    toolCallSummaries?: string[];
    approvalSummaries?: string[];
  };
  eventRange?: {
    startEventId: string;
    endEventId: string;
  };
  visibility: 'public' | 'internal' | 'confidential';
  createdAt: string;
}

export interface TranscriptsResponse {
  transcripts: TranscriptTurn[];
  total: number;
}

export interface SendMessageRequest {
  text: string;
}

export interface SendMessageResponse {
  accepted: boolean;
  turnId?: string;
  message?: string;
}

export interface RunInfo {
  runId: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  objective?: string;
  progress?: number;
  createdAt: string;
  updatedAt?: string;
}

export interface RunsResponse {
  runs: RunInfo[];
  total: number;
}

export interface SseRunEvent {
  type: 'run_started' | 'run_progress' | 'run_completed' | 'run_failed' | 'run_cancelled';
  runId: string;
  data: Record<string, unknown>;
  timestamp: string;
}

export interface ApprovalInfo {
  id: string;
  userId: string;
  sessionId: string;
  status: 'pending' | 'approved' | 'rejected' | 'expired' | 'cancelled';
  riskLevel?: string;
  scope?: string;
  actionType: string;
  resource?: string;
  justification?: string;
  requestedBy: string;
  requestedAt: string;
  expiresAt?: string;
}

export interface ApprovalsResponse {
  approvals: ApprovalInfo[];
  total: number;
}

export interface ApprovalDecisionRequest {
  decision: 'approved' | 'rejected';
  reason?: string;
}

export interface ApprovalDecisionResponse {
  success: boolean;
  approvalId: string;
  status: 'approved' | 'rejected';
}