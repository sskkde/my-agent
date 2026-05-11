import { describe, expect, it, vi } from 'vitest';
import { createCancellationCoordinator } from '../../../src/recovery/cancellation-coordinator.js';
import { createRetryExecutor } from '../../../src/recovery/retry-executor.js';
import type { CancellationCoordinatorConfig, RetryPolicy } from '../../../src/recovery/types.js';
import { CANCELLATION_TARGET_TYPES } from '../../../src/shared/cancellation.js';
import { BACKOFF_STRATEGIES } from '../../../src/shared/retry.js';
import { TestClock } from '../../helpers/clock.js';

describe('runtime recovery policy completion', () => {
  it('planner cancel cascade marks active tool execution and background run terminal cancelled', async () => {
    const plannerRunStore = {
      getById: vi.fn().mockReturnValue({
        plannerRunId: 'planner-run-1',
        status: 'planning',
        checkpoint: {
          activeExecutionRefs: [
            { refId: 'tool-call-1', refType: 'tool_execution', status: 'executing' },
            { refId: 'background-run-1', refType: 'background_run', status: 'running' },
          ],
        },
      }),
      updateStatus: vi.fn(),
    };

    const toolExecutionStore = {
      getById: vi.fn().mockReturnValue({
        toolCallId: 'tool-call-1',
        toolName: 'searchDocs',
        status: 'executing',
        userId: 'user-1',
        sessionId: 'session-1',
      }),
      updateStatus: vi.fn(),
      saveResult: vi.fn(),
    };

    const backgroundRunStore = {
      getById: vi.fn().mockReturnValue({ backgroundRunId: 'background-run-1', status: 'running' }),
      updateStatus: vi.fn(),
    };

    const config: CancellationCoordinatorConfig = {
      plannerRunStore,
      toolExecutionStore,
      backgroundRunStore,
      kernelRunStore: { getById: vi.fn(), updateStatus: vi.fn() },
      eventStore: { append: vi.fn() },
    };

    const coordinator = createCancellationCoordinator(config);

    const result = await coordinator.cancel({
      targetType: CANCELLATION_TARGET_TYPES.PLANNER_RUN,
      targetId: 'planner-run-1',
      cascade: true,
      reason: 'user cancelled planner run',
    });

    expect(result.status).toBe('completed');
    expect(result.affectedRefs).toEqual(expect.arrayContaining(['planner-run-1', 'tool-call-1', 'background-run-1']));
    expect(toolExecutionStore.updateStatus).toHaveBeenCalledWith('tool-call-1', 'cancelled');
    expect(toolExecutionStore.saveResult).toHaveBeenCalledWith('tool-call-1', expect.objectContaining({ synthetic: true, status: 'cancelled' }));
    expect(backgroundRunStore.updateStatus).toHaveBeenCalledWith('background-run-1', 'cancelled');
    expect(plannerRunStore.updateStatus).toHaveBeenCalledWith('planner-run-1', 'cancelled', expect.objectContaining({ cancelledAt: expect.any(String) }));
  });

  it('connector rate limit retries with controlled backoff then completes', async () => {
    const clock = new TestClock();
    const delays: number[] = [];
    let attempts = 0;

    const retryExecutor = createRetryExecutor({
      sleep: (ms: number) => {
        delays.push(ms);
        clock.advance(ms);
        return Promise.resolve();
      },
    });

    const policy: RetryPolicy = {
      maxAttempts: 3,
      backoff: BACKOFF_STRATEGIES.EXPONENTIAL,
      initialDelayMs: 100,
      maxDelayMs: 1_000,
      retryableErrorCategories: ['connector_rate_limited', 'timeout'],
      jitterRatio: 0,
    };

    const result = await retryExecutor.executeWithRetry(
      {
        operationName: 'mock_search',
        operation: async () => {
          attempts += 1;
          if (attempts < 3) {
            throw {
              errorId: `rate-limit-${attempts}`,
              category: 'connector_rate_limited',
              code: 'RATE_LIMITED',
              message: 'Search connector rate limited',
              recoverability: 'retryable_later',
              source: { module: 'connector', connectorId: 'mock_search' },
              technical: { retryAfterMs: 100 },
              createdAt: clock.nowISO(),
            };
          }
          return { status: 'completed', data: ['result'] };
        },
      },
      policy
    );

    expect(result.success).toBe(true);
    expect(result.attempts).toBe(3);
    expect(attempts).toBe(3);
    expect(delays).toEqual([100, 200]);
    expect(result.auditTrail?.filter(entry => entry.status === 'retry_scheduled')).toHaveLength(2);
    expect(result.data).toEqual({ status: 'completed', data: ['result'] });
  });
});
