import type { Recoverability, RuntimeError, RuntimeErrorCategory } from '../shared/errors.js';

export interface ReplayFailureInput {
  runtime: string;
  category?: RuntimeErrorCategory;
  code?: string;
  message?: string;
  recoverability?: Recoverability;
  retryAfterMs?: number;
}

export interface FailureAnalysis {
  runtime: string;
  rootCauseCategory: RuntimeErrorCategory;
  recoverability: Recoverability;
  remediation: string;
  count: number;
  failures: ReplayFailureInput[];
}

type FailureInput = RuntimeError | ReplayFailureInput;

interface FailureClassification {
  category: RuntimeErrorCategory;
  recoverability: Recoverability;
  remediation: string;
}

export class FailureAnalyzer {
  analyze(failures: FailureInput[]): FailureAnalysis[] {
    const grouped = new Map<string, FailureAnalysis>();

    for (const failure of failures) {
      const normalized = this.normalizeFailure(failure);
      const classification = this.classify(normalized);
      const key = `${normalized.runtime}:${classification.category}:${classification.recoverability}:${classification.remediation}`;
      const existing = grouped.get(key);

      if (existing) {
        existing.count += 1;
        existing.failures.push(normalized);
        continue;
      }

      grouped.set(key, {
        runtime: normalized.runtime,
        rootCauseCategory: classification.category,
        recoverability: classification.recoverability,
        remediation: classification.remediation,
        count: 1,
        failures: [normalized],
      });
    }

    return Array.from(grouped.values());
  }

  private normalizeFailure(failure: FailureInput): ReplayFailureInput {
    if ('errorId' in failure) {
      return {
        runtime: failure.source.module,
        category: failure.category,
        code: failure.code,
        message: failure.message,
        recoverability: failure.recoverability,
        retryAfterMs: failure.technical?.retryAfterMs,
      };
    }

    return failure;
  }

  private classify(failure: ReplayFailureInput): FailureClassification {
    const category = failure.category ?? this.inferCategory(failure);

    switch (category) {
      case 'connector_rate_limited': {
        const retryAfterMs = failure.retryAfterMs ?? 30000;
        return {
          category,
          recoverability: 'retryable_later',
          remediation: `retry after ${retryAfterMs}ms`,
        };
      }
      case 'permission_error':
      case 'approval_rejected':
        return {
          category,
          recoverability: failure.recoverability ?? 'recoverable_with_approval',
          remediation: 'request approval or update permission policy before retry',
        };
      case 'timeout':
      case 'external_event_timeout':
        return {
          category,
          recoverability: failure.recoverability ?? 'retryable_later',
          remediation: `retry after ${failure.retryAfterMs ?? 30000}ms or increase timeout`,
        };
      case 'workflow_step_error':
        return {
          category,
          recoverability: failure.recoverability ?? 'recoverable_auto',
          remediation: 'inspect step input/output, fix failing step, then resume workflow',
        };
      case 'connector_auth_error':
        return {
          category,
          recoverability: failure.recoverability ?? 'recoverable_with_user',
          remediation: 'reauthorize connector credentials and retry',
        };
      case 'tool_validation_error':
      case 'user_input_error':
        return {
          category,
          recoverability: failure.recoverability ?? 'recoverable_with_user',
          remediation: 'correct input parameters and retry',
        };
      case 'system_internal_error':
      case 'model_error':
      case 'tool_execution_error':
        return {
          category,
          recoverability: failure.recoverability ?? 'retryable_later',
          remediation: 'retry with backoff and inspect runtime logs if it repeats',
        };
      default:
        return {
          category,
          recoverability: failure.recoverability ?? 'non_recoverable',
          remediation: 'inspect failure details and escalate if unrecoverable',
        };
    }
  }

  private inferCategory(failure: ReplayFailureInput): RuntimeErrorCategory {
    const code = (failure.code ?? '').toLowerCase();
    const message = (failure.message ?? '').toLowerCase();
    const text = `${code} ${message}`;

    if (text.includes('rate_limited') || text.includes('rate limit') || text.includes('429')) {
      return 'connector_rate_limited';
    }

    if (text.includes('permission') || text.includes('denied') || text.includes('forbidden')) {
      return 'permission_error';
    }

    if (text.includes('timeout') || text.includes('timed out')) {
      return 'timeout';
    }

    if (text.includes('workflow') || text.includes('step')) {
      return 'workflow_step_error';
    }

    return 'system_internal_error';
  }
}

export function createFailureAnalyzer(): FailureAnalyzer {
  return new FailureAnalyzer();
}
