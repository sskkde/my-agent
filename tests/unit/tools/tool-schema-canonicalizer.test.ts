import { describe, it, expect } from 'vitest'
import {
  canonicalizeSchema,
  canonicalizeToolDefinition,
  computeToolExposureHash,
  stableToolSort,
  canonicalizeToolList,
} from '../../../src/tools/tool-schema-canonicalizer.js'
import type { ToolDefinition, ToolCategory, ToolSensitivity } from '../../../src/tools/types.js'

describe('canonicalizeSchema', () => {
  it('should produce same output for same input', () => {
    const schema = {
      type: 'object',
      properties: {
        b: { type: 'string' },
        a: { type: 'number' },
      },
    }

    const result1 = canonicalizeSchema(schema)
    const result2 = canonicalizeSchema(schema)

    expect(result1).toBe(result2)
  })

  it('should sort object keys alphabetically', () => {
    const schema = {
      z: 1,
      a: 2,
      m: 3,
    }

    const result = canonicalizeSchema(schema)
    const parsed = JSON.parse(result)

    const keys = Object.keys(parsed)
    expect(keys).toEqual(['a', 'm', 'z'])
  })

  it('should sort nested object keys', () => {
    const schema = {
      type: 'object',
      properties: {
        zebra: { type: 'string' },
        apple: {
          type: 'object',
          properties: {
            y: { type: 'number' },
            x: { type: 'boolean' },
          },
        },
      },
    }

    const result = canonicalizeSchema(schema)
    const parsed = JSON.parse(result)

    expect(Object.keys(parsed.properties)).toEqual(['apple', 'zebra'])
    expect(Object.keys(parsed.properties.apple.properties)).toEqual(['x', 'y'])
  })

  it('should handle arrays', () => {
    const schema = {
      items: [{ z: 1 }, { a: 2 }],
    }

    const result = canonicalizeSchema(schema)
    const parsed = JSON.parse(result)

    expect(parsed.items).toEqual([{ z: 1 }, { a: 2 }])
  })

  it('should remove undefined values', () => {
    const schema = {
      a: 1,
      b: undefined,
      c: 'test',
    }

    const result = canonicalizeSchema(schema)
    const parsed = JSON.parse(result)

    expect(parsed).toEqual({ a: 1, c: 'test' })
    expect('b' in parsed).toBe(false)
  })

  it('should handle null values', () => {
    const schema = {
      a: null,
      b: 'value',
    }

    const result = canonicalizeSchema(schema)
    const parsed = JSON.parse(result)

    expect(parsed.a).toBeNull()
  })

  it('should produce deterministic output for reordered keys', () => {
    const schema1 = { b: 1, a: 2, c: 3 }
    const schema2 = { c: 3, a: 2, b: 1 }

    const result1 = canonicalizeSchema(schema1)
    const result2 = canonicalizeSchema(schema2)

    expect(result1).toBe(result2)
  })
})

describe('canonicalizeToolDefinition', () => {
  function createTool(name: string): ToolDefinition {
    return {
      name,
      description: `${name} description`,
      category: 'read' as ToolCategory,
      sensitivity: 'low' as ToolSensitivity,
      schema: {
        type: 'object',
        properties: {
          input: { type: 'string' },
        },
      },
      handler: async () => ({ success: true }),
    }
  }

  it('should produce deterministic output for same tool', () => {
    const tool = createTool('test_tool')

    const result1 = canonicalizeToolDefinition(tool)
    const result2 = canonicalizeToolDefinition(tool)

    expect(result1).toBe(result2)
  })

  it('should include essential fields', () => {
    const tool = createTool('test_tool')

    const result = canonicalizeToolDefinition(tool)
    const parsed = JSON.parse(result)

    expect(parsed.name).toBe('test_tool')
    expect(parsed.description).toBe('test_tool description')
    expect(parsed.category).toBe('read')
    expect(parsed.sensitivity).toBe('low')
  })
})

describe('computeToolExposureHash', () => {
  function createTool(name: string, category: ToolCategory = 'read'): ToolDefinition {
    return {
      name,
      description: `${name} tool`,
      category,
      sensitivity: 'low' as ToolSensitivity,
      schema: { type: 'object', properties: {} },
      handler: async () => ({ success: true }),
    }
  }

  it('should produce deterministic hash for same tools', () => {
    const tools = [createTool('a'), createTool('b')]

    const hash1 = computeToolExposureHash(tools)
    const hash2 = computeToolExposureHash(tools)

    expect(hash1).toBe(hash2)
  })

  it('should produce same hash regardless of input order', () => {
    const tools1 = [createTool('a'), createTool('b')]
    const tools2 = [createTool('b'), createTool('a')]

    const hash1 = computeToolExposureHash(tools1)
    const hash2 = computeToolExposureHash(tools2)

    expect(hash1).toBe(hash2)
  })

  it('should produce different hash for different tools', () => {
    const tools1 = [createTool('a')]
    const tools2 = [createTool('b')]

    const hash1 = computeToolExposureHash(tools1)
    const hash2 = computeToolExposureHash(tools2)

    expect(hash1).not.toBe(hash2)
  })

  it('should return SHA-256 hash format (64 hex chars)', () => {
    const tools = [createTool('test')]

    const hash = computeToolExposureHash(tools)

    expect(hash).toHaveLength(64)
    expect(/^[a-f0-9]+$/.test(hash)).toBe(true)
  })

  it('should handle empty tool list', () => {
    const hash = computeToolExposureHash([])

    expect(hash).toBeDefined()
    expect(hash).toHaveLength(64)
  })
})

describe('stableToolSort', () => {
  function createTool(name: string, category: ToolCategory): ToolDefinition {
    return {
      name,
      description: `${name} tool`,
      category,
      sensitivity: 'low' as ToolSensitivity,
      schema: { type: 'object', properties: {} },
      handler: async () => ({ success: true }),
    }
  }

  it('should sort by category then name', () => {
    const tools = [createTool('z_read', 'read'), createTool('a_write', 'write'), createTool('a_read', 'read')]

    const sorted = stableToolSort(tools)

    expect(sorted.map((t) => t.name)).toEqual(['a_read', 'z_read', 'a_write'])
  })

  it('should not modify original array', () => {
    const tools = [createTool('b', 'read'), createTool('a', 'read')]

    stableToolSort(tools)

    expect(tools[0].name).toBe('b')
    expect(tools[1].name).toBe('a')
  })

  it('should handle empty array', () => {
    const sorted = stableToolSort([])

    expect(sorted).toEqual([])
  })

  it('should sort read before write', () => {
    const tools = [createTool('write', 'write'), createTool('read', 'read')]

    const sorted = stableToolSort(tools)

    expect(sorted[0].category).toBe('read')
    expect(sorted[1].category).toBe('write')
  })

  it('should sort search category correctly', () => {
    const tools = [createTool('execute', 'execute'), createTool('search', 'search'), createTool('read', 'read')]

    const sorted = stableToolSort(tools)

    expect(sorted.map((t) => t.category)).toEqual(['read', 'search', 'execute'])
  })
})

describe('canonicalizeToolList', () => {
  function createTool(name: string, category: ToolCategory = 'read'): ToolDefinition {
    return {
      name,
      description: `${name} tool`,
      category,
      sensitivity: 'low' as ToolSensitivity,
      schema: { type: 'object', properties: {} },
      handler: async () => ({ success: true }),
    }
  }

  it('should produce deterministic output', () => {
    const tools = [createTool('a'), createTool('b')]

    const result1 = canonicalizeToolList(tools)
    const result2 = canonicalizeToolList(tools)

    expect(result1).toBe(result2)
  })

  it('should separate tools with delimiter', () => {
    const tools = [createTool('a'), createTool('b')]

    const result = canonicalizeToolList(tools)

    expect(result).toContain('---')
  })
})
