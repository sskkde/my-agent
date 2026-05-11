import type { ToolDefinition, ToolSensitivity, ToolCategory } from '../types.js';

/**
 * Schema exposure modes for tool definitions.
 * - full: Complete schema with all properties and details
 * - simplified: Reduced schema with essential properties only
 * - card_only: Minimal card representation (name, description, category)
 * - hidden: Tool not exposed to LLM
 */
export type ExposureMode = 'full' | 'simplified' | 'card_only' | 'hidden';

/**
 * Token budget thresholds for schema exposure.
 */
export const TOKEN_THRESHOLDS = {
  /** Maximum tokens for full exposure */
  FULL_MAX: 300,
  /** Maximum tokens for simplified exposure */
  SIMPLIFIED_MAX: 1200,
} as const;

/**
 * Categories considered high-risk that require simplified minimum.
 */
export const HIGH_RISK_CATEGORIES: ToolCategory[] = ['delete'];

/**
 * Sensitivity levels considered high-risk that require simplified minimum.
 */
export const HIGH_RISK_SENSITIVITIES: ToolSensitivity[] = ['high', 'restricted'];

/**
 * Options for schema exposure calculation.
 */
export interface SchemaExposureOptions {
  /** Explicit trusted override to allow full exposure for high-risk tools */
  trustedOverride?: boolean;
}

/**
 * Provider interface for determining tool schema exposure modes.
 */
export interface ToolSchemaProvider {
  /**
   * Get the exposure mode for a single tool definition.
   */
  getExposureMode(toolDefinition: ToolDefinition, options?: SchemaExposureOptions): ExposureMode;

  /**
   * Get exposure modes for multiple tool definitions.
   * Returns a Map of tool name to exposure mode.
   */
  getExposureModes(toolDefinitions: ToolDefinition[], options?: SchemaExposureOptions): Map<string, ExposureMode>;

  /**
   * Estimate token count for a tool schema.
   */
  estimateTokenCount(toolDefinition: ToolDefinition): number;
}

/**
 * Estimate token count from schema JSON.
 * Uses rough approximation: character count / 4.
 */
export function estimateSchemaTokens(schema: unknown): number {
  const jsonStr = JSON.stringify(schema);
  return Math.ceil(jsonStr.length / 4);
}

/**
 * Check if a tool is considered high-risk.
 */
export function isHighRiskTool(toolDefinition: ToolDefinition): boolean {
  const isHighRiskCategory = HIGH_RISK_CATEGORIES.includes(toolDefinition.category);
  const isHighRiskSensitivity = HIGH_RISK_SENSITIVITIES.includes(toolDefinition.sensitivity);
  return isHighRiskCategory || isHighRiskSensitivity;
}

/**
 * Create a ToolSchemaProvider instance.
 */
export function createToolSchemaProvider(): ToolSchemaProvider {
  return {
    getExposureMode(toolDefinition: ToolDefinition, options: SchemaExposureOptions = {}): ExposureMode {
      const tokenCount = this.estimateTokenCount(toolDefinition);
      const highRisk = isHighRiskTool(toolDefinition);

      // High-risk tools default to simplified minimum unless trusted override
      if (highRisk && !options.trustedOverride) {
        // Even with small schema, high-risk tools should not be full
        if (tokenCount <= TOKEN_THRESHOLDS.FULL_MAX) {
          return 'simplified';
        }
        if (tokenCount <= TOKEN_THRESHOLDS.SIMPLIFIED_MAX) {
          return 'simplified';
        }
        return 'card_only';
      }

      // Normal token-based exposure
      if (tokenCount <= TOKEN_THRESHOLDS.FULL_MAX) {
        return 'full';
      }
      if (tokenCount <= TOKEN_THRESHOLDS.SIMPLIFIED_MAX) {
        return 'simplified';
      }
      return 'card_only';
    },

    getExposureModes(toolDefinitions: ToolDefinition[], options?: SchemaExposureOptions): Map<string, ExposureMode> {
      const result = new Map<string, ExposureMode>();
      for (const tool of toolDefinitions) {
        result.set(tool.name, this.getExposureMode(tool, options));
      }
      return result;
    },

    estimateTokenCount(toolDefinition: ToolDefinition): number {
      // Estimate from schema (input schema primarily)
      const schemaTokens = estimateSchemaTokens(toolDefinition.schema);
      
      // Add tokens for name and description
      const nameTokens = estimateSchemaTokens(toolDefinition.name);
      const descTokens = estimateSchemaTokens(toolDefinition.description);
      
      return schemaTokens + nameTokens + descTokens;
    },
  };
}
