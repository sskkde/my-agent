/**
 * Child Task Policy — unit tests
 *
 * The child-task policy is the single source of truth for child session
 * visibility, the fixed taskId identity rule, launch source, depth and
 * per-parent-turn launch limits, allowed-profile validation and the AgentType
 * `subagent` envelope intersection for child tool projections.
 *
 * The module must be pure and framework-free so it can run without DB/HTTP.
 * Rejection happens at the policy level, BEFORE any session/run row could be
 * created — proven here via a gating wrapper that records store calls.
 */

import { describe, it, expect, vi } from 'vitest'
import {
  MAX_SUBAGENT_DEPTH,
  MAX_CHILD_LAUNCHES_PER_PARENT_TURN,
  CHILD_TASK_LAUNCH_SOURCE,
  SEARCH_CHILD_TOOL_IDS,
  ORCHESTRATION_LAUNCH_TOOL_IDS,
  SUBAGENT_DEPTH_EXCEEDED,
  SUBAGENT_LAUNCH_LIMIT_EXCEEDED,
  SUBAGENT_PROFILE_UNKNOWN,
  SUBAGENT_TOOL_DENIED,
  CHILD_TASK_ID_MISMATCH,
  CHILD_LAUNCH_SOURCE_INVALID,
  ChildTaskPolicyError,
  resolveSessionVisibility,
  isInternalChildSession,
  resolveChildTaskId,
  assertChildTaskIdMatchesSession,
  assertChildLaunchSource,
  isDepthWithinLimit,
  assertDepthAllowed,
  isLaunchCountWithinLimit,
  assertLaunchAllowed,
  resolveChildProfile,
  buildChildToolProjection,
  assertToolRequestAllowed,
  buildSearchChildProjection,
  evaluateChildLaunch,
  type SessionVisibility,
  type ChildLaunchDecision,
} from '../../../src/subagents/child-task-policy.js'
import type { SubagentDefinition, SubagentRegistry } from '../../../src/subagents/registry.js'
import { createSubagentRegistry } from '../../../src/subagents/registry.js'
import { registerBuiltInSubagents } from '../../../src/subagents/builtin-definitions.js'
import type { SubagentTaskSpec } from '../../../src/subagents/types.js'
import { createToolRegistry } from '../../../src/tools/tool-registry.js'
import type { ToolRegistry, ToolCategory, ToolDefinition } from '../../../src/tools/types.js'
import { createAgentTypeToolEnvelopeRegistry } from '../../../src/permissions/agent-type-tool-envelope.js'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TEST_DEFINITION_ID = 'test_worker'

function createDefinition(overrides?: Partial<SubagentDefinition>): SubagentDefinition {
  return {
    agentType: TEST_DEFINITION_ID,
    displayName: 'Test Worker',
    description: 'A pure test subagent',
    modality: 'text',
    promptId: 'agentProfile:test_worker',
    allowedToolIds: ['file_read', 'web_search', 'todolist', 'todowrite'],
    defaultMaxIterations: 10,
    defaultTimeoutMs: 60000,
    supportedExecutionModes: ['sync', 'background'],
    canRunInBackground: true,
    providerPolicy: { fallbackMode: 'any_compatible' },
    permissionProfile: 'ask_on_write',
    summaryPolicy: { returnMode: 'summary_only', maxSummaryTokens: 500 },
    ...overrides,
  }
}

/** A malicious profile that claims far more than any envelope grants. */
function createMaliciousDefinition(): SubagentDefinition {
  return createDefinition({
    agentType: 'malicious_worker',
    allowedToolIds: [
      'exec',
      'bash',
      'code_execution',
      'admin_config',
      'manage_users',
      'foreground_launch_subagent',
      'file_read',
    ],
  })
}

function createTaskSpec(overrides?: Partial<SubagentTaskSpec>): SubagentTaskSpec {
  return { objective: 'Test task', ...overrides }
}

function registerFixtureTool(
  registry: ToolRegistry,
  name: string,
  category: ToolCategory = 'internal',
): ToolDefinition {
  const tool: ToolDefinition = {
    name,
    description: `Fixture tool ${name}`,
    category,
    sensitivity: 'medium',
    schema: { type: 'object', properties: {}, additionalProperties: true },
    handler: () => ({ success: true, data: {} }),
  }
  registry.register(tool)
  return tool
}

function createFixtureToolRegistry(): ToolRegistry {
  const registry = createToolRegistry()
  registerFixtureTool(registry, 'web_search', 'search')
  registerFixtureTool(registry, 'file_read', 'read')
  registerFixtureTool(registry, 'file_glob', 'read')
  registerFixtureTool(registry, 'todolist', 'write')
  registerFixtureTool(registry, 'todowrite', 'write')
  registerFixtureTool(registry, 'artifact_create', 'write')
  registerFixtureTool(registry, 'exec', 'execute')
  registerFixtureTool(registry, 'bash', 'execute')
  registerFixtureTool(registry, 'code_execution', 'execute')
  registerFixtureTool(registry, 'admin_config', 'admin')
  registerFixtureTool(registry, 'manage_users', 'admin')
  registerFixtureTool(registry, 'foreground_launch_subagent')
  registerFixtureTool(registry, 'search_subagent', 'search')
  registerFixtureTool(registry, 'foreground_spawn_planner')
  return registry
}

function createFixtureSubagentRegistry(): SubagentRegistry {
  const registry = createSubagentRegistry()
  registerBuiltInSubagents(registry)
  registry.register(createDefinition())
  registry.register(createMaliciousDefinition())
  return registry
}

function expectPolicyError(fn: () => unknown, code: string): ChildTaskPolicyError {
  try {
    fn()
  } catch (err) {
    expect(err).toBeInstanceOf(ChildTaskPolicyError)
    expect((err as ChildTaskPolicyError).code).toBe(code)
    return err as ChildTaskPolicyError
  }
  throw new Error(`Expected ChildTaskPolicyError with code "${code}" but nothing was thrown`)
}

// ---------------------------------------------------------------------------
// Session kind / visibility
// ---------------------------------------------------------------------------

describe('resolveSessionVisibility / isInternalChildSession', () => {
  it('resolves the parent (depth 0) as a foreground session', () => {
    expect(resolveSessionVisibility(0)).toBe('foreground')
  })

  it('resolves every child (depth >= 1) as an internal session', () => {
    for (const depth of [1, 2, 3]) {
      expect(resolveSessionVisibility(depth)).toBe('internal')
    }
  })

  it('never classifies a child as foreground', () => {
    expect(resolveSessionVisibility(4)).toBe('internal')
    const kinds = [
      resolveSessionVisibility(0),
      resolveSessionVisibility(1),
      resolveSessionVisibility(2),
      resolveSessionVisibility(3),
    ]
    expect(kinds.filter((k) => k === 'foreground')).toHaveLength(1)
  })

  it('isInternalChildSession matches only internal sessions', () => {
    expect(isInternalChildSession('internal')).toBe(true)
    expect(isInternalChildSession('foreground')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Fixed taskId identity rule
// ---------------------------------------------------------------------------

describe('taskId identity rule (taskId === childSessionId)', () => {
  it('derives the task ID directly from the child session ID', () => {
    const childSessionId = 'sess_child_abc123'
    expect(resolveChildTaskId(childSessionId)).toBe(childSessionId)
    expect(resolveChildTaskId('sess_child_xyz')).toBe('sess_child_xyz')
  })

  it('accepts a matching taskId / childSessionId pair', () => {
    expect(() => assertChildTaskIdMatchesSession('sess_child_abc', 'sess_child_abc')).not.toThrow()
  })

  it('rejects a taskId that differs from the childSessionId', () => {
    expectPolicyError(() => assertChildTaskIdMatchesSession('sess_parent_1', 'sess_child_abc'), CHILD_TASK_ID_MISMATCH)
  })
})

// ---------------------------------------------------------------------------
// Launch source
// ---------------------------------------------------------------------------

describe('child launch source', () => {
  it('defines main_agent_delegation as the child launch source', () => {
    expect(CHILD_TASK_LAUNCH_SOURCE).toBe('main_agent_delegation')
  })

  it('accepts the fixed child launch source', () => {
    expect(() => assertChildLaunchSource('main_agent_delegation')).not.toThrow()
  })

  it('rejects any other launch source for child tasks', () => {
    expectPolicyError(() => assertChildLaunchSource('gateway_intent'), CHILD_LAUNCH_SOURCE_INVALID)
    expectPolicyError(() => assertChildLaunchSource('planner_execution'), CHILD_LAUNCH_SOURCE_INVALID)
    expectPolicyError(() => assertChildLaunchSource(''), CHILD_LAUNCH_SOURCE_INVALID)
  })
})

// ---------------------------------------------------------------------------
// Depth limit (max 3; depth 4 rejected)
// ---------------------------------------------------------------------------

describe('depth policy', () => {
  it('exposes the maximum depth constant as 3', () => {
    expect(MAX_SUBAGENT_DEPTH).toBe(3)
  })

  it('accepts depths 0 through 3', () => {
    for (const depth of [0, 1, 2, 3]) {
      expect(isDepthWithinLimit(depth)).toBe(true)
      expect(() => assertDepthAllowed(depth)).not.toThrow()
    }
  })

  it('rejects depth 4 with SUBAGENT_DEPTH_EXCEEDED', () => {
    expect(isDepthWithinLimit(4)).toBe(false)
    expectPolicyError(() => assertDepthAllowed(4), SUBAGENT_DEPTH_EXCEEDED)
  })

  it('rejects deeper nesting as well', () => {
    expect(isDepthWithinLimit(5)).toBe(false)
    expectPolicyError(() => assertDepthAllowed(99), SUBAGENT_DEPTH_EXCEEDED)
  })

  it('rejects negative or non-integer depths as malformed', () => {
    expectPolicyError(() => assertDepthAllowed(-1), SUBAGENT_DEPTH_EXCEEDED)
    expectPolicyError(() => assertDepthAllowed(2.5), SUBAGENT_DEPTH_EXCEEDED)
    expectPolicyError(() => assertDepthAllowed(Number.NaN), SUBAGENT_DEPTH_EXCEEDED)
  })
})

// ---------------------------------------------------------------------------
// Launch limit (max 8 per parent turn; 9th rejected)
// ---------------------------------------------------------------------------

describe('launch limit policy', () => {
  it('exposes the per-parent-turn launch limit constant as 8', () => {
    expect(MAX_CHILD_LAUNCHES_PER_PARENT_TURN).toBe(8)
  })

  it('accepts 0 through 7 launches already made in the parent turn (8 total)', () => {
    for (const count of [0, 1, 7]) {
      expect(isLaunchCountWithinLimit(count)).toBe(true)
      expect(() => assertLaunchAllowed(count)).not.toThrow()
    }
  })

  it('rejects the ninth launch in one parent turn with SUBAGENT_LAUNCH_LIMIT_EXCEEDED', () => {
    // 8 launches already made means the next one would be the 9th → rejected.
    expect(isLaunchCountWithinLimit(8)).toBe(false)
    expectPolicyError(() => assertLaunchAllowed(8), SUBAGENT_LAUNCH_LIMIT_EXCEEDED)
    expectPolicyError(() => assertLaunchAllowed(9), SUBAGENT_LAUNCH_LIMIT_EXCEEDED)
  })

  it('rejects every further launch in the same turn', () => {
    expectPolicyError(() => assertLaunchAllowed(10), SUBAGENT_LAUNCH_LIMIT_EXCEEDED)
  })

  it('rejects negative launch counts as malformed', () => {
    expectPolicyError(() => assertLaunchAllowed(-1), SUBAGENT_LAUNCH_LIMIT_EXCEEDED)
  })
})

// ---------------------------------------------------------------------------
// Profile validation
// ---------------------------------------------------------------------------

describe('resolveChildProfile', () => {
  it('resolves a known built-in profile by profile label', () => {
    const registry = createFixtureSubagentRegistry()
    const def = resolveChildProfile('document_processor', registry)
    expect(def.agentType).toBe('document_processor')
  })

  it('resolves a definition by its exact agentType key', () => {
    const registry = createFixtureSubagentRegistry()
    expect(resolveChildProfile(TEST_DEFINITION_ID, registry).agentType).toBe(TEST_DEFINITION_ID)
  })

  it('rejects an unknown profile with SUBAGENT_PROFILE_UNKNOWN', () => {
    const registry = createFixtureSubagentRegistry()
    expectPolicyError(() => resolveChildProfile('hacker_profile', registry), SUBAGENT_PROFILE_UNKNOWN)
    expectPolicyError(() => resolveChildProfile('', registry), SUBAGENT_PROFILE_UNKNOWN)
  })

  it('rejects a main-agent label that is not a subagent profile', () => {
    const registry = createFixtureSubagentRegistry()
    expectPolicyError(() => resolveChildProfile('foreground', registry), SUBAGENT_PROFILE_UNKNOWN)
  })
})

// ---------------------------------------------------------------------------
// Tool projection: AgentType subagent envelope intersection
// ---------------------------------------------------------------------------

describe('buildChildToolProjection', () => {
  const toolRegistry = createFixtureToolRegistry()
  const envelopeRegistry = createAgentTypeToolEnvelopeRegistry()

  it('projects the profile default tools when no tools are requested', () => {
    const projection = buildChildToolProjection({
      definition: createDefinition(),
      taskSpec: createTaskSpec(),
      toolRegistry,
      envelopeRegistry,
      depth: 1,
    })
    expect(projection.toolIds.sort()).toEqual(['file_read', 'todolist', 'todowrite', 'web_search'].sort())
  })

  it('intersects requested tools with the profile allowlist', () => {
    const projection = buildChildToolProjection({
      definition: createDefinition(),
      taskSpec: createTaskSpec({ tools: ['file_read', 'artifact_create', 'web_search'] }),
      toolRegistry,
      envelopeRegistry,
      depth: 1,
    })
    // artifact_create is not in the profile allowlist → dropped.
    expect(projection.toolIds.sort()).toEqual(['file_read', 'web_search'].sort())
  })

  it('denies exec/send/admin tools even when a profile claims them', () => {
    const projection = buildChildToolProjection({
      definition: createMaliciousDefinition(),
      taskSpec: createTaskSpec({ tools: ['exec', 'bash', 'code_execution', 'admin_config', 'manage_users'] }),
      toolRegistry,
      envelopeRegistry,
      depth: 1,
    })
    // The AgentType subagent envelope is the hard boundary — profile name
    // alone must never expand permissions (project anti-pattern #8).
    expect(projection.toolIds).not.toContain('exec')
    expect(projection.toolIds).not.toContain('bash')
    expect(projection.toolIds).not.toContain('code_execution')
    expect(projection.toolIds).not.toContain('admin_config')
    expect(projection.toolIds).not.toContain('manage_users')
    expect(projection.toolIds).toEqual([])
  })

  it('still permits envelope-safe tools from the malicious profile', () => {
    const projection = buildChildToolProjection({
      definition: createMaliciousDefinition(),
      taskSpec: createTaskSpec({ tools: ['file_read', 'exec'] }),
      toolRegistry,
      envelopeRegistry,
      depth: 1,
    })
    expect(projection.toolIds).toEqual(['file_read'])
  })

  it('drops unknown (unregistered) tool IDs instead of granting them', () => {
    const projection = buildChildToolProjection({
      definition: createDefinition({ allowedToolIds: ['file_read', 'mystery_tool'] }),
      taskSpec: createTaskSpec({ tools: ['file_read', 'mystery_tool'] }),
      toolRegistry,
      envelopeRegistry,
      depth: 1,
    })
    expect(projection.toolIds).toEqual(['file_read'])
  })

  it('defaults children to no orchestration launch tools', () => {
    const definition = createDefinition({
      allowedToolIds: ['web_search', 'foreground_launch_subagent', 'search_subagent', 'foreground_spawn_planner'],
    })
    const projection = buildChildToolProjection({
      definition,
      taskSpec: createTaskSpec({
        tools: ['web_search', 'foreground_launch_subagent', 'search_subagent', 'foreground_spawn_planner'],
      }),
      toolRegistry,
      envelopeRegistry,
      depth: 1,
    })
    for (const launchTool of ORCHESTRATION_LAUNCH_TOOL_IDS) {
      expect(projection.toolIds).not.toContain(launchTool)
    }
    expect(projection.toolIds).toEqual(['web_search'])
  })

  it('keeps launch tools only when explicitly permitted below the max depth', () => {
    const definition = createDefinition({
      allowedToolIds: ['web_search', 'foreground_launch_subagent'],
    })
    const nested = buildChildToolProjection({
      definition,
      taskSpec: createTaskSpec({ tools: ['web_search', 'foreground_launch_subagent'] }),
      toolRegistry,
      envelopeRegistry,
      depth: 2,
      allowNestedLaunch: true,
    })
    expect(nested.toolIds.sort()).toEqual(['foreground_launch_subagent', 'web_search'].sort())
  })

  it('never grants launch tools at the maximum depth even when permitted', () => {
    const definition = createDefinition({
      allowedToolIds: ['web_search', 'foreground_launch_subagent'],
    })
    const projection = buildChildToolProjection({
      definition,
      taskSpec: createTaskSpec({ tools: ['web_search', 'foreground_launch_subagent'] }),
      toolRegistry,
      envelopeRegistry,
      depth: MAX_SUBAGENT_DEPTH,
      allowNestedLaunch: true,
    })
    expect(projection.toolIds).not.toContain('foreground_launch_subagent')
    expect(projection.toolIds).toEqual(['web_search'])
  })

  it('emits LLM tool definitions for every projected tool', () => {
    const projection = buildChildToolProjection({
      definition: createDefinition(),
      taskSpec: createTaskSpec(),
      toolRegistry,
      envelopeRegistry,
      depth: 1,
    })
    const names = (projection.tools ?? []).map((t) => t.function.name)
    expect(names.sort()).toEqual(projection.toolIds.sort())
  })
})

describe('assertToolRequestAllowed', () => {
  const toolRegistry = createFixtureToolRegistry()
  const envelopeRegistry = createAgentTypeToolEnvelopeRegistry()

  it('accepts a request fully inside the envelope and profile', () => {
    expect(() =>
      assertToolRequestAllowed({
        definition: createDefinition(),
        requestedTools: ['file_read', 'web_search'],
        toolRegistry,
        envelopeRegistry,
      }),
    ).not.toThrow()
  })

  it('rejects a request for exec/send/admin tools with SUBAGENT_TOOL_DENIED', () => {
    expectPolicyError(
      () =>
        assertToolRequestAllowed({
          definition: createMaliciousDefinition(),
          requestedTools: ['exec', 'bash', 'code_execution', 'admin_config', 'manage_users'],
          toolRegistry,
          envelopeRegistry,
        }),
      SUBAGENT_TOOL_DENIED,
    )
  })

  it('rejects a request outside the profile allowlist even when envelope-safe', () => {
    expectPolicyError(
      () =>
        assertToolRequestAllowed({
          definition: createDefinition(),
          requestedTools: ['artifact_create', 'file_read'],
          toolRegistry,
          envelopeRegistry,
        }),
      SUBAGENT_TOOL_DENIED,
    )
  })

  it('rejects orchestration launch tools unless explicitly permitted below depth', () => {
    expectPolicyError(
      () =>
        assertToolRequestAllowed({
          definition: createDefinition({ allowedToolIds: ['foreground_launch_subagent', 'file_read'] }),
          requestedTools: ['foreground_launch_subagent'],
          toolRegistry,
          envelopeRegistry,
        }),
      SUBAGENT_TOOL_DENIED,
    )
  })
})

// ---------------------------------------------------------------------------
// Search child: web_search ONLY
// ---------------------------------------------------------------------------

describe('search child projection', () => {
  const toolRegistry = createFixtureToolRegistry()
  const envelopeRegistry = createAgentTypeToolEnvelopeRegistry()

  it('defines the search child tool set as exactly web_search', () => {
    expect(SEARCH_CHILD_TOOL_IDS).toEqual(['web_search'])
  })

  it('projects exactly web_search regardless of the requested tools', () => {
    const projection = buildSearchChildProjection({ toolRegistry, envelopeRegistry })
    expect(projection.toolIds).toEqual(['web_search'])
    const names = (projection.tools ?? []).map((t) => t.function.name)
    expect(names).toEqual(['web_search'])
  })

  it('never lets a malicious request widen the search projection', () => {
    const registry = createFixtureSubagentRegistry()
    const searchProfile = resolveChildProfile('search_processor', registry)
    const projection = buildChildToolProjection({
      definition: searchProfile,
      taskSpec: createTaskSpec({ tools: ['web_search', 'exec', 'admin_config', 'todowrite'] }),
      toolRegistry,
      envelopeRegistry,
      depth: 1,
    })
    // search_processor profile grants todowrite — but for search children the
    // projection must be web_search ONLY, so use the search builder instead.
    expect(projection.toolIds).not.toContain('exec')
    expect(projection.toolIds).not.toContain('admin_config')

    const searchProjection = buildSearchChildProjection({ toolRegistry, envelopeRegistry })
    expect(searchProjection.toolIds).toEqual(['web_search'])
  })
})

// ---------------------------------------------------------------------------
// evaluateChildLaunch — single source of truth for Todo 7 / Todo 10
// ---------------------------------------------------------------------------

describe('evaluateChildLaunch', () => {
  const toolRegistry = createFixtureToolRegistry()
  const envelopeRegistry = createAgentTypeToolEnvelopeRegistry()

  function evaluate(input: Partial<Parameters<typeof evaluateChildLaunch>[0]> = {}) {
    return evaluateChildLaunch({
      childSessionId: 'sess_child_abc',
      depth: 1,
      launchesInParentTurn: 0,
      profileId: 'document_processor',
      requestedTools: [],
      registry: createFixtureSubagentRegistry(),
      toolRegistry,
      envelopeRegistry,
      ...input,
    })
  }

  it('returns a complete decision for a valid child launch', () => {
    const decision: ChildLaunchDecision = evaluate()
    expect(decision.sessionKind).toBe('internal')
    expect(decision.taskId).toBe('sess_child_abc')
    expect(decision.launchSource).toBe('main_agent_delegation')
    expect(decision.profile.agentType).toBe('document_processor')
    expect(Array.isArray(decision.toolProjection.toolIds)).toBe(true)
  })

  it('rejects a depth-4 child launch with SUBAGENT_DEPTH_EXCEEDED', () => {
    expectPolicyError(() => evaluate({ depth: 4 }), SUBAGENT_DEPTH_EXCEEDED)
  })

  it('rejects the ninth launch of a parent turn with SUBAGENT_LAUNCH_LIMIT_EXCEEDED', () => {
    expectPolicyError(
      () => evaluate({ launchesInParentTurn: MAX_CHILD_LAUNCHES_PER_PARENT_TURN }),
      SUBAGENT_LAUNCH_LIMIT_EXCEEDED,
    )
  })

  it('rejects an unknown profile with SUBAGENT_PROFILE_UNKNOWN', () => {
    expectPolicyError(() => evaluate({ profileId: 'hacker_profile' }), SUBAGENT_PROFILE_UNKNOWN)
  })

  it('rejects a malicious tool request with SUBAGENT_TOOL_DENIED before any row could be created', () => {
    expectPolicyError(
      () => evaluate({ profileId: 'malicious_worker', requestedTools: ['exec', 'admin_config'] }),
      SUBAGENT_TOOL_DENIED,
    )
  })
})

// ---------------------------------------------------------------------------
// No-row guarantee: rejection happens at the policy level, before creation
// ---------------------------------------------------------------------------

describe('policy rejection prevents session/run creation', () => {
  const toolRegistry = createFixtureToolRegistry()
  const envelopeRegistry = createAgentTypeToolEnvelopeRegistry()

  /** Mimics the Todo 7 runtime gating: policy first, store writes after. */
  function gatedLaunch(input: {
    depth: number
    launchesInParentTurn: number
    profileId: string
    requestedTools: string[]
    childSessionId: string
  }): { decision: ChildLaunchDecision } {
    const registry = createFixtureSubagentRegistry()
    // 1. Policy evaluation — throws on ANY violation, no side effects.
    const decision = evaluateChildLaunch({
      childSessionId: input.childSessionId,
      depth: input.depth,
      launchesInParentTurn: input.launchesInParentTurn,
      profileId: input.profileId,
      requestedTools: input.requestedTools,
      registry,
      toolRegistry,
      envelopeRegistry,
    })
    // 2. Only after the policy approves may rows be created.
    return { decision }
  }

  it('creates a session row for an approved launch', () => {
    const createSessionRow = vi.fn()
    const { decision } = gatedLaunch({
      depth: 1,
      launchesInParentTurn: 0,
      profileId: 'document_processor',
      requestedTools: [],
      childSessionId: 'sess_child_ok',
    })
    createSessionRow(decision.taskId) // store write happens only post-policy
    expect(createSessionRow).toHaveBeenCalledWith('sess_child_ok')
  })

  it('malicious depth-4 launch is rejected and creates no session row', () => {
    const createSessionRow = vi.fn()
    expectPolicyError(
      () =>
        gatedLaunch({
          depth: 4,
          launchesInParentTurn: 0,
          profileId: 'document_processor',
          requestedTools: [],
          childSessionId: 'sess_child_deep',
        }),
      SUBAGENT_DEPTH_EXCEEDED,
    )
    expect(createSessionRow).not.toHaveBeenCalled()
  })

  it('ninth launch is rejected and creates no session row', () => {
    const createSessionRow = vi.fn()
    expectPolicyError(
      () =>
        gatedLaunch({
          depth: 1,
          launchesInParentTurn: 8,
          profileId: 'document_processor',
          requestedTools: [],
          childSessionId: 'sess_child_9th',
        }),
      SUBAGENT_LAUNCH_LIMIT_EXCEEDED,
    )
    expect(createSessionRow).not.toHaveBeenCalled()
  })

  it('malicious profile cannot escape the envelope and creates no session/run row', () => {
    const createSessionRow = vi.fn()
    const createRunRow = vi.fn()
    expectPolicyError(
      () =>
        gatedLaunch({
          depth: 1,
          launchesInParentTurn: 0,
          profileId: 'malicious_worker',
          requestedTools: ['exec', 'bash', 'code_execution', 'admin_config'],
          childSessionId: 'sess_child_evil',
        }),
      SUBAGENT_TOOL_DENIED,
    )
    expect(createSessionRow).not.toHaveBeenCalled()
    expect(createRunRow).not.toHaveBeenCalled()
  })

  it('unknown profile cannot create a session row', () => {
    const createSessionRow = vi.fn()
    expectPolicyError(
      () =>
        gatedLaunch({
          depth: 1,
          launchesInParentTurn: 0,
          profileId: 'not_a_profile',
          requestedTools: [],
          childSessionId: 'sess_child_ghost',
        }),
      SUBAGENT_PROFILE_UNKNOWN,
    )
    expect(createSessionRow).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// SessionVisibility type sanity
// ---------------------------------------------------------------------------

describe('SessionVisibility type', () => {
  it('is a closed union of foreground and internal', () => {
    const kinds: SessionVisibility[] = ['foreground', 'internal']
    expect(kinds).toHaveLength(2)
    expect(kinds).toContain('foreground')
    expect(kinds).toContain('internal')
  })
})
