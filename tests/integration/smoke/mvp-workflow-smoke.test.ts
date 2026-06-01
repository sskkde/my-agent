import { describe, it, expect } from 'vitest';
import { WORKFLOW_RUN_STATES } from '../../../src/shared/states.js';
import type { WorkflowStep } from '../../../src/workflows/types.js';
import { closeSmokeHarness, createSmokeHarness } from './smoke-test-utils.js';

describe('MVP smoke: workflow lifecycle', () => {
  it('creates, validates, publishes, starts, and completes a workflow run', async () => {
    const harness = await createSmokeHarness({ username: 'smoke-workflow-user' });

    try {
      const steps: WorkflowStep[] = [
        {
          stepId: 'step_collect',
          stepType: 'tool_call',
          name: 'Collect data',
          config: { toolName: 'docs_search', toolParams: { query: 'mvp smoke' } },
          nextStepId: 'step_summarize',
        },
        {
          stepId: 'step_summarize',
          stepType: 'agent_run',
          name: 'Summarize data',
          config: { agentId: 'summary-agent', agentParams: { mode: 'smoke' } },
        },
      ];

      const draftResponse = await fetch(`${harness.baseUrl}/api/v1/workflows/drafts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: harness.authCookie },
        body: JSON.stringify({
          name: 'MVP Smoke Workflow',
          description: 'End-to-end workflow smoke test',
          steps,
        }),
      });
      expect(draftResponse.status).toBe(201);
      const draftBody = await draftResponse.json() as { data: { draftId: string; steps: WorkflowStep[] } };
      expect(draftBody.data.steps).toHaveLength(2);

      const validationResponse = await fetch(`${harness.baseUrl}/api/v1/workflows/drafts/${draftBody.data.draftId}/validate`, {
        method: 'POST',
        headers: { Cookie: harness.authCookie },
      });
      expect(validationResponse.status).toBe(200);
      const validationBody = await validationResponse.json() as { data: { valid: boolean; issues: unknown[] } };
      expect(validationBody.data.valid).toBe(true);
      expect(validationBody.data.issues).toHaveLength(0);

      const publishResponse = await fetch(`${harness.baseUrl}/api/v1/workflows/drafts/${draftBody.data.draftId}/publish`, {
        method: 'POST',
        headers: { Cookie: harness.authCookie },
      });
      expect(publishResponse.status).toBe(201);
      const publishBody = await publishResponse.json() as { data: { workflowId: string; status: string } };
      expect(publishBody.data.status).toBe('published');

      const runResponse = await fetch(`${harness.baseUrl}/api/v1/workflows/runs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: harness.authCookie },
        body: JSON.stringify({ definitionId: publishBody.data.workflowId, inputData: { smoke: true } }),
      });
      expect(runResponse.status).toBe(201);
      const runBody = await runResponse.json() as {
        data: { workflowRunId: string; status: string; stepRuns: Array<{ stepRunId: string }> }
      };
      expect(runBody.data.status).toBe(WORKFLOW_RUN_STATES.RUNNING);

      for (const stepRun of runBody.data.stepRuns) {
        harness.baseCtx.workflowRuntime.handleStepCompletion(stepRun.stepRunId, {
          success: true,
          output: { smokeCompleted: stepRun.stepRunId },
        });
      }

      const completedRun = harness.baseCtx.workflowRuntime.getWorkflowRun(runBody.data.workflowRunId);
      expect(completedRun?.status).toBe(WORKFLOW_RUN_STATES.COMPLETED);
    } finally {
      await closeSmokeHarness(harness);
    }
  }, 15000);
});
