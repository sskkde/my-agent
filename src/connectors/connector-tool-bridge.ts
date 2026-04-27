import type { ConnectorCapability, ConnectorToolBridge, MCPToolDescriptor } from './types.js';
import type { ToolDefinition, ToolCategory, ToolSensitivity, ToolSchema } from '../tools/types.js';

export class ConnectorToolBridgeImpl implements ConnectorToolBridge {
  bridgeCapabilityToToolDefinition(capability: ConnectorCapability): ToolDefinition {
    const category = this.determineToolCategory(capability);
    const sensitivity = this.determineRiskLevel(capability);

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

    return {
      name: `connector.${capability.capabilityId}`,
      description: capability.description,
      category,
      sensitivity,
      schema,
      handler: async () => {
        throw new Error('Connector tool handler should be implemented by the connector runtime');
      },
      requiresPermission: sensitivity === 'high',
      idempotent: capability.category === 'read' || capability.category === 'search',
      metadata: {
        connectorCapabilityId: capability.capabilityId,
        supportedOperations: capability.supportedOperations,
        requiresAuth: capability.requiresAuth,
        rateLimitInfo: capability.rateLimitInfo,
      },
    };
  }

  determineToolCategory(capability: ConnectorCapability): ToolCategory {
    if (capability.category &&
        capability.category !== 'connector' &&
        ['read', 'search', 'write', 'delete', 'execute', 'admin', 'internal'].includes(capability.category)) {
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

export function createConnectorToolBridge(): ConnectorToolBridge {
  return new ConnectorToolBridgeImpl();
}
