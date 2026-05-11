import type {
  ConnectorRuntime,
  ConnectorRuntimeConfig,
  ConnectorCallRequest,
  ConnectorResponse,
  ConnectorResponseStatus,
  AsyncOperationRef,
  ConnectorCapability,
  ConnectorEventType,
  ConnectorEventPayload,
} from './types.js';
import type { ConnectorDefinition, ConnectorInstance } from '../storage/connector-store.js';

export class ConnectorRuntimeImpl implements ConnectorRuntime {
  private config: ConnectorRuntimeConfig;
  private adapterRegistry: Map<string, {
    execute: (instance: ConnectorInstance, request: ConnectorCallRequest) => Promise<unknown>;
    discoverCapabilities: (instance: ConnectorInstance) => ConnectorCapability[];
  }> = new Map();
  private asyncOperations: Map<string, AsyncOperationRef> = new Map();

  constructor(config: ConnectorRuntimeConfig) {
    this.config = config;
  }

  registerAdapter(
    connectorType: string,
    adapter: {
      execute: (instance: ConnectorInstance, request: ConnectorCallRequest) => Promise<unknown>;
      discoverCapabilities: (instance: ConnectorInstance) => ConnectorCapability[];
    }
  ): void {
    this.adapterRegistry.set(connectorType, adapter);
  }

  registerDefinition(def: Omit<ConnectorDefinition, 'id' | 'createdAt' | 'updatedAt'>): ConnectorDefinition {
    const definition = this.config.connectorStore.createDefinition(def);

    this.emitEvent('connector_definition_registered', {
      connectorInstanceId: definition.connectorId,
      metadata: {
        connectorType: definition.connectorType,
        version: definition.version,
      },
    });

    return definition;
  }

  createInstance(instance: Omit<ConnectorInstance, 'id' | 'createdAt' | 'updatedAt'>): ConnectorInstance {
    const createdInstance = this.config.connectorStore.createInstance(instance);

    this.emitEvent('connector_instance_created', {
      connectorInstanceId: createdInstance.connectorInstanceId,
      userId: createdInstance.userId,
      metadata: {
        definitionId: createdInstance.connectorDefinitionId,
      },
    });

    return createdInstance;
  }

  discoverCapabilities(connectorInstanceId: string): ConnectorCapability[] {
    const instance = this.config.connectorStore.findInstanceById(connectorInstanceId);
    if (!instance) {
      throw new Error(`Connector instance not found: ${connectorInstanceId}`);
    }

    const definition = this.config.connectorStore.findDefinitionById(instance.connectorDefinitionId);
    if (!definition) {
      throw new Error(`Connector definition not found: ${instance.connectorDefinitionId}`);
    }

    const adapter = this.adapterRegistry.get(definition.connectorType);
    if (!adapter) {
      const capabilities = this.createCapabilitiesFromDefinition(definition);

      this.emitEvent('connector_capability_discovered', {
        connectorInstanceId: instance.connectorInstanceId,
        metadata: {
          capabilityCount: capabilities.length,
        },
      });

      return capabilities;
    }

    const capabilities = adapter.discoverCapabilities(instance);

    this.emitEvent('connector_capability_discovered', {
      connectorInstanceId: instance.connectorInstanceId,
      metadata: {
        capabilityCount: capabilities.length,
      },
    });

    return capabilities;
  }

  async executeCall(request: ConnectorCallRequest): Promise<ConnectorResponse | AsyncOperationRef> {
    const instance = this.config.connectorStore.findInstanceById(request.connectorInstanceId);
    if (!instance) {
      return this.createErrorResponse(
        request.requestId,
        request.connectorInstanceId,
        'INSTANCE_NOT_FOUND',
        `Connector instance not found: ${request.connectorInstanceId}`,
        false
      );
    }

    const instanceId = instance.connectorInstanceId;
    const traceId = request.correlationId ?? request.requestId;
    const spanId = this.generateId('span');
    const startedAt = Date.now();

    this.config.traceStore?.createSpan({
      spanId,
      traceId,
      spanType: 'connector_call',
      module: 'connector',
      operation: request.operation,
      status: 'started',
      startTime: new Date(startedAt).toISOString(),
      metadata: {
        connectorId: instanceId,
        operation: request.operation,
        resourceRef: request.capabilityId,
      },
    });

    const definition = this.config.connectorStore.findDefinitionById(instance.connectorDefinitionId);
    if (!definition) {
      return this.createErrorResponse(
        request.requestId,
        instanceId,
        'DEFINITION_NOT_FOUND',
        `Connector definition not found: ${instance.connectorDefinitionId}`,
        false
      );
    }

    const adapter = this.adapterRegistry.get(definition.connectorType);
    if (!adapter) {
      return this.createErrorResponse(
        request.requestId,
        instanceId,
        'ADAPTER_NOT_FOUND',
        `No adapter found for connector type: ${definition.connectorType}`,
        false
      );
    }

    try {
      const rawResult = await adapter.execute(instance, request);
      const response = this.normalizeResponse(rawResult, request.requestId, instanceId);

      if (response.status === 'started_async') {
        const operationRef = this.createAsyncOperationRef(
          instanceId,
          response.metadata?.operationId || this.generateId('op')
        );
        this.asyncOperations.set(operationRef.operationId, operationRef);

        this.emitEvent('connector_async_started', {
          connectorInstanceId: instanceId,
          userId: request.userId,
          sessionId: request.sessionId,
          capabilityId: request.capabilityId,
          operation: request.operation,
          metadata: {
            operationId: operationRef.operationId,
          },
        });

        this.completeObservability(request, instanceId, spanId, startedAt, 'success', 'started_async');

        return operationRef;
      }

      this.emitEvent('connector_call_executed', {
        connectorInstanceId: instanceId,
        userId: request.userId,
        sessionId: request.sessionId,
        capabilityId: request.capabilityId,
        operation: request.operation,
        status: response.status,
      });

      this.completeObservability(
        request,
        instanceId,
        spanId,
        startedAt,
        response.status === 'success' || response.status === 'partial_success' ? 'success' : 'failure',
        response.status
      );

      return response;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const response = this.createErrorResponse(
        request.requestId,
        instanceId,
        'EXECUTION_ERROR',
        errorMessage,
        true
      );

      this.emitEvent('connector_call_failed', {
        connectorInstanceId: instanceId,
        userId: request.userId,
        sessionId: request.sessionId,
        capabilityId: request.capabilityId,
        operation: request.operation,
        errorCode: 'EXECUTION_ERROR',
      });

      this.completeObservability(request, instanceId, spanId, startedAt, 'failure', response.status, errorMessage);

      return response;
    }
  }

  private completeObservability(
    request: ConnectorCallRequest,
    connectorInstanceId: string,
    spanId: string,
    startedAt: number,
    auditStatus: 'success' | 'failure',
    status: string,
    error?: string
  ): void {
    const durationMs = Date.now() - startedAt;
    this.config.traceStore?.updateSpan(spanId, {
      status: auditStatus === 'success' ? 'completed' : 'failed',
      endTime: new Date().toISOString(),
      durationMs,
      error,
      metadata: {
        connectorId: connectorInstanceId,
        operation: request.operation,
        status,
        durationMs,
      },
    });
    this.config.auditRecorder?.recordConnectorAccess({
      userId: request.userId,
      sessionId: request.sessionId,
      connectorInstanceId,
      operation: request.operation,
      resourceRef: request.capabilityId,
      payloadSummary: {
        operation: request.operation,
        paramKeys: Object.keys(request.params),
      },
      status: auditStatus,
      correlationId: request.correlationId ?? request.requestId,
      causationId: request.requestId,
    });
  }

  normalizeResponse(raw: unknown, requestId?: string, connectorInstanceId?: string): ConnectorResponse {
    const reqId = requestId || this.generateId('req');
    const instId = connectorInstanceId || 'unknown';

    if (this.isConnectorResponse(raw)) {
      return raw;
    }

    if (this.isErrorLike(raw)) {
      const errorObj = this.extractErrorObject(raw);
      const status = this.determineErrorStatus(errorObj);
      return {
        status,
        requestId: reqId,
        connectorInstanceId: instId,
        error: {
          code: errorObj.code || 'UNKNOWN_ERROR',
          message: errorObj.message || String(raw),
          recoverable: errorObj.recoverable ?? true,
        },
      };
    }

    if (this.isAsyncStarted(raw)) {
      return {
        status: 'started_async',
        requestId: reqId,
        connectorInstanceId: instId,
        data: raw.data,
        metadata: {
          operationId: raw.operationId,
        },
      };
    }

    return {
      status: 'success',
      requestId: reqId,
      connectorInstanceId: instId,
      data: raw,
    };
  }

  private extractErrorObject(raw: Record<string, unknown>): { code?: string; message?: string; recoverable?: boolean } {
    if (raw.error && typeof raw.error === 'object' && raw.error !== null) {
      return raw.error as { code?: string; message?: string; recoverable?: boolean };
    }
    return raw as { code?: string; message?: string; recoverable?: boolean };
  }

  private createCapabilitiesFromDefinition(definition: ConnectorDefinition): ConnectorCapability[] {
    return definition.capabilities.map(capId => ({
      capabilityId: capId,
      name: capId,
      description: `Capability: ${capId}`,
      category: 'connector',
      riskLevel: 'medium',
      inputSchema: {},
      requiresAuth: true,
      supportedOperations: ['execute'],
    }));
  }

  private createErrorResponse(
    requestId: string,
    connectorInstanceId: string,
    code: string,
    message: string,
    recoverable: boolean
  ): ConnectorResponse {
    return {
      status: 'failed',
      requestId,
      connectorInstanceId,
      error: {
        code,
        message,
        recoverable,
      },
    };
  }

  private createAsyncOperationRef(
    connectorInstanceId: string,
    operationId: string
  ): AsyncOperationRef {
    return {
      operationId,
      connectorInstanceId,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
  }

  private isConnectorResponse(obj: unknown): obj is ConnectorResponse {
    return (
      typeof obj === 'object' &&
      obj !== null &&
      'status' in obj &&
      typeof (obj as ConnectorResponse).status === 'string' &&
      ['success', 'auth_required', 'rate_limited', 'failed', 'started_async'].includes(
        (obj as ConnectorResponse).status
      )
    );
  }

  private isErrorLike(obj: unknown): obj is { code?: string; message?: string; recoverable?: boolean } {
    return (
      typeof obj === 'object' &&
      obj !== null &&
      (('error' in obj && obj.error !== null) ||
       ('message' in obj && typeof (obj as Record<string, unknown>).message === 'string') ||
       ('code' in obj && typeof (obj as Record<string, unknown>).code === 'string'))
    );
  }

  private isAsyncStarted(obj: unknown): obj is { operationId: string; data?: unknown } {
    return (
      typeof obj === 'object' &&
      obj !== null &&
      'async' in obj &&
      (obj as Record<string, unknown>).async === true
    );
  }

  private determineErrorStatus(error: { code?: string; status?: string; message?: string }): ConnectorResponseStatus {
    const code = (error.code || '').toLowerCase();
    const message = (error.message || '').toLowerCase();

    if (code.includes('auth') ||
        code.includes('unauthorized') ||
        code.includes('forbidden') ||
        message.includes('authentication') ||
        message.includes('authorization')) {
      return 'auth_required';
    }

    if (code.includes('rate') ||
        code.includes('throttle') ||
        message.includes('rate limit') ||
        message.includes('too many requests')) {
      return 'rate_limited';
    }

    return 'failed';
  }

  private emitEvent(eventType: ConnectorEventType, payload: ConnectorEventPayload): void {
    if (!this.config.eventStore) {
      return;
    }

    const event = {
      eventId: this.generateId('evt'),
      eventType,
      sourceModule: 'connector' as const,
      timestamp: new Date().toISOString(),
      payload,
      sensitivity: 'low' as const,
      retentionClass: 'standard' as const,
      createdAt: new Date().toISOString(),
    };

    this.config.eventStore.append(event);
  }

  private generateId(prefix: string): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }
}

export function createConnectorRuntime(config: ConnectorRuntimeConfig): ConnectorRuntime {
  return new ConnectorRuntimeImpl(config);
}
