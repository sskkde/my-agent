import type {
  ToolExecutor,
  ToolExecutorConfig,
  ToolExecutionRequest,
  ToolExecutionResult,
  ToolExecutionContext,
  ToolCategory,
} from './types.js'
import type { RuntimeContextDelta } from '../context/types.js'
import type { AgentType } from '../context/types.js'
import { TOOL_EXECUTION_STATES } from '../shared/states.js'
import { sanitizeErrorMessage, formatPersistedError } from './error-sanitizer.js'
import { isWorkdirFileTool } from '../permissions/types.js'
import { isWithinWorkdir } from '../workdirs/workdir-paths.js'
import { parsePatchText } from './builtins/patch-parser.js'
import { resolve, isAbsolute } from 'path'

class ToolExecutorImpl implements ToolExecutor {
  private config: ToolExecutorConfig

  constructor(config: ToolExecutorConfig) {
    this.config = config
  }

  async execute(request: ToolExecutionRequest): Promise<ToolExecutionResult> {
    const {
      toolCallId,
      toolName,
      params,
      userId,
      sessionId,
      kernelRunId,
      permissionContext,
      signal,
      agentType,
      agentId,
      agentProfile,
      launchSource,
      outputContract,
      permissionPolicyRef,
      workDirRoot,
      workDirId,
    } = request
    const traceId = kernelRunId || toolCallId
    const spanId = `span_${toolCallId}`
    const startedAt = Date.now()

    this.config.traceStore?.createSpan({
      spanId,
      traceId,
      spanType: 'tool_call',
      module: 'tool',
      operation: toolName,
      status: 'started',
      startTime: new Date(startedAt).toISOString(),
      metadata: {
        toolCallId,
        toolName,
        ...(agentType ? { agentType } : {}),
        ...(agentProfile ? { agentProfile } : {}),
        ...(launchSource ? { launchSource } : {}),
        ...(outputContract ? { outputContract } : {}),
        ...(permissionPolicyRef ? { permissionPolicyRef } : {}),
        ...(workDirRoot ? { workDirRoot } : {}),
        ...(workDirId ? { workDirId } : {}),
      },
    })

    try {
      const tool = this.config.registry.getTool(toolName)

      if (!tool) {
        const errorMessage = `[TOOL_NOT_FOUND] Tool not found: ${toolName}`
        this.config.toolExecutionStore.create({
          toolCallId,
          toolName,
          userId,
          sessionId,
          kernelRunId,
          status: TOOL_EXECUTION_STATES.FAILED,
          sensitivity: 'low',
          errorMessage,
        })
        this.endToolSpan(spanId, startedAt, 'failed', errorMessage)
        return this.createErrorResult('TOOL_NOT_FOUND', `Tool not found: ${toolName}`, false)
      }

      if (this.config.envelopeRegistry) {
        if (!agentType) {
          const errorMessage = '[ENVELOPE_DENIED] Missing agentType for envelope enforcement'
          this.config.toolExecutionStore.create({
            toolCallId,
            toolName,
            userId,
            sessionId,
            kernelRunId,
            status: TOOL_EXECUTION_STATES.DENIED,
            sensitivity: tool.sensitivity,
            errorMessage,
          })
          this.endToolSpan(spanId, startedAt, 'failed', errorMessage)
          return this.createErrorResult('ENVELOPE_DENIED', errorMessage, false)
        }

        const envelope = this.config.envelopeRegistry.getEnvelope(agentType as AgentType)
        if (!envelope) {
          const errorMessage = `[ENVELOPE_DENIED] No envelope for agentType: ${agentType}`
          this.config.toolExecutionStore.create({
            toolCallId,
            toolName,
            userId,
            sessionId,
            kernelRunId,
            status: TOOL_EXECUTION_STATES.DENIED,
            sensitivity: tool.sensitivity,
            errorMessage,
          })
          this.endToolSpan(spanId, startedAt, 'failed', errorMessage)
          return this.createErrorResult('ENVELOPE_DENIED', errorMessage, false)
        }

        if (!this.config.envelopeRegistry.isToolAllowedByEnvelope(agentType as AgentType, toolName, tool.category)) {
          const errorMessage = `[ENVELOPE_DENIED] Tool "${toolName}" (category: ${tool.category}) is outside the ${agentType} envelope boundary`
          this.config.toolExecutionStore.create({
            toolCallId,
            toolName,
            userId,
            sessionId,
            kernelRunId,
            status: TOOL_EXECUTION_STATES.DENIED,
            sensitivity: tool.sensitivity,
            errorMessage,
          })
          this.endToolSpan(spanId, startedAt, 'failed', errorMessage)
          return this.createErrorResult('ENVELOPE_DENIED', errorMessage, false)
        }
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
      })

      const validationResult = this.validateParams(params, tool.schema)
      if (!validationResult.valid) {
        const rawErrorMessage = `Schema validation failed: ${validationResult.errors?.join(', ')}`
        const persistedErrorMessage = formatPersistedError('SCHEMA_VALIDATION_FAILED', rawErrorMessage)
        this.config.toolExecutionStore.updateStatus(
          toolCallId,
          TOOL_EXECUTION_STATES.FAILED,
          undefined,
          persistedErrorMessage,
        )
        this.endToolSpan(spanId, startedAt, 'failed', sanitizeErrorMessage(rawErrorMessage))
        return this.createErrorResult('SCHEMA_VALIDATION_FAILED', rawErrorMessage, false)
      }

      this.config.toolExecutionStore.updateStatus(toolCallId, TOOL_EXECUTION_STATES.PERMISSION_CHECKING)

      const operationType = this.categoryToOperationType(tool.category)
      const permissionResource = derivePermissionResource(toolName, params, workDirRoot)
      const permissionDecision = this.config.permissionEngine.checkPermission({
        context: permissionContext,
        actionType: `tool:${toolName}`,
        resource: permissionResource,
        operationType,
        justification: `Execute tool: ${tool.description}`,
        workDirRoot,
        workDirId,
      })

      if (!permissionDecision.allowed) {
        const rawErrorMessage = permissionDecision.reason || 'Permission denied'

        if (permissionDecision.status === 'requires_approval' || permissionDecision.status === 'pending_approval') {
          const persistedErrorMessage = formatPersistedError('APPROVAL_REQUIRED', rawErrorMessage)
          this.config.toolExecutionStore.updateStatus(
            toolCallId,
            TOOL_EXECUTION_STATES.WAITING_FOR_APPROVAL,
            undefined,
            persistedErrorMessage,
          )
          this.endToolSpan(spanId, startedAt, 'failed', sanitizeErrorMessage(rawErrorMessage))
          return {
            success: false,
            error: {
              code: 'APPROVAL_REQUIRED',
              message: rawErrorMessage,
              recoverable: true,
            },
            structuredContent: {
              status: 'requires_approval',
              requestId: permissionDecision.requestId,
              approvalRequest: permissionDecision.approvalRequest,
            },
          }
        }

        const persistedErrorMessage = formatPersistedError('PERMISSION_DENIED', rawErrorMessage)
        this.config.toolExecutionStore.updateStatus(
          toolCallId,
          TOOL_EXECUTION_STATES.DENIED,
          undefined,
          persistedErrorMessage,
        )
        this.endToolSpan(spanId, startedAt, 'failed', sanitizeErrorMessage(rawErrorMessage))
        return this.createErrorResult('PERMISSION_DENIED', rawErrorMessage, false)
      }

      this.config.toolExecutionStore.updateStatus(toolCallId, TOOL_EXECUTION_STATES.EXECUTING)

      if (signal?.aborted) {
        this.config.toolExecutionStore.updateStatus(
          toolCallId,
          TOOL_EXECUTION_STATES.FAILED,
          undefined,
          'CANCELLED: Tool execution was cancelled',
        )
        this.endToolSpan(spanId, startedAt, 'failed', 'Tool execution was cancelled')
        return this.createErrorResult('CANCELLED', 'Tool execution was cancelled', true)
      }

      const executionContext: ToolExecutionContext = {
        toolCallId,
        toolName,
        userId,
        sessionId,
        kernelRunId,
        permissionContext,
        executionStartTime: new Date().toISOString(),
        signal,
        agentType,
        agentId,
        agentProfile,
        launchSource,
        workDirRoot,
        workDirId,
        stores: {
          toolExecutionStore: {
            updateStatus: (id: string, status: string, errorMessage?: string) => {
              this.config.toolExecutionStore.updateStatus(id, status, undefined, errorMessage)
            },
            saveResult: (
              id: string,
              result: {
                preview?: string
                resultRef?: string
                structuredContent?: Record<string, unknown>
              },
            ) => {
              this.config.toolExecutionStore.saveResult(id, result)
            },
          },
        },
      }

      const handlerResult = await tool.handler(params, executionContext)

      if (signal?.aborted) {
        this.config.toolExecutionStore.updateStatus(
          toolCallId,
          TOOL_EXECUTION_STATES.FAILED,
          undefined,
          'CANCELLED: Tool execution was cancelled',
        )
        this.endToolSpan(spanId, startedAt, 'failed', 'Tool execution was cancelled')
        return this.createErrorResult('CANCELLED', 'Tool execution was cancelled', true)
      }

      const finalResult: ToolExecutionResult = {
        ...handlerResult,
        contextDelta: this.normalizeContextDelta(handlerResult.contextDelta, kernelRunId),
      }

      if (!finalResult.success) {
        const rawErrorMessage = finalResult.error?.message || 'Tool execution returned failure'
        const persistedErrorMessage = formatPersistedError('EXECUTION_FAILED', rawErrorMessage)
        this.config.toolExecutionStore.updateStatus(
          toolCallId,
          TOOL_EXECUTION_STATES.FAILED,
          undefined,
          persistedErrorMessage,
        )
        this.config.toolExecutionStore.saveResult(toolCallId, {
          preview: finalResult.resultPreview,
          resultRef: finalResult.resultRef,
          structuredContent: finalResult.structuredContent,
        })
      } else {
        this.config.toolExecutionStore.updateStatus(toolCallId, TOOL_EXECUTION_STATES.COMPLETED)
        this.config.toolExecutionStore.saveResult(toolCallId, {
          preview: finalResult.resultPreview,
          resultRef: finalResult.resultRef,
          structuredContent: finalResult.structuredContent,
        })
      }

      if (finalResult.contextDelta && this.config.contextManager) {
        this.config.contextManager.applyDelta(finalResult.contextDelta)
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
        agentType,
        agentProfile,
        launchSource,
        outputContract,
        permissionPolicyRef,
        ...(permissionDecision.metadata?.workdirAutoAllow
          ? { workdirAutoAllow: true, workDirRoot, workDirId }
          : {}),
      })
      const spanError = finalResult.success
        ? undefined
        : sanitizeErrorMessage(finalResult.error?.message || 'Tool execution returned failure')
      this.endToolSpan(spanId, startedAt, finalResult.success ? 'completed' : 'failed', spanError)

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
          })
        }
      }

      return finalResult
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : String(error)
      const persistedErrorMessage = formatPersistedError('EXECUTION_FAILED', rawMessage)
      this.config.toolExecutionStore.updateStatus(
        toolCallId,
        TOOL_EXECUTION_STATES.FAILED,
        undefined,
        persistedErrorMessage,
      )

      this.endToolSpan(spanId, startedAt, 'failed', sanitizeErrorMessage(rawMessage))
      return this.createErrorResult('EXECUTION_FAILED', rawMessage, false)
    }
  }

  private validateParams(
    params: unknown,
    schema: { type: string; properties: Record<string, unknown>; required?: string[] },
  ): { valid: boolean; errors?: string[] } {
    const errors: string[] = []

    if (schema.type !== 'object') {
      return { valid: true }
    }

    if (typeof params !== 'object' || params === null) {
      return { valid: false, errors: ['Params must be an object'] }
    }

    const paramsObj = params as Record<string, unknown>

    if (schema.required && schema.required.length > 0) {
      for (const required of schema.required) {
        if (!(required in paramsObj)) {
          errors.push(`Missing required field: ${required}`)
        }
      }
    }

    if (schema.properties) {
      for (const [key, value] of Object.entries(paramsObj)) {
        const propertySchema = schema.properties[key]
        if (propertySchema && typeof propertySchema === 'object' && 'type' in propertySchema) {
          const expectedType = (propertySchema as { type: string }).type
          const actualType = this.getTypeName(value)

          if (expectedType === 'number' && typeof value !== 'number') {
            errors.push(`Field '${key}' must be of type 'number', got '${actualType}'`)
          } else if (expectedType === 'string' && typeof value !== 'string') {
            errors.push(`Field '${key}' must be of type 'string', got '${actualType}'`)
          } else if (expectedType === 'boolean' && typeof value !== 'boolean') {
            errors.push(`Field '${key}' must be of type 'boolean', got '${actualType}'`)
          } else if (expectedType === 'array' && !Array.isArray(value)) {
            errors.push(`Field '${key}' must be of type 'array', got '${actualType}'`)
          } else if (
            expectedType === 'object' &&
            (typeof value !== 'object' || value === null || Array.isArray(value))
          ) {
            errors.push(`Field '${key}' must be of type 'object', got '${actualType}'`)
          }
        }
      }
    }

    return { valid: errors.length === 0, errors: errors.length > 0 ? errors : undefined }
  }

  private getTypeName(value: unknown): string {
    if (value === null) return 'null'
    if (Array.isArray(value)) return 'array'
    return typeof value
  }

  private categoryToOperationType(category: ToolCategory): 'read' | 'write' | 'execute' | 'delete' | 'admin' {
    switch (category) {
      case 'read':
      case 'search':
      case 'internal':
        return 'read'
      case 'write':
      case 'send':
        return 'write'
      case 'delete':
        return 'delete'
      case 'execute':
      case 'automation':
        return 'execute'
      case 'admin':
      case 'connector':
        return 'admin'
      default:
        return 'read'
    }
  }

  private normalizeContextDelta(
    delta: RuntimeContextDelta | undefined,
    kernelRunId: string | undefined,
  ): RuntimeContextDelta | undefined {
    if (!delta) return undefined

    return {
      ...delta,
      runId: delta.runId || kernelRunId || 'unknown',
      source: delta.source || 'tool_result',
    }
  }

  private normalizeRecordParams(params: unknown): Record<string, unknown> {
    if (typeof params === 'object' && params !== null && !Array.isArray(params)) {
      return params as Record<string, unknown>
    }
    return { value: params }
  }

  private endToolSpan(spanId: string, startedAt: number, status: 'completed' | 'failed', error?: string): void {
    this.config.traceStore?.updateSpan(spanId, {
      status,
      endTime: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      error,
    })
  }

  private createErrorResult(
    code: string,
    message: string,
    recoverable: boolean,
    details?: Record<string, unknown>,
  ): ToolExecutionResult {
    return {
      success: false,
      error: {
        code,
        message,
        recoverable,
      },
      structuredContent: details,
    }
  }
}

function derivePermissionResource(toolName: string, params: unknown, workDirRoot?: string): string {
  if (!workDirRoot || !isWorkdirFileTool(toolName)) {
    return toolName
  }

  const paramsRecord = typeof params === 'object' && params !== null && !Array.isArray(params)
    ? (params as Record<string, unknown>)
    : undefined

  if (toolName === 'file_apply_patch') {
    return derivePatchPermissionResource(paramsRecord, workDirRoot)
  }

  const rawPath =
    typeof paramsRecord?.filePath === 'string'
      ? paramsRecord.filePath
      : typeof paramsRecord?.path === 'string'
        ? paramsRecord.path
        : undefined

  if (!rawPath) {
    return toolName
  }

  if (isAbsolute(rawPath)) {
    return rawPath
  }

  return resolve(workDirRoot, rawPath)
}

function derivePatchPermissionResource(paramsRecord: Record<string, unknown> | undefined, workDirRoot: string): string {
  const rawPaths = collectPatchOperationPaths(paramsRecord)
  if (rawPaths.length === 0) {
    return 'file_apply_patch'
  }

  const resolvedPaths = rawPaths.map((rawPath) => isAbsolute(rawPath) ? rawPath : resolve(workDirRoot, rawPath))
  const outsidePath = resolvedPaths.find((resolvedPath) => !isWithinWorkdir(resolvedPath, workDirRoot))
  if (outsidePath) {
    return outsidePath
  }

  return workDirRoot
}

function collectPatchOperationPaths(paramsRecord: Record<string, unknown> | undefined): string[] {
  if (!paramsRecord) {
    return []
  }

  if (Array.isArray(paramsRecord.operations)) {
    return paramsRecord.operations.flatMap((operation) => {
      if (typeof operation !== 'object' || operation === null || Array.isArray(operation)) {
        return []
      }
      const filePath = (operation as Record<string, unknown>).filePath
      return typeof filePath === 'string' ? [filePath] : []
    })
  }

  if (typeof paramsRecord.patch !== 'string') {
    return []
  }

  try {
    return parsePatchText(paramsRecord.patch).operations.map((operation) => operation.filePath)
  } catch (error) {
    if (error instanceof Error) {
      return []
    }
    throw error
  }
}

export function createToolExecutor(config: ToolExecutorConfig): ToolExecutor {
  return new ToolExecutorImpl(config)
}

// @internal - Exported for testing only
export function _categoryToOperationTypeForTesting(
  category: ToolCategory,
): 'read' | 'write' | 'execute' | 'delete' | 'admin' {
  const executor = new ToolExecutorImpl({} as ToolExecutorConfig)
  return executor['categoryToOperationType'](category)
}
