import type {
  TraceContext,
  RuntimeSpan,
  MetricRecord,
  TracingCollector,
  TracingConfig,
  TracingHooks,
  SpanType,
  SourceModule,
  TraceStatus,
  SpanStatus,
} from './types.js'

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`
}

class TracingCollectorImpl implements TracingCollector {
  private traceStore: TracingConfig['traceStore']
  private metricStore: TracingConfig['metricStore']
  private enabled: boolean
  private sampleRate: number

  constructor(config: TracingConfig) {
    this.traceStore = config.traceStore
    this.metricStore = config.metricStore
    this.enabled = config.enabled ?? true
    this.sampleRate = config.sampleRate ?? 1.0
  }

  private shouldSample(): boolean {
    if (!this.enabled) {
      return false
    }
    return Math.random() < this.sampleRate
  }

  startTrace(context: Partial<TraceContext>): TraceContext {
    if (!this.shouldSample()) {
      return {
        traceId: generateId(),
        rootSpanId: generateId(),
        startedAt: new Date().toISOString(),
        status: 'active',
        ...context,
      }
    }

    const traceId = context.traceId ?? generateId()
    const rootSpanId = context.rootSpanId ?? generateId()
    const startedAt = context.startedAt ?? new Date().toISOString()

    const traceContext: TraceContext = {
      traceId,
      rootSpanId,
      correlationId: context.correlationId,
      userId: context.userId,
      sessionId: context.sessionId,
      startedAt,
      status: context.status ?? 'active',
    }

    this.traceStore.createTrace(traceContext)

    const rootSpan = this.startSpan(traceId, 'dispatch', 'gateway', 'root', undefined, { traceType: 'root' })

    return {
      ...traceContext,
      rootSpanId: rootSpan.spanId,
    }
  }

  endTrace(traceId: string, status: TraceStatus): void {
    if (!this.enabled) {
      return
    }

    this.traceStore.updateTraceStatus(traceId, status)

    const spans = this.traceStore.findSpansByTrace(traceId)
    const activeSpans = spans.filter((s) => s.status === 'started')
    for (const span of activeSpans) {
      this.endSpan(span.spanId, status === 'failed' ? 'failed' : 'completed')
    }
  }

  startSpan(
    traceId: string,
    spanType: SpanType,
    module: SourceModule,
    operation: string,
    parentSpanId?: string,
    metadata?: Record<string, unknown>,
  ): RuntimeSpan {
    const spanId = generateId()
    const startTime = new Date().toISOString()

    const span: RuntimeSpan = {
      spanId,
      traceId,
      parentSpanId,
      spanType,
      module,
      operation,
      status: 'started',
      startTime,
      metadata,
    }

    if (this.enabled) {
      this.traceStore.createSpan(span)
    }

    return span
  }

  endSpan(spanId: string, status: SpanStatus, error?: string): void {
    if (!this.enabled) {
      return
    }

    this.traceStore.endSpan(spanId, status, error)
  }

  recordMetric(metric: Omit<MetricRecord, 'metricId' | 'timestamp'>): void {
    if (!this.enabled) {
      return
    }

    const metricRecord: MetricRecord = {
      ...metric,
      metricId: generateId(),
      timestamp: new Date().toISOString(),
    }

    this.metricStore.recordMetric(metricRecord)
  }

  async withSpan<T>(
    traceId: string,
    spanType: SpanType,
    module: SourceModule,
    operation: string,
    fn: (span: RuntimeSpan) => Promise<T>,
    parentSpanId?: string,
    metadata?: Record<string, unknown>,
  ): Promise<T> {
    const span = this.startSpan(traceId, spanType, module, operation, parentSpanId, metadata)

    const startMs = Date.now()

    try {
      const result = await fn(span)
      const durationMs = Date.now() - startMs

      this.endSpan(span.spanId, 'completed')

      this.recordMetric({
        traceId,
        spanId: span.spanId,
        module,
        metricType: 'timer',
        name: `${operation}_duration_ms`,
        value: durationMs,
        unit: 'ms',
        labels: { spanType, operation, status: 'success' },
      })

      return result
    } catch (error) {
      const durationMs = Date.now() - startMs
      const errorMessage = error instanceof Error ? error.message : String(error)

      this.endSpan(span.spanId, 'failed', errorMessage)

      this.recordMetric({
        traceId,
        spanId: span.spanId,
        module,
        metricType: 'counter',
        name: `${operation}_errors`,
        value: 1,
        labels: { spanType, operation, error: errorMessage },
      })

      this.recordMetric({
        traceId,
        spanId: span.spanId,
        module,
        metricType: 'timer',
        name: `${operation}_duration_ms`,
        value: durationMs,
        unit: 'ms',
        labels: { spanType, operation, status: 'failed' },
      })

      throw error
    }
  }

  getTraceContext(traceId: string): TraceContext | null {
    if (!this.enabled) {
      return null
    }

    return this.traceStore.getTrace(traceId)
  }

  getSpanContext(spanId: string): RuntimeSpan | null {
    if (!this.enabled) {
      return null
    }

    return this.traceStore.getSpan(spanId)
  }
}

export function createTracingCollector(config: TracingConfig): TracingCollector {
  return new TracingCollectorImpl(config)
}

export function createTracingHooks(collector: TracingCollector): TracingHooks {
  return {
    onGatewayRequest: (context: TraceContext, metadata?: Record<string, unknown>): RuntimeSpan => {
      return collector.startSpan(
        context.traceId,
        'dispatch',
        'gateway',
        'gateway_request',
        context.rootSpanId,
        metadata,
      )
    },

    onDispatch: (traceId: string, targetRuntime: string, action: string, parentSpanId?: string): RuntimeSpan => {
      return collector.startSpan(traceId, 'dispatch', 'dispatcher', `dispatch_to_${targetRuntime}`, parentSpanId, {
        targetRuntime,
        action,
      })
    },

    onKernelRun: (traceId: string, agentId: string, parentSpanId?: string): RuntimeSpan => {
      return collector.startSpan(traceId, 'kernel_run', 'kernel', `kernel_run_${agentId}`, parentSpanId, { agentId })
    },

    onToolExecution: (traceId: string, toolName: string, parentSpanId?: string): RuntimeSpan => {
      return collector.startSpan(traceId, 'tool_execution', 'tool', `execute_${toolName}`, parentSpanId, { toolName })
    },

    onWorkflowRun: (traceId: string, workflowId: string, parentSpanId?: string): RuntimeSpan => {
      return collector.startSpan(traceId, 'workflow_run', 'workflow', `workflow_${workflowId}`, parentSpanId, {
        workflowId,
      })
    },

    onSubagentRun: (traceId: string, agentType: string, parentSpanId?: string): RuntimeSpan => {
      return collector.startSpan(traceId, 'subagent_run', 'subagent', `subagent_${agentType}`, parentSpanId, {
        agentType,
      })
    },

    onTrigger: (traceId: string, triggerType: string, parentSpanId?: string): RuntimeSpan => {
      return collector.startSpan(
        traceId,
        'trigger_evaluation',
        'trigger',
        `trigger_evaluation_${triggerType}`,
        parentSpanId,
        { triggerId: triggerType, eventType: triggerType },
      )
    },

    onConnectorCall: (traceId: string, connectorId: string, operation: string, parentSpanId?: string): RuntimeSpan => {
      return collector.startSpan(
        traceId,
        'connector_call',
        'connector',
        `connector_${connectorId}_${operation}`,
        parentSpanId,
        { connectorId, operation },
      )
    },

    onPermissionCheck: (traceId: string, action: string, resource: string, parentSpanId?: string): RuntimeSpan => {
      return collector.startSpan(
        traceId,
        'permission_check',
        'permission',
        `permission_check_${action}`,
        parentSpanId,
        { action, resource },
      )
    },

    onMemoryAccess: (traceId: string, operation: string, memoryId?: string, parentSpanId?: string): RuntimeSpan => {
      return collector.startSpan(
        traceId,
        operation === 'summary_write' ? 'summary_write' : 'memory_write',
        'memory',
        `memory_${operation}`,
        parentSpanId,
        { operation, memoryId },
      )
    },
  }
}
