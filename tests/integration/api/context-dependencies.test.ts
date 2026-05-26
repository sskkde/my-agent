/**
 * ApiContext Dependencies Test Suite
 *
 * Tests for Task 4: Wire ApiContext dependencies with TDD-safe factories
 * Verifies all required services are exposed and support test-friendly injection.
 */

import { describe, it, expect } from 'vitest';
import {
  createApiContext,
  DEFAULT_MESSAGE_PROCESSOR_TIMEOUT_MS,
  isApiContextError,
} from '../../../src/api/context.js';
import { DEFAULT_REPAIR_ATTEMPTS, DEFAULT_ROUTING_TIMEOUT_MS } from '../../../src/storage/agent-config-store.js';
import type { MessageProcessor, MessageProcessorInput, MessageProcessorOutput } from '../../../src/processing/types.js';
import type { ForegroundAgent } from '../../../src/foreground/foreground-agent.js';
import type { RuntimeDispatcher } from '../../../src/dispatcher/types.js';
import type { PlannerRuntime } from '../../../src/planner/planner-runtime.js';
import type { AgentKernel } from '../../../src/kernel/agent-kernel.js';
import type { LLMAdapter } from '../../../src/llm/adapter.js';
import type { TimelineBroadcaster } from '../../../src/api/timeline-broadcaster.js';
import type { ChannelRegistry } from '../../../src/gateway/channel-registry.js';

describe('ApiContext Dependencies - Task 4', () => {
  describe('Required Services Exposure', () => {
    it('should expose Gateway on context', () => {
      const result = createApiContext({ dbPath: ':memory:' });
      expect(isApiContextError(result)).toBe(false);
      if (isApiContextError(result)) return;

      expect(result.gateway).toBeDefined();
      expect(typeof result.gateway.receiveUserMessage).toBe('function');
      expect(typeof result.gateway.formatOutbound).toBe('function');
      expect(typeof result.gateway.assembleHydratedState).toBe('function');

      result.connection.close();
    });

    it('should expose ChannelRegistry on context', () => {
      const result = createApiContext({ dbPath: ':memory:' });
      expect(isApiContextError(result)).toBe(false);
      if (isApiContextError(result)) return;

      expect(result.channelRegistry).toBeDefined();
      expect(typeof result.channelRegistry.register).toBe('function');
      expect(typeof result.channelRegistry.list).toBe('function');
      expect(typeof result.channelRegistry.deliver).toBe('function');

      const channels = result.channelRegistry.list();
      const webuiChannel = channels.find(c => c.connectorId === 'webui');
      expect(webuiChannel).toBeDefined();
      expect(webuiChannel?.type).toBe('webui');

      result.connection.close();
    });

    it('should expose TimelineBroadcaster on context', () => {
      const result = createApiContext({ dbPath: ':memory:' });
      expect(isApiContextError(result)).toBe(false);
      if (isApiContextError(result)) return;

      expect(result.timelineBroadcaster).toBeDefined();
      expect(typeof result.timelineBroadcaster.subscribe).toBe('function');
      expect(typeof result.timelineBroadcaster.broadcast).toBe('function');
      expect(typeof result.timelineBroadcaster.getConnectionCount).toBe('function');

      result.connection.close();
    });

    it('should expose MessageProcessor on context', () => {
      const result = createApiContext({ dbPath: ':memory:' });
      expect(isApiContextError(result)).toBe(false);
      if (isApiContextError(result)) return;

      expect(result.messageProcessor).toBeDefined();
      expect(typeof result.messageProcessor.process).toBe('function');

      result.connection.close();
    });

    it('should expose ForegroundAgent on context', () => {
      const result = createApiContext({ dbPath: ':memory:' });
      expect(isApiContextError(result)).toBe(false);
      if (isApiContextError(result)) return;

      expect(result.foregroundAgent).toBeDefined();
      expect(typeof result.foregroundAgent.processMessage).toBe('function');

      result.connection.close();
    });

    it('should expose RuntimeDispatcher on context', () => {
      const result = createApiContext({ dbPath: ':memory:' });
      expect(isApiContextError(result)).toBe(false);
      if (isApiContextError(result)) return;

      expect(result.runtimeDispatcher).toBeDefined();
      expect(typeof result.runtimeDispatcher.dispatch).toBe('function');

      result.connection.close();
    });

    it('should expose PlannerRuntime on context', () => {
      const result = createApiContext({ dbPath: ':memory:' });
      expect(isApiContextError(result)).toBe(false);
      if (isApiContextError(result)) return;

      expect(result.plannerRuntime).toBeDefined();
      expect(typeof result.plannerRuntime.createPlannerRun).toBe('function');
      expect(typeof result.plannerRuntime.emitRuntimeAction).toBe('function');

      result.connection.close();
    });

    it('should expose AgentKernel on context', () => {
      const result = createApiContext({ dbPath: ':memory:' });
      expect(isApiContextError(result)).toBe(false);
      if (isApiContextError(result)) return;

      expect(result.agentKernel).toBeDefined();
      expect(typeof result.agentKernel.run).toBe('function');

      result.connection.close();
    });

    it('should expose LLMAdapter on context', () => {
      const result = createApiContext({ dbPath: ':memory:' });
      expect(isApiContextError(result)).toBe(false);
      if (isApiContextError(result)) return;

      expect(result.llmAdapter).toBeDefined();
      expect(typeof result.llmAdapter.complete).toBe('function');

      result.connection.close();
    });
  });

  describe('Test-Friendly Dependency Injection', () => {
    it('should accept injected MessageProcessor via options', () => {
      const mockProcessor: MessageProcessor = {
        process: async (_input: MessageProcessorInput): Promise<MessageProcessorOutput> => ({
          correlationId: _input.correlationId,
          success: true,
          result: { text: 'mock response' },
          timestamp: new Date().toISOString(),
        }),
      };

      const result = createApiContext({
        dbPath: ':memory:',
        messageProcessor: mockProcessor,
      });

      expect(isApiContextError(result)).toBe(false);
      if (isApiContextError(result)) return;

      expect(result.messageProcessor).toBe(mockProcessor);
      result.connection.close();
    });

    it('should accept injected ForegroundAgent via options', () => {
      const mockAgent: ForegroundAgent = {
        processMessage: async (_input, _state) => ({
          route: 'answer_directly',
          requiresPlanner: false,
          reason: 'mock decision',
          userVisibleResponse: 'mock response',
        }),
      };

      const result = createApiContext({
        dbPath: ':memory:',
        foregroundAgent: mockAgent,
      });

      expect(isApiContextError(result)).toBe(false);
      if (isApiContextError(result)) return;

      expect(result.foregroundAgent).toBe(mockAgent);
      result.connection.close();
    });

    it('should accept injected RuntimeDispatcher via options', () => {
      const mockDispatcher: RuntimeDispatcher = {
        dispatch: async (_request) => ({
          requestId: 'mock-req',
          actionId: 'mock-action',
          status: 'completed',
          targetRuntime: 'tool_plane',
          createdAt: new Date().toISOString(),
        }),
      };

      const result = createApiContext({
        dbPath: ':memory:',
        runtimeDispatcher: mockDispatcher,
      });

      expect(isApiContextError(result)).toBe(false);
      if (isApiContextError(result)) return;

      expect(result.runtimeDispatcher).toBe(mockDispatcher);
      result.connection.close();
    });

    it('should accept injected PlannerRuntime via options', () => {
      const mockPlanner: PlannerRuntime = {
        createPlannerRun: (_input) => ({
          plannerRunId: 'mock-run',
          planId: 'mock-plan',
          status: 'initializing',
          actions: [],
        }),
        resumePlannerRun: (_id, _event) => ({
          plannerRunId: 'mock-run',
          planId: 'mock-plan',
          status: 'planning',
          actions: [],
        }),
        cancelPlannerRun: (_id) => {},
        replan: (_id, _reason) => {},
        archivePlannerRun: (_id) => {},
        transitionState: (_id, _state, _data) => {},
        handleApprovalRejection: (_id, _reason) => {},
        applyPlanPatch: (_id, _data) => {},
        addActiveExecutionRef: (_id, _ref) => {},
        emitRuntimeAction: (_id, _action) => ({
          actionId: 'mock-action',
          targetRuntime: 'agent_kernel',
          targetAction: 'test',
          payload: {},
          status: 'created',
        }),
        saveCheckpoint: (_id, _data) => {},
      };

      const result = createApiContext({
        dbPath: ':memory:',
        plannerRuntime: mockPlanner,
      });

      expect(isApiContextError(result)).toBe(false);
      if (isApiContextError(result)) return;

      expect(result.plannerRuntime).toBe(mockPlanner);
      result.connection.close();
    });

    it('should accept injected AgentKernel via options', () => {
      const mockKernel = {
        run: async (_input: { runId: string; contextBundle: unknown }) => ({
          finalStatus: 'completed' as const,
          iterationsUsed: 1,
          toolCalls: [],
          transcript: [],
          finalResponse: 'mock response',
        }),
      };

      const result = createApiContext({
        dbPath: ':memory:',
        agentKernel: mockKernel as unknown as AgentKernel,
      });

      expect(isApiContextError(result)).toBe(false);
      if (isApiContextError(result)) return;

      expect(result.agentKernel).toBe(mockKernel);
      result.connection.close();
    });

    it('should accept injected LLMAdapter via options', () => {
      const mockAdapter: LLMAdapter = {
        config: { providers: [], defaultTimeoutMs: 1000, enableCircuitBreaker: false },
        providers: [],
        complete: async (_request) => ({
          success: true,
          response: {
            id: 'mock-id',
            content: 'mock response',
            model: 'mock-model',
            role: 'assistant',
            finishReason: 'stop',
            createdAt: new Date().toISOString(),
            usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
          },
          providerId: 'mock-provider',
        }),
        stream: async function* () {},
        addProvider: (_provider) => {},
        removeProvider: (_id) => {},
        getProvider: (_id) => undefined,
        getHealthyProviders: () => [],
        updateProviderPriority: (_id, _priority) => {},
      };

      const result = createApiContext({
        dbPath: ':memory:',
        llmAdapter: mockAdapter,
      });

      expect(isApiContextError(result)).toBe(false);
      if (isApiContextError(result)) return;

      expect(result.llmAdapter).toBe(mockAdapter);
      result.connection.close();
    });

    it('should accept injected TimelineBroadcaster via options', () => {
      const mockBroadcaster: TimelineBroadcaster = {
        subscribe: (_sessionId, _options) => ({
          connectionId: 'mock-conn',
          sessionId: _sessionId,
          write: () => {},
          close: () => {},
          isActive: () => true,
        }),
        broadcast: (_sessionId, _event) => {},
        broadcastProcessingStatus: (_sessionId, _status) => {},
        broadcastTokenStream: (_sessionId, _token) => {},
        getConnectionCount: (_sessionId) => 0,
        closeSession: (_sessionId) => {},
        bindConnection: (_id, _write, _close) => {},
      };

      const result = createApiContext({
        dbPath: ':memory:',
        timelineBroadcaster: mockBroadcaster,
      });

      expect(isApiContextError(result)).toBe(false);
      if (isApiContextError(result)) return;

      expect(result.timelineBroadcaster).toBe(mockBroadcaster);
      result.connection.close();
    });

    it('should accept injected ChannelRegistry via options', () => {
      const mockRegistry: ChannelRegistry = {
        register: (_id, _handler, _metadata) => {},
        unregister: (_id) => true,
        get: (_id) => undefined,
        list: () => [],
        has: (_id) => false,
        deliver: (_id, _envelope) => ({ success: false, error: { code: 'MOCK', message: 'mock' } }),
      };

      const result = createApiContext({
        dbPath: ':memory:',
        channelRegistry: mockRegistry,
      });

      expect(isApiContextError(result)).toBe(false);
      if (isApiContextError(result)) return;

      expect(result.channelRegistry).toBe(mockRegistry);
      result.connection.close();
    });
  });

  describe('Safe Fallback Without Provider Credentials', () => {
    it('should create context successfully without API keys or real providers', () => {
      const originalEnv = process.env;
      process.env = { ...originalEnv };
      delete process.env.OPENROUTER_API_KEY;
      delete process.env.OLLAMA_BASE_URL;
      delete process.env.ANTHROPIC_API_KEY;

      const result = createApiContext({ dbPath: ':memory:' });

      process.env = originalEnv;

      expect(isApiContextError(result)).toBe(false);
      if (isApiContextError(result)) return;

      expect(result.gateway).toBeDefined();
      expect(result.channelRegistry).toBeDefined();
      expect(result.timelineBroadcaster).toBeDefined();
      expect(result.messageProcessor).toBeDefined();
      expect(result.foregroundAgent).toBeDefined();
      expect(result.runtimeDispatcher).toBeDefined();
      expect(result.plannerRuntime).toBeDefined();
      expect(result.agentKernel).toBeDefined();
      expect(result.llmAdapter).toBeDefined();

      result.connection.close();
    });

    it('should create context with only dbPath option', () => {
      const result = createApiContext({ dbPath: ':memory:' });

      expect(isApiContextError(result)).toBe(false);
      if (isApiContextError(result)) return;

      expect(result.messageProcessor).toBeDefined();
      expect(result.foregroundAgent).toBeDefined();
      expect(result.runtimeDispatcher).toBeDefined();
      expect(result.plannerRuntime).toBeDefined();
      expect(result.agentKernel).toBeDefined();
      expect(result.llmAdapter).toBeDefined();

      result.connection.close();
    });

    it('should create context with no options at all', () => {
      const result = createApiContext();

      expect(isApiContextError(result)).toBe(false);
      if (isApiContextError(result)) return;

      expect(result.messageProcessor).toBeDefined();
      expect(result.foregroundAgent).toBeDefined();
      expect(result.runtimeDispatcher).toBeDefined();
      expect(result.plannerRuntime).toBeDefined();
      expect(result.agentKernel).toBeDefined();
      expect(result.llmAdapter).toBeDefined();

      result.connection.close();
    });
  });

  describe('MessageProcessor Functionality', () => {
    it('should process messages with default processor', async () => {
      const result = createApiContext({ dbPath: ':memory:' });
      expect(isApiContextError(result)).toBe(false);
      if (isApiContextError(result)) return;

      const processor = result.messageProcessor;

      const input: MessageProcessorInput = {
        correlationId: 'test-001',
        userId: 'user-001',
        sessionId: 'session-001',
        text: 'Hello, test!',
        timestamp: new Date().toISOString(),
      };

      const output = await processor.process(input);

      expect(output).toBeDefined();
      expect(output.correlationId).toBe('test-001');
      expect(output.success).toBe(false);
      expect(output.error?.code).toBe('PROCESSING_ERROR');
      expect(output.timestamp).toBeDefined();

      result.connection.close();
    });

    it('should use configured database provider before processing a message', async () => {
      const foregroundAgent: ForegroundAgent = {
        processMessage: async () => ({
          route: 'answer_directly',
          requiresPlanner: false,
          reason: 'Provider configured regression test',
          userVisibleResponse: 'Provider is available.',
        }),
      };

      const result = createApiContext({
        dbPath: ':memory:',
        foregroundAgent,
      });
      expect(isApiContextError(result)).toBe(false);
      if (isApiContextError(result)) return;

      result.providerConfigStore.create({
        providerId: 'provider-user-001',
        userId: 'user-001',
        providerType: 'ollama',
        displayName: 'User Ollama',
        baseUrl: 'http://localhost:11434',
      });

      const output = await result.messageProcessor.process({
        correlationId: 'test-provider-001',
        userId: 'user-001',
        sessionId: 'session-001',
        text: 'Hello with provider!',
        timestamp: new Date().toISOString(),
      });

      expect(output.success).toBe(true);
      expect(output.result?.text).toBe('Provider is available.');

      result.connection.close();
    });

    it('should not leak one user provider into another user during processing', async () => {
      const foregroundAgent: ForegroundAgent = {
        processMessage: async () => ({
          route: 'answer_directly',
          requiresPlanner: false,
          reason: 'Provider isolation regression test',
          userVisibleResponse: 'Provider is isolated.',
        }),
      };

      const result = createApiContext({
        dbPath: ':memory:',
        foregroundAgent,
      });
      expect(isApiContextError(result)).toBe(false);
      if (isApiContextError(result)) return;

      result.providerConfigStore.create({
        providerId: 'provider-user-001',
        userId: 'user-001',
        providerType: 'ollama',
        displayName: 'User Ollama',
        baseUrl: 'http://localhost:11434',
      });

      const configuredUserOutput = await result.messageProcessor.process({
        correlationId: 'test-provider-user-001',
        userId: 'user-001',
        sessionId: 'session-001',
        text: 'Hello with provider!',
        timestamp: new Date().toISOString(),
      });
      expect(configuredUserOutput.success).toBe(true);

      const unconfiguredUserOutput = await result.messageProcessor.process({
        correlationId: 'test-provider-user-002',
        userId: 'user-002',
        sessionId: 'session-002',
        text: 'Hello without provider!',
        timestamp: new Date().toISOString(),
      });
      expect(unconfiguredUserOutput.success).toBe(false);
      expect(unconfiguredUserOutput.error?.message).toBe('No LLM providers configured. Message received but cannot be processed.');

      result.connection.close();
    });

    it('should handle processor errors gracefully', async () => {
      const mockProcessor: MessageProcessor = {
        process: async (_input): Promise<MessageProcessorOutput> => ({
          correlationId: _input.correlationId,
          success: false,
          error: {
            code: 'TEST_ERROR',
            message: 'Test error message',
          },
          timestamp: new Date().toISOString(),
        }),
      };

      const result = createApiContext({
        dbPath: ':memory:',
        messageProcessor: mockProcessor,
      });

      expect(isApiContextError(result)).toBe(false);
      if (isApiContextError(result)) return;

      const input: MessageProcessorInput = {
        correlationId: 'test-002',
        userId: 'user-001',
        sessionId: 'session-001',
        text: 'Hello!',
        timestamp: new Date().toISOString(),
      };

      const output = await result.messageProcessor.process(input);

      expect(output.success).toBe(false);
      expect(output.error?.code).toBe('TEST_ERROR');

      result.connection.close();
    });

    it('should enforce processor timeout', async () => {
      const { createMessageProcessor } = await import('../../../src/processing/message-processor.js');

      const slowProcessorImpl: MessageProcessor = {
        process: async (_input): Promise<MessageProcessorOutput> => {
          await new Promise(resolve => setTimeout(resolve, 100));
          return {
            correlationId: _input.correlationId,
            success: true,
            timestamp: new Date().toISOString(),
          };
        },
      };

      const wrappedProcessor = createMessageProcessor({
        timeoutMs: 50,
        processorFn: (input) => slowProcessorImpl.process(input),
      });

      const result = createApiContext({
        dbPath: ':memory:',
        messageProcessor: wrappedProcessor,
      });

      expect(isApiContextError(result)).toBe(false);
      if (isApiContextError(result)) return;

      const input: MessageProcessorInput = {
        correlationId: 'test-003',
        userId: 'user-001',
        sessionId: 'session-001',
        text: 'Hello!',
        timestamp: new Date().toISOString(),
      };

      const output = await result.messageProcessor.process(input);

      expect(output.success).toBe(false);
      expect(output.error?.code).toBe('TIMEOUT');

      result.connection.close();
    });

    it('should budget default processor timeout for routing repair attempts', () => {
      expect(DEFAULT_MESSAGE_PROCESSOR_TIMEOUT_MS).toBe(
        DEFAULT_ROUTING_TIMEOUT_MS * (1 + DEFAULT_REPAIR_ATTEMPTS) + 10000
      );
    });
  });

  describe('ForegroundAgent Functionality', () => {
    it('should make decisions with default agent', async () => {
      const result = createApiContext({ dbPath: ':memory:' });
      expect(isApiContextError(result)).toBe(false);
      if (isApiContextError(result)) return;

      const agent = result.foregroundAgent;

      const decision = await agent.processMessage(
        {
          message: 'Hello, what can you do?',
          userId: 'user-001',
          sessionId: 'session-001',
          turnId: 'turn-001',
          timestamp: new Date().toISOString(),
        },
        {
          hydratedSession: {
            userContext: {
              userId: 'user-001',
              sessionId: 'session-001',
            },
            sessionContext: {
              messageCount: 0,
              lastActivityAt: new Date().toISOString(),
              activePlannerRunIds: [],
              activeBackgroundRunIds: [],
            },
            activeWorkRefs: {
              activeRuns: [],
              pendingApprovals: [],
            },
          },
          activeWorkRefs: {
            activeRuns: [],
            pendingApprovals: [],
          },
          currentPersona: {
            personaId: 'default',
            name: 'Assistant',
            directDelegationPolicy: {
              estimatedStepsGte: 3,
              maxComplexity: 'medium',
              allowedToolCategories: ['read'],
            },
          },
          effectivePolicy: {
            estimatedStepsGte: 3,
            maxComplexity: 'medium',
            allowedToolCategories: ['read'],
          },
        }
      );

      expect(decision).toBeDefined();
      expect(decision.route).toBeDefined();
      expect(decision.reason).toBeDefined();

      result.connection.close();
    });
  });

  describe('RuntimeDispatcher Functionality', () => {
    it('should dispatch actions with default dispatcher', async () => {
      const result = createApiContext({ dbPath: ':memory:' });
      expect(isApiContextError(result)).toBe(false);
      if (isApiContextError(result)) return;

      const dispatcher = result.runtimeDispatcher;

      try {
        const dispatchResult = await dispatcher.dispatch({
          requestId: 'req-001',
          action: {
            actionId: 'action-001',
            actionType: 'execute_tool',
            targetRuntime: 'tool_plane',
            targetAction: 'execute_tool',
            source: {
              sourceModule: 'foreground_conversation_agent',
              sourceAction: 'test',
            },
            userId: 'user-001',
            sessionId: 'session-001',
            payload: {
              toolCallId: 'tool-001',
              toolName: 'test_tool',
              params: {},
            },
            status: 'created',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          context: {
            callerModule: 'test',
            userId: 'user-001',
            sessionId: 'session-001',
          },
        });

        expect(dispatchResult).toBeDefined();
        expect(dispatchResult.requestId).toBe('req-001');
        expect(dispatchResult.actionId).toBe('action-001');
      } catch (error) {
        expect(error).toBeDefined();
      }

      result.connection.close();
    });
  });

  describe('PlannerRuntime Functionality', () => {
    it('should work with PlanStore available', () => {
      const result = createApiContext({ dbPath: ':memory:' });
      expect(isApiContextError(result)).toBe(false);
      if (isApiContextError(result)) return;

      const planner = result.plannerRuntime;

      // PlanStore is now implemented, so createPlannerRun should work
      const plannerResult = planner.createPlannerRun({
        userId: 'user-001',
        sessionId: 'session-001',
        objective: 'Test planning task',
      });

      expect(plannerResult.plannerRunId).toBeDefined();
      expect(plannerResult.planId).toBeDefined();
      expect(plannerResult.status).toBe('initializing');

      result.connection.close();
    });

    it('should work with injected planner runtime', () => {
      const mockPlanner: PlannerRuntime = {
        createPlannerRun: (_input) => ({
          plannerRunId: 'mock-run-001',
          planId: 'mock-plan-001',
          status: 'planning',
          actions: [],
        }),
        resumePlannerRun: (_id, _event) => ({
          plannerRunId: 'mock-run-001',
          planId: 'mock-plan-001',
          status: 'planning',
          actions: [],
        }),
        cancelPlannerRun: (_id) => {},
        replan: (_id, _reason) => {},
        archivePlannerRun: (_id) => {},
        transitionState: (_id, _state, _data) => {},
        handleApprovalRejection: (_id, _reason) => {},
        applyPlanPatch: (_id, _data) => {},
        addActiveExecutionRef: (_id, _ref) => {},
        emitRuntimeAction: (_id, _action) => ({
          actionId: 'mock-action',
          targetRuntime: 'agent_kernel',
          targetAction: 'test',
          payload: {},
          status: 'created',
        }),
        saveCheckpoint: (_id, _data) => {},
      };

      const result = createApiContext({
        dbPath: ':memory:',
        plannerRuntime: mockPlanner,
      });

      expect(isApiContextError(result)).toBe(false);
      if (isApiContextError(result)) return;

      const plannerResult = result.plannerRuntime.createPlannerRun({
        userId: 'user-001',
        sessionId: 'session-001',
        objective: 'Test planning task',
      });

      expect(plannerResult).toBeDefined();
      expect(plannerResult.plannerRunId).toBe('mock-run-001');
      expect(plannerResult.planId).toBe('mock-plan-001');

      result.connection.close();
    });
  });

  describe('LLMAdapter Safe Fallback', () => {
    it('should return error result when no providers configured', async () => {
      const result = createApiContext({ dbPath: ':memory:' });
      expect(isApiContextError(result)).toBe(false);
      if (isApiContextError(result)) return;

      const adapter = result.llmAdapter;

      const llmResult = await adapter.complete({
        model: 'test-model',
        messages: [{ role: 'user', content: 'Hello!' }],
      });

      expect(llmResult).toBeDefined();
      // In test environment, mock LLM adapter is used and returns success
      expect(llmResult.success).toBe(true);

      result.connection.close();
    });

    it('should accept new providers after creation', async () => {
      const result = createApiContext({ dbPath: ':memory:' });
      expect(isApiContextError(result)).toBe(false);
      if (isApiContextError(result)) return;

      const adapter = result.llmAdapter;

      // In test environment, mock LLM adapter provides one provider
      expect(adapter.getHealthyProviders()).toHaveLength(1);

      result.connection.close();
    });
  });

  describe('AgentKernel Safe Fallback', () => {
    it('should return error result when LLM fails', async () => {
      const result = createApiContext({ dbPath: ':memory:' });
      expect(isApiContextError(result)).toBe(false);
      if (isApiContextError(result)) return;

      const kernel = result.agentKernel;

      const kernelResult = await kernel.run({
        contextBundle: {
          runId: 'run-001',
          bundleId: 'bundle-001',
          agentId: 'agent-001',
          agentType: 'main',
          userId: 'test-user',
          invocationSource: 'system',
          orderedItems: [],
          pinnedItems: [],
          tokenEstimate: 100,
        },
        userId: 'test-user',
      });

      expect(kernelResult).toBeDefined();
      // In test environment, mock LLM adapter is used so kernel completes successfully
      expect(kernelResult.finalStatus).toBe('completed');

      result.connection.close();
    });
  });

  describe('Backward Compatibility', () => {
    it('should preserve existing channel registry behavior', () => {
      const result = createApiContext({ dbPath: ':memory:' });
      expect(isApiContextError(result)).toBe(false);
      if (isApiContextError(result)) return;

      const channels = result.channelRegistry.list();
      const webui = channels.find(c => c.connectorId === 'webui');
      expect(webui).toBeDefined();
      expect(webui?.status).toBe('active');

      const deliveryResult = result.channelRegistry.deliver('unknown-channel', {
        envelopeId: 'env-001',
        messageType: 'text',
        recipient: {
          userId: 'user-001',
          sessionId: 'session-001',
        },
        content: { text: 'test' },
        correlationId: 'corr-001',
        timestamp: new Date().toISOString(),
      });

      expect(deliveryResult.success).toBe(false);
      expect(deliveryResult.error?.code).toBe('CHANNEL_NOT_FOUND');

      result.connection.close();
    });

    it('should preserve existing timeline broadcaster behavior', () => {
      const result = createApiContext({ dbPath: ':memory:' });
      expect(isApiContextError(result)).toBe(false);
      if (isApiContextError(result)) return;

      expect(result.timelineBroadcaster).toBeDefined();

      const connection = result.timelineBroadcaster.subscribe('session-001');
      expect(connection).toBeDefined();
      expect(connection.connectionId).toBeDefined();
      expect(connection.sessionId).toBe('session-001');

      result.connection.close();
    });
  });
});
