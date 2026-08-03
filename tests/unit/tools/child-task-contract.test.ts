/**
 * Contract tests locking the public child-task tool contracts BEFORE the runtime
 * replacement (plan: opencode-like-subagent-sessions, Todo 5).
 *
 * Locks:
 *  - Public tool IDs and catalog entries are unchanged.
 *  - Legacy required input/result shapes keep validating.
 *  - New child-task fields (taskId / background) are STRICTLY additive (optional).
 *  - Projection behavior: search_subagent hides web_search.
 *  - Observation summaries keep their special-casing.
 *  - Terminal error envelope {code, message, recoverable, phase?} never leaks
 *    stacks or secrets into model/user-visible output.
 *  - Bounded-result policy: >= 32KiB structured results go by reference; the
 *    model-facing summary is sanitized and capped at 2,000 chars.
 */

import { describe, it, expect, vi } from 'vitest'
import { getFallbackToolCatalog } from '../../../src/tools/tool-catalog.js'
import { getToolCatalog } from '../../../src/api/tool-catalog.js'
import {
  createForegroundLaunchSubagentToolDefinition,
  createSearchSubagentToolDefinition,
} from '../../../src/foreground/tools/index.js'
import {
  LAUNCH_SUBAGENT_TOOL_ID,
  handleLaunchSubagent,
  type LaunchSubagentDeps,
} from '../../../src/foreground/tools/subagent-launch-tool.js'
import { SEARCH_SUBAGENT_TOOL_ID, type SearchSubagentToolDeps } from '../../../src/search/search-subagent-tool.js'
import { assertSearchScope } from '../../../src/search/search-subagent-types.js'
import { buildForegroundToolProjection } from '../../../src/foreground/tool-projection-mapper.js'
import { buildObservationSummary } from '../../../src/kernel/observation-summary-builder.js'
import { INLINE_THRESHOLD } from '../../../src/tools/tool-result-reference.js'
import { createAgentProfileRegistry, registerSystemProfiles } from '../../../src/taxonomy/agent-profile-registry.js'
import type { AgentProfileRegistry } from '../../../src/taxonomy/agent-profile-registry.js'
import type { RuntimeDispatcher, DispatchResult } from '../../../src/dispatcher/types.js'
import {
  CHILD_TASK_MODEL_SUMMARY_MAX_CHARS,
  applyBoundedResultPolicy,
  toChildTaskTerminalError,
  sanitizeChildTaskSummary,
} from '../../../src/foreground/tools/child-task-contract.js'

// ---------------------------------------------------------------------------
// Minimal schema validation mirroring the tool-executor contract
// (required presence + declared property type checks). Kept local so the
// contract test stays independent of executor internals.
// ---------------------------------------------------------------------------
interface PropertySchema {
  type?: string
  enum?: string[]
  items?: { type?: string }
  [key: string]: unknown
}

function validateAgainstSchema(
  params: unknown,
  schema: { type: string; properties: Record<string, unknown>; required?: string[] },
): { valid: boolean; errors: string[] } {
  const errors: string[] = []
  if (typeof params !== 'object' || params === null) {
    return { valid: false, errors: ['Params must be an object'] }
  }
  const obj = params as Record<string, unknown>
  for (const required of schema.required ?? []) {
    if (!(required in obj)) errors.push(`Missing required field: ${required}`)
  }
  for (const [key, value] of Object.entries(obj)) {
    const prop = schema.properties[key] as PropertySchema | undefined
    if (prop?.type) {
      const typeMismatch = prop.type === 'array' ? !Array.isArray(value) : typeof value !== prop.type
      if (typeMismatch) {
        errors.push(`Field '${key}' must be of type '${prop.type}'`)
      }
    }
  }
  return { valid: errors.length === 0, errors }
}

function createLaunchDeps(profileRegistry: AgentProfileRegistry, dispatchResult: DispatchResult): LaunchSubagentDeps {
  return {
    runtimeDispatcher: { dispatch: vi.fn().mockResolvedValue(dispatchResult) } as unknown as RuntimeDispatcher,
    userId: 'user-1',
    sessionId: 'session-1',
    turnId: 'turn-1',
    profileRegistry,
  }
}

function createSearchDeps(): SearchSubagentToolDeps {
  return {
    searchSubagent: {
      execute: vi.fn().mockResolvedValue({
        success: true,
        answer: 'Test answer',
        toolResult: {
          query: 'weather in Tokyo today',
          results: [
            { title: 'Tokyo Weather', url: 'https://weather.com/tokyo', snippet: 'Current temperature is 22°C' },
          ],
          total: 1,
          provider: 'searxng',
          endpointHost: 'localhost:8888',
        },
        metadata: { providerId: 'test-provider', model: 'test-model', querySource: 'search_subagent', durationMs: 150 },
      }),
    },
    queryPlanner: {
      plan: vi.fn().mockImplementation((input: { originalQuestion: string; intent?: string; locale?: string }) => ({
        originalQuestion: input.originalQuestion,
        searchQuery: input.originalQuestion,
        intent: input.intent || 'general',
        requiresFreshness: false,
        locale: input.locale,
        missingCriticalContext: [],
      })),
    },
    resultNormalizer: {
      extractFacts: vi
        .fn()
        .mockReturnValue([{ fact: 'Tokyo is 22°C', sourceUrl: 'https://weather.com/tokyo', confidence: 0.7 }]),
    },
    scopeGuard: assertSearchScope,
  }
}

// ---------------------------------------------------------------------------
// 1. Public tool IDs and catalog entries are unchanged
// ---------------------------------------------------------------------------
describe('child-task contract: public tool identity', () => {
  it('keeps the public tool IDs byte-identical', () => {
    expect(LAUNCH_SUBAGENT_TOOL_ID).toBe('foreground_launch_subagent')
    expect(SEARCH_SUBAGENT_TOOL_ID).toBe('search_subagent')
  })

  it('keeps catalog entries unchanged in the tools fallback catalog', () => {
    const catalog = getFallbackToolCatalog()
    const launch = catalog.find((t) => t.name === 'foreground_launch_subagent')
    const search = catalog.find((t) => t.name === 'search_subagent')

    expect(launch).toBeDefined()
    expect(launch).toMatchObject({
      name: 'foreground_launch_subagent',
      category: 'internal',
      sensitivity: 'medium',
      executionPlane: 'foreground',
    })
    expect(search).toBeDefined()
    expect(search).toMatchObject({
      name: 'search_subagent',
      category: 'search',
      sensitivity: 'medium',
    })
  })

  it('keeps catalog identity fields and evolves descriptions additively in the public API catalog', () => {
    const catalog = getToolCatalog()
    const launch = catalog.find((t) => t.name === 'foreground_launch_subagent')
    const search = catalog.find((t) => t.name === 'search_subagent')

    // Identity fields stay byte-identical (Todo 17: descriptions gain
    // child-session wording additively, names/categories/sensitivity never change).
    expect(launch).toEqual({
      name: 'foreground_launch_subagent',
      description:
        'Launch a subagent to perform a task in a dedicated child session. The parent waits for a bounded result (foreground) or is notified on completion (background); the task can be resumed later by its taskId.',
      category: 'internal',
      sensitivity: 'medium',
    })
    expect(search).toEqual({
      name: 'search_subagent',
      description:
        'Search the web for information. Returns structured evidence with extracted facts and source URLs. Runs inside a resumable child session; the parent receives only the bounded final evidence.',
      category: 'search',
      sensitivity: 'medium',
    })
  })

  it('keeps tool definition identity fields unchanged', () => {
    const launchDef = createForegroundLaunchSubagentToolDefinition()
    expect(launchDef.name).toBe('foreground_launch_subagent')
    expect(launchDef.category).toBe('internal')
    expect(launchDef.sensitivity).toBe('medium')
    expect(launchDef.requiresPermission).toBe(true)

    const searchDef = createSearchSubagentToolDefinition(createSearchDeps())
    expect(searchDef.name).toBe('search_subagent')
    expect(searchDef.category).toBe('search')
    expect(searchDef.sensitivity).toBe('medium')
    expect(searchDef.requiresPermission).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 2. Legacy required inputs still validate; child-task fields are additive
// ---------------------------------------------------------------------------
describe('child-task contract: schemas are strictly additive', () => {
  it('foreground_launch_subagent keeps required: [objective] and existing property types', () => {
    const schema = createForegroundLaunchSubagentToolDefinition().schema
    expect(schema.required).toEqual(['objective'])
    expect(schema.properties.objective).toMatchObject({ type: 'string' })
    expect(schema.properties.agentType).toMatchObject({ type: 'string' })
    expect(schema.properties.suggestedTools).toMatchObject({ type: 'array', items: { type: 'string' } })
  })

  it('foreground_launch_subagent accepts optional taskId and background', () => {
    const schema = createForegroundLaunchSubagentToolDefinition().schema
    expect(schema.properties.taskId).toMatchObject({ type: 'string' })
    expect(schema.properties.background).toMatchObject({ type: 'boolean' })
    // strictly additive: never required
    expect(schema.required).toEqual(['objective'])
    expect(schema.required).not.toContain('taskId')
    expect(schema.required).not.toContain('background')
  })

  it('search_subagent keeps required: [originalQuestion] and existing property types', () => {
    const schema = createSearchSubagentToolDefinition(createSearchDeps()).schema
    expect(schema.required).toEqual(['originalQuestion'])
    expect(schema.properties.originalQuestion).toMatchObject({ type: 'string' })
    expect(schema.properties.intent).toMatchObject({ type: 'string' })
    expect(schema.properties.locale).toMatchObject({ type: 'string' })
    expect(schema.properties.freshnessRequired).toMatchObject({ type: 'boolean' })
  })

  it('search_subagent accepts optional taskId', () => {
    const schema = createSearchSubagentToolDefinition(createSearchDeps()).schema
    expect(schema.properties.taskId).toMatchObject({ type: 'string' })
    expect(schema.required).toEqual(['originalQuestion'])
    expect(schema.required).not.toContain('taskId')
  })

  it('old payloads still validate', () => {
    const launchSchema = createForegroundLaunchSubagentToolDefinition().schema
    const searchSchema = createSearchSubagentToolDefinition(createSearchDeps()).schema

    // Legacy payloads — exactly the pre-child-session fields
    expect(validateAgainstSchema({ objective: 'Process the PDF' }, launchSchema).valid).toBe(true)
    expect(
      validateAgainstSchema(
        { objective: 'Process the PDF', agentType: 'document_processor', suggestedTools: ['file_read'] },
        launchSchema,
      ).valid,
    ).toBe(true)
    expect(validateAgainstSchema({ originalQuestion: 'weather in Tokyo' }, searchSchema).valid).toBe(true)
    expect(
      validateAgainstSchema(
        { originalQuestion: 'weather in Tokyo', intent: 'weather', locale: 'en-US', freshnessRequired: true },
        searchSchema,
      ).valid,
    ).toBe(true)
  })

  it('payloads carrying the new optional fields still validate (additive)', () => {
    const launchSchema = createForegroundLaunchSubagentToolDefinition().schema
    const searchSchema = createSearchSubagentToolDefinition(createSearchDeps()).schema

    expect(
      validateAgainstSchema({ objective: 'Process the PDF', taskId: 'child_sess_1', background: true }, launchSchema)
        .valid,
    ).toBe(true)
    expect(validateAgainstSchema({ originalQuestion: 'weather', taskId: 'child_sess_2' }, searchSchema).valid).toBe(
      true,
    )

    // wrong types for the new optional fields are still rejected — schema is real
    expect(validateAgainstSchema({ objective: 'x', background: 'not-a-boolean' }, launchSchema).valid).toBe(false)
  })

  it('missing required fields are still rejected', () => {
    const launchSchema = createForegroundLaunchSubagentToolDefinition().schema
    const searchSchema = createSearchSubagentToolDefinition(createSearchDeps()).schema

    expect(validateAgainstSchema({}, launchSchema).valid).toBe(false)
    expect(validateAgainstSchema({}, searchSchema).valid).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 3. Result shapes are preserved
// ---------------------------------------------------------------------------
describe('child-task contract: result shapes', () => {
  it('foreground_launch_subagent success data keeps runtimeActionId/agentType/agentProfile/dispatchResult', async () => {
    const profileRegistry = createAgentProfileRegistry()
    registerSystemProfiles(profileRegistry)

    const dispatchResult: DispatchResult = {
      requestId: 'turn-1',
      actionId: 'action-123',
      status: 'completed',
      targetRuntime: 'subagent_runtime',
      createdAt: '2024-01-01T00:00:00Z',
    }

    const result = await handleLaunchSubagent(createLaunchDeps(profileRegistry, dispatchResult), {
      objective: 'Process the PDF document',
      agentType: 'document_processor',
    })

    expect(result.success).toBe(true)
    expect(Object.keys(result.data ?? {}).sort()).toEqual(
      ['agentProfile', 'agentType', 'dispatchResult', 'runtimeActionId'].sort(),
    )
    // runtimeActionId is server-generated by the launch facade, not the dispatcher's actionId
    expect(result.data?.runtimeActionId).toMatch(/^act_/)
    expect(result.data?.agentType).toBe('document_processor')
    expect(result.data?.agentProfile).toBe('document_processor')
    expect(result.data?.dispatchResult).toEqual(dispatchResult)
  })

  it('search_subagent result keeps structured evidence and no final-answer fields', async () => {
    const { handleSearchSubagentTool } = await import('../../../src/search/search-subagent-tool.js')
    const result = await handleSearchSubagentTool(createSearchDeps(), {
      originalQuestion: 'weather in Tokyo today',
      intent: 'weather',
    })

    expect(result.success).toBe(true)
    const data = result.data as unknown as Record<string, unknown>
    expect(data).not.toHaveProperty('finalAnswer')
    expect(data).not.toHaveProperty('userVisibleResponse')

    const metadata = data.metadata as Record<string, unknown>
    expect(data.originalQuestion).toBe('weather in Tokyo today')
    expect(data.searchQuery).toBe('weather in Tokyo today')
    expect(data.intent).toBe('weather')
    expect(data.freshness).toBe(false)
    expect(Array.isArray(data.results)).toBe(true)
    expect(Array.isArray(data.extractedFacts)).toBe(true)
    expect(Array.isArray(data.warnings)).toBe(true)
    expect(metadata.durationMs).toBeGreaterThanOrEqual(0)
    expect(metadata.resultCount).toBe(1)
    expect(metadata.uniqueSourceCount).toBe(1)
    expect(data.queryPlan).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// 4. Projection behavior is unchanged
// ---------------------------------------------------------------------------
describe('child-task contract: projection behavior', () => {
  const toolSummary = (name: string, category: 'search' | 'internal' | 'read', sensitivity: 'low' | 'medium') => ({
    name,
    category,
    sensitivity,
    description: name,
    schema: { type: 'object' as const, properties: {}, required: [] },
  })

  it('search_subagent available hides web_search from the projection', () => {
    const projection = buildForegroundToolProjection(
      {} as Parameters<typeof buildForegroundToolProjection>[0],
      [
        toolSummary('web_search', 'search', 'medium'),
        toolSummary('search_subagent', 'search', 'medium'),
        toolSummary('foreground_launch_subagent', 'internal', 'medium'),
        toolSummary('status_query', 'read', 'low'),
      ],
      undefined,
    )
    expect(projection.allowedToolIds).toContain('search_subagent')
    expect(projection.allowedToolIds).not.toContain('web_search')
    expect(projection.allowedToolIds).toContain('foreground_launch_subagent')
  })

  it('web_search stays when search_subagent is absent', () => {
    const projection = buildForegroundToolProjection(
      {} as Parameters<typeof buildForegroundToolProjection>[0],
      [toolSummary('web_search', 'search', 'medium'), toolSummary('status_query', 'read', 'low')],
      undefined,
    )
    expect(projection.allowedToolIds).toContain('web_search')
  })
})

// ---------------------------------------------------------------------------
// 5. Observation summaries keep their special-casing
// ---------------------------------------------------------------------------
describe('child-task contract: observation summaries', () => {
  it('search_subagent summaries are search_facts with extracted facts', () => {
    const summary = buildObservationSummary('search_subagent', {
      toolCallId: 'call-1',
      result: {
        extractedFacts: [
          { fact: 'Tokyo is 22°C', sourceUrl: 'https://weather.com', confidence: 0.7 },
          { fact: 'Sunny', sourceUrl: 'https://weather.com', confidence: 0.6 },
          { fact: 'Wind 10km/h', sourceUrl: 'https://weather.com', confidence: 0.5 },
        ],
      },
    } as never)

    expect(summary.summaryType).toBe('search_facts')
    expect(summary.summary).toContain('Tokyo is 22°C')
    expect(summary.summary).toContain('Sunny')
    expect(summary.evidenceCount).toBe(3)
  })

  it('search_subagent failure summaries stay safe', () => {
    const summary = buildObservationSummary('search_subagent', {
      toolCallId: 'call-1',
      error: { code: 'SEARCH_SUBAGENT_ERROR', message: 'backend down' },
    } as never)
    expect(summary.summaryType).toBe('search_facts')
    expect(summary.summary).toBe('Search failed: backend down')
  })

  it('foreground_launch_subagent falls through to generic summaries', () => {
    const summary = buildObservationSummary('foreground_launch_subagent', {
      toolCallId: 'call-1',
      result: { runtimeActionId: 'action-1', agentType: 'document_processor', agentProfile: 'document_processor' },
    } as never)
    expect(summary.summaryType).toBe('generic')
    expect(summary.summary).toContain('document_processor')
  })
})

// ---------------------------------------------------------------------------
// 6. Terminal error shape + safe envelope
// ---------------------------------------------------------------------------
describe('child-task contract: terminal error shape', () => {
  it('defines the terminal error envelope {code, message, recoverable, phase?}', () => {
    const err = toChildTaskTerminalError(new Error('child failed'), {
      code: 'CHILD_TASK_ERROR',
      recoverable: false,
      phase: 'run',
    })
    expect(err).toEqual({
      code: 'CHILD_TASK_ERROR',
      message: 'child failed',
      recoverable: false,
      phase: 'run',
    })
    // exactly the four contract keys — no stack, no extras
    expect(Object.keys(err).sort()).toEqual(['code', 'message', 'phase', 'recoverable'].sort())
  })

  it('phase is optional', () => {
    const err = toChildTaskTerminalError(new Error('boom'))
    expect(err.phase).toBeUndefined()
    expect(Object.keys(err).sort()).toEqual(['code', 'message', 'recoverable'].sort())
  })

  it('injected stack + API-key-shaped error yields safe code/message only', () => {
    const raw = new Error('Dispatch failed: upstream unreachable api_key=sk-abcdefghijklmnopqrstuvwxyz123456')
    raw.stack =
      'Error: Dispatch failed\n    at handleLaunchSubagent (subagent-launch-tool.ts:138:11)\n    at runTurn (foreground-agent.ts:42:7)'

    const err = toChildTaskTerminalError(raw, { code: 'CHILD_TASK_TIMEOUT', recoverable: true, phase: 'wait' })

    // safe envelope
    expect(err.code).toBe('CHILD_TASK_TIMEOUT')
    expect(err.recoverable).toBe(true)
    expect(err.phase).toBe('wait')
    // raw stack lines absent
    expect(err.message).not.toContain('subagent-launch-tool.ts')
    expect(err.message).not.toContain('at handleLaunchSubagent')
    expect(err.message).not.toContain('Error:')
    // API-key-shaped secret redacted
    expect(err.message).not.toContain('sk-abcdefghijklmnopqrstuvwxyz123456')
    expect(err.message).toContain('[REDACTED_API_KEY]')
  })

  it('non-Error thrown values never leak raw object dumps', () => {
    const err = toChildTaskTerminalError({ providerBody: { raw: 'secret-payload' } })
    expect(err.message).not.toContain('secret-payload')
    expect(err.message.length).toBeGreaterThan(0)
  })

  it('exposes only the typed envelope — never a stack property', () => {
    const err = toChildTaskTerminalError(new Error('x'))
    expect('stack' in err).toBe(false)
    expect(err).not.toHaveProperty('stack')
  })
})

// ---------------------------------------------------------------------------
// 7. Bounded-result policy
// ---------------------------------------------------------------------------
describe('child-task contract: bounded-result policy', () => {
  it('aligns the reference threshold with the existing 32KiB result-reference path', () => {
    // structured results above the existing threshold go by reference
    const large = applyBoundedResultPolicy({ data: 'x'.repeat(INLINE_THRESHOLD) })
    expect(large.mode).toBe('ref')

    const small = applyBoundedResultPolicy({ data: 'small' })
    expect(small.mode).toBe('inline')
  })

  it('reports serialized size for both modes', () => {
    const small = applyBoundedResultPolicy({ message: 'hello' })
    expect(small.sizeBytes).toBeGreaterThan(0)
    expect(small.sizeBytes).toBeLessThan(INLINE_THRESHOLD)
  })

  it('caps the model-facing summary at 2,000 sanitized characters', () => {
    const summary = sanitizeChildTaskSummary('a'.repeat(5000))
    expect(summary.length).toBeLessThanOrEqual(CHILD_TASK_MODEL_SUMMARY_MAX_CHARS)
    expect(CHILD_TASK_MODEL_SUMMARY_MAX_CHARS).toBe(2000)

    const bounded = applyBoundedResultPolicy({ data: 'y'.repeat(INLINE_THRESHOLD * 4) })
    expect(bounded.summary.length).toBeLessThanOrEqual(CHILD_TASK_MODEL_SUMMARY_MAX_CHARS)
  })

  it('keeps short summaries intact and within bound', () => {
    const summary = sanitizeChildTaskSummary('Found 3 results for "weather in Tokyo"')
    expect(summary).toBe('Found 3 results for "weather in Tokyo"')
  })

  it('sanitizes secrets and ANSI control sequences out of the summary', () => {
    const raw = '\u001b[31mCredentials: api_key=sk-abcdefghijklmnopqrstuvwxyz123456\u001b[0m'
    const summary = sanitizeChildTaskSummary(raw)
    expect(summary).not.toContain('sk-abcdefghijklmnopqrstuvwxyz123456')
    expect(summary).toContain('[REDACTED_API_KEY]')
    expect(summary).not.toContain('\u001b')
  })

  it('is a pure function — same input, same output, no side effects', () => {
    const input = { data: 'stable' }
    const first = applyBoundedResultPolicy(input)
    const second = applyBoundedResultPolicy(input)
    expect(second).toEqual(first)
  })
})
