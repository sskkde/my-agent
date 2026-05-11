import type {
  AsyncOperationRef,
  ConnectorCallRequest,
  ConnectorCapability,
  ConnectorResponse,
  ConnectorRuntime,
  ConnectorToolBridge,
  MCPToolDescriptor,
} from './types.js';
import type { ConnectorInstance } from '../storage/connector-store.js';
import type { ToolDefinition, ToolCategory, ToolRegistry, ToolSensitivity, ToolSchema } from '../tools/types.js';
import { createToolSchemaProvider, type ToolSchemaProvider } from '../tools/schema/tool-schema-provider.js';

type ConnectorToolInstance = ConnectorInstance & {
  connectorId?: string;
};

export interface ConnectorToolBridgeOptions {
  runtime?: ConnectorRuntime;
  schemaProvider?: ToolSchemaProvider;
}

const CONNECTED_STATUSES = new Set(['active']);
const HIGH_RISK_LEVELS: ToolSensitivity[] = ['high', 'restricted'];

export class ConnectorToolBridgeImpl implements ConnectorToolBridge {
  private runtime?: ConnectorRuntime;
  private schemaProvider: ToolSchemaProvider;

  constructor(options: ConnectorToolBridgeOptions = {}) {
    this.runtime = options.runtime;
    this.schemaProvider = options.schemaProvider ?? createToolSchemaProvider();
  }

  bridgeCapabilityToToolDefinition(
    capability: ConnectorCapability,
    connectorInstance?: ConnectorToolInstance
  ): ToolDefinition {
    const category = this.determineToolCategory(capability);
    const sensitivity = this.determineRiskLevel(capability);
    const connectorId = this.determineConnectorId(capability, connectorInstance);
    const operation = this.determineOperation(capability);
    const toolName = `connector.${connectorId}.${operation}`;
    const connected = this.isConnected(connectorInstance);

    const schema: ToolSchema = {
      type: 'object',
      properties: capability.inputSchema || {},
      description: capability.description,
    };

    if (capability.inputSchema && typeof capability.inputSchema === 'object') {
      const requiredFields: string[] = [];
      for (const [key, value] of Object.entries(capability.inputSchema)) {
        if (typeof value === 'object' && value !== null && 'required' in value && (value as Record<string, unknown>).required === true) {
          requiredFields.push(key);
        }
      }
      if (requiredFields.length > 0) {
        schema.required = requiredFields;
      }
    }

    const definition: ToolDefinition = {
      name: toolName,
      description: capability.description,
      category,
      sensitivity,
      schema,
      handler: async (params, context) => {
        if (!connected || !connectorInstance) {
          return {
            success: false,
            error: {
              code: 'CONNECTOR_UNAVAILABLE',
              message: `Connector unavailable: ${connectorId}`,
              recoverable: true,
            },
            resultPreview: `Connector unavailable: ${connectorId}`,
            structuredContent: {
              status: 'unavailable',
              connectorId,
              capabilityId: capability.capabilityId,
            },
          };
        }

        if (!this.runtime) {
          throw new Error('Connector runtime is required to execute connector tools');
        }

        const request: ConnectorCallRequest = {
          requestId: context.toolCallId,
          connectorInstanceId: connectorInstance.id,
          capabilityId: capability.capabilityId,
          operation,
          params: this.normalizeParams(params),
          userId: context.userId,
          sessionId: context.sessionId,
          correlationId: context.toolCallId,
        };
        const response = await this.runtime.executeCall(request);
        return this.mapConnectorExecutionResult(response, connectorId, capability.capabilityId);
      },
      requiresPermission: HIGH_RISK_LEVELS.includes(sensitivity),
      idempotent: capability.category === 'read' || capability.category === 'search',
      metadata: {
        connectorId,
        instanceId: connectorInstance?.connectorInstanceId,
        connectorInstanceStoreId: connectorInstance?.id,
        connectorCapabilityId: capability.capabilityId,
        operation,
        requiredAuthScopes: capability.requiresAuth ? [`connector:${connectorId}`] : [],
        approvalDefault: HIGH_RISK_LEVELS.includes(sensitivity) ? 'required' : 'permission_mode',
        resultSensitivity: sensitivity,
        supportsAsync: this.supportsAsync(capability),
        availability: connected ? 'available' : 'deferred',
        supportedOperations: capability.supportedOperations,
        requiresAuth: capability.requiresAuth,
        rateLimitInfo: capability.rateLimitInfo,
        outputSchema: capability.outputSchema,
      },
    };

    definition.metadata = {
      ...definition.metadata,
      schemaExposureMode: connected ? this.schemaProvider.getExposureMode(definition) : 'hidden',
    };

    return definition;
  }

  determineToolCategory(capability: ConnectorCapability): ToolCategory {
    if (capability.category &&
        capability.category !== 'connector' &&
        ['read', 'search', 'write', 'delete', 'send', 'automation', 'execute', 'admin', 'internal'].includes(capability.category)) {
      return capability.category as ToolCategory;
    }

    const name = capability.name.toLowerCase();
    const capabilityId = capability.capabilityId.toLowerCase();

    if (name.includes('read') || name.includes('get') || name.includes('fetch') ||
        capabilityId.includes('read') || capabilityId.includes('get') || capabilityId.includes('fetch')) {
      return 'read';
    }

    if (name.includes('search') || name.includes('find') || name.includes('query') ||
        capabilityId.includes('search') || capabilityId.includes('find') || capabilityId.includes('query')) {
      return 'search';
    }

    if (name.includes('send') || capabilityId.includes('send')) {
      return 'send';
    }

    if (name.includes('write') || name.includes('create') || name.includes('update') ||
        name.includes('post') || name.includes('put') || name.includes('save') ||
        name.includes('add') ||
        capabilityId.includes('write') || capabilityId.includes('create') || capabilityId.includes('update')) {
      return 'write';
    }

    if (name.includes('delete') || name.includes('remove') || name.includes('destroy') ||
        capabilityId.includes('delete') || capabilityId.includes('remove')) {
      return 'delete';
    }

    if (name.includes('execute') || name.includes('run') || name.includes('invoke') ||
        capabilityId.includes('execute') || capabilityId.includes('run')) {
      return 'execute';
    }

    return 'connector';
  }

  determineRiskLevel(capability: ConnectorCapability): ToolSensitivity {
    const category = this.determineToolCategory(capability);

    switch (category) {
      case 'read':
      case 'search':
        return 'low';
      case 'write':
      case 'send':
      case 'automation':
      case 'execute':
        return 'medium';
      case 'delete':
        return 'high';
      case 'admin':
      case 'connector':
      case 'internal':
      default:
        return capability.riskLevel && ['low', 'medium', 'high', 'restricted'].includes(capability.riskLevel)
          ? capability.riskLevel as ToolSensitivity
          : 'medium';
    }
  }

  registerConnectorTools(
    registry: ToolRegistry,
    connectorInstance: ConnectorToolInstance,
    capabilities: ConnectorCapability[]
  ): void {
    for (const capability of capabilities) {
      registry.register(this.bridgeCapabilityToToolDefinition(capability, connectorInstance), {
        overwriteExisting: true,
      });
    }
  }

  unregisterConnectorTools(
    registry: ToolRegistry,
    connectorInstance: ConnectorToolInstance): void {
    const instanceId = connectorInstance.connectorInstanceId;
    for (const tool of registry.listTools()) {
      if (tool.metadata?.instanceId === instanceId) {
        registry.unregister(tool.name);
      }
    }
  }

  private determineConnectorId(
    capability: ConnectorCapability,
    connectorInstance?: ConnectorToolInstance
  ): string {
    const configConnectorId = connectorInstance?.config?.connectorId;
    if (typeof connectorInstance?.connectorId === 'string') return connectorInstance.connectorId;
    if (typeof configConnectorId === 'string') return configConnectorId;
    return capability.capabilityId.split('.')[0] ?? capability.capabilityId;
  }

  private determineOperation(capability: ConnectorCapability): string {
    return capability.supportedOperations[0] ?? capability.capabilityId.split('.').pop() ?? capability.name;
  }

  private supportsAsync(capability: ConnectorCapability): boolean {
    return capability.supportedOperations.some(operation => operation.includes('async'));
  }

  private isConnected(connectorInstance?: ConnectorToolInstance): boolean {
    return connectorInstance ? CONNECTED_STATUSES.has(connectorInstance.status) : true;
  }

  private normalizeParams(params: unknown): Record<string, unknown> {
    if (typeof params === 'object' && params !== null && !Array.isArray(params)) {
      return params as Record<string, unknown>;
    }
    return {};
  }

  private mapConnectorExecutionResult(
    response: ConnectorResponse | AsyncOperationRef,
    connectorId: string,
    capabilityId: string
  ) {
    if ('operationId' in response && !('requestId' in response)) {
      return {
        success: true,
        data: response,
        resultPreview: `Connector operation started: ${response.operationId}`,
        structuredContent: {
          status: 'started_async',
          connectorId,
          capabilityId,
          operationId: response.operationId,
        },
      };
    }

    const connectorResponse = response as ConnectorResponse;

    if (connectorResponse.status === 'success' || connectorResponse.status === 'partial_success') {
      return {
        success: true,
        data: connectorResponse.data,
        resultPreview: `Connector ${connectorId} returned ${connectorResponse.status}`,
        structuredContent: {
          status: connectorResponse.status,
          connectorId,
          capabilityId,
          data: connectorResponse.data as Record<string, unknown> | undefined,
          metadata: connectorResponse.metadata,
        },
      };
    }

    return {
      success: false,
      status: connectorResponse.status === 'timeout' || connectorResponse.status === 'cancelled' ? connectorResponse.status : undefined,
      data: connectorResponse.data,
      error: {
        code: connectorResponse.error?.code ?? connectorResponse.status.toUpperCase(),
        message: connectorResponse.error?.message ?? `Connector call failed with status: ${connectorResponse.status}`,
        recoverable: connectorResponse.error?.recoverable ?? true,
      },
      resultPreview: connectorResponse.error?.message ?? `Connector call failed: ${connectorResponse.status}`,
      structuredContent: {
        status: connectorResponse.status,
        connectorId,
        capabilityId,
        metadata: connectorResponse.metadata,
      },
    };
  }
}

export function registerConnectorTools(
  registry: ToolRegistry,
  connectorInstance: ConnectorToolInstance,
  capabilities: ConnectorCapability[],
  options: ConnectorToolBridgeOptions = {}
): void {
  new ConnectorToolBridgeImpl(options).registerConnectorTools(registry, connectorInstance, capabilities);
}

export function unregisterConnectorTools(
  registry: ToolRegistry,
  connectorInstance: ConnectorToolInstance
): void {
  new ConnectorToolBridgeImpl().unregisterConnectorTools(registry, connectorInstance);
}

export function mapMCPDescriptorToToolDefinition(descriptor: MCPToolDescriptor): ToolDefinition {
  const schema: ToolSchema = {
    type: 'object',
    properties: descriptor.inputSchema.properties || {},
    description: descriptor.description,
  };

  if (descriptor.inputSchema.required && descriptor.inputSchema.required.length > 0) {
    schema.required = descriptor.inputSchema.required;
  }

  let category: ToolCategory = 'connector';
  let sensitivity: ToolSensitivity = 'medium';

  if (descriptor.annotations) {
    if (descriptor.annotations.readOnlyHint) {
      category = 'read';
      sensitivity = 'low';
    } else if (descriptor.annotations.destructiveHint) {
      category = 'delete';
      sensitivity = 'high';
    }
  }

  const nameLower = descriptor.name.toLowerCase();
  if (nameLower.includes('read') || nameLower.includes('get')) {
    category = 'read';
    sensitivity = 'low';
  } else if (nameLower.includes('search') || nameLower.includes('find')) {
    category = 'search';
    sensitivity = 'low';
  } else if (nameLower.includes('write') || nameLower.includes('create') || nameLower.includes('update')) {
    category = 'write';
    sensitivity = 'medium';
  } else if (nameLower.includes('delete') || nameLower.includes('remove')) {
    category = 'delete';
    sensitivity = 'high';
  } else if (nameLower.includes('execute') || nameLower.includes('run')) {
    category = 'execute';
    sensitivity = 'medium';
  }

  return {
    name: `mcp.${descriptor.name}`,
    description: descriptor.description,
    category,
    sensitivity,
    schema,
    handler: async () => {
      throw new Error('MCP tool handler should be implemented by the MCP runtime');
    },
    requiresPermission: sensitivity === 'high',
    idempotent: descriptor.annotations?.idempotentHint ?? false,
    metadata: {
      mcpToolId: descriptor.toolId,
      outputSchema: descriptor.outputSchema,
      annotations: descriptor.annotations,
    },
  };
}

export function createConnectorToolBridge(options: ConnectorToolBridgeOptions = {}): ConnectorToolBridge {
  return new ConnectorToolBridgeImpl(options);
}
