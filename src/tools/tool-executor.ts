import type {
  ToolExecutor,
  ToolExecutorConfig,
  ToolExecutionRequest,
  ToolExecutionResult,
  ToolExecutionContext,
  ToolCategory,
} from './types.js';
import type { RuntimeContextDelta } from '../context/types.js';
import { TOOL_EXECUTION_STATES } from '../shared/states.js';

class ToolExecutorImpl implements ToolExecutor {
  private config: ToolExecutorConfig;

  constructor(config: ToolExecutorConfig) {
    this.config = config;
  }

  async execute(request: ToolExecutionRequest): Promise<ToolExecutionResult> {
    const { toolCallId, toolName, params, userId, sessionId, kernelRunId, permissionContext } = request;
    const traceId = kernelRunId || toolCallId;
    const spanId = `span_${toolCallId}`;
    const startedAt = Date.now();

    this.config.traceStore?.createSpan({
      spanId,
      traceId,
      spanType: 'tool_call',
      module: 'tool',
      operation: toolName,
      status: 'started',
      startTime: new Date(startedAt).toISOString(),
      metadata: { toolCallId, toolName },
    });

    try {
      const tool = this.config.registry.getTool(toolName);

      if (!tool) {
        this.endToolSpan(spanId, startedAt, 'failed', 'Tool not found');
        return this.createErrorResult(
          'TOOL_NOT_FOUND',
          `Tool not found: ${toolName}`,
          false
        );
      }

      this.config.toolExecutionStore.create({
        toolCallId,
        toolName,
        userId,
        sessionId,
        kernelRunId,
        status: TOOL_EXECUTION_STATES.SCHEMA_VALIDATING,
        params,
        sensitivity: tool.sensitivity,
      });

      const validationResult = this.validateParams(params, tool.schema);
      if (!validationResult.valid) {
        this.config.toolExecutionStore.updateStatus(toolCallId, TOOL_EXECUTION_STATES.FAILED);
        this.endToolSpan(spanId, startedAt, 'failed', validationResult.errors?.join(', '));
        return this.createErrorResult(
          'SCHEMA_VALIDATION_FAILED',
          `Schema validation failed: ${validationResult.errors?.join(', ')}`,
          false
        );
      }

      this.config.toolExecutionStore.updateStatus(toolCallId, TOOL_EXECUTION_STATES.PERMISSION_CHECKING);

      const operationType = this.categoryToOperationType(tool.category);
      const permissionDecision = this.config.permissionEngine.checkPermission({
        context: permissionContext,
        actionType: `tool:${toolName}`,
        resource: toolName,
        operationType,
        justification: `Execute tool: ${tool.description}`,
      });

      if (!permissionDecision.allowed) {
        this.config.toolExecutionStore.updateStatus(toolCallId, TOOL_EXECUTION_STATES.DENIED);
        this.endToolSpan(spanId, startedAt, 'failed', permissionDecision.reason || 'Permission denied');
        return this.createErrorResult(
          'PERMISSION_DENIED',
          permissionDecision.reason || 'Permission denied',
          false
        );
      }

      this.config.toolExecutionStore.updateStatus(toolCallId, TOOL_EXECUTION_STATES.EXECUTING);

      const executionContext: ToolExecutionContext = {
        toolCallId,
        toolName,
        userId,
        sessionId,
        kernelRunId,
        permissionContext,
        executionStartTime: new Date().toISOString(),
        stores: {
          toolExecutionStore: {
            updateStatus: (id: string, status: string) => {
              this.config.toolExecutionStore.updateStatus(id, status);
            },
            saveResult: (id: string, result: {
              preview?: string;
              resultRef?: string;
              structuredContent?: Record<string, unknown>;
            }) => {
              this.config.toolExecutionStore.saveResult(id, result);
            },
          },
        },
      };

      const handlerResult = await tool.handler(params, executionContext);

      const finalResult: ToolExecutionResult = {
        ...handlerResult,
        contextDelta: this.normalizeContextDelta(handlerResult.contextDelta, kernelRunId),
      };

      this.config.toolExecutionStore.updateStatus(toolCallId, TOOL_EXECUTION_STATES.COMPLETED);
      this.config.toolExecutionStore.saveResult(toolCallId, {
        preview: finalResult.resultPreview,
        resultRef: finalResult.resultRef,
        structuredContent: finalResult.structuredContent,
      });

      if (finalResult.contextDelta && this.config.contextManager) {
        this.config.contextManager.applyDelta(finalResult.contextDelta);
      }

      this.config.auditRecorder?.recordToolCall({
        toolCallId,
        toolName,
        userId,
        sessionId,
        params: this.normalizeRecordParams(params),
        result: finalResult.resultPreview,
        status: finalResult.success ? 'success' : 'failure',
        correlationId: toolCallId,
        causationId: kernelRunId,
      });
      this.endToolSpan(spanId, startedAt, finalResult.success ? 'completed' : 'failed', finalResult.error?.message);

      if (finalResult.events && finalResult.events.length > 0 && this.config.eventStore) {
        for (const event of finalResult.events) {
          this.config.eventStore.append({
            eventId: `evt_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
            eventType: event.eventType,
            sourceModule: 'tool_plane',
            userId,
            sessionId,
            correlationId: toolCallId,
            payload: event.payload,
            sensitivity: tool.sensitivity === 'restricted' ? 'high' : tool.sensitivity === 'high' ? 'medium' : 'low',
            retentionClass: 'standard',
            createdAt: event.timestamp,
          });
        }
      }

      return finalResult;
    } catch (error) {
      this.config.toolExecutionStore.updateStatus(toolCallId, TOOL_EXECUTION_STATES.FAILED);

      const errorMessage = error instanceof Error ? error.message : String(error);
      this.endToolSpan(spanId, startedAt, 'failed', errorMessage);
      return this.createErrorResult(
        'EXECUTION_FAILED',
        errorMessage,
        false
      );
    }
  }

  private validateParams(params: unknown, schema: { type: string; properties: Record<string, unknown>; required?: string[] }): { valid: boolean; errors?: string[] } {
    const errors: string[] = [];

    if (schema.type !== 'object') {
      return { valid: true };
    }

    if (typeof params !== 'object' || params === null) {
      return { valid: false, errors: ['Params must be an object'] };
    }

    const paramsObj = params as Record<string, unknown>;

    if (schema.required && schema.required.length > 0) {
      for (const required of schema.required) {
        if (!(required in paramsObj)) {
          errors.push(`Missing required field: ${required}`);
        }
      }
    }

    if (schema.properties) {
      for (const [key, value] of Object.entries(paramsObj)) {
        const propertySchema = schema.properties[key];
        if (propertySchema && typeof propertySchema === 'object' && 'type' in propertySchema) {
          const expectedType = (propertySchema as { type: string }).type;
          const actualType = this.getTypeName(value);

          if (expectedType === 'number' && typeof value !== 'number') {
            errors.push(`Field '${key}' must be of type 'number', got '${actualType}'`);
          } else if (expectedType === 'string' && typeof value !== 'string') {
            errors.push(`Field '${key}' must be of type 'string', got '${actualType}'`);
          } else if (expectedType === 'boolean' && typeof value !== 'boolean') {
            errors.push(`Field '${key}' must be of type 'boolean', got '${actualType}'`);
          } else if (expectedType === 'array' && !Array.isArray(value)) {
            errors.push(`Field '${key}' must be of type 'array', got '${actualType}'`);
          } else if (expectedType === 'object' && (typeof value !== 'object' || value === null || Array.isArray(value))) {
            errors.push(`Field '${key}' must be of type 'object', got '${actualType}'`);
          }
        }
      }
    }

    return { valid: errors.length === 0, errors: errors.length > 0 ? errors : undefined };
  }

  private getTypeName(value: unknown): string {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    return typeof value;
  }

  private categoryToOperationType(category: ToolCategory): 'read' | 'write' | 'execute' | 'delete' | 'admin' {
    switch (category) {
      case 'read':
      case 'search':
        return 'read';
      case 'write':
        return 'write';
      case 'delete':
        return 'delete';
      case 'execute':
        return 'execute';
      case 'admin':
      case 'connector':
      case 'internal':
        return 'admin';
      default:
        return 'read';
    }
  }

  private normalizeContextDelta(delta: RuntimeContextDelta | undefined, kernelRunId: string | undefined): RuntimeContextDelta | undefined {
    if (!delta) return undefined;

    return {
      ...delta,
      runId: delta.runId || kernelRunId || 'unknown',
      source: delta.source || 'tool_result',
    };
  }

  private normalizeRecordParams(params: unknown): Record<string, unknown> {
    if (typeof params === 'object' && params !== null && !Array.isArray(params)) {
      return params as Record<string, unknown>;
    }
    return { value: params };
  }

  private endToolSpan(
    spanId: string,
    startedAt: number,
    status: 'completed' | 'failed',
    error?: string
  ): void {
    this.config.traceStore?.updateSpan(spanId, {
      status,
      endTime: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      error,
    });
  }

  private createErrorResult(code: string, message: string, recoverable: boolean): ToolExecutionResult {
    return {
      success: false,
      error: {
        code,
        message,
        recoverable,
      },
    };
  }
}

export function createToolExecutor(config: ToolExecutorConfig): ToolExecutor {
  return new ToolExecutorImpl(config);
}
