import { describe, it, expect } from 'vitest'
import {
  createToolSchemaProvider,
  estimateSchemaTokens,
  isHighRiskTool,
  TOKEN_THRESHOLDS,
  HIGH_RISK_CATEGORIES,
  HIGH_RISK_SENSITIVITIES,
} from '../../../src/tools/schema/tool-schema-provider.js'
import type { ToolDefinition, ToolSchema } from '../../../src/tools/types.js'

function createToolDefinition(overrides: Partial<ToolDefinition> & { name: string }): ToolDefinition {
  return {
    description: 'Test tool',
    category: 'read',
    sensitivity: 'low',
    schema: { type: 'object' as const, properties: {} },
    handler: async () => ({ success: true }),
    ...overrides,
  }
}

function createSchemaWithTokenCount(targetTokens: number): ToolSchema {
  const approxChars = targetTokens * 4
  const properties: Record<string, unknown> = {}

  let currentChars = 0
  let propIndex = 0

  while (currentChars < approxChars) {
    const propName = `prop_${propIndex}`
    const propValue = { type: 'string', description: 'x'.repeat(50) }
    properties[propName] = propValue
    currentChars += JSON.stringify({ [propName]: propValue }).length
    propIndex++
  }

  return { type: 'object' as const, properties }
}

describe('ToolSchemaProvider', () => {
  describe('estimateSchemaTokens', () => {
    it('estimates tokens from JSON string length / 4', () => {
      const schema = { type: 'object', properties: { name: { type: 'string' } } }
      const jsonStr = JSON.stringify(schema)
      const expectedTokens = Math.ceil(jsonStr.length / 4)

      expect(estimateSchemaTokens(schema)).toBe(expectedTokens)
    })

    it('handles empty schema', () => {
      expect(estimateSchemaTokens({})).toBe(1)
    })
  })

  describe('isHighRiskTool', () => {
    it('returns true for delete category', () => {
      const tool = createToolDefinition({ name: 'delete_tool', category: 'delete' })
      expect(isHighRiskTool(tool)).toBe(true)
    })

    it('returns true for high sensitivity', () => {
      const tool = createToolDefinition({ name: 'high_sens_tool', sensitivity: 'high' })
      expect(isHighRiskTool(tool)).toBe(true)
    })

    it('returns true for restricted sensitivity', () => {
      const tool = createToolDefinition({ name: 'restricted_tool', sensitivity: 'restricted' })
      expect(isHighRiskTool(tool)).toBe(true)
    })

    it('returns false for low risk tools', () => {
      const tool = createToolDefinition({ name: 'safe_tool', category: 'read', sensitivity: 'low' })
      expect(isHighRiskTool(tool)).toBe(false)
    })

    it('returns false for medium sensitivity write tools', () => {
      const tool = createToolDefinition({ name: 'write_tool', category: 'write', sensitivity: 'medium' })
      expect(isHighRiskTool(tool)).toBe(false)
    })
  })

  describe('schema thresholds', () => {
    it('returns full for schema <= 300 tokens', () => {
      const provider = createToolSchemaProvider()
      const smallSchema: ToolSchema = { type: 'object' as const, properties: { a: { type: 'string' } } }
      const tool = createToolDefinition({
        name: 'small_tool',
        schema: smallSchema,
        category: 'read',
        sensitivity: 'low',
      })

      const mode = provider.getExposureMode(tool)
      expect(mode).toBe('full')
    })

    it('returns simplified for schema 301-1200 tokens', () => {
      const provider = createToolSchemaProvider()
      const mediumSchema = createSchemaWithTokenCount(800)
      const tool = createToolDefinition({
        name: 'medium_tool',
        schema: mediumSchema,
        category: 'read',
        sensitivity: 'low',
      })

      const mode = provider.getExposureMode(tool)
      expect(mode).toBe('simplified')
    })

    it('returns card_only for schema > 1200 tokens', () => {
      const provider = createToolSchemaProvider()
      const largeSchema = createSchemaWithTokenCount(1500)
      const tool = createToolDefinition({
        name: 'large_tool',
        schema: largeSchema,
        category: 'read',
        sensitivity: 'low',
      })

      const mode = provider.getExposureMode(tool)
      expect(mode).toBe('card_only')
    })
  })

  describe('high risk downgrade', () => {
    it('returns simplified for delete category even with small schema', () => {
      const provider = createToolSchemaProvider()
      const smallSchema: ToolSchema = { type: 'object' as const, properties: { id: { type: 'string' } } }
      const tool = createToolDefinition({
        name: 'delete_tool',
        schema: smallSchema,
        category: 'delete',
        sensitivity: 'medium',
      })

      const mode = provider.getExposureMode(tool)
      expect(mode).toBe('simplified')
    })

    it('returns simplified for high sensitivity even with small schema', () => {
      const provider = createToolSchemaProvider()
      const smallSchema: ToolSchema = { type: 'object' as const, properties: { id: { type: 'string' } } }
      const tool = createToolDefinition({
        name: 'high_sens_tool',
        schema: smallSchema,
        category: 'write',
        sensitivity: 'high',
      })

      const mode = provider.getExposureMode(tool)
      expect(mode).toBe('simplified')
    })

    it('returns simplified for restricted sensitivity even with small schema', () => {
      const provider = createToolSchemaProvider()
      const smallSchema: ToolSchema = { type: 'object' as const, properties: { id: { type: 'string' } } }
      const tool = createToolDefinition({
        name: 'restricted_tool',
        schema: smallSchema,
        category: 'read',
        sensitivity: 'restricted',
      })

      const mode = provider.getExposureMode(tool)
      expect(mode).toBe('simplified')
    })

    it('returns card_only for high risk tools with large schema', () => {
      const provider = createToolSchemaProvider()
      const largeSchema = createSchemaWithTokenCount(1500)
      const tool = createToolDefinition({
        name: 'large_delete_tool',
        schema: largeSchema,
        category: 'delete',
        sensitivity: 'high',
      })

      const mode = provider.getExposureMode(tool)
      expect(mode).toBe('card_only')
    })
  })

  describe('trusted override', () => {
    it('allows full exposure for high risk tools with trusted override', () => {
      const provider = createToolSchemaProvider()
      const smallSchema: ToolSchema = { type: 'object' as const, properties: { id: { type: 'string' } } }
      const tool = createToolDefinition({
        name: 'delete_tool',
        schema: smallSchema,
        category: 'delete',
        sensitivity: 'medium',
      })

      const mode = provider.getExposureMode(tool, { trustedOverride: true })
      expect(mode).toBe('full')
    })

    it('still respects token thresholds with trusted override', () => {
      const provider = createToolSchemaProvider()
      const largeSchema = createSchemaWithTokenCount(1500)
      const tool = createToolDefinition({
        name: 'large_delete_tool',
        schema: largeSchema,
        category: 'delete',
        sensitivity: 'high',
      })

      const mode = provider.getExposureMode(tool, { trustedOverride: true })
      expect(mode).toBe('card_only')
    })
  })

  describe('getExposureModes', () => {
    it('returns map of tool names to exposure modes', () => {
      const provider = createToolSchemaProvider()
      const tools = [
        createToolDefinition({ name: 'small_tool', schema: { type: 'object' as const, properties: {} } }),
        createToolDefinition({
          name: 'delete_tool',
          category: 'delete',
          schema: { type: 'object' as const, properties: {} },
        }),
      ]

      const modes = provider.getExposureModes(tools)

      expect(modes.size).toBe(2)
      expect(modes.get('small_tool')).toBe('full')
      expect(modes.get('delete_tool')).toBe('simplified')
    })

    it('passes options to each tool', () => {
      const provider = createToolSchemaProvider()
      const tools = [
        createToolDefinition({
          name: 'delete_tool',
          category: 'delete',
          schema: { type: 'object' as const, properties: {} },
        }),
      ]

      const modesWithoutOverride = provider.getExposureModes(tools)
      const modesWithOverride = provider.getExposureModes(tools, { trustedOverride: true })

      expect(modesWithoutOverride.get('delete_tool')).toBe('simplified')
      expect(modesWithOverride.get('delete_tool')).toBe('full')
    })
  })

  describe('estimateTokenCount', () => {
    it('includes schema, name, and description in token count', () => {
      const provider = createToolSchemaProvider()
      const tool = createToolDefinition({
        name: 'test_tool',
        description: 'A test tool for testing',
        schema: { type: 'object', properties: { a: { type: 'string' } } },
      })

      const tokenCount = provider.estimateTokenCount(tool)

      const expectedSchemaTokens = estimateSchemaTokens(tool.schema)
      const expectedNameTokens = estimateSchemaTokens(tool.name)
      const expectedDescTokens = estimateSchemaTokens(tool.description)
      const expectedTotal = expectedSchemaTokens + expectedNameTokens + expectedDescTokens

      expect(tokenCount).toBe(expectedTotal)
    })
  })

  describe('constants', () => {
    it('TOKEN_THRESHOLDS has correct values', () => {
      expect(TOKEN_THRESHOLDS.FULL_MAX).toBe(300)
      expect(TOKEN_THRESHOLDS.SIMPLIFIED_MAX).toBe(1200)
    })

    it('HIGH_RISK_CATEGORIES contains delete', () => {
      expect(HIGH_RISK_CATEGORIES).toContain('delete')
    })

    it('HIGH_RISK_SENSITIVITIES contains high and restricted', () => {
      expect(HIGH_RISK_SENSITIVITIES).toContain('high')
      expect(HIGH_RISK_SENSITIVITIES).toContain('restricted')
    })
  })
})
