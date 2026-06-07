import { describe, it, expect, beforeEach } from 'vitest'
import {
  FailureAnalyzer,
  createFailureAnalyzer,
  analyzeConnectorResponse,
  analyzeToolResult,
  isRetryable,
  getHighestSeverity,
  FailureAnalysis,
} from '../../../src/observability/failure-analyzer.js'
import type { ConnectorResponse, ToolExecutionResult } from '../../../src/observability/failure-analyzer.js'

describe('FailureAnalyzer', () => {
  let analyzer: FailureAnalyzer

  beforeEach(() => {
    analyzer = new FailureAnalyzer()
  })

  describe('createFailureAnalyzer', () => {
    it('should create a new FailureAnalyzer instance', () => {
      const instance = createFailureAnalyzer()
      expect(instance).toBeInstanceOf(FailureAnalyzer)
    })
  })

  describe('classifyFailure', () => {
    it('should classify connector auth failures', () => {
      const error = new Error('authentication required')
      expect(analyzer.classifyFailure(error)).toBe('connector_auth')
    })

    it('should classify unauthorized errors', () => {
      const error = new Error('unauthorized access')
      expect(analyzer.classifyFailure(error)).toBe('connector_auth')
    })

    it('should classify auth errors by code', () => {
      const error = new Error('auth failed')
      ;(error as { code?: string }).code = 'auth_required'
      expect(analyzer.classifyFailure(error)).toBe('connector_auth')
    })

    it('should classify rate limit failures', () => {
      const error = new Error('rate limit exceeded')
      expect(analyzer.classifyFailure(error)).toBe('connector_rate_limit')
    })

    it('should classify 429 status as rate limit', () => {
      const error = new Error('too many requests')
      ;(error as { status?: number }).status = 429
      expect(analyzer.classifyFailure(error)).toBe('connector_rate_limit')
    })

    it('should classify approval rejected failures', () => {
      const error = new Error('approval rejected by user')
      expect(analyzer.classifyFailure(error)).toBe('approval_rejected')
    })

    it('should classify approval denied failures', () => {
      const error = new Error('approval denied')
      expect(analyzer.classifyFailure(error)).toBe('approval_rejected')
    })

    it('should classify wait timeout failures', () => {
      const error = new Error('wait condition timed out')
      expect(analyzer.classifyFailure(error)).toBe('wait_timeout')
    })

    it('should classify timeout errors', () => {
      const error = new Error('timeout waiting for response')
      expect(analyzer.classifyFailure(error)).toBe('wait_timeout')
    })

    it('should classify timeout by error name', () => {
      const error = new Error('request failed')
      error.name = 'TimeoutError'
      expect(analyzer.classifyFailure(error)).toBe('wait_timeout')
    })

    it('should classify tool execution failures', () => {
      const error = new Error('tool execution failed')
      expect(analyzer.classifyFailure(error)).toBe('tool_execution')
    })

    it('should classify tool errors by code', () => {
      const error = new Error('execution failed')
      ;(error as { code?: string }).code = 'TOOL_NOT_FOUND'
      expect(analyzer.classifyFailure(error)).toBe('tool_execution')
    })

    it('should classify model provider failures', () => {
      const error = new Error('model provider error')
      expect(analyzer.classifyFailure(error)).toBe('model_provider')
    })

    it('should classify OpenAI errors as model provider', () => {
      const error = new Error('openai api error')
      expect(analyzer.classifyFailure(error)).toBe('model_provider')
    })

    it('should classify Anthropic errors as model provider', () => {
      const error = new Error('anthropic api error')
      expect(analyzer.classifyFailure(error)).toBe('model_provider')
    })

    it('should classify LLM errors as model provider', () => {
      const error = new Error('llm request failed')
      expect(analyzer.classifyFailure(error)).toBe('model_provider')
    })

    it('should classify workflow step failures', () => {
      const error = new Error('workflow step failed')
      expect(analyzer.classifyFailure(error)).toBe('workflow_step')
    })

    it('should classify background watchdog failures', () => {
      const error = new Error('watchdog detected stuck process')
      expect(analyzer.classifyFailure(error)).toBe('background_watchdog')
    })

    it('should classify background errors', () => {
      const error = new Error('background run failed')
      expect(analyzer.classifyFailure(error)).toBe('background_watchdog')
    })

    it('should classify unknown failures', () => {
      const error = new Error('something unexpected happened')
      expect(analyzer.classifyFailure(error)).toBe('unknown')
    })
  })

  describe('analyzeConnectorAuth', () => {
    it('should return correct analysis for auth failure', () => {
      const error = new Error('authentication required')
      const analysis = analyzer.analyzeConnectorAuth(error)

      expect(analysis.rootCause).toBe('connector auth required')
      expect(analysis.suggestedFixes).toContain('reauthorize')
      expect(analysis.retryable).toBe(true)
      expect(analysis.severity).toBe('high')
      expect(analysis.category).toBe('connector_auth')
    })
  })

  describe('analyzeApprovalRejected', () => {
    it('should return correct analysis for approval rejection', () => {
      const error = new Error('approval rejected')
      const analysis = analyzer.analyzeApprovalRejected(error)

      expect(analysis.rootCause).toBe('approval denied by user')
      expect(analysis.suggestedFixes).toContain('replan')
      expect(analysis.suggestedFixes).toContain('stop')
      expect(analysis.retryable).toBe(false)
      expect(analysis.severity).toBe('medium')
      expect(analysis.category).toBe('approval_rejected')
    })
  })

  describe('analyzeWaitTimeout', () => {
    it('should return correct analysis for wait timeout', () => {
      const error = new Error('wait timeout')
      const analysis = analyzer.analyzeWaitTimeout(error)

      expect(analysis.rootCause).toBe('wait condition timed out')
      expect(analysis.suggestedFixes).toContain('retry_wait')
      expect(analysis.suggestedFixes).toContain('skip_step')
      expect(analysis.suggestedFixes).toContain('cancel_run')
      expect(analysis.retryable).toBe(true)
      expect(analysis.severity).toBe('medium')
      expect(analysis.category).toBe('wait_timeout')
    })
  })

  describe('analyzeRateLimit', () => {
    it('should return correct analysis for rate limit', () => {
      const error = new Error('rate limit')
      const analysis = analyzer.analyzeRateLimit(error)

      expect(analysis.rootCause).toBe('rate limit exceeded')
      expect(analysis.suggestedFixes).toContain('wait_and_retry')
      expect(analysis.retryable).toBe(true)
      expect(analysis.severity).toBe('medium')
      expect(analysis.category).toBe('connector_rate_limit')
    })

    it('should include retry-after information when available', () => {
      const error = new Error('rate limit')
      ;(error as { retryAfterMs?: number }).retryAfterMs = 5000
      const analysis = analyzer.analyzeRateLimit(error)

      expect(analysis.suggestedFixes).toContain('wait 5000ms before retry')
    })
  })

  describe('analyzeToolExecution', () => {
    it('should analyze TOOL_NOT_FOUND error', () => {
      const error = new Error('tool not found')
      ;(error as { code?: string }).code = 'TOOL_NOT_FOUND'
      const analysis = analyzer.analyzeToolExecution(error, { toolName: 'test-tool' })

      expect(analysis.rootCause).toBe('tool not found: test-tool')
      expect(analysis.suggestedFixes).toContain('verify tool name')
      expect(analysis.suggestedFixes).toContain('check tool registration')
      expect(analysis.retryable).toBe(false)
      expect(analysis.severity).toBe('high')
    })

    it('should analyze SCHEMA_VALIDATION_FAILED error', () => {
      const error = new Error('validation failed')
      ;(error as { code?: string }).code = 'SCHEMA_VALIDATION_FAILED'
      const analysis = analyzer.analyzeToolExecution(error, {})

      expect(analysis.rootCause).toBe('tool parameter validation failed')
      expect(analysis.suggestedFixes).toContain('check parameter schema')
      expect(analysis.retryable).toBe(false)
      expect(analysis.severity).toBe('medium')
    })

    it('should analyze PERMISSION_DENIED error', () => {
      const error = new Error('permission denied')
      ;(error as { code?: string }).code = 'PERMISSION_DENIED'
      const analysis = analyzer.analyzeToolExecution(error, {})

      expect(analysis.rootCause).toBe('tool execution permission denied')
      expect(analysis.suggestedFixes).toContain('request permission')
      expect(analysis.retryable).toBe(false)
      expect(analysis.severity).toBe('high')
    })

    it('should analyze TIMEOUT error', () => {
      const error = new Error('timeout')
      ;(error as { code?: string }).code = 'TIMEOUT'
      const analysis = analyzer.analyzeToolExecution(error, {})

      expect(analysis.rootCause).toBe('tool execution timed out')
      expect(analysis.suggestedFixes).toContain('increase timeout')
      expect(analysis.retryable).toBe(true)
      expect(analysis.severity).toBe('medium')
    })

    it('should analyze EXECUTION_FAILED error', () => {
      const error = new Error('execution failed')
      ;(error as { code?: string }).code = 'EXECUTION_FAILED'
      const analysis = analyzer.analyzeToolExecution(error, {})

      expect(analysis.rootCause).toBe('tool execution returned error')
      expect(analysis.retryable).toBe(true)
      expect(analysis.severity).toBe('medium')
    })

    it('should analyze INVALID_PARAMS error', () => {
      const error = new Error('invalid params')
      ;(error as { code?: string }).code = 'INVALID_PARAMS'
      const analysis = analyzer.analyzeToolExecution(error, {})

      expect(analysis.rootCause).toBe('invalid parameters provided to tool')
      expect(analysis.retryable).toBe(false)
      expect(analysis.severity).toBe('medium')
    })

    it('should analyze unknown errors by message', () => {
      const error = new Error('tool not found in registry')
      const analysis = analyzer.analyzeToolExecution(error, { toolName: 'missing-tool' })

      expect(analysis.rootCause).toBe('tool not found: missing-tool')
      expect(analysis.severity).toBe('high')
    })

    it('should include recent spans in analysis', () => {
      const error = new Error('tool failed')
      const spans = [
        {
          spanId: 'span-1',
          traceId: 'trace-1',
          spanType: 'tool_execution' as const,
          module: 'tool' as const,
          operation: 'test-op',
          status: 'failed' as const,
          startTime: new Date().toISOString(),
        },
      ]
      const analysis = analyzer.analyzeToolExecution(error, { recentSpans: spans })

      expect(analysis.contributingEvents).toHaveLength(1)
      expect(analysis.contributingEvents[0].spanId).toBe('span-1')
    })
  })

  describe('analyzeModelProvider', () => {
    it('should analyze 401 authentication error', () => {
      const error = new Error('unauthorized')
      ;(error as { status?: number }).status = 401
      const analysis = analyzer.analyzeModelProvider(error, {})

      expect(analysis.rootCause).toBe('model provider authentication failed')
      expect(analysis.suggestedFixes).toContain('check api key')
      expect(analysis.retryable).toBe(false)
      expect(analysis.severity).toBe('critical')
    })

    it('should analyze 403 forbidden error', () => {
      const error = new Error('forbidden')
      ;(error as { status?: number }).status = 403
      const analysis = analyzer.analyzeModelProvider(error, {})

      expect(analysis.severity).toBe('critical')
      expect(analysis.retryable).toBe(false)
    })

    it('should analyze 429 rate limit error', () => {
      const error = new Error('rate limited')
      ;(error as { status?: number }).status = 429
      const analysis = analyzer.analyzeModelProvider(error, {})

      expect(analysis.rootCause).toBe('model provider rate limit exceeded')
      expect(analysis.retryable).toBe(true)
      expect(analysis.severity).toBe('medium')
    })

    it('should analyze 500 server error', () => {
      const error = new Error('internal server error')
      ;(error as { status?: number }).status = 500
      const analysis = analyzer.analyzeModelProvider(error, {})

      expect(analysis.rootCause).toBe('model provider service error')
      expect(analysis.retryable).toBe(true)
    })

    it('should analyze 502 bad gateway error', () => {
      const error = new Error('bad gateway')
      ;(error as { status?: number }).status = 502
      const analysis = analyzer.analyzeModelProvider(error, {})

      expect(analysis.rootCause).toBe('model provider service error')
    })

    it('should analyze 503 service unavailable error', () => {
      const error = new Error('service unavailable')
      ;(error as { status?: number }).status = 503
      const analysis = analyzer.analyzeModelProvider(error, {})

      expect(analysis.retryable).toBe(true)
    })

    it('should analyze 400 bad request error', () => {
      const error = new Error('bad request')
      ;(error as { status?: number }).status = 400
      const analysis = analyzer.analyzeModelProvider(error, {})

      expect(analysis.rootCause).toBe('invalid request to model provider')
      expect(analysis.retryable).toBe(false)
    })

    it('should analyze 413 payload too large error', () => {
      const error = new Error('payload too large')
      ;(error as { status?: number }).status = 413
      const analysis = analyzer.analyzeModelProvider(error, {})

      expect(analysis.rootCause).toBe('request too large for model provider')
      expect(analysis.suggestedFixes).toContain('reduce context size')
      expect(analysis.retryable).toBe(false)
    })

    it('should analyze timeout errors', () => {
      const error = new Error('request timeout')
      const analysis = analyzer.analyzeModelProvider(error, {})

      expect(analysis.rootCause).toBe('model provider request timed out')
      expect(analysis.retryable).toBe(true)
      expect(analysis.severity).toBe('medium')
    })

    it('should analyze quota exceeded errors', () => {
      const error = new Error('quota exceeded for api')
      const analysis = analyzer.analyzeModelProvider(error, {})

      expect(analysis.rootCause).toBe('model provider quota exceeded')
      expect(analysis.retryable).toBe(false)
      expect(analysis.severity).toBe('high')
    })

    it('should analyze limit exceeded errors', () => {
      const error = new Error('usage limit reached')
      const analysis = analyzer.analyzeModelProvider(error, {})

      expect(analysis.rootCause).toBe('model provider quota exceeded')
      expect(analysis.suggestedFixes).toContain('check usage quota')
    })
  })

  describe('analyzeWorkflowStep', () => {
    it('should analyze waiting_for_approval state', () => {
      const error = new Error('step failed')
      const analysis = analyzer.analyzeWorkflowStep(error, {
        workflowRunState: 'waiting_for_approval',
      })

      expect(analysis.rootCause).toBe('workflow step failed during approval wait')
      expect(analysis.suggestedFixes).toContain('check approval status')
      expect(analysis.severity).toBe('medium')
    })

    it('should analyze waiting_for_external_event state', () => {
      const error = new Error('step failed')
      const analysis = analyzer.analyzeWorkflowStep(error, {
        workflowRunState: 'waiting_for_external_event',
      })

      expect(analysis.rootCause).toBe('workflow step failed waiting for external event')
      expect(analysis.suggestedFixes).toContain('check event source')
    })

    it('should analyze sleeping state', () => {
      const error = new Error('step failed')
      const analysis = analyzer.analyzeWorkflowStep(error, {
        workflowRunState: 'sleeping',
      })

      expect(analysis.rootCause).toBe('workflow step failed during sleep period')
    })

    it('should analyze timeout state', () => {
      const error = new Error('step failed')
      const analysis = analyzer.analyzeWorkflowStep(error, {
        workflowRunState: 'timeout',
      })

      expect(analysis.rootCause).toBe('workflow step exceeded timeout')
      expect(analysis.suggestedFixes).toContain('increase timeout')
    })

    it('should analyze failed state', () => {
      const error = new Error('step failed')
      const analysis = analyzer.analyzeWorkflowStep(error, {
        workflowRunState: 'failed',
      })

      expect(analysis.rootCause).toBe('workflow step execution failed')
      expect(analysis.severity).toBe('high')
    })

    it('should analyze timeout error messages', () => {
      const error = new Error('step timeout')
      const analysis = analyzer.analyzeWorkflowStep(error, {})

      expect(analysis.rootCause).toBe('workflow step timed out')
    })

    it('should analyze dependency errors', () => {
      const error = new Error('dependency failed')
      const analysis = analyzer.analyzeWorkflowStep(error, {})

      expect(analysis.rootCause).toBe('workflow step dependency failed')
      expect(analysis.severity).toBe('high')
    })

    it('should analyze input errors', () => {
      const error = new Error('invalid input provided')
      const analysis = analyzer.analyzeWorkflowStep(error, {})

      expect(analysis.rootCause).toBe('workflow step invalid input')
      expect(analysis.retryable).toBe(false)
    })
  })

  describe('analyzeBackgroundWatchdog', () => {
    it('should analyze failed state', () => {
      const error = new Error('watchdog alert')
      const analysis = analyzer.analyzeBackgroundWatchdog(error, {
        backgroundRunState: 'failed',
      })

      expect(analysis.rootCause).toBe('background run failed')
      expect(analysis.suggestedFixes).toContain('check run logs')
      expect(analysis.severity).toBe('high')
    })

    it('should analyze expired state', () => {
      const error = new Error('watchdog alert')
      const analysis = analyzer.analyzeBackgroundWatchdog(error, {
        backgroundRunState: 'expired',
      })

      expect(analysis.rootCause).toBe('background run expired')
      expect(analysis.suggestedFixes).toContain('extend expiration')
      expect(analysis.severity).toBe('medium')
    })

    it('should analyze waiting_for_user state', () => {
      const error = new Error('watchdog alert')
      const analysis = analyzer.analyzeBackgroundWatchdog(error, {
        backgroundRunState: 'waiting_for_user',
      })

      expect(analysis.rootCause).toBe('background run waiting for user indefinitely')
      expect(analysis.suggestedFixes).toContain('notify user')
      expect(analysis.severity).toBe('low')
    })

    it('should analyze waiting_for_approval state', () => {
      const error = new Error('watchdog alert')
      const analysis = analyzer.analyzeBackgroundWatchdog(error, {
        backgroundRunState: 'waiting_for_approval',
      })

      expect(analysis.rootCause).toBe('background run waiting for approval')
      expect(analysis.suggestedFixes).toContain('escalate if needed')
    })

    it('should analyze waiting_for_external_event state', () => {
      const error = new Error('watchdog alert')
      const analysis = analyzer.analyzeBackgroundWatchdog(error, {
        backgroundRunState: 'waiting_for_external_event',
      })

      expect(analysis.rootCause).toBe('background run waiting for external event')
    })

    it('should analyze recovering state', () => {
      const error = new Error('watchdog alert')
      const analysis = analyzer.analyzeBackgroundWatchdog(error, {
        backgroundRunState: 'recovering',
      })

      expect(analysis.rootCause).toBe('background run recovery failed')
      expect(analysis.severity).toBe('high')
      expect(analysis.suggestedFixes).toContain('manual intervention')
    })

    it('should analyze timeout messages', () => {
      const error = new Error('watchdog timeout triggered')
      const analysis = analyzer.analyzeBackgroundWatchdog(error, {})

      expect(analysis.rootCause).toBe('background run watchdog timeout')
    })

    it('should analyze stuck messages', () => {
      const error = new Error('run appears stuck')
      const analysis = analyzer.analyzeBackgroundWatchdog(error, {})

      expect(analysis.rootCause).toBe('background run appears stuck')
    })

    it('should analyze memory messages', () => {
      const error = new Error('memory limit exceeded')
      const analysis = analyzer.analyzeBackgroundWatchdog(error, {})

      expect(analysis.rootCause).toBe('background run memory limit exceeded')
      expect(analysis.severity).toBe('high')
    })
  })

  describe('analyze', () => {
    it('should delegate to analyzeConnectorAuth for auth errors', () => {
      const error = new Error('auth required')
      const analysis = analyzer.analyze(error, {})

      expect(analysis.category).toBe('connector_auth')
      expect(analysis.rootCause).toBe('connector auth required')
    })

    it('should delegate to analyzeApprovalRejected for approval errors', () => {
      const error = new Error('approval rejected')
      const analysis = analyzer.analyze(error, {})

      expect(analysis.category).toBe('approval_rejected')
      expect(analysis.rootCause).toBe('approval denied by user')
    })

    it('should delegate to analyzeWaitTimeout for timeout errors', () => {
      const error = new Error('wait timeout')
      const analysis = analyzer.analyze(error, {})

      expect(analysis.category).toBe('wait_timeout')
      expect(analysis.rootCause).toBe('wait condition timed out')
    })

    it('should delegate to analyzeRateLimit for rate limit errors', () => {
      const error = new Error('rate limit')
      const analysis = analyzer.analyze(error, {})

      expect(analysis.category).toBe('connector_rate_limit')
    })

    it('should delegate to analyzeToolExecution for tool errors', () => {
      const error = new Error('tool failed')
      const analysis = analyzer.analyze(error, { toolName: 'test' })

      expect(analysis.category).toBe('tool_execution')
    })

    it('should delegate to analyzeModelProvider for model errors', () => {
      const error = new Error('model error')
      ;(error as { status?: number }).status = 500
      const analysis = analyzer.analyze(error, {})

      expect(analysis.category).toBe('model_provider')
    })

    it('should delegate to analyzeWorkflowStep for workflow errors', () => {
      const error = new Error('workflow failed')
      const analysis = analyzer.analyze(error, {
        workflowRunState: 'failed',
      })

      expect(analysis.category).toBe('workflow_step')
    })

    it('should delegate to analyzeBackgroundWatchdog for watchdog errors', () => {
      const error = new Error('watchdog alert')
      const analysis = analyzer.analyze(error, {
        backgroundRunState: 'failed',
      })

      expect(analysis.category).toBe('background_watchdog')
    })

    it('should return unknown analysis for unclassified errors', () => {
      const error = new Error('unknown issue')
      const analysis = analyzer.analyze(error, {})

      expect(analysis.category).toBe('unknown')
      expect(analysis.rootCause).toContain('unknown failure')
      expect(analysis.retryable).toBe(false)
    })
  })

  describe('analyzeConnectorResponse', () => {
    it('should analyze auth_required response', () => {
      const response: ConnectorResponse = {
        status: 'auth_required',
        requestId: 'req-1',
        connectorInstanceId: 'conn-1',
      }
      const analysis = analyzeConnectorResponse(response)

      expect(analysis.category).toBe('connector_auth')
      expect(analysis.retryable).toBe(true)
    })

    it('should analyze rate_limited response', () => {
      const response: ConnectorResponse = {
        status: 'rate_limited',
        requestId: 'req-1',
        connectorInstanceId: 'conn-1',
      }
      const analysis = analyzeConnectorResponse(response)

      expect(analysis.category).toBe('connector_rate_limit')
      expect(analysis.retryable).toBe(true)
    })

    it('should analyze failed response with error', () => {
      const response: ConnectorResponse = {
        status: 'failed',
        requestId: 'req-1',
        connectorInstanceId: 'conn-1',
        error: {
          code: 'TOOL_NOT_FOUND',
          message: 'tool not found',
          recoverable: false,
        },
      }
      const analysis = analyzeConnectorResponse(response)

      expect(analysis.category).toBe('tool_execution')
      expect(analysis.retryable).toBe(false)
    })

    it('should return unknown analysis for generic failed response', () => {
      const response: ConnectorResponse = {
        status: 'failed',
        requestId: 'req-1',
        connectorInstanceId: 'conn-1',
      }
      const analysis = analyzeConnectorResponse(response)

      expect(analysis.category).toBe('unknown')
      expect(analysis.suggestedFixes).toContain('retry')
    })
  })

  describe('analyzeToolResult', () => {
    it('should analyze failed tool result', () => {
      const result: ToolExecutionResult = {
        success: false,
        error: {
          code: 'TIMEOUT',
          message: 'tool timed out',
          recoverable: true,
        },
      }
      const analysis = analyzeToolResult(result, 'test-tool')

      expect(analysis.category).toBe('tool_execution')
      expect(analysis.rootCause).toBe('tool execution timed out')
    })

    it('should throw for successful results', () => {
      const result: ToolExecutionResult = {
        success: true,
        data: { result: 'success' },
      }

      expect(() => analyzeToolResult(result)).toThrow('Cannot analyze successful tool result')
    })

    it('should throw for results without error', () => {
      const result: ToolExecutionResult = {
        success: false,
      }

      expect(() => analyzeToolResult(result)).toThrow('Cannot analyze successful tool result')
    })
  })

  describe('isRetryable', () => {
    it('should return true for retryable analysis', () => {
      const analysis: FailureAnalysis = {
        rootCause: 'test',
        contributingEvents: [],
        suggestedFixes: [],
        retryable: true,
        severity: 'medium',
        category: 'unknown',
      }

      expect(isRetryable(analysis)).toBe(true)
    })

    it('should return false for non-retryable analysis', () => {
      const analysis: FailureAnalysis = {
        rootCause: 'test',
        contributingEvents: [],
        suggestedFixes: [],
        retryable: false,
        severity: 'medium',
        category: 'unknown',
      }

      expect(isRetryable(analysis)).toBe(false)
    })
  })

  describe('getHighestSeverity', () => {
    it('should return critical from mixed severities', () => {
      const analyses: FailureAnalysis[] = [
        {
          rootCause: 'low',
          contributingEvents: [],
          suggestedFixes: [],
          retryable: true,
          severity: 'low',
          category: 'unknown',
        },
        {
          rootCause: 'high',
          contributingEvents: [],
          suggestedFixes: [],
          retryable: true,
          severity: 'high',
          category: 'unknown',
        },
        {
          rootCause: 'critical',
          contributingEvents: [],
          suggestedFixes: [],
          retryable: true,
          severity: 'critical',
          category: 'unknown',
        },
      ]

      expect(getHighestSeverity(analyses)).toBe('critical')
    })

    it('should return high from low and medium', () => {
      const analyses: FailureAnalysis[] = [
        {
          rootCause: 'low',
          contributingEvents: [],
          suggestedFixes: [],
          retryable: true,
          severity: 'low',
          category: 'unknown',
        },
        {
          rootCause: 'medium',
          contributingEvents: [],
          suggestedFixes: [],
          retryable: true,
          severity: 'medium',
          category: 'unknown',
        },
        {
          rootCause: 'high',
          contributingEvents: [],
          suggestedFixes: [],
          retryable: true,
          severity: 'high',
          category: 'unknown',
        },
      ]

      expect(getHighestSeverity(analyses)).toBe('high')
    })

    it('should return low from single low', () => {
      const analyses: FailureAnalysis[] = [
        {
          rootCause: 'low',
          contributingEvents: [],
          suggestedFixes: [],
          retryable: true,
          severity: 'low',
          category: 'unknown',
        },
      ]

      expect(getHighestSeverity(analyses)).toBe('low')
    })

    it('should return low for empty array', () => {
      expect(getHighestSeverity([])).toBe('low')
    })
  })
})
