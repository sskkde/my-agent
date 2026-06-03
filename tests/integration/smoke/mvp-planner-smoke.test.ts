import { describe, it, expect } from 'vitest';
import type { ForegroundDecision } from '../../../src/foreground/types.js';
import { closeSmokeHarness, createSession, createSmokeHarness, waitForCondition } from './smoke-test-utils.js';

describe('MVP smoke: complex task planner flow', () => {
  it('creates a planner run and a multi-step plan from a foreground planner decision', async () => {
    const plannerDecision: ForegroundDecision = {
      route: 'spawn_planner',
      requiresPlanner: true,
      reason: 'Complex task needs a plan',
      userVisibleResponse: 'Plan the MVP smoke verification task',
      estimatedSteps: 3,
      complexity: 'medium',
    };

    const harness = await createSmokeHarness({
      username: 'smoke-planner-user',
      foregroundDecision: plannerDecision,
    });

    try {
      const sessionId = await createSession(harness);
      const messageResponse = await fetch(`${harness.baseUrl}/api/v1/sessions/${sessionId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: harness.authCookie },
        body: JSON.stringify({ text: 'Please plan this complex task in steps' }),
      });

      expect(messageResponse.status).toBe(202);
      await messageResponse.json();

      await waitForCondition(() => {
        const plannerRuns = harness.baseCtx.stores.plannerRunStore.findByUser(harness.userId);
        expect(plannerRuns.length).toBeGreaterThan(0);

        const plan = harness.baseCtx.stores.planStore.getPlan(plannerRuns[0]!.planId);
        expect(plan).toBeTruthy();
        expect(plan!.steps.length).toBeGreaterThanOrEqual(3);
      });
    } finally {
      await closeSmokeHarness(harness);
    }
  }, 30000);
});
