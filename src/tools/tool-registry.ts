import type {
  ToolDefinition,
  ToolRegistry,
  ToolRegistrationOptions,
  ToolCategory,
  ToolPool,
  ToolPoolAssemblyOptions,
} from './types.js';
import { isValidToolName } from './tool-name.js';

class ToolRegistryImpl implements ToolRegistry {
  private tools: Map<string, ToolDefinition> = new Map();

  register(definition: ToolDefinition, options: ToolRegistrationOptions = {}): void {
    if (!isValidToolName(definition.name)) {
      throw new Error(
        `Invalid tool name: "${definition.name}". Tool names must match [A-Za-z0-9_-]{1,64}.`,
      );
    }

    if (this.tools.has(definition.name) && !options.overwriteExisting) {
      throw new Error(`Tool already registered: ${definition.name}`);
    }

    this.tools.set(definition.name, definition);
  }

  getTool(name: string): ToolDefinition | null {
    return this.tools.get(name) ?? null;
  }

  listTools(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  listToolsByCategory(category: ToolCategory): ToolDefinition[] {
    return this.listTools().filter(tool => tool.category === category);
  }

  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  hasTool(name: string): boolean {
    return this.tools.has(name);
  }
}

export function createToolRegistry(): ToolRegistry {
  return new ToolRegistryImpl();
}

export function assembleToolPool(
  registry: ToolRegistry,
  runId: string,
  options: ToolPoolAssemblyOptions = {}
): ToolPool {
  let tools = registry.listTools();

  if (options.includeCategories && options.includeCategories.length > 0) {
    tools = tools.filter(tool =>
      options.includeCategories!.includes(tool.category)
    );
  }

  if (options.excludeTools && options.excludeTools.length > 0) {
    tools = tools.filter(tool =>
      !options.excludeTools!.includes(tool.name)
    );
  }

  if (options.maxTools && tools.length > options.maxTools) {
    tools = tools.slice(0, options.maxTools);
  }

  const categoryCounts = tools.reduce((counts, tool) => {
    counts[tool.category] = (counts[tool.category] || 0) + 1;
    return counts;
  }, {} as Record<ToolCategory, number>);

  return {
    tools,
    metadata: {
      assembledAt: new Date().toISOString(),
      runId,
      categoryCounts,
    },
  };
}
