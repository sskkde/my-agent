import { createConnectionManager, type ConnectionManager } from '../../src/storage/connection.js';
import { createMigrationRunner } from '../../src/storage/migrations.js';
import { allStoreMigrations } from '../../src/storage/all-stores-migrations.js';
import { createEventStore, type EventStore } from '../../src/storage/event-store.js';
import { createRuntimeActionStore, type RuntimeActionStore } from '../../src/storage/runtime-action-store.js';
import { createTranscriptStore, type TranscriptStore } from '../../src/storage/transcript-store.js';
import { createSummaryStore, type SummaryStore } from '../../src/storage/summary-store.js';
import { createApprovalStore, type ApprovalStore } from '../../src/storage/approval-store.js';
import { createPermissionGrantStore, type PermissionGrantStore } from '../../src/storage/permission-grant-store.js';
import { createToolExecutionStore, type ToolExecutionStore } from '../../src/storage/tool-execution-store.js';
import { createToolRegistry } from '../../src/tools/tool-registry.js';
import { createToolExecutor } from '../../src/tools/tool-executor.js';
import { createPermissionEngine } from '../../src/permissions/permission-engine.js';
import { createGateway } from '../../src/gateway/gateway.js';
import { createForegroundAgent } from '../../src/foreground/foreground-agent.js';
import { createRuntimeDispatcher } from '../../src/dispatcher/runtime-dispatcher.js';
import type { AdapterRegistry, RuntimeAdapter, TargetRuntime, RuntimeAction } from '../../src/dispatcher/types.js';
import type { PermissionContext, PermissionMode } from '../../src/permissions/types.js';
import type { ToolDefinition, ToolRegistry, ToolExecutor } from '../../src/tools/types.js';
import type { RuntimeDispatcher } from '../../src/dispatcher/types.js';
import type { Gateway } from '../../src/gateway/gateway.js';
import type { ForegroundAgent } from '../../src/foreground/foreground-agent.js';
import type { PermissionEngine } from '../../src/permissions/permission-engine.js';
import type { InboundEnvelope, OutboundEnvelope } from '../../src/gateway/types.js';
import type { ForegroundMessageInput, ForegroundSessionState } from '../../src/foreground/types.js';
import { TestClock } from '../helpers/clock.js';
import { IdGenerator } from '../helpers/ids.js';
import type { EventRecord } from '../../src/storage/event-store.js';
import type { ToolExecutionState } from '../../src/shared/states.js';

export interface E2EHarness {
  connection: ConnectionManager;
  stores: {
    eventStore: EventStore;
    runtimeActionStore: RuntimeActionStore;
    transcriptStore: TranscriptStore;
    summaryStore: SummaryStore;
    approvalStore: ApprovalStore;
    permissionGrantStore: PermissionGrantStore;
    toolExecutionStore: ToolExecutionStore;
  };
  gateway: Gateway;
  foregroundAgent: ForegroundAgent;
  toolRegistry: ToolRegistry;
  toolExecutor: ToolExecutor;
  permissionEngine: PermissionEngine;
  dispatcher: RuntimeDispatcher;
  clock: TestClock;
  idGenerator: IdGenerator;
  registerTool(tool: ToolDefinition): void;
  registerAdapter(runtimeType: TargetRuntime, adapter: RuntimeAdapter): void;
  createPermissionContext(userId: string, sessionId: string, mode: PermissionMode): PermissionContext;
  sendMessage(userId: string, sessionId: string, message: string): Promise<E2EMessageResult>;
  sendApprovalResponse(userId: string, sessionId: string, approvalId: string, approved: boolean): Promise<E2EApprovalResult>;
  close(): void;
}

export interface E2EMessageResult {
  envelope: InboundEnvelope;
  foregroundDecision: {
    route: string;
    requiresPlanner: boolean;
    reason: string;
    userVisibleResponse?: string;
  };
  outboundEnvelopes: OutboundEnvelope[];
  toolExecutions: Array<{
    toolCallId: string;
    toolName: string;
    status: string;
  }>;
  transcripts: Array<{
    turnId: string;
    input: { userMessageSummary?: string };
    output: { visibleMessages: Array<{ role: string; content: string }> };
  }>;
}

export interface E2EApprovalResult {
  success: boolean;
  approvalId: string;
  toolExecution?: {
    toolCallId: string;
    toolName: string;
    status: string;
  };
}

class TestAdapterRegistry implements AdapterRegistry {
  private adapters = new Map<TargetRuntime, RuntimeAdapter>();

  register(runtimeType: TargetRuntime, adapter: RuntimeAdapter): void {
    this.adapters.set(runtimeType, adapter);
  }

  getAdapter(runtimeType: TargetRuntime): RuntimeAdapter | null {
    return this.adapters.get(runtimeType) ?? null;
  }

  unregister(runtimeType: TargetRuntime): void {
    this.adapters.delete(runtimeType);
  }

  listAdapters(): TargetRuntime[] {
    return Array.from(this.adapters.keys());
  }
}

export function createE2EHarness(): E2EHarness {
  const connection = createConnectionManager(':memory:');
  connection.open();

  const migrationRunner = createMigrationRunner(connection);
  migrationRunner.init();
  migrationRunner.apply(allStoreMigrations);

  const eventStore = createEventStore(connection);
  const runtimeActionStore = createRuntimeActionStore(connection);
  const transcriptStore = createTranscriptStore(connection);
  const summaryStore = createSummaryStore(connection);
  const approvalStore = createApprovalStore(connection);
  const permissionGrantStore = createPermissionGrantStore(connection);
  const toolExecutionStore = createToolExecutionStore(connection);

  const clock = new TestClock('2024-01-15T10:00:00.000Z');
  const idGenerator = new IdGenerator();

  const permissionEngine = createPermissionEngine(
    { approvalStore, grantStore: permissionGrantStore, eventStore },
    { defaultExpiryMs: 3600000, maxPendingApprovals: 10, auditAllDecisions: true, respectExistingGrants: true }
  );

  const toolRegistry = createToolRegistry();

  const toolExecutor = createToolExecutor({
    registry: toolRegistry,
    permissionEngine: {
      checkPermission: (request) => permissionEngine.checkPermission(request),
    },
    toolExecutionStore: {
      create: (exec: {
        toolCallId: string;
        toolName: string;
        userId: string;
        sessionId?: string;
        kernelRunId?: string;
        status: string;
        params?: unknown;
        sensitivity: string;
      }) => {
        toolExecutionStore.create(exec as Parameters<ToolExecutionStore['create']>[0]);
      },
      updateStatus: (toolCallId: string, status: string) => {
        toolExecutionStore.updateStatus(toolCallId, status as ToolExecutionState);
      },
      saveResult: (toolCallId: string, result: {
        preview?: string;
        resultRef?: string;
        structuredContent?: Record<string, unknown>;
      }) => {
        toolExecutionStore.saveResult(toolCallId, result);
      },
    },
    eventStore: {
      append: (event: unknown) => {
        eventStore.append(event as EventRecord | EventRecord[]);
      },
    },
  });

  const adapterRegistry = new TestAdapterRegistry();

  adapterRegistry.register('tool_plane', {
    async execute(action) {
      if (action.targetAction === 'execute_tool') {
        const payload = action.payload as {
          toolCallId: string;
          toolName: string;
          params: unknown;
          userId: string;
          sessionId?: string;
          kernelRunId?: string;
          permissionContext: PermissionContext;
        };

        const result = await toolExecutor.execute({
          toolCallId: payload.toolCallId,
          toolName: payload.toolName,
          params: payload.params,
          userId: payload.userId,
          sessionId: payload.sessionId,
          kernelRunId: payload.kernelRunId,
          permissionContext: payload.permissionContext,
        });

        return result;
      }
      throw new Error(`Unknown tool action: ${action.targetAction}`);
    },
  });

  const dispatcher = createRuntimeDispatcher({
    actionStore: runtimeActionStore,
    eventStore: {
      append: (event: unknown) => {
        eventStore.append(event as EventRecord | EventRecord[]);
      },
    },
    adapterRegistry,
  });

  const gateway = createGateway({
    stores: {
      eventStore: {
        append: (event: unknown) => {
          eventStore.append(event as EventRecord | EventRecord[]);
        },
        query: (filters: { sessionId?: string; eventType?: string }) => {
          return eventStore.query(filters);
        },
      },
      summaryStore,
      transcriptStore,
      runtimeActionStore: runtimeActionStore as unknown as {
        findBySessionId?: (sessionId: string) => Array<{ actionId: string; status: string; targetRef?: Record<string, unknown> }>;
      },
    },
  });

  const foregroundAgent = createForegroundAgent();

  const outboundEnvelopes: OutboundEnvelope[] = [];

  const harness: E2EHarness = {
    connection,
    stores: {
      eventStore,
      runtimeActionStore,
      transcriptStore,
      summaryStore,
      approvalStore,
      permissionGrantStore,
      toolExecutionStore,
    },
    gateway,
    foregroundAgent,
    toolRegistry,
    toolExecutor,
    permissionEngine,
    dispatcher,
    clock,
    idGenerator,

    registerTool(tool: ToolDefinition): void {
      toolRegistry.register(tool);
    },

    registerAdapter(runtimeType: TargetRuntime, adapter: RuntimeAdapter): void {
      adapterRegistry.register(runtimeType, adapter);
    },

    createPermissionContext(userId: string, sessionId: string, mode: PermissionMode): PermissionContext {
      return {
        userId,
        sessionId,
        mode,
        grants: [],
        metadata: {},
      };
    },

    async sendMessage(userId: string, sessionId: string, message: string): Promise<E2EMessageResult> {
      const envelope = gateway.receiveUserMessage(userId, sessionId, message);

      const hydratedSession = gateway.assembleHydratedState(userId, sessionId, {
        eventStore: {
          append: (event: unknown) => {
            eventStore.append(event as EventRecord | EventRecord[]);
          },
          query: (filters: { sessionId?: string; eventType?: string }) => {
            return eventStore.query(filters);
          },
        },
        summaryStore,
        transcriptStore,
        runtimeActionStore: runtimeActionStore as unknown as {
          findBySessionId?: (sessionId: string) => Array<{ actionId: string; status: string; targetRef?: Record<string, unknown> }>;
        },
      });

      const permissionContext = this.createPermissionContext(userId, sessionId, 'ask_on_write');
      const input: ForegroundMessageInput = {
        message,
        userId,
        sessionId,
        turnId: idGenerator.custom('turn'),
        timestamp: clock.nowISO(),
      };

      const state: ForegroundSessionState = {
        hydratedSession,
        activeWorkRefs: hydratedSession.activeWorkRefs,
        currentPersona: {
          personaId: 'default',
          name: 'Assistant',
          directDelegationPolicy: {
            estimatedStepsGte: 3,
            maxComplexity: 'medium',
            allowedToolCategories: ['read', 'search', 'internal'],
          },
        },
        effectivePolicy: {
          estimatedStepsGte: 3,
          maxComplexity: 'medium',
          allowedToolCategories: ['read', 'search', 'internal'],
        },
      };

      const decision = foregroundAgent.processMessage(input, state);

      const toolExecutions: Array<{ toolCallId: string; toolName: string; status: string }> = [];

      if (decision.route === 'dispatch_tool' && decision.suggestedTools && decision.suggestedTools.length > 0) {
        const toolName = decision.suggestedTools[0];
        const toolCallId = idGenerator.custom('tool_call');

        const action: RuntimeAction = {
          actionId: idGenerator.custom('action'),
          actionType: 'execute_tool',
          source: { sourceModule: 'foreground' },
          targetRuntime: 'tool_plane',
          targetAction: 'execute_tool',
          payload: {
            toolCallId,
            toolName,
            params: {},
            userId,
            sessionId,
            permissionContext,
          },
          correlationId: envelope.envelopeId,
          sessionId,
          userId,
          status: 'created',
          createdAt: clock.nowISO(),
          updatedAt: clock.nowISO(),
        };

        const dispatchResult = await dispatcher.dispatch({
          requestId: idGenerator.custom('dispatch'),
          action,
          context: {
            callerModule: 'foreground',
            userId,
            sessionId,
          },
        });

        const toolExec = toolExecutionStore.getById(toolCallId);
        if (toolExec) {
          toolExecutions.push({
            toolCallId: toolExec.toolCallId,
            toolName: toolExec.toolName,
            status: toolExec.status,
          });
        }

        if (dispatchResult.status === 'waiting_for_approval' || (dispatchResult.status === 'denied' && dispatchResult.waitingState?.waitingFor === 'approval')) {
          const approvalId = dispatchResult.waitingState?.approvalId;
          const outbound = gateway.formatOutbound(
            'approval_request',
            {
              text: `Approval required for tool: ${toolName}`,
              approvalRequest: { approvalId, toolName },
            },
            { userId, sessionId },
            envelope.envelopeId
          );
          outboundEnvelopes.push(outbound);
        } else if (dispatchResult.status === 'completed') {
          const outbound = gateway.formatOutbound(
            'text',
            { text: `Tool executed: ${toolName}` },
            { userId, sessionId },
            envelope.envelopeId
          );
          outboundEnvelopes.push(outbound);
        }
      } else if (decision.route === 'answer_directly') {
        const outbound = gateway.formatOutbound(
          'text',
          { text: decision.userVisibleResponse || 'I understand.' },
          { userId, sessionId },
          envelope.envelopeId
        );
        outboundEnvelopes.push(outbound);
      }

      const transcripts = transcriptStore.findBySession(sessionId).map(t => ({
        turnId: t.turnId,
        input: { userMessageSummary: t.input.userMessageSummary },
        output: { visibleMessages: t.output.visibleMessages },
      }));

      transcriptStore.saveTurn({
        turnId: idGenerator.custom('turn'),
        sessionId,
        userId,
        input: {
          inboundEventId: envelope.envelopeId,
          userMessageSummary: message,
        },
        output: {
          visibleMessages: outboundEnvelopes
            .filter(e => e.messageType === 'text')
            .map(e => ({
              messageId: e.envelopeId,
              role: 'assistant' as const,
              content: e.content.text || '',
            })),
        },
        visibility: 'public',
        createdAt: clock.nowISO(),
      });

      return {
        envelope,
        foregroundDecision: {
          route: decision.route,
          requiresPlanner: decision.requiresPlanner,
          reason: decision.reason,
          userVisibleResponse: decision.userVisibleResponse,
        },
        outboundEnvelopes: [...outboundEnvelopes],
        toolExecutions,
        transcripts,
      };
    },

    async sendApprovalResponse(
      userId: string,
      sessionId: string,
      approvalId: string,
      approved: boolean
    ): Promise<E2EApprovalResult> {
      const approval = approvalStore.getById(approvalId);
      if (!approval) {
        return { success: false, approvalId };
      }

      approvalStore.update(approvalId, {
        status: approved ? 'approved' : 'rejected',
        respondedAt: clock.nowISO(),
        responseBy: userId,
        responseReason: approved ? 'User approved' : 'User rejected',
      });

      if (approved && approval.actionType.startsWith('tool:')) {
        const toolName = approval.actionType.replace('tool:', '');
        const toolCallId = idGenerator.custom('tool_call');

        const permissionContext: PermissionContext = {
          userId,
          sessionId,
          mode: 'ask_on_write',
          grants: [{
            id: idGenerator.custom('grant'),
            userId,
            scope: 'session',
            action: approval.actionType,
            resourcePattern: approval.resource || '*',
            createdAt: clock.nowISO(),
            updatedAt: clock.nowISO(),
          }],
          metadata: {},
        };

        const params = approval.metadata
          ? JSON.parse(approval.metadata)
          : {};

        const result = await toolExecutor.execute({
          toolCallId,
          toolName,
          params,
          userId,
          sessionId,
          permissionContext,
        });

        return {
          success: true,
          approvalId,
          toolExecution: {
            toolCallId,
            toolName,
            status: result.success ? 'completed' : 'failed',
          },
        };
      }

      return { success: true, approvalId };
    },

    close(): void {
      connection.close();
    },
  };

  return harness;
}
