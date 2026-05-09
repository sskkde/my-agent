import { describe, expect, it } from 'vitest';
import { FailureAnalyzer } from '../../../src/replay/failure-analyzer.js';

describe('Replay FailureAnalyzer', () => {
  it('maps connector_rate_limited to retryable_later remediation', () => {
    const analyzer = new FailureAnalyzer();

    const [analysis] = analyzer.analyze([
      {
        runtime: 'connector',
        category: 'connector_rate_limited',
        message: 'rate limit exceeded',
        retryAfterMs: 30000,
      },
    ]);

    expect(analysis?.rootCauseCategory).toBe('connector_rate_limited');
    expect(analysis?.recoverability).toBe('retryable_later');
    expect(analysis?.remediation).toContain('retry after 30000ms');
  });

  it('groups failures by runtime category recoverability and remediation', () => {
    const analyzer = new FailureAnalyzer();

    const analyses = analyzer.analyze([
      { runtime: 'workflow', category: 'workflow_step_error', message: 'step failed' },
      { runtime: 'workflow', category: 'workflow_step_error', message: 'step failed again' },
      { runtime: 'connector', code: 'permission_denied', message: 'permission denied' },
      { runtime: 'connector', category: 'timeout', message: 'timeout' },
    ]);

    expect(analyses).toHaveLength(3);
    expect(analyses.find((item) => item.rootCauseCategory === 'workflow_step_error')?.count).toBe(2);
    expect(analyses.find((item) => item.rootCauseCategory === 'permission_error')?.recoverability).toBe('recoverable_with_approval');
    expect(analyses.find((item) => item.rootCauseCategory === 'timeout')?.remediation).toContain('increase timeout');
  });
});
