/**
 * Observability types for trace, span, and metrics collection.
 * This is the foundation for the agent platform's observability infrastructure.
 */

// ============================================================================
// Source Module Type (aligned with event-store.ts)
// ============================================================================

export type SourceModule =
  | 'gateway'
  | 'foreground_agent'
  | 'planner'
  | 'dispatcher'
  | 'kernel'
  | 'tool'
  | 'workflow'
  | 'subagent'
  | 'trigger'
  | 'connector'
  | 'permission'
  | 'memory';

// ============================================================================
// Span Types
// ============================================================================

export type SpanType =
  | 'dispatch'
  | 'foreground_run'
  | 'tool_execution'
  | 'tool_call'
  | 'kernel_run'
  | 'planner_run'
  | 'workflow_run'
  | 'background_run'
  | 'subagent_run'
  | 'trigger'
  | 'trigger_evaluation'
  | 'connector_call'
  | 'permission_check'
  | 'memory_write'
  | 'summary_write'
  | 'replay';

// ============================================================================
// Metric Types
// ============================================================================

export type MetricType = 'counter' | 'gauge' | 'histogram' | 'timer';

// ============================================================================
// Trace Status
// ============================================================================

export type TraceStatus = 'active' | 'completed' | 'failed' | 'cancelled';

// ============================================================================
// Span Status
// ============================================================================

export type SpanStatus = 'started' | 'completed' | 'failed' | 'cancelled';

// ============================================================================
// Trace Context
// ============================================================================

export interface TraceContext {
  traceId: string;
  rootSpanId: string;
  correlationId?: string;
  userId?: string;
  sessionId?: string;
  startedAt: string;
  status: TraceStatus;
}

// ============================================================================
// Runtime Span
// ============================================================================

export interface RuntimeSpan {
  spanId: string;
  traceId: string;
  parentSpanId?: string;
  spanType: SpanType;
  module: SourceModule;
  operation: string;
  status: SpanStatus;
  startTime: string;
  endTime?: string;
  durationMs?: number;
  error?: string;
  metadata?: Record<string, unknown>;
}

// ============================================================================
// Metric Record
// ============================================================================

export interface MetricRecord {
  metricId: string;
  traceId?: string;
  spanId?: string;
  module: SourceModule;
  metricType: MetricType;
  name: string;
  value: number;
  unit?: string;
  timestamp: string;
  labels?: Record<string, string>;
}

// ============================================================================
// Trace Query
// ============================================================================

export interface TraceQuery {
  correlationId?: string;
  userId?: string;
  sessionId?: string;
  status?: TraceStatus;
  limit?: number;
  offset?: number;
}

// ============================================================================
// Span Query
// ============================================================================

export interface SpanQuery {
  traceId?: string;
  module?: SourceModule;
  spanType?: SpanType;
  status?: SpanStatus;
  parentSpanId?: string;
  limit?: number;
  offset?: number;
}

// ============================================================================
// Metric Query
// ============================================================================

export interface MetricQuery {
  module?: SourceModule;
  metricType?: MetricType;
  name?: string;
  traceId?: string;
  spanId?: string;
  startTime?: string;
  endTime?: string;
  labels?: Record<string, string>;
  limit?: number;
  offset?: number;
}

// ============================================================================
// Metric Aggregation
// ============================================================================

export interface MetricAggregation {
  name: string;
  module: SourceModule;
  metricType: MetricType;
  count: number;
  sum: number;
  avg: number;
  min: number;
  max: number;
  startTime: string;
  endTime: string;
}

// ============================================================================
// Trace Store Interface
// ============================================================================

export interface TraceStore {
  createTrace(context: TraceContext): void;
  getTrace(traceId: string): TraceContext | null;
  updateTraceStatus(traceId: string, status: TraceStatus): void;
  findTracesByCorrelation(correlationId: string): TraceContext[];
  findTracesByUser(userId: string): TraceContext[];
  findTracesBySession(sessionId: string): TraceContext[];
  findTraces(query: TraceQuery): TraceContext[];

  createSpan(span: RuntimeSpan): void;
  getSpan(spanId: string): RuntimeSpan | null;
  updateSpan(spanId: string, updates: Partial<RuntimeSpan>): void;
  endSpan(spanId: string, status: SpanStatus, error?: string): void;
  findSpansByTrace(traceId: string): RuntimeSpan[];
  findSpansByModule(module: SourceModule): RuntimeSpan[];
  findSpansByParent(parentSpanId: string): RuntimeSpan[];
  findSpans(query: SpanQuery): RuntimeSpan[];
}

// ============================================================================
// Metric Store Interface
// ============================================================================

export interface MetricStore {
  recordMetric(metric: MetricRecord): void;
  recordMetrics(metrics: MetricRecord[]): void;
  getMetric(metricId: string): MetricRecord | null;
  queryMetrics(query: MetricQuery): MetricRecord[];
  aggregateMetrics(query: MetricQuery): MetricAggregation[];
  getLatestMetric(name: string, module: SourceModule): MetricRecord | null;
}

// ============================================================================
// Tracing Collector Interface
// ============================================================================

export interface TracingCollector {
  startTrace(context: Partial<TraceContext>): TraceContext;
  endTrace(traceId: string, status: TraceStatus): void;

  startSpan(
    traceId: string,
    spanType: SpanType,
    module: SourceModule,
    operation: string,
    parentSpanId?: string,
    metadata?: Record<string, unknown>
  ): RuntimeSpan;

  endSpan(spanId: string, status: SpanStatus, error?: string): void;

  recordMetric(metric: Omit<MetricRecord, 'metricId' | 'timestamp'>): void;

  withSpan<T>(
    traceId: string,
    spanType: SpanType,
    module: SourceModule,
    operation: string,
    fn: (span: RuntimeSpan) => Promise<T>,
    parentSpanId?: string,
    metadata?: Record<string, unknown>
  ): Promise<T>;

  getTraceContext(traceId: string): TraceContext | null;
  getSpanContext(spanId: string): RuntimeSpan | null;
}

// ============================================================================
// Tracing Configuration
// ============================================================================

export interface TracingConfig {
  traceStore: TraceStore;
  metricStore: MetricStore;
  enabled?: boolean;
  sampleRate?: number;
  maxSpansPerTrace?: number;
  maxMetricsPerSpan?: number;
}

// ============================================================================
// Integration Hooks
// ============================================================================

export interface TracingHooks {
  onGatewayRequest: (context: TraceContext, metadata?: Record<string, unknown>) => RuntimeSpan;
  onDispatch: (
    traceId: string,
    targetRuntime: string,
    action: string,
    parentSpanId?: string
  ) => RuntimeSpan;
  onKernelRun: (
    traceId: string,
    agentId: string,
    parentSpanId?: string
  ) => RuntimeSpan;
  onToolExecution: (
    traceId: string,
    toolName: string,
    parentSpanId?: string
  ) => RuntimeSpan;
  onWorkflowRun: (
    traceId: string,
    workflowId: string,
    parentSpanId?: string
  ) => RuntimeSpan;
  onSubagentRun: (
    traceId: string,
    agentType: string,
    parentSpanId?: string
  ) => RuntimeSpan;
  onTrigger: (
    traceId: string,
    triggerType: string,
    parentSpanId?: string
  ) => RuntimeSpan;
  onConnectorCall: (
    traceId: string,
    connectorId: string,
    operation: string,
    parentSpanId?: string
  ) => RuntimeSpan;
  onPermissionCheck: (
    traceId: string,
    action: string,
    resource: string,
    parentSpanId?: string
  ) => RuntimeSpan;
  onMemoryAccess: (
    traceId: string,
    operation: string,
    memoryId?: string,
    parentSpanId?: string
  ) => RuntimeSpan;
}
