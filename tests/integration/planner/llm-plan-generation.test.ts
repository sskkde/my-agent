import { describe, it, expect, beforeEach } from 'vitest';
import { LLMPlanGenerator, type LLMAdapter } from '../../../src/planner/llm-plan-generator.js';
import { DeterministicPlanGenerator } from '../../../src/planner/deterministic-plan-generator.js';
import { PlanValidator } from '../../../src/planner/plan-validator.js';
import type { PlanGenerationInput, ExecutionPlan } from '../../../src/planner/plan-schema.js';

function createMockToolRegistry(tools: string[] = ['read_file', 'write_file']) {
  return {
    hasTool: (name: string) => tools.includes(name),
    getTool: (name: string) => {
      if (tools.includes(name)) {
        return { name, category: name.includes('write') ? 'write' : 'read' };
      }
      return null;
    },
  };
}

function createValidPlan(goal: string): ExecutionPlan {
  return {
    id: 'plan_test123',
    goal,
    steps: [
      {
        id: 'step_1',
        kind: 'tool_call',
        title: 'Read file',
        description: 'Read the target file',
        executor: 'tool_plane',
        toolName: 'read_file',
      },
      {
        id: 'step_2',
        kind: 'final_response',
        title: 'Respond to user',
        description: 'Send final response',
        executor: 'foreground',
        dependsOn: [{ type: 'depends_on', targetStepId: 'step_1' }],
      },
    ],
    successCriteria: ['File read successfully', 'User received response'],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    version: 1,
  };
}

describe('LLMPlanGenerator', () => {
  let deterministicGenerator: DeterministicPlanGenerator;
  let validator: PlanValidator;

  beforeEach(() => {
    deterministicGenerator = new DeterministicPlanGenerator();
    validator = new PlanValidator({
      toolRegistry: createMockToolRegistry(),
    });
  });

  describe('without LLM adapter', () => {
    it('should fall back to deterministic generator when no adapter provided', () => {
      const generator = new LLMPlanGenerator({
        deterministicGenerator,
        validator,
      });

      const input: PlanGenerationInput = {
        goal: 'Read the configuration file',
        availableTools: ['read_file'],
      };

      const result = generator.generate(input);

      expect(result.plan).toBeDefined();
      expect(result.plan.goal).toBe(input.goal);
      expect(result.plan.steps.length).toBeGreaterThan(0);
    });

    it('should fall back to deterministic generator when adapter is null', () => {
      const generator = new LLMPlanGenerator({
        llmAdapter: null,
        deterministicGenerator,
        validator,
      });

      const input: PlanGenerationInput = {
        goal: 'Analyze the data',
        availableTools: ['read_file'],
      };

      const result = generator.generate(input);

      expect(result.plan).toBeDefined();
      expect(result.plan.goal).toBe(input.goal);
    });
  });

  describe('with mock LLM adapter', () => {
    it('should use LLM adapter output when valid plan is returned', () => {
      const validPlan = createValidPlan('Read the test file');

      const mockAdapter: LLMAdapter = {
        generatePlan: () => validPlan,
      };

      const generator = new LLMPlanGenerator({
        llmAdapter: mockAdapter,
        deterministicGenerator,
        validator,
      });

      const input: PlanGenerationInput = {
        goal: 'Read the test file',
        availableTools: ['read_file'],
      };

      const result = generator.generate(input);

      expect(result.plan).toBeDefined();
      expect(result.plan.id).toBe(validPlan.id);
      expect(result.plan.goal).toBe(validPlan.goal);
      expect(result.plan.steps).toHaveLength(2);
    });

    it('should fall back to deterministic when adapter returns null', () => {
      const mockAdapter: LLMAdapter = {
        generatePlan: () => null,
      };

      const generator = new LLMPlanGenerator({
        llmAdapter: mockAdapter,
        deterministicGenerator,
        validator,
      });

      const input: PlanGenerationInput = {
        goal: 'Process the document',
        availableTools: ['read_file'],
      };

      const result = generator.generate(input);

      expect(result.plan).toBeDefined();
      expect(result.plan.goal).toBe(input.goal);
    });

    it('should fall back to deterministic when adapter throws error', () => {
      const mockAdapter: LLMAdapter = {
        generatePlan: () => {
          throw new Error('LLM service unavailable');
        },
      };

      const generator = new LLMPlanGenerator({
        llmAdapter: mockAdapter,
        deterministicGenerator,
        validator,
      });

      const input: PlanGenerationInput = {
        goal: 'Handle the request',
        availableTools: ['read_file'],
      };

      const result = generator.generate(input);

      expect(result.plan).toBeDefined();
      expect(result.plan.goal).toBe(input.goal);
    });
  });

  describe('validation and repair', () => {
    it('should fall back to deterministic when LLM returns invalid plan', () => {
      const invalidPlan: ExecutionPlan = {
        id: '',
        goal: '',
        steps: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        version: 1,
      };

      let callCount = 0;
      const mockAdapter: LLMAdapter = {
        generatePlan: () => {
          callCount++;
          return invalidPlan;
        },
      };

      const generator = new LLMPlanGenerator({
        llmAdapter: mockAdapter,
        deterministicGenerator,
        validator,
      });

      const input: PlanGenerationInput = {
        goal: 'Test validation fallback',
        availableTools: ['read_file'],
      };

      const result = generator.generate(input);

      expect(result.plan).toBeDefined();
      expect(result.plan.goal).toBe(input.goal);
      expect(callCount).toBeLessThanOrEqual(2);
    });

    it('should accept repaired plan on second attempt', () => {
      const invalidPlan: ExecutionPlan = {
        id: '',
        goal: '',
        steps: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        version: 1,
      };

      const validPlan = createValidPlan('Repaired goal');

      let callCount = 0;
      const mockAdapter: LLMAdapter = {
        generatePlan: () => {
          callCount++;
          if (callCount === 1) {
            return invalidPlan;
          }
          return validPlan;
        },
      };

      const generator = new LLMPlanGenerator({
        llmAdapter: mockAdapter,
        deterministicGenerator,
        validator,
      });

      const input: PlanGenerationInput = {
        goal: 'Test repair retry',
        availableTools: ['read_file'],
      };

      const result = generator.generate(input);

      expect(result.plan).toBeDefined();
      expect(result.plan.id).toBe(validPlan.id);
      expect(callCount).toBe(2);
    });

    it('should fall back to deterministic after max repair attempts', () => {
      const invalidPlan: ExecutionPlan = {
        id: '',
        goal: '',
        steps: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        version: 1,
      };

      let callCount = 0;
      const mockAdapter: LLMAdapter = {
        generatePlan: () => {
          callCount++;
          return invalidPlan;
        },
      };

      const generator = new LLMPlanGenerator({
        llmAdapter: mockAdapter,
        deterministicGenerator,
        validator,
      });

      const input: PlanGenerationInput = {
        goal: 'Test max attempts',
        availableTools: ['read_file'],
      };

      const result = generator.generate(input);

      expect(result.plan).toBeDefined();
      expect(result.plan.goal).toBe(input.goal);
      expect(callCount).toBe(2);
    });
  });

  describe('with write tool approval validation', () => {
    it('should reject plan with write tool but no approval', () => {
      const planWithWriteTool: ExecutionPlan = {
        id: 'plan_write',
        goal: 'Write to file',
        steps: [
          {
            id: 'step_1',
            kind: 'tool_call',
            title: 'Write file',
            description: 'Write content to file',
            executor: 'tool_plane',
            toolName: 'write_file',
          },
          {
            id: 'step_2',
            kind: 'final_response',
            title: 'Done',
            description: 'Complete',
            executor: 'foreground',
            dependsOn: [{ type: 'depends_on', targetStepId: 'step_1' }],
          },
        ],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        version: 1,
      };

      const mockAdapter: LLMAdapter = {
        generatePlan: () => planWithWriteTool,
      };

      const generator = new LLMPlanGenerator({
        llmAdapter: mockAdapter,
        deterministicGenerator,
        validator,
      });

      const input: PlanGenerationInput = {
        goal: 'Write to file',
        availableTools: ['read_file', 'write_file'],
      };

      const result = generator.generate(input);

      expect(result.plan).toBeDefined();
      expect(result.plan.goal).toBe(input.goal);
    });
  });
});
