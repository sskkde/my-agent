/**
 * Connector Request Router
 * Routes ConnectorCallRequest to the appropriate connector instance
 * and returns raw ConnectorResponse.
 */

import type { ConnectorCallRequest, ConnectorResponse, ConnectorAdapter } from '../types.js'
import type { ConnectorInstance, ConnectorStore } from '../../storage/connector-store.js'

export interface ConnectorRequestRouterConfig {
  instanceStore: ConnectorStore
  adapterRegistry: ConnectorAdapterRegistry
}

export interface ConnectorAdapterRegistry {
  getAdapter(connectorType: string): ConnectorAdapter | undefined
}

export interface RouterResult {
  response: ConnectorResponse
  instance: ConnectorInstance
}

export class ConnectorRequestRouter {
  private instanceStore: ConnectorStore
  private adapterRegistry: ConnectorAdapterRegistry

  constructor(config: ConnectorRequestRouterConfig) {
    this.instanceStore = config.instanceStore
    this.adapterRegistry = config.adapterRegistry
  }

  async route(request: ConnectorCallRequest): Promise<RouterResult> {
    const instance = this.instanceStore.findInstanceById(request.connectorInstanceId)

    if (!instance) {
      return {
        response: {
          status: 'failed',
          requestId: request.requestId,
          connectorInstanceId: request.connectorInstanceId,
          error: {
            code: 'instance_not_found',
            message: `Connector instance not found: ${request.connectorInstanceId}`,
            recoverable: false,
          },
        },
        instance: this.createPlaceholderInstance(request.connectorInstanceId),
      }
    }

    const definition = this.instanceStore.findDefinitionById(instance.connectorDefinitionId)
    const connectorType = definition?.connectorType ?? 'unknown'

    const adapter = this.adapterRegistry.getAdapter(connectorType)

    if (!adapter) {
      return {
        response: {
          status: 'failed',
          requestId: request.requestId,
          connectorInstanceId: request.connectorInstanceId,
          error: {
            code: 'adapter_not_found',
            message: `No adapter registered for connector type: ${connectorType}`,
            recoverable: false,
          },
        },
        instance,
      }
    }

    try {
      const rawResult = await adapter.execute(instance, request)

      const response: ConnectorResponse = this.normalizeRawResult(
        rawResult,
        request.requestId,
        request.connectorInstanceId,
      )

      return { response, instance }
    } catch (error) {
      return {
        response: {
          status: 'failed',
          requestId: request.requestId,
          connectorInstanceId: request.connectorInstanceId,
          error: {
            code: 'execution_error',
            message: error instanceof Error ? error.message : 'Unknown execution error',
            recoverable: true,
          },
        },
        instance,
      }
    }
  }

  private normalizeRawResult(raw: unknown, requestId: string, connectorInstanceId: string): ConnectorResponse {
    if (this.isConnectorResponse(raw)) {
      return {
        ...raw,
        requestId,
        connectorInstanceId,
      }
    }

    return {
      status: 'success',
      requestId,
      connectorInstanceId,
      data: raw,
    }
  }

  private isConnectorResponse(value: unknown): value is ConnectorResponse {
    if (typeof value !== 'object' || value === null) {
      return false
    }

    const obj = value as Record<string, unknown>
    return typeof obj.status === 'string' && typeof obj.requestId === 'string'
  }

  private createPlaceholderInstance(id: string): ConnectorInstance {
    return {
      id,
      connectorInstanceId: id,
      connectorDefinitionId: '',
      userId: '',
      name: 'Placeholder Instance',
      authStateRef: '',
      status: 'inactive',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
  }
}

export function createConnectorRequestRouter(config: ConnectorRequestRouterConfig): ConnectorRequestRouter {
  return new ConnectorRequestRouter(config)
}
