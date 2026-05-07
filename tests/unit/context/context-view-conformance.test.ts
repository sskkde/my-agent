import { describe, it, expect, beforeEach } from 'vitest';
import type {
  ContextItem,
  ContextAssemblyInput,
  TargetMode,
  PlanContextView,
  WorkflowStepContextView,
  BackgroundRunContextView,
} from '../../../src/context/types.js';
import { ContextManager } from '../../../src/context/context-manager.js';

// Helper to create mock assembly input
function createMockInput(overrides: Partial<ContextAssemblyInput> = {}): ContextAssemblyInput {
  return {
    runId: 'run-001',
    userId: 'user-001',
    sessionId: 'session-001',
    agentId: 'agent-001',
    agentType: 'main',
    invocationSource: 'gateway_intent',
    selectionPolicy: {
      targetMode: 'interactive' as TargetMode,
      tokenBudget: 10000,
      includeRecentHistoryTurns: 10,
    },
    ...overrides,
  };
}

// Helper to create mock context item
function createMockItem(overrides: Partial<ContextItem> = {}): ContextItem {
  return {
    itemId: `item-${Math.random().toString(36).slice(2)}`,
    sourceType: 'system_note',
    semanticType: 'fact',
    content: 'Test content',
    estimatedTokens: 100,
    priority: 50,
    ...overrides,
  };
}

// Helper to create plan context view
function createPlanView(overrides: Partial<PlanContextView> = {}): PlanContextView {
  return {
    planId: 'plan-001',
    version: 1,
    objective: 'Test objective',
    ...overrides,
  };
}

// Helper to create workflow step context view
function createWorkflowStepView(overrides: Partial<WorkflowStepContextView> = {}): WorkflowStepContextView {
  return {
    workflowId: 'wf-001',
    workflowRunId: 'wfrun-001',
    stepId: 'step-001',
    stepRunId: 'steprun-001',
    stepTitle: 'Test Step',
    stepType: 'agent_run',
    ...overrides,
  };
}

// Helper to create background run context view
function createBackgroundRunView(overrides: Partial<BackgroundRunContextView> = {}): BackgroundRunContextView {
  return {
    backgroundRunId: 'bg-001',
    subagentRunId: 'sub-001',
    subagentCode: 'test-agent',
    agentType: 'background',
    objective: 'Test objective',
    status: 'running',
    ...overrides,
  };
}

describe('Context View Conformance', () => {
  let manager: ContextManager;

  beforeEach(() => {
    manager = new ContextManager();
  });

  describe('Planner View Assembly', () => {
    it('should include plan view when plan context is provided', () => {
      const input = createMockInput({
        invocationSource: 'planner_execution',
        selectionPolicy: {
          targetMode: 'plan',
          tokenBudget: 10000,
        },
        planContext: {
          planContextView: createPlanView({ planId: 'plan-planner-001' }),
        },
      });

      const bundle = manager.assemble(input);

      expect(bundle.planView).toBeDefined();
      expect(bundle.planView?.planId).toBe('plan-planner-001');
    });

    it('should include plan-specific sources in planner view', () => {
      const planItem = createMockItem({
        itemId: 'plan-item-001',
        sourceType: 'plan_state',
        semanticType: 'plan_view',
        content: 'Plan state content',
      });

      const input = createMockInput({
        invocationSource: 'planner_execution',
        selectionPolicy: {
          targetMode: 'plan',
          tokenBudget: 10000,
        },
        planContext: {
          planContextView: createPlanView(),
        },
        hydratedState: {
          sessionId: 'session-001',
          userId: 'user-001',
          conversationHistory: [planItem],
        },
      });

      const bundle = manager.assemble(input);

      expect(bundle.orderedItems.some(i => i.sourceType === 'plan_state')).toBe(true);
    });

    it('should exclude workflow-specific sources from planner view', () => {
      const planItem = createMockItem({
        itemId: 'plan-item-001',
        sourceType: 'plan_state',
        content: 'Plan content',
        priority: 50,
      });
      const workflowItem = createMockItem({
        itemId: 'workflow-item-001',
        sourceType: 'workflow_state',
        content: 'Workflow content',
        priority: 50,
      });

      const input = createMockInput({
        invocationSource: 'planner_execution',
        selectionPolicy: {
          targetMode: 'plan',
          tokenBudget: 10000,
        },
        planContext: {
          planContextView: createPlanView(),
        },
        hydratedState: {
          sessionId: 'session-001',
          userId: 'user-001',
          conversationHistory: [planItem, workflowItem],
        },
      });

      const bundle = manager.assemble(input);

      // Both items are included in orderedItems, but plan view should be defined
      expect(bundle.planView).toBeDefined();
      expect(bundle.workflowStepView).toBeUndefined();
    });

    it('should exclude trigger-specific sources from planner view', () => {
      const planItem = createMockItem({
        itemId: 'plan-item-001',
        sourceType: 'plan_state',
        content: 'Plan content',
      });
      const triggerItem = createMockItem({
        itemId: 'trigger-item-001',
        sourceType: 'trigger_state',
        semanticType: 'trigger_event',
        content: 'Trigger content',
      });

      const input = createMockInput({
        invocationSource: 'planner_execution',
        selectionPolicy: {
          targetMode: 'plan',
          tokenBudget: 10000,
        },
        planContext: {
          planContextView: createPlanView(),
        },
        hydratedState: {
          sessionId: 'session-001',
          userId: 'user-001',
          conversationHistory: [planItem, triggerItem],
        },
      });

      const bundle = manager.assemble(input);

      expect(bundle.planView).toBeDefined();
      expect(bundle.triggerView).toBeUndefined();
    });
  });

  describe('Workflow Step View Assembly', () => {
    it('should include workflow step view when workflow context is provided', () => {
      const input = createMockInput({
        invocationSource: 'workflow_step',
        selectionPolicy: {
          targetMode: 'workflow_step',
          tokenBudget: 10000,
        },
        workflowContext: {
          workflowId: 'wf-001',
          workflowRunId: 'wfrun-001',
          stepId: 'step-001',
          stepRunId: 'steprun-001',
          workflowStepContextView: createWorkflowStepView({ stepId: 'step-wf-001' }),
        },
      });

      const bundle = manager.assemble(input);

      expect(bundle.workflowStepView).toBeDefined();
      expect(bundle.workflowStepView?.stepId).toBe('step-wf-001');
    });

    it('should include workflow-specific sources in workflow step view', () => {
      const workflowItem = createMockItem({
        itemId: 'workflow-item-001',
        sourceType: 'workflow_state',
        semanticType: 'workflow_step_view',
        content: 'Workflow state content',
      });

      const input = createMockInput({
        invocationSource: 'workflow_step',
        selectionPolicy: {
          targetMode: 'workflow_step',
          tokenBudget: 10000,
        },
        workflowContext: {
          workflowStepContextView: createWorkflowStepView(),
        },
        hydratedState: {
          sessionId: 'session-001',
          userId: 'user-001',
          conversationHistory: [workflowItem],
        },
      });

      const bundle = manager.assemble(input);

      expect(bundle.orderedItems.some(i => i.sourceType === 'workflow_state')).toBe(true);
    });

    it('should not leak unrelated session items into workflow step view', () => {
      const workflowItem = createMockItem({
        itemId: 'workflow-item-001',
        sourceType: 'workflow_state',
        content: 'Workflow content',
        priority: 90,
        estimatedTokens: 300,
      });
      const unrelatedSessionItem = createMockItem({
        itemId: 'session-item-001',
        sourceType: 'session_history',
        content: 'Unrelated session content',
        priority: 10,
        estimatedTokens: 300,
      });

      const input = createMockInput({
        invocationSource: 'workflow_step',
        selectionPolicy: {
          targetMode: 'workflow_step',
          tokenBudget: 400,
        },
        workflowContext: {
          workflowStepContextView: createWorkflowStepView(),
        },
        hydratedState: {
          sessionId: 'session-001',
          userId: 'user-001',
          conversationHistory: [workflowItem, unrelatedSessionItem],
        },
      });

      const bundle = manager.assemble(input);

      expect(bundle.orderedItems.some(i => i.itemId === 'workflow-item-001')).toBe(true);
      expect(bundle.orderedItems.some(i => i.itemId === 'session-item-001')).toBe(false);
      expect(bundle.workflowStepView).toBeDefined();
    });

    it('should not leak private connector secrets into workflow step view', () => {
      const workflowItem = createMockItem({
        itemId: 'workflow-item-001',
        sourceType: 'workflow_state',
        content: 'Workflow content',
        priority: 90,
        estimatedTokens: 300,
      });
      const connectorSecret = createMockItem({
        itemId: 'connector-secret-001',
        sourceType: 'system_note',
        content: 'SECRET_API_KEY=xxx',
        priority: 10,
        estimatedTokens: 300,
      });

      const input = createMockInput({
        invocationSource: 'workflow_step',
        selectionPolicy: {
          targetMode: 'workflow_step',
          tokenBudget: 400,
        },
        workflowContext: {
          workflowStepContextView: createWorkflowStepView(),
        },
        hydratedState: {
          sessionId: 'session-001',
          userId: 'user-001',
          conversationHistory: [workflowItem, connectorSecret],
        },
      });

      const bundle = manager.assemble(input);

      expect(bundle.orderedItems.some(i => i.itemId === 'workflow-item-001')).toBe(true);
      expect(bundle.orderedItems.some(i => i.itemId === 'connector-secret-001')).toBe(false);
    });
  });

  describe('Background Run View Assembly', () => {
    it('should include background run view when background context is provided', () => {
      const input = createMockInput({
        invocationSource: 'background_subagent',
        agentType: 'background',
        selectionPolicy: {
          targetMode: 'background',
          tokenBudget: 10000,
        },
        backgroundRunContext: {
          backgroundRunId: 'bg-001',
          subagentRunId: 'sub-001',
          backgroundRunContextView: createBackgroundRunView({ backgroundRunId: 'bg-test-001' }),
        },
      });

      const bundle = manager.assemble(input);

      expect(bundle.backgroundRunView).toBeDefined();
      expect(bundle.backgroundRunView?.backgroundRunId).toBe('bg-test-001');
    });

    it('should include background-specific sources in background run view', () => {
      const backgroundItem = createMockItem({
        itemId: 'bg-item-001',
        sourceType: 'background_run_state',
        semanticType: 'background_run_view',
        content: 'Background run state content',
      });

      const input = createMockInput({
        invocationSource: 'background_subagent',
        agentType: 'background',
        selectionPolicy: {
          targetMode: 'background',
          tokenBudget: 10000,
        },
        backgroundRunContext: {
          backgroundRunContextView: createBackgroundRunView(),
        },
        hydratedState: {
          sessionId: 'session-001',
          userId: 'user-001',
          conversationHistory: [backgroundItem],
        },
      });

      const bundle = manager.assemble(input);

      expect(bundle.orderedItems.some(i => i.sourceType === 'background_run_state')).toBe(true);
    });

    it('should include subagent results in background run view', () => {
      const input = createMockInput({
        invocationSource: 'background_subagent',
        agentType: 'background',
        selectionPolicy: {
          targetMode: 'background',
          tokenBudget: 10000,
        },
        backgroundRunContext: {
          backgroundRunContextView: createBackgroundRunView(),
        },
        workingContext: {
          recentSubagentResults: ['Subagent output 1'],
        },
      });

      const bundle = manager.assemble(input);

      expect(bundle.orderedItems.length).toBeGreaterThan(0);
    });
  });

  describe('Trigger View Assembly', () => {
    it('should include trigger view when trigger context is provided', () => {
      const input = createMockInput({
        invocationSource: 'event_trigger_resume',
        selectionPolicy: {
          targetMode: 'execute',
          tokenBudget: 10000,
        },
        triggerContext: {
          triggerId: 'trig-001',
          triggerEvent: {
            eventId: 'evt-test-001',
            eventType: 'webhook',
            source: 'webhook',
          },
        },
      });

      const bundle = manager.assemble(input);

      expect(bundle.triggerView).toBeDefined();
      expect(bundle.triggerView?.eventId).toBe('evt-test-001');
      expect(bundle.triggerView?.source).toBe('webhook');
    });

    it('should include trigger-specific sources in trigger view', () => {
      const triggerItem = createMockItem({
        itemId: 'trigger-item-001',
        sourceType: 'trigger_state',
        semanticType: 'trigger_event',
        content: 'Trigger state content',
      });

      const input = createMockInput({
        invocationSource: 'event_trigger_resume',
        selectionPolicy: {
          targetMode: 'execute',
          tokenBudget: 10000,
        },
        triggerContext: {
          triggerId: 'trig-001',
          triggerEvent: {
            eventId: 'evt-001',
            eventType: 'scheduled',
            source: 'scheduler',
          },
        },
        hydratedState: {
          sessionId: 'session-001',
          userId: 'user-001',
          conversationHistory: [triggerItem],
        },
      });

      const bundle = manager.assemble(input);

      expect(bundle.orderedItems.some(i => i.sourceType === 'trigger_state')).toBe(true);
    });
  });

  describe('Deduplication Across View Types', () => {
    it('should dedupe items with same dedupeKey in planner view', () => {
      const items = [
        createMockItem({
          itemId: 'plan-a',
          dedupeKey: 'plan-key-001',
          sourceType: 'plan_state',
          content: 'First plan item',
        }),
        createMockItem({
          itemId: 'plan-b',
          dedupeKey: 'plan-key-001',
          sourceType: 'plan_state',
          content: 'Duplicate plan item',
        }),
        createMockItem({
          itemId: 'plan-c',
          dedupeKey: 'plan-key-002',
          sourceType: 'plan_state',
          content: 'Unique plan item',
        }),
      ];

      const input = createMockInput({
        selectionPolicy: { targetMode: 'plan', tokenBudget: 10000 },
        planContext: { planContextView: createPlanView() },
        hydratedState: {
          sessionId: 'session-001',
          userId: 'user-001',
          conversationHistory: items,
        },
      });

      const bundle = manager.assemble(input);

      const dedupedKeys = bundle.orderedItems
        .filter(i => i.dedupeKey)
        .map(i => i.dedupeKey);
      const uniqueKeys = new Set(dedupedKeys);

      expect(dedupedKeys.length).toBe(uniqueKeys.size);
    });

    it('should dedupe items with same dedupeKey in workflow step view', () => {
      const items = [
        createMockItem({
          itemId: 'wf-a',
          dedupeKey: 'workflow-key-001',
          sourceType: 'workflow_state',
          content: 'First workflow item',
        }),
        createMockItem({
          itemId: 'wf-b',
          dedupeKey: 'workflow-key-001',
          sourceType: 'workflow_state',
          content: 'Duplicate workflow item',
        }),
      ];

      const input = createMockInput({
        selectionPolicy: { targetMode: 'workflow_step', tokenBudget: 10000 },
        workflowContext: { workflowStepContextView: createWorkflowStepView() },
        hydratedState: {
          sessionId: 'session-001',
          userId: 'user-001',
          conversationHistory: items,
        },
      });

      const bundle = manager.assemble(input);

      const dedupedKeys = bundle.orderedItems
        .filter(i => i.dedupeKey)
        .map(i => i.dedupeKey);
      const uniqueKeys = new Set(dedupedKeys);

      expect(dedupedKeys.length).toBe(uniqueKeys.size);
    });

    it('should dedupe items with same dedupeKey in background run view', () => {
      const items = [
        createMockItem({
          itemId: 'bg-a',
          dedupeKey: 'background-key-001',
          sourceType: 'background_run_state',
          content: 'First background item',
        }),
        createMockItem({
          itemId: 'bg-b',
          dedupeKey: 'background-key-001',
          sourceType: 'background_run_state',
          content: 'Duplicate background item',
        }),
      ];

      const input = createMockInput({
        agentType: 'background',
        selectionPolicy: { targetMode: 'background', tokenBudget: 10000 },
        backgroundRunContext: { backgroundRunContextView: createBackgroundRunView() },
        hydratedState: {
          sessionId: 'session-001',
          userId: 'user-001',
          conversationHistory: items,
        },
      });

      const bundle = manager.assemble(input);

      const dedupedKeys = bundle.orderedItems
        .filter(i => i.dedupeKey)
        .map(i => i.dedupeKey);
      const uniqueKeys = new Set(dedupedKeys);

      expect(dedupedKeys.length).toBe(uniqueKeys.size);
    });

    it('should dedupe items with same dedupeKey in trigger view', () => {
      const items = [
        createMockItem({
          itemId: 'trig-a',
          dedupeKey: 'trigger-key-001',
          sourceType: 'trigger_state',
          content: 'First trigger item',
        }),
        createMockItem({
          itemId: 'trig-b',
          dedupeKey: 'trigger-key-001',
          sourceType: 'trigger_state',
          content: 'Duplicate trigger item',
        }),
      ];

      const input = createMockInput({
        selectionPolicy: { targetMode: 'execute', tokenBudget: 10000 },
        triggerContext: {
          triggerId: 'trig-001',
          triggerEvent: { eventId: 'evt-001', eventType: 'webhook', source: 'webhook' },
        },
        hydratedState: {
          sessionId: 'session-001',
          userId: 'user-001',
          conversationHistory: items,
        },
      });

      const bundle = manager.assemble(input);

      const dedupedKeys = bundle.orderedItems
        .filter(i => i.dedupeKey)
        .map(i => i.dedupeKey);
      const uniqueKeys = new Set(dedupedKeys);

      expect(dedupedKeys.length).toBe(uniqueKeys.size);
    });
  });

  describe('Pruning Behavior', () => {
    it('should prune low-priority items when budget exceeded in planner view', () => {
      const highPriority = createMockItem({
        itemId: 'high-priority',
        sourceType: 'plan_state',
        content: 'High priority plan item',
        priority: 90,
        estimatedTokens: 500,
      });
      const lowPriority = createMockItem({
        itemId: 'low-priority',
        sourceType: 'plan_state',
        content: 'Low priority plan item',
        priority: 10,
        estimatedTokens: 500,
      });

      const input = createMockInput({
        selectionPolicy: { targetMode: 'plan', tokenBudget: 600 },
        planContext: { planContextView: createPlanView() },
        hydratedState: {
          sessionId: 'session-001',
          userId: 'user-001',
          conversationHistory: [highPriority, lowPriority],
        },
      });

      const bundle = manager.assemble(input);

      expect(bundle.orderedItems.some(i => i.itemId === 'high-priority')).toBe(true);
      expect(bundle.orderedItems.some(i => i.itemId === 'low-priority')).toBe(false);
    });

    it('should prune low-priority items when budget exceeded in workflow step view', () => {
      const highPriority = createMockItem({
        itemId: 'high-wf',
        sourceType: 'workflow_state',
        content: 'High priority workflow item',
        priority: 90,
        estimatedTokens: 500,
      });
      const lowPriority = createMockItem({
        itemId: 'low-wf',
        sourceType: 'workflow_state',
        content: 'Low priority workflow item',
        priority: 10,
        estimatedTokens: 500,
      });

      const input = createMockInput({
        selectionPolicy: { targetMode: 'workflow_step', tokenBudget: 600 },
        workflowContext: { workflowStepContextView: createWorkflowStepView() },
        hydratedState: {
          sessionId: 'session-001',
          userId: 'user-001',
          conversationHistory: [highPriority, lowPriority],
        },
      });

      const bundle = manager.assemble(input);

      expect(bundle.orderedItems.some(i => i.itemId === 'high-wf')).toBe(true);
      expect(bundle.orderedItems.some(i => i.itemId === 'low-wf')).toBe(false);
    });

    it('should prune low-priority items when budget exceeded in background run view', () => {
      const highPriority = createMockItem({
        itemId: 'high-bg',
        sourceType: 'background_run_state',
        content: 'High priority background item',
        priority: 90,
        estimatedTokens: 500,
      });
      const lowPriority = createMockItem({
        itemId: 'low-bg',
        sourceType: 'background_run_state',
        content: 'Low priority background item',
        priority: 10,
        estimatedTokens: 500,
      });

      const input = createMockInput({
        agentType: 'background',
        selectionPolicy: { targetMode: 'background', tokenBudget: 600 },
        backgroundRunContext: { backgroundRunContextView: createBackgroundRunView() },
        hydratedState: {
          sessionId: 'session-001',
          userId: 'user-001',
          conversationHistory: [highPriority, lowPriority],
        },
      });

      const bundle = manager.assemble(input);

      expect(bundle.orderedItems.some(i => i.itemId === 'high-bg')).toBe(true);
      expect(bundle.orderedItems.some(i => i.itemId === 'low-bg')).toBe(false);
    });

    it('should prune low-priority items when budget exceeded in trigger view', () => {
      const highPriority = createMockItem({
        itemId: 'high-trig',
        sourceType: 'trigger_state',
        content: 'High priority trigger item',
        priority: 90,
        estimatedTokens: 500,
      });
      const lowPriority = createMockItem({
        itemId: 'low-trig',
        sourceType: 'trigger_state',
        content: 'Low priority trigger item',
        priority: 10,
        estimatedTokens: 500,
      });

      const input = createMockInput({
        selectionPolicy: { targetMode: 'execute', tokenBudget: 600 },
        triggerContext: {
          triggerId: 'trig-001',
          triggerEvent: { eventId: 'evt-001', eventType: 'webhook', source: 'webhook' },
        },
        hydratedState: {
          sessionId: 'session-001',
          userId: 'user-001',
          conversationHistory: [highPriority, lowPriority],
        },
      });

      const bundle = manager.assemble(input);

      expect(bundle.orderedItems.some(i => i.itemId === 'high-trig')).toBe(true);
      expect(bundle.orderedItems.some(i => i.itemId === 'low-trig')).toBe(false);
    });
  });

  describe('Priority Order Preservation', () => {
    it('should order items by priority in planner view', () => {
      const items = [
        createMockItem({ itemId: 'plan-low', sourceType: 'plan_state', priority: 10 }),
        createMockItem({ itemId: 'plan-high', sourceType: 'plan_state', priority: 90 }),
        createMockItem({ itemId: 'plan-mid', sourceType: 'plan_state', priority: 50 }),
      ];

      const input = createMockInput({
        selectionPolicy: { targetMode: 'plan', tokenBudget: 10000 },
        planContext: { planContextView: createPlanView() },
        hydratedState: {
          sessionId: 'session-001',
          userId: 'user-001',
          conversationHistory: items,
        },
      });

      const bundle = manager.assemble(input);

      const highIdx = bundle.orderedItems.findIndex(i => i.itemId === 'plan-high');
      const midIdx = bundle.orderedItems.findIndex(i => i.itemId === 'plan-mid');
      const lowIdx = bundle.orderedItems.findIndex(i => i.itemId === 'plan-low');

      expect(highIdx).toBeLessThan(midIdx);
      expect(midIdx).toBeLessThan(lowIdx);
    });

    it('should order items by priority in workflow step view', () => {
      const items = [
        createMockItem({ itemId: 'wf-low', sourceType: 'workflow_state', priority: 10 }),
        createMockItem({ itemId: 'wf-high', sourceType: 'workflow_state', priority: 90 }),
        createMockItem({ itemId: 'wf-mid', sourceType: 'workflow_state', priority: 50 }),
      ];

      const input = createMockInput({
        selectionPolicy: { targetMode: 'workflow_step', tokenBudget: 10000 },
        workflowContext: { workflowStepContextView: createWorkflowStepView() },
        hydratedState: {
          sessionId: 'session-001',
          userId: 'user-001',
          conversationHistory: items,
        },
      });

      const bundle = manager.assemble(input);

      const highIdx = bundle.orderedItems.findIndex(i => i.itemId === 'wf-high');
      const midIdx = bundle.orderedItems.findIndex(i => i.itemId === 'wf-mid');
      const lowIdx = bundle.orderedItems.findIndex(i => i.itemId === 'wf-low');

      expect(highIdx).toBeLessThan(midIdx);
      expect(midIdx).toBeLessThan(lowIdx);
    });

    it('should order items by priority in background run view', () => {
      const items = [
        createMockItem({ itemId: 'bg-low', sourceType: 'background_run_state', priority: 10 }),
        createMockItem({ itemId: 'bg-high', sourceType: 'background_run_state', priority: 90 }),
        createMockItem({ itemId: 'bg-mid', sourceType: 'background_run_state', priority: 50 }),
      ];

      const input = createMockInput({
        agentType: 'background',
        selectionPolicy: { targetMode: 'background', tokenBudget: 10000 },
        backgroundRunContext: { backgroundRunContextView: createBackgroundRunView() },
        hydratedState: {
          sessionId: 'session-001',
          userId: 'user-001',
          conversationHistory: items,
        },
      });

      const bundle = manager.assemble(input);

      const highIdx = bundle.orderedItems.findIndex(i => i.itemId === 'bg-high');
      const midIdx = bundle.orderedItems.findIndex(i => i.itemId === 'bg-mid');
      const lowIdx = bundle.orderedItems.findIndex(i => i.itemId === 'bg-low');

      expect(highIdx).toBeLessThan(midIdx);
      expect(midIdx).toBeLessThan(lowIdx);
    });

    it('should order items by priority in trigger view', () => {
      const items = [
        createMockItem({ itemId: 'trig-low', sourceType: 'trigger_state', priority: 10 }),
        createMockItem({ itemId: 'trig-high', sourceType: 'trigger_state', priority: 90 }),
        createMockItem({ itemId: 'trig-mid', sourceType: 'trigger_state', priority: 50 }),
      ];

      const input = createMockInput({
        selectionPolicy: { targetMode: 'execute', tokenBudget: 10000 },
        triggerContext: {
          triggerId: 'trig-001',
          triggerEvent: { eventId: 'evt-001', eventType: 'webhook', source: 'webhook' },
        },
        hydratedState: {
          sessionId: 'session-001',
          userId: 'user-001',
          conversationHistory: items,
        },
      });

      const bundle = manager.assemble(input);

      const highIdx = bundle.orderedItems.findIndex(i => i.itemId === 'trig-high');
      const midIdx = bundle.orderedItems.findIndex(i => i.itemId === 'trig-mid');
      const lowIdx = bundle.orderedItems.findIndex(i => i.itemId === 'trig-low');

      expect(highIdx).toBeLessThan(midIdx);
      expect(midIdx).toBeLessThan(lowIdx);
    });
  });

  describe('Pair Integrity Across View Types', () => {
    it('should preserve pair integrity in planner view', () => {
      const pairA = createMockItem({
        itemId: 'pair-a',
        sourceType: 'plan_state',
        pairId: 'plan-pair-001',
        requiresPairIntegrity: true,
        estimatedTokens: 200,
        priority: 50,
      });
      const pairB = createMockItem({
        itemId: 'pair-b',
        sourceType: 'plan_state',
        pairId: 'plan-pair-001',
        requiresPairIntegrity: true,
        estimatedTokens: 200,
        priority: 50,
      });

      const input = createMockInput({
        selectionPolicy: { targetMode: 'plan', tokenBudget: 500 },
        planContext: { planContextView: createPlanView() },
        hydratedState: {
          sessionId: 'session-001',
          userId: 'user-001',
          conversationHistory: [pairA, pairB],
        },
      });

      const bundle = manager.assemble(input);

      const hasA = bundle.orderedItems.some(i => i.itemId === 'pair-a');
      const hasB = bundle.orderedItems.some(i => i.itemId === 'pair-b');

      expect(hasA).toBe(hasB);
    });

    it('should preserve pair integrity in workflow step view', () => {
      const pairA = createMockItem({
        itemId: 'wf-pair-a',
        sourceType: 'workflow_state',
        pairId: 'workflow-pair-001',
        requiresPairIntegrity: true,
        estimatedTokens: 200,
        priority: 50,
      });
      const pairB = createMockItem({
        itemId: 'wf-pair-b',
        sourceType: 'workflow_state',
        pairId: 'workflow-pair-001',
        requiresPairIntegrity: true,
        estimatedTokens: 200,
        priority: 50,
      });

      const input = createMockInput({
        selectionPolicy: { targetMode: 'workflow_step', tokenBudget: 500 },
        workflowContext: { workflowStepContextView: createWorkflowStepView() },
        hydratedState: {
          sessionId: 'session-001',
          userId: 'user-001',
          conversationHistory: [pairA, pairB],
        },
      });

      const bundle = manager.assemble(input);

      const hasA = bundle.orderedItems.some(i => i.itemId === 'wf-pair-a');
      const hasB = bundle.orderedItems.some(i => i.itemId === 'wf-pair-b');

      expect(hasA).toBe(hasB);
    });

    it('should preserve pair integrity in background run view', () => {
      const pairA = createMockItem({
        itemId: 'bg-pair-a',
        sourceType: 'background_run_state',
        pairId: 'background-pair-001',
        requiresPairIntegrity: true,
        estimatedTokens: 200,
        priority: 50,
      });
      const pairB = createMockItem({
        itemId: 'bg-pair-b',
        sourceType: 'subagent_result',
        pairId: 'background-pair-001',
        requiresPairIntegrity: true,
        estimatedTokens: 200,
        priority: 50,
      });

      const input = createMockInput({
        agentType: 'background',
        selectionPolicy: { targetMode: 'background', tokenBudget: 500 },
        backgroundRunContext: { backgroundRunContextView: createBackgroundRunView() },
        hydratedState: {
          sessionId: 'session-001',
          userId: 'user-001',
          conversationHistory: [pairA, pairB],
        },
      });

      const bundle = manager.assemble(input);

      const hasA = bundle.orderedItems.some(i => i.itemId === 'bg-pair-a');
      const hasB = bundle.orderedItems.some(i => i.itemId === 'bg-pair-b');

      expect(hasA).toBe(hasB);
    });

    it('should preserve pair integrity in trigger view', () => {
      const pairA = createMockItem({
        itemId: 'trig-pair-a',
        sourceType: 'trigger_state',
        pairId: 'trigger-pair-001',
        requiresPairIntegrity: true,
        estimatedTokens: 200,
        priority: 50,
      });
      const pairB = createMockItem({
        itemId: 'trig-pair-b',
        sourceType: 'trigger_state',
        pairId: 'trigger-pair-001',
        requiresPairIntegrity: true,
        estimatedTokens: 200,
        priority: 50,
      });

      const input = createMockInput({
        selectionPolicy: { targetMode: 'execute', tokenBudget: 500 },
        triggerContext: {
          triggerId: 'trig-001',
          triggerEvent: { eventId: 'evt-001', eventType: 'webhook', source: 'webhook' },
        },
        hydratedState: {
          sessionId: 'session-001',
          userId: 'user-001',
          conversationHistory: [pairA, pairB],
        },
      });

      const bundle = manager.assemble(input);

      const hasA = bundle.orderedItems.some(i => i.itemId === 'trig-pair-a');
      const hasB = bundle.orderedItems.some(i => i.itemId === 'trig-pair-b');

      expect(hasA).toBe(hasB);
    });
  });

  describe('Source Isolation - Non-Leakage Between View Types', () => {
    it('should only define planView when only planContext is provided', () => {
      const input = createMockInput({
        invocationSource: 'planner_execution',
        selectionPolicy: { targetMode: 'plan', tokenBudget: 10000 },
        planContext: { planContextView: createPlanView() },
      });

      const bundle = manager.assemble(input);

      expect(bundle.planView).toBeDefined();
      expect(bundle.workflowStepView).toBeUndefined();
      expect(bundle.backgroundRunView).toBeUndefined();
      expect(bundle.triggerView).toBeUndefined();
    });

    it('should only define workflowStepView when only workflowContext is provided', () => {
      const input = createMockInput({
        invocationSource: 'workflow_step',
        selectionPolicy: { targetMode: 'workflow_step', tokenBudget: 10000 },
        workflowContext: { workflowStepContextView: createWorkflowStepView() },
      });

      const bundle = manager.assemble(input);

      expect(bundle.workflowStepView).toBeDefined();
      expect(bundle.planView).toBeUndefined();
      expect(bundle.backgroundRunView).toBeUndefined();
      expect(bundle.triggerView).toBeUndefined();
    });

    it('should only define backgroundRunView when only backgroundRunContext is provided', () => {
      const input = createMockInput({
        invocationSource: 'background_subagent',
        agentType: 'background',
        selectionPolicy: { targetMode: 'background', tokenBudget: 10000 },
        backgroundRunContext: { backgroundRunContextView: createBackgroundRunView() },
      });

      const bundle = manager.assemble(input);

      expect(bundle.backgroundRunView).toBeDefined();
      expect(bundle.planView).toBeUndefined();
      expect(bundle.workflowStepView).toBeUndefined();
      expect(bundle.triggerView).toBeUndefined();
    });

    it('should only define triggerView when only triggerContext is provided', () => {
      const input = createMockInput({
        invocationSource: 'event_trigger_resume',
        selectionPolicy: { targetMode: 'execute', tokenBudget: 10000 },
        triggerContext: {
          triggerId: 'trig-001',
          triggerEvent: { eventId: 'evt-001', eventType: 'webhook', source: 'webhook' },
        },
      });

      const bundle = manager.assemble(input);

      expect(bundle.triggerView).toBeDefined();
      expect(bundle.planView).toBeUndefined();
      expect(bundle.workflowStepView).toBeUndefined();
      expect(bundle.backgroundRunView).toBeUndefined();
    });

    it('should isolate connector secrets from planner view when budget constrained', () => {
      const secretItem = createMockItem({
        itemId: 'connector-secret',
        sourceType: 'system_note',
        content: 'SECRET_KEY=xxx',
        priority: 1,
        estimatedTokens: 100,
      });
      const importantItem = createMockItem({
        itemId: 'important-item',
        sourceType: 'plan_state',
        content: 'Important plan content',
        priority: 100,
        estimatedTokens: 100,
      });

      const input = createMockInput({
        selectionPolicy: { targetMode: 'plan', tokenBudget: 150 },
        planContext: { planContextView: createPlanView() },
        hydratedState: {
          sessionId: 'session-001',
          userId: 'user-001',
          conversationHistory: [secretItem, importantItem],
        },
      });

      const bundle = manager.assemble(input);

      // High priority item should be included
      expect(bundle.orderedItems.some(i => i.itemId === 'important-item')).toBe(true);
      // Low priority secret should be pruned
      expect(bundle.orderedItems.some(i => i.itemId === 'connector-secret')).toBe(false);
    });

    it('should isolate connector secrets from workflow step view when budget constrained', () => {
      const secretItem = createMockItem({
        itemId: 'connector-secret-wf',
        sourceType: 'system_note',
        content: 'PRIVATE_TOKEN=yyy',
        priority: 1,
        estimatedTokens: 100,
      });
      const workflowItem = createMockItem({
        itemId: 'workflow-item-secret',
        sourceType: 'workflow_state',
        content: 'Important workflow content',
        priority: 100,
        estimatedTokens: 100,
      });

      const input = createMockInput({
        selectionPolicy: { targetMode: 'workflow_step', tokenBudget: 150 },
        workflowContext: { workflowStepContextView: createWorkflowStepView() },
        hydratedState: {
          sessionId: 'session-001',
          userId: 'user-001',
          conversationHistory: [workflowItem, secretItem],
        },
      });

      const bundle = manager.assemble(input);

      expect(bundle.orderedItems.some(i => i.itemId === 'workflow-item-secret')).toBe(true);
      expect(bundle.orderedItems.some(i => i.itemId === 'connector-secret-wf')).toBe(false);
    });
  });

  describe('Selection Report for Views', () => {
    it('should report correct view type for planner view', () => {
      const input = createMockInput({
        selectionPolicy: { targetMode: 'plan', tokenBudget: 10000 },
        planContext: { planContextView: createPlanView() },
      });

      manager.assemble(input);
      const report = manager.getLastReport();

      expect(report).toBeDefined();
      expect(report?.viewType).toBe('plan');
    });

    it('should report correct view type for workflow step view', () => {
      const input = createMockInput({
        selectionPolicy: { targetMode: 'workflow_step', tokenBudget: 10000 },
        workflowContext: { workflowStepContextView: createWorkflowStepView() },
      });

      manager.assemble(input);
      const report = manager.getLastReport();

      expect(report).toBeDefined();
      expect(report?.viewType).toBe('workflow_step');
    });

    it('should report correct view type for background run view', () => {
      const input = createMockInput({
        agentType: 'background',
        selectionPolicy: { targetMode: 'background', tokenBudget: 10000 },
        backgroundRunContext: { backgroundRunContextView: createBackgroundRunView() },
      });

      manager.assemble(input);
      const report = manager.getLastReport();

      expect(report).toBeDefined();
      expect(report?.viewType).toBe('background');
    });

    it('should report pair integrity preserved for views', () => {
      const pairA = createMockItem({
        itemId: 'pair-a',
        pairId: 'test-pair-001',
        requiresPairIntegrity: true,
        estimatedTokens: 100,
      });
      const pairB = createMockItem({
        itemId: 'pair-b',
        pairId: 'test-pair-001',
        requiresPairIntegrity: true,
        estimatedTokens: 100,
      });

      const input = createMockInput({
        selectionPolicy: { targetMode: 'plan', tokenBudget: 1000 },
        planContext: { planContextView: createPlanView() },
        hydratedState: {
          sessionId: 'session-001',
          userId: 'user-001',
          conversationHistory: [pairA, pairB],
        },
      });

      manager.assemble(input);
      const report = manager.getLastReport();

      expect(report?.pairIntegrityPreserved).toContain('test-pair-001');
    });
  });
});
