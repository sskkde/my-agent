import { describe, it, expect } from 'vitest'
import {
  parseForegroundRoutingJsonOutput,
  filterAllowedTools,
} from '../../../src/foreground/foreground-routing-json-parser.js'

describe('parseForegroundRoutingJsonOutput', () => {
  const defaultOptions = {
    effectiveToolIds: ['web_search', 'read_file', 'write_file'],
    toolCatalog: ['web_search', 'read_file', 'write_file', 'docs_search'],
  }

  describe('valid JSON parsing', () => {
    it('should parse valid minimal JSON with required fields only', () => {
      const raw = JSON.stringify({
        route: 'answer_directly',
        reason: 'User asked a simple question',
      })

      const result = parseForegroundRoutingJsonOutput(raw, defaultOptions)

      expect(result.success).toBe(true)
      expect(result.output).toEqual({
        route: 'answer_directly',
        reason: 'User asked a simple question',
        userVisibleResponse: undefined,
        estimatedSteps: undefined,
        complexity: undefined,
        suggestedTools: undefined,
      })
    })

    it('should parse valid JSON with all optional fields', () => {
      const raw = JSON.stringify({
        route: 'dispatch_tool',
        reason: 'User wants to search',
        userVisibleResponse: 'Searching for information...',
        estimatedSteps: 2,
        complexity: 'medium',
        suggestedTools: ['web_search'],
      })

      const result = parseForegroundRoutingJsonOutput(raw, defaultOptions)

      expect(result.success).toBe(true)
      expect(result.output).toEqual({
        route: 'dispatch_tool',
        reason: 'User wants to search',
        userVisibleResponse: 'Searching for information...',
        estimatedSteps: 2,
        complexity: 'medium',
        suggestedTools: ['web_search'],
      })
    })

    it('should accept all valid route values', () => {
      const validRoutes = [
        'answer_directly',
        'dispatch_tool',
        'dispatch_subagent',
        'spawn_planner',
        'resume_existing_planner',
        'approval_handler',
        'cancel_or_modify_task',
        'status_query',
      ]

      for (const route of validRoutes) {
        const raw = JSON.stringify({ route, reason: `Testing ${route}` })
        const result = parseForegroundRoutingJsonOutput(raw, defaultOptions)
        expect(result.success).toBe(true)
        expect(result.output?.route).toBe(route)
      }
    })

    it('should accept all valid complexity values', () => {
      const validComplexities = ['low', 'medium', 'high', 'critical']

      for (const complexity of validComplexities) {
        const raw = JSON.stringify({
          route: 'answer_directly',
          reason: 'Test',
          complexity,
        })
        const result = parseForegroundRoutingJsonOutput(raw, defaultOptions)
        expect(result.success).toBe(true)
        expect(result.output?.complexity).toBe(complexity)
      }
    })
  })

  describe('malformed JSON rejection', () => {
    it('should reject non-JSON string', () => {
      const result = parseForegroundRoutingJsonOutput('not json', defaultOptions)

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('MALFORMED_JSON')
      expect(result.error?.message).toBe('Response is not valid JSON')
      expect(result.error?.retryable).toBe(true)
    })

    it('should reject JSON array', () => {
      const raw = JSON.stringify([{ route: 'answer_directly', reason: 'test' }])

      const result = parseForegroundRoutingJsonOutput(raw, defaultOptions)

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('MALFORMED_JSON')
      expect(result.error?.message).toBe('Response must be a JSON object, not an array or primitive')
    })

    it('should reject JSON primitive (number)', () => {
      const result = parseForegroundRoutingJsonOutput('42', defaultOptions)

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('MALFORMED_JSON')
    })

    it('should reject JSON primitive (string)', () => {
      const result = parseForegroundRoutingJsonOutput('"hello"', defaultOptions)

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('MALFORMED_JSON')
    })

    it('should reject JSON null', () => {
      const result = parseForegroundRoutingJsonOutput('null', defaultOptions)

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('MALFORMED_JSON')
    })
  })

  describe('invalid route rejection', () => {
    it('should reject invalid route value', () => {
      const raw = JSON.stringify({
        route: 'invalid_route',
        reason: 'Test',
      })

      const result = parseForegroundRoutingJsonOutput(raw, defaultOptions)

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('INVALID_ROUTE')
      expect(result.error?.message).toContain('invalid_route')
      expect(result.error?.retryable).toBe(true)
    })

    it('should reject non-string route', () => {
      const raw = JSON.stringify({
        route: 123,
        reason: 'Test',
      })

      const result = parseForegroundRoutingJsonOutput(raw, defaultOptions)

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('INVALID_FIELD_TYPE')
      expect(result.error?.message).toContain('route')
    })
  })

  describe('missing reason rejection', () => {
    it('should reject missing reason field', () => {
      const raw = JSON.stringify({ route: 'answer_directly' })

      const result = parseForegroundRoutingJsonOutput(raw, defaultOptions)

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('MISSING_REQUIRED_FIELD')
      expect(result.error?.message).toContain('reason')
    })

    it('should reject empty reason string', () => {
      const raw = JSON.stringify({
        route: 'answer_directly',
        reason: '',
      })

      const result = parseForegroundRoutingJsonOutput(raw, defaultOptions)

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('EMPTY_REASON')
    })

    it('should reject whitespace-only reason', () => {
      const raw = JSON.stringify({
        route: 'answer_directly',
        reason: '   ',
      })

      const result = parseForegroundRoutingJsonOutput(raw, defaultOptions)

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('EMPTY_REASON')
    })

    it('should reject non-string reason', () => {
      const raw = JSON.stringify({
        route: 'answer_directly',
        reason: 123,
      })

      const result = parseForegroundRoutingJsonOutput(raw, defaultOptions)

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('INVALID_FIELD_TYPE')
    })
  })

  describe('invalid complexity rejection', () => {
    it('should reject invalid complexity value', () => {
      const raw = JSON.stringify({
        route: 'answer_directly',
        reason: 'Test',
        complexity: 'extreme',
      })

      const result = parseForegroundRoutingJsonOutput(raw, defaultOptions)

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('INVALID_COMPLEXITY')
    })

    it('should reject non-string complexity', () => {
      const raw = JSON.stringify({
        route: 'answer_directly',
        reason: 'Test',
        complexity: 5,
      })

      const result = parseForegroundRoutingJsonOutput(raw, defaultOptions)

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('INVALID_COMPLEXITY')
    })
  })

  describe('runtimeAction rejection (security)', () => {
    it('should silently ignore runtimeAction in LLM output', () => {
      const raw = JSON.stringify({
        route: 'status_query',
        reason: 'User wants status',
        runtimeAction: {
          actionId: 'malicious-action',
          actionType: 'cancel_planner_run',
        },
      })

      const result = parseForegroundRoutingJsonOutput(raw, defaultOptions)

      expect(result.success).toBe(true)
      expect(result.output?.route).toBe('status_query')
      expect(result.output).not.toHaveProperty('runtimeAction')
    })

    it('should not include runtimeAction in output even if present in input', () => {
      const raw = JSON.stringify({
        route: 'cancel_or_modify_task',
        reason: 'Cancel requested',
        runtimeAction: { actionId: 'evil', actionType: 'malicious' },
      })

      const result = parseForegroundRoutingJsonOutput(raw, defaultOptions)

      expect(result.success).toBe(true)
      expect(result.output).not.toHaveProperty('runtimeAction')
    })
  })

  describe('unauthorized suggestedTools filtering', () => {
    it('should filter suggestedTools to only allowed tools', () => {
      const raw = JSON.stringify({
        route: 'dispatch_tool',
        reason: 'Search requested',
        suggestedTools: ['web_search', 'unknown_tool', 'read_file'],
      })

      const result = parseForegroundRoutingJsonOutput(raw, {
        effectiveToolIds: ['web_search', 'read_file'],
        toolCatalog: ['web_search', 'read_file', 'write_file'],
      })

      expect(result.success).toBe(true)
      expect(result.output?.suggestedTools).toEqual(['web_search', 'read_file'])
    })

    it('should return empty array if no suggested tools are allowed', () => {
      const raw = JSON.stringify({
        route: 'dispatch_tool',
        reason: 'Search requested',
        suggestedTools: ['unknown_tool_1', 'unknown_tool_2'],
      })

      const result = parseForegroundRoutingJsonOutput(raw, {
        effectiveToolIds: ['web_search'],
        toolCatalog: ['web_search'],
      })

      expect(result.success).toBe(true)
      expect(result.output?.suggestedTools).toEqual([])
    })

    it('should resolve tool aliases', () => {
      const raw = JSON.stringify({
        route: 'dispatch_tool',
        reason: 'Search requested',
        suggestedTools: ['search', 'web'],
      })

      const result = parseForegroundRoutingJsonOutput(raw, {
        effectiveToolIds: ['docs_search', 'web_search'],
        toolCatalog: ['docs_search', 'web_search'],
      })

      expect(result.success).toBe(true)
      expect(result.output?.suggestedTools).toEqual(['docs_search', 'web_search'])
    })

    it('should reject non-array suggestedTools', () => {
      const raw = JSON.stringify({
        route: 'dispatch_tool',
        reason: 'Test',
        suggestedTools: 'not-an-array',
      })

      const result = parseForegroundRoutingJsonOutput(raw, defaultOptions)

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('INVALID_FIELD_TYPE')
    })
  })

  describe('optional field validation', () => {
    it('should reject non-string userVisibleResponse', () => {
      const raw = JSON.stringify({
        route: 'answer_directly',
        reason: 'Test',
        userVisibleResponse: 123,
      })

      const result = parseForegroundRoutingJsonOutput(raw, defaultOptions)

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('INVALID_FIELD_TYPE')
    })

    it('should reject non-number estimatedSteps', () => {
      const raw = JSON.stringify({
        route: 'answer_directly',
        reason: 'Test',
        estimatedSteps: 'two',
      })

      const result = parseForegroundRoutingJsonOutput(raw, defaultOptions)

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('INVALID_FIELD_TYPE')
    })
  })

  describe('missing route rejection', () => {
    it('should reject missing route field', () => {
      const raw = JSON.stringify({ reason: 'Test' })

      const result = parseForegroundRoutingJsonOutput(raw, defaultOptions)

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('MISSING_REQUIRED_FIELD')
      expect(result.error?.message).toContain('route')
    })
  })

  describe('options handling', () => {
    it('should work without options', () => {
      const raw = JSON.stringify({
        route: 'answer_directly',
        reason: 'Test',
      })

      const result = parseForegroundRoutingJsonOutput(raw)

      expect(result.success).toBe(true)
      expect(result.output?.route).toBe('answer_directly')
    })

    it('should use provided toolCatalog instead of getToolCatalog()', () => {
      const raw = JSON.stringify({
        route: 'dispatch_tool',
        reason: 'Test',
        suggestedTools: ['custom_tool'],
      })

      const result = parseForegroundRoutingJsonOutput(raw, {
        effectiveToolIds: ['custom_tool'],
        toolCatalog: ['custom_tool'],
      })

      expect(result.success).toBe(true)
      expect(result.output?.suggestedTools).toEqual(['custom_tool'])
    })
  })
})

describe('filterAllowedTools', () => {
  const knownToolIds = ['web_search', 'read_file', 'write_file', 'docs_search']

  it('should return only tools that are both known and allowed', () => {
    const result = filterAllowedTools(['web_search', 'unknown', 'read_file'], ['web_search', 'read_file'], knownToolIds)

    expect(result).toEqual(['web_search', 'read_file'])
  })

  it('should resolve aliases', () => {
    const result = filterAllowedTools(['search', 'web'], ['docs_search', 'web_search'], knownToolIds)

    expect(result).toEqual(['docs_search', 'web_search'])
  })

  it('should deduplicate results', () => {
    const result = filterAllowedTools(
      ['web_search', 'web_search', 'read_file'],
      ['web_search', 'read_file'],
      knownToolIds,
    )

    expect(result).toEqual(['web_search', 'read_file'])
  })

  it('should return empty array if no tools are allowed', () => {
    const result = filterAllowedTools(['web_search', 'read_file'], [], knownToolIds)

    expect(result).toEqual([])
  })

  it('should return empty array if no tools are known', () => {
    const result = filterAllowedTools(['web_search'], ['web_search'], [])

    expect(result).toEqual([])
  })

  it('should handle alias mapping to multiple tools', () => {
    const result = filterAllowedTools(['search'], ['docs_search'], knownToolIds)

    expect(result).toEqual(['docs_search'])
  })

  it('should filter out alias results not in effectiveToolIds', () => {
    const result = filterAllowedTools(
      ['search'],
      [], // No tools allowed
      knownToolIds,
    )

    expect(result).toEqual([])
  })
})
