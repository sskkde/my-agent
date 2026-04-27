import type { ToolExecutionResult as ToolExecResult } from '../tools/types.js';
import type { ConnectorResponse as ConnResponse } from '../connectors/types.js';

export type ToolExecutionResult = ToolExecResult;
export type ConnectorResponse = ConnResponse;
import type { RuntimeSpan, SpanType, SourceModule } from './types.js';
import type { BackgroundSubagentState, WorkflowRunState } from '../shared/states.js';

export type FailureCategory =
  | 'connector_auth'
  | 'connector_rate_limit'
  | 'permission_denied'
  | 'approval_rejected'
  | 'wait_timeout'
  | 'tool_execution'
  | 'model_provider'
  | 'workflow_step'
  | 'background_watchdog'
  | 'unknown';

export type FailureSeverity = 'critical' | 'high' | 'medium' | 'low';

export interface FailureAnalysis {
  rootCause: string;
  contributingEvents: RuntimeSpan[];
  suggestedFixes: string[];
  retryable: boolean;
  severity: FailureSeverity;
  category: FailureCategory;
}

export interface FailureContext {
  module?: SourceModule;
  spanType?: SpanType;
  operation?: string;
  recentSpans?: RuntimeSpan[];
  connectorInstanceId?: string;
  toolName?: string;
  workflowRunState?: WorkflowRunState;
  backgroundRunState?: BackgroundSubagentState;
  metadata?: Record<string, unknown>;
}

export class FailureAnalyzer {
  analyze(error: Error, context: FailureContext): FailureAnalysis {
    const category = this.classifyFailure(error);

    switch (category) {
      case 'connector_auth':
        return this.analyzeConnectorAuth(error);
      case 'connector_rate_limit':
        return this.analyzeRateLimit(error);
      case 'approval_rejected':
        return this.analyzeApprovalRejected(error);
      case 'wait_timeout':
        return this.analyzeWaitTimeout(error);
      case 'tool_execution':
        return this.analyzeToolExecution(error, context);
      case 'model_provider':
        return this.analyzeModelProvider(error, context);
      case 'workflow_step':
        return this.analyzeWorkflowStep(error, context);
      case 'background_watchdog':
        return this.analyzeBackgroundWatchdog(error, context);
      default:
        return this.createUnknownAnalysis(error, context);
    }
  }

  classifyFailure(error: Error): FailureCategory {
    const errorMessage = error.message.toLowerCase();
    const errorName = error.name.toLowerCase();
    const errorCode = (error as { code?: string }).code?.toLowerCase() ?? '';

    if (
      errorMessage.includes('auth') ||
      errorMessage.includes('unauthorized') ||
      errorMessage.includes('authentication') ||
      errorCode.includes('auth_required') ||
      errorCode.includes('unauthorized')
    ) {
      return 'connector_auth';
    }

    if (
      errorMessage.includes('rate limit') ||
      errorMessage.includes('too many requests') ||
      errorMessage.includes('throttled') ||
      errorCode.includes('rate_limited') ||
      errorCode.includes('429') ||
      (error as { status?: number }).status === 429
    ) {
      return 'connector_rate_limit';
    }

    if (
      errorMessage.includes('approval rejected') ||
      errorMessage.includes('approval denied') ||
      errorMessage.includes('user denied') ||
      errorCode.includes('approval_rejected')
    ) {
      return 'approval_rejected';
    }

    if (
      errorMessage.includes('wait timeout') ||
      errorMessage.includes('wait condition timed out') ||
      errorMessage.includes('timeout waiting') ||
      errorName.includes('timeout') ||
      errorCode.includes('timeout')
    ) {
      return 'wait_timeout';
    }

    if (
      errorMessage.includes('tool') ||
      errorName.includes('tool') ||
      errorCode.includes('tool_') ||
      errorMessage.includes('execution failed')
    ) {
      return 'tool_execution';
    }

    if (
      errorMessage.includes('model') ||
      errorMessage.includes('llm') ||
      errorMessage.includes('provider') ||
      errorName.includes('model') ||
      errorMessage.includes('api error') ||
      errorMessage.includes('openai') ||
      errorMessage.includes('anthropic')
    ) {
      return 'model_provider';
    }

    if (
      errorMessage.includes('workflow') ||
      errorMessage.includes('step') ||
      errorName.includes('workflow')
    ) {
      return 'workflow_step';
    }

    if (
      errorMessage.includes('watchdog') ||
      errorMessage.includes('background') ||
      errorName.includes('watchdog')
    ) {
      return 'background_watchdog';
    }

    return 'unknown';
  }

  analyzeConnectorAuth(_error: Error): FailureAnalysis {
    return {
      rootCause: 'connector auth required',
      contributingEvents: [],
      suggestedFixes: ['reauthorize'],
      retryable: true,
      severity: 'high',
      category: 'connector_auth',
    };
  }

  analyzeApprovalRejected(_error: Error): FailureAnalysis {
    return {
      rootCause: 'approval denied by user',
      contributingEvents: [],
      suggestedFixes: ['replan', 'stop'],
      retryable: false,
      severity: 'medium',
      category: 'approval_rejected',
    };
  }

  analyzeWaitTimeout(_error: Error): FailureAnalysis {
    return {
      rootCause: 'wait condition timed out',
      contributingEvents: [],
      suggestedFixes: ['retry_wait', 'skip_step', 'cancel_run'],
      retryable: true,
      severity: 'medium',
      category: 'wait_timeout',
    };
  }

  analyzeRateLimit(error: Error): FailureAnalysis {
    const suggestedFixes: string[] = ['wait_and_retry'];

    const retryAfter = (error as { retryAfterMs?: number }).retryAfterMs;
    if (retryAfter !== undefined) {
      suggestedFixes.push(`wait ${retryAfter}ms before retry`);
    }

    return {
      rootCause: 'rate limit exceeded',
      contributingEvents: [],
      suggestedFixes,
      retryable: true,
      severity: 'medium',
      category: 'connector_rate_limit',
    };
  }

  analyzeToolExecution(error: Error, context: FailureContext): FailureAnalysis {
    const errorCode = (error as { code?: string }).code;
    const errorMessage = error.message.toLowerCase();

    let rootCause = 'tool execution failed';
    let severity: FailureSeverity = 'medium';
    let retryable = false;
    const suggestedFixes: string[] = [];

    switch (errorCode) {
      case 'TOOL_NOT_FOUND':
        rootCause = `tool not found: ${context.toolName ?? 'unknown'}`;
        severity = 'high';
        retryable = false;
        suggestedFixes.push('verify tool name', 'check tool registration');
        break;
      case 'SCHEMA_VALIDATION_FAILED':
        rootCause = 'tool parameter validation failed';
        severity = 'medium';
        retryable = false;
        suggestedFixes.push('check parameter schema', 'validate input parameters');
        break;
      case 'PERMISSION_DENIED':
        rootCause = 'tool execution permission denied';
        severity = 'high';
        retryable = false;
        suggestedFixes.push('request permission', 'check user permissions');
        break;
      case 'TIMEOUT':
        rootCause = 'tool execution timed out';
        severity = 'medium';
        retryable = true;
        suggestedFixes.push('increase timeout', 'check tool availability', 'retry');
        break;
      case 'EXECUTION_FAILED':
        rootCause = 'tool execution returned error';
        severity = 'medium';
        retryable = true;
        suggestedFixes.push('check tool logs', 'retry with backoff');
        break;
      case 'INVALID_PARAMS':
        rootCause = 'invalid parameters provided to tool';
        severity = 'medium';
        retryable = false;
        suggestedFixes.push('fix parameter format', 'check required parameters');
        break;
      default:
        if (errorMessage.includes('not found')) {
          rootCause = `tool not found: ${context.toolName ?? 'unknown'}`;
          severity = 'high';
          suggestedFixes.push('verify tool name', 'check tool registration');
        } else if (errorMessage.includes('timeout')) {
          rootCause = 'tool execution timed out';
          severity = 'medium';
          retryable = true;
          suggestedFixes.push('increase timeout', 'retry');
        } else if (errorMessage.includes('permission')) {
          rootCause = 'tool execution permission denied';
          severity = 'high';
          suggestedFixes.push('request permission');
        } else {
          suggestedFixes.push('check tool logs', 'verify tool configuration');
        }
    }

    return {
      rootCause,
      contributingEvents: context.recentSpans ?? [],
      suggestedFixes,
      retryable,
      severity,
      category: 'tool_execution',
    };
  }

  analyzeModelProvider(error: Error, context: FailureContext): FailureAnalysis {
    const errorMessage = error.message.toLowerCase();
    const status = (error as { status?: number }).status;

    let rootCause = 'model provider error';
    let severity: FailureSeverity = 'high';
    let retryable = true;
    const suggestedFixes: string[] = [];

    if (status === 401 || status === 403) {
      rootCause = 'model provider authentication failed';
      severity = 'critical';
      retryable = false;
      suggestedFixes.push('check api key', 'verify credentials', 'reauthorize');
    } else if (status === 429) {
      rootCause = 'model provider rate limit exceeded';
      severity = 'medium';
      retryable = true;
      suggestedFixes.push('wait and retry', 'implement backoff');
    } else if (status === 500 || status === 502 || status === 503) {
      rootCause = 'model provider service error';
      severity = 'high';
      retryable = true;
      suggestedFixes.push('retry with backoff', 'check provider status');
    } else if (status === 400) {
      rootCause = 'invalid request to model provider';
      severity = 'medium';
      retryable = false;
      suggestedFixes.push('check request format', 'validate parameters');
    } else if (status === 413) {
      rootCause = 'request too large for model provider';
      severity = 'medium';
      retryable = false;
      suggestedFixes.push('reduce context size', 'compact conversation');
    } else if (errorMessage.includes('timeout')) {
      rootCause = 'model provider request timed out';
      severity = 'medium';
      retryable = true;
      suggestedFixes.push('increase timeout', 'retry with shorter context');
    } else if (errorMessage.includes('quota') || errorMessage.includes('limit')) {
      rootCause = 'model provider quota exceeded';
      severity = 'high';
      retryable = false;
      suggestedFixes.push('check usage quota', 'upgrade plan');
    } else {
      suggestedFixes.push('check provider status', 'retry with backoff');
    }

    return {
      rootCause,
      contributingEvents: context.recentSpans ?? [],
      suggestedFixes,
      retryable,
      severity,
      category: 'model_provider',
    };
  }

  analyzeWorkflowStep(error: Error, context: FailureContext): FailureAnalysis {
    const workflowState = context.workflowRunState;
    const errorMessage = error.message.toLowerCase();

    let rootCause = 'workflow step failed';
    let severity: FailureSeverity = 'high';
    let retryable = true;
    const suggestedFixes: string[] = [];

    switch (workflowState) {
      case 'waiting_for_approval':
        rootCause = 'workflow step failed during approval wait';
        severity = 'medium';
        suggestedFixes.push('check approval status', 'retry step');
        break;
      case 'waiting_for_external_event':
        rootCause = 'workflow step failed waiting for external event';
        severity = 'medium';
        suggestedFixes.push('check event source', 'verify webhook configuration');
        break;
      case 'sleeping':
        rootCause = 'workflow step failed during sleep period';
        severity = 'medium';
        suggestedFixes.push('check sleep configuration', 'retry step');
        break;
      case 'timeout':
        rootCause = 'workflow step exceeded timeout';
        severity = 'medium';
        suggestedFixes.push('increase timeout', 'optimize step execution');
        break;
      case 'failed':
        rootCause = 'workflow step execution failed';
        severity = 'high';
        suggestedFixes.push('check step logs', 'retry with fixed parameters');
        break;
      default:
        if (errorMessage.includes('timeout')) {
          rootCause = 'workflow step timed out';
          severity = 'medium';
          suggestedFixes.push('increase timeout', 'optimize step');
        } else if (errorMessage.includes('dependency')) {
          rootCause = 'workflow step dependency failed';
          severity = 'high';
          suggestedFixes.push('check upstream steps', 'fix dependency');
        } else if (errorMessage.includes('input')) {
          rootCause = 'workflow step invalid input';
          severity = 'medium';
          retryable = false;
          suggestedFixes.push('validate step inputs', 'check data format');
        } else {
          suggestedFixes.push('check workflow logs', 'retry step');
        }
    }

    return {
      rootCause,
      contributingEvents: context.recentSpans ?? [],
      suggestedFixes,
      retryable,
      severity,
      category: 'workflow_step',
    };
  }

  analyzeBackgroundWatchdog(error: Error, context: FailureContext): FailureAnalysis {
    const runState = context.backgroundRunState;
    const errorMessage = error.message.toLowerCase();

    let rootCause = 'background watchdog detected failure';
    let severity: FailureSeverity = 'high';
    const suggestedFixes: string[] = [];

    switch (runState) {
      case 'failed':
        rootCause = 'background run failed';
        severity = 'high';
        suggestedFixes.push('check run logs', 'retry background task');
        break;
      case 'expired':
        rootCause = 'background run expired';
        severity = 'medium';
        suggestedFixes.push('extend expiration', 'restart task');
        break;
      case 'waiting_for_user':
        rootCause = 'background run waiting for user indefinitely';
        severity = 'low';
        suggestedFixes.push('notify user', 'set timeout', 'cancel if stale');
        break;
      case 'waiting_for_approval':
        rootCause = 'background run waiting for approval';
        severity = 'medium';
        suggestedFixes.push('check approval status', 'escalate if needed');
        break;
      case 'waiting_for_external_event':
        rootCause = 'background run waiting for external event';
        severity = 'medium';
        suggestedFixes.push('check event source', 'verify webhook');
        break;
      case 'recovering':
        rootCause = 'background run recovery failed';
        severity = 'high';
        suggestedFixes.push('check recovery logs', 'manual intervention');
        break;
      default:
        if (errorMessage.includes('timeout')) {
          rootCause = 'background run watchdog timeout';
          severity = 'medium';
          suggestedFixes.push('check run status', 'increase watchdog timeout');
        } else if (errorMessage.includes('stuck')) {
          rootCause = 'background run appears stuck';
          severity = 'medium';
          suggestedFixes.push('check run logs', 'restart if unresponsive');
        } else if (errorMessage.includes('memory')) {
          rootCause = 'background run memory limit exceeded';
          severity = 'high';
          suggestedFixes.push('increase memory limit', 'optimize task');
        } else {
          suggestedFixes.push('check watchdog logs', 'investigate run state');
        }
    }

    return {
      rootCause,
      contributingEvents: context.recentSpans ?? [],
      suggestedFixes,
      retryable: true,
      severity,
      category: 'background_watchdog',
    };
  }

  private createUnknownAnalysis(error: Error, context: FailureContext): FailureAnalysis {
    return {
      rootCause: `unknown failure: ${error.message}`,
      contributingEvents: context.recentSpans ?? [],
      suggestedFixes: ['investigate error', 'check logs', 'retry if appropriate'],
      retryable: false,
      severity: 'medium',
      category: 'unknown',
    };
  }
}

export function createFailureAnalyzer(): FailureAnalyzer {
  return new FailureAnalyzer();
}

export function analyzeConnectorResponse(response: ConnectorResponse): FailureAnalysis {
  const analyzer = new FailureAnalyzer();

  if (response.status === 'auth_required') {
    return analyzer.analyzeConnectorAuth(
      new Error('connector authentication required')
    );
  }

  if (response.status === 'rate_limited') {
    return analyzer.analyzeRateLimit(
      new Error('connector rate limit exceeded')
    );
  }

  if (response.error) {
    const error = new Error(response.error.message);
    (error as { code?: string }).code = response.error.code;
    return analyzer.analyze(error, { module: 'connector' });
  }

  return {
    rootCause: 'connector call failed',
    contributingEvents: [],
    suggestedFixes: ['check connector status', 'retry'],
    retryable: true,
    severity: 'medium',
    category: 'unknown',
  };
}

export function analyzeToolResult(result: ToolExecutionResult, toolName?: string): FailureAnalysis {
  if (result.success || !result.error) {
    throw new Error('Cannot analyze successful tool result');
  }

  const analyzer = new FailureAnalyzer();
  const error = new Error(result.error.message);
  (error as { code?: string }).code = result.error.code;

  return analyzer.analyzeToolExecution(error, {
    module: 'tool',
    toolName,
  });
}

export function isRetryable(analysis: FailureAnalysis): boolean {
  return analysis.retryable;
}

export function getHighestSeverity(analyses: FailureAnalysis[]): FailureSeverity {
  const severityOrder: FailureSeverity[] = ['low', 'medium', 'high', 'critical'];
  let highest: FailureSeverity = 'low';

  for (const analysis of analyses) {
    if (severityOrder.indexOf(analysis.severity) > severityOrder.indexOf(highest)) {
      highest = analysis.severity;
    }
  }

  return highest;
}
