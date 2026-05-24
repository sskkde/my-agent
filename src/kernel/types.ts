import type { ContextBundle, ContextItem } from '../context/types.js';
import type { LLMAdapter } from '../llm/adapter.js';
import type { ModelInputBuilder } from './model-input/model-input-builder.js';
import type { ToolPlaneProjection, ToolSelectionPolicyProjection } from './model-input/model-input-types.js';

export interface ToolUseRequest {
  toolCallId: string;
  toolName: string;
  params: Record<string, unknown>;
}

export interface ToolUseResult {
  toolCallId: string;
  result: unknown;
  error?: {
    code: string;
    message: string;
    recoverable: boolean;
  };
}

export interface KernelRunInput {
  contextBundle: ContextBundle;
  /** Per-run tool projection — takes priority over KernelConfig.toolProjection.
   *  Allows different tool visibility per tenant, workflow step, approval state, or connector scope. */
  toolProjection?: ToolPlaneProjection;
  /** Per-run tool selection policy — injected when PROMPT_MEMORY_P0_ENABLED is true. */
  toolSelectionPolicy?: ToolSelectionPolicyProjection;
  maxIterations?: number;
  timeoutMs?: number;
  config?: Record<string, unknown>;
}

export type KernelRunStatus = 'completed' | 'max_iterations_reached' | 'timeout' | 'failed';

export interface KernelRunResult {
  finalStatus: KernelRunStatus;
  finalResponse?: string;
  iterationsUsed: number;
  toolCalls: ToolUseRequest[];
  transcript: KernelTranscriptEntry[];
  error?: {
    code: string;
    message: string;
  };
}

export interface KernelTranscriptEntry {
  iteration: number;
  timestamp: string;
  type: 'llm_request' | 'llm_response' | 'tool_call' | 'tool_result' | 'compact' | 'error';
  content: unknown;
}

export interface KernelRunState {
  currentIteration: number;
  status: 'running' | 'waiting' | 'completed' | 'failed';
  contextItems: ContextItem[];
  startTime: number;
  toolCalls: ToolUseRequest[];
  transcript: KernelTranscriptEntry[];
}

export interface ToolExecutor {
  execute(request: {
    toolCallId: string;
    toolName: string;
    params: unknown;
    userId: string;
    sessionId?: string;
    kernelRunId?: string;
    permissionContext: {
      userId: string;
      permissions: string[];
    };
  }): Promise<{
    success: boolean;
    data?: unknown;
    error?: {
      code: string;
      message: string;
      recoverable: boolean;
    };
    resultPreview?: string;
  }>;
}

export interface ContextManager {
  assembleBundle(): ContextBundle;
  getItems(): ContextItem[];
  addItem(item: ContextItem): void;
  applyDelta(delta: { items?: ContextItem[] }): void;
}

export interface RuntimeDispatcher {
  dispatch(request: {
    requestId: string;
    action: {
      actionId: string;
      actionType: string;
      targetRuntime: string;
      targetAction?: {
        toolName?: string;
        params?: unknown;
      };
      source: {
        sourceModule: string;
        sourceAction: string;
      };
      userId: string;
      createdAt: string;
      status: string;
    };
    context: {
      callerModule: string;
      userId?: string;
      sessionId?: string;
    };
  }): Promise<{
    requestId: string;
    actionId: string;
    status: string;
    targetRuntime: string;
    result?: unknown;
    error?: {
      code: string;
      message: string;
      recoverable: boolean;
    };
    createdAt: string;
    completedAt?: string;
  }>;
}

export interface KernelConfig {
  llmAdapter: LLMAdapter;
  toolExecutor: ToolExecutor;
  contextManager: ContextManager;
  dispatcher: RuntimeDispatcher;
  modelInputBuilder: ModelInputBuilder;
  maxIterations: number;
  timeoutMs: number;
  compactThreshold?: number;
  defaultModel?: string;
  providerFamily?: string;
  toolProjection?: ToolPlaneProjection;
  modelInputSnapshotStore?: import('./model-input/model-input-snapshot-store.js').ModelInputSnapshotStore;
}

export interface CompactTriggerResult {
  shouldCompact: boolean;
  candidateItemIds?: string[];
  mustKeepItemIds?: string[];
}
