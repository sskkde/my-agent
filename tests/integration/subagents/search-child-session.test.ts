/**
 * Search Child Session — integration tests (Todo 16 of opencode-like-subagent-sessions).
 *
 * Proves the `search_subagent` tool runs through a SPECIALIZED search child
 * runner behind ChildSessionTaskRuntime while keeping every public contract:
 *
 *   - a tenant/user-owned SEARCH child session + subagent_runs attempt exist
 *   - the parent (tool caller) receives the UNCHANGED `SearchSubagentToolResult`
 *     evidence shape (deep-equal against the legacy synchronous path)
 *   - the child timeline records the search phases (phase1 / backend_search /
 *     phase2) plus safe backend errors — never raw provider bodies/CAPTCHA/stack
 *   - search-only permission holds: the child projection is exactly ['web_search']
 *   - taskId resumes the same search child session history (new run attempt)
 *   - timeout / backend-failure / invalid-tool-call are typed safe and
 *     recoverable where appropriate, with no orphan run
 *
 * The two-phase executor (createSearchSubagent) is exercised end to end with a
 * scripted LLM provider; the harness wires a real ChildSessionTaskRuntime with
 * the specialized search runner.
 */

import { describe, it, expect, afterEach, vi } from 'vitest'
import { createConnectionManager, type ConnectionManager } from '../../../src/storage/connection.js'
import { createMigrationRunner } from '../../../src/storage/migrations.js'
import { allStoreMigrations } from '../../../src/storage/all-stores-migrations.js'
import { createSessionStore, type SessionStore } from '../../../src/storage/session-store.js'
import { createSubagentRunStore, type SubagentRunStore } from '../../../src/storage/subagent-run-store.js'
import {
  createSubagentTranscriptStore,
  type SubagentTranscriptStore,
} from '../../../src/storage/subagent-transcript-store.js'
import { createSubagentRegistry } from '../../../src/subagents/registry.js'
import { registerBuiltInSubagents } from '../../../src/subagents/builtin-definitions.js'
import { createToolRegistry } from '../../../src/tools/tool-registry.js'
import type { ToolDefinition, ToolCategory } from '../../../src/tools/types.js'
import { createAgentTypeToolEnvelopeRegistry } from '../../../src/permissions/agent-type-tool-envelope.js'
import {
  createChildSessionTaskRuntime,
  type ChildSessionTaskRuntime,
} from '../../../src/subagents/child-session-task-runtime.js'
import { buildSearchChildProjection, SEARCH_CHILD_PROFILE_ID } from '../../../src/subagents/child-task-policy.js'
import {
  createSearchChildSessionRunner,
  createSearchPhaseRecorder,
  SEARCH_TIMEOUT,
  SEARCH_BACKEND_ERROR,
  SEARCH_EXECUTION_ERROR,
} from '../../../src/search/search-child-runner.js'
import { createSearchSubagent } from '../../../src/search/search-subagent.js'
import { DEGRADED_ANSWER } from '../../../src/search/search-answer-phase.js'
import type { SearchSubagentInput } from '../../../src/search/search-subagent.js'
import type { BuiltModelInput, ModelInputBuildInput } from '../../../src/kernel/model-input/model-input-types.js'
import type { ModelInputBuilder } from '../../../src/kernel/model-input/model-input-builder.js'
import {
  handleSearchSubagentTool,
  DefaultSearchQueryPlanner,
  DefaultSearchResultNormalizer,
  type SearchSubagentToolDeps,
  type SearchSubagentToolInput,
} from '../../../src/search/search-subagent-tool.js'
import { assertSearchScope } from '../../../src/search/search-subagent-types.js'
import { MULTI_ROUND_SEARCH_POLICY, type SearchRoundPolicy } from '../../../src/search/search-round-budget.js'
import { DEFAULT_TENANT_ID } from '../../../src/tenancy/tenant-context.js'
import type { SearchSubagentToolResult, SearchPlanHints } from '../../../src/search/search-subagent-types.js'
import type { WebSearchResult } from '../../../src/search/types.js'
import type { LLMRequest } from '../../../src/llm/types.js'

const QUERY = 'what is the weather in Tokyo today'

/**
 * Multi-round policy with enlarged phase2/handoff reserves so a short
 * integration budget keeps a wide deterministic margin between the controller's
 * internal deadlines and the child-run wait budget (avoiding wall-clock flakiness
 * in the partial-success / zero-evidence scenarios).
 */
const PARTIAL_BUDGET_POLICY: SearchRoundPolicy = {
  maxRounds: 3,
  maxReplans: 2,
  phase2ReserveMs: 20_000,
  handoffReserveMs: 10_000,
}

// ---------------------------------------------------------------------------
// Scripted two-phase search provider — queue based; never throws on empty.
// ---------------------------------------------------------------------------

interface ScriptedResponse {
  content?: string
  toolCalls?: Array<{ id: string; name: string; arguments: string }>
  delayMs?: number
  /** When set, the completion returns a typed failure (e.g. a forced tool-choice retry). */
  fail?: { code: string; message: string }
}

class ScriptedSearchProvider {
  readonly queue: ScriptedResponse[] = []
  readonly requests: LLMRequest[] = []
  private readonly inFlightDelays: Array<Promise<void>> = []

  enqueue(entry: ScriptedResponse): void {
    this.queue.push(entry)
  }

  get hasPending(): boolean {
    return this.queue.length > 0
  }

  /** Await every scheduled delayed completion so abandoned provider promises settle benignly. */
  async flush(): Promise<void> {
    const pending = this.inFlightDelays.splice(0)
    await Promise.allSettled(pending)
  }

  getProviderCapabilities(): { supportsFunctionCalling: boolean } {
    return { supportsFunctionCalling: true }
  }

  async complete(request: LLMRequest): Promise<{
    success: boolean
    response?: {
      id: string
      model: string
      content: string
      toolCalls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>
      finishReason: string
    }
    error?: { code: string; message: string }
  }> {
    this.requests.push(request)
    const next = this.queue.shift()
    if (!next) {
      // Benign default — an abandoned post-cancel chain must never reject.
      return {
        success: true,
        response: { id: `mock-${this.requests.length}`, model: request.model, content: '', finishReason: 'stop' },
      }
    }
    if (next.fail) {
      return { success: false, error: next.fail }
    }
    if (next.delayMs && next.delayMs > 0) {
      const delay = new Promise<void>((resolve) => setTimeout(resolve, next.delayMs))
      this.inFlightDelays.push(delay)
      await delay
    }
    return {
      success: true,
      response: {
        id: `mock-${this.requests.length}`,
        model: request.model,
        content: next.content ?? '',
        finishReason: next.toolCalls && next.toolCalls.length > 0 ? 'tool_calls' : 'stop',
        ...(next.toolCalls && next.toolCalls.length > 0
          ? {
              toolCalls: next.toolCalls.map((tc) => ({
                id: tc.id,
                type: 'function' as const,
                function: { name: tc.name, arguments: tc.arguments },
              })),
            }
          : {}),
      },
    }
  }
}

// ---------------------------------------------------------------------------
// Model input builder fixture (segment-stable, mirrors the unit-test builder).
// ---------------------------------------------------------------------------

interface MockModelInputBuilder extends ModelInputBuilder {
  /** Every model-input build captured in order: round function_calling builds + the final structured_json build. */
  buildInputs: ModelInputBuildInput[]
}

function createMockModelInputBuilder(): MockModelInputBuilder {
  const messages: Array<{ role: 'system' | 'user'; content: string }> = []
  const buildInputs: ModelInputBuildInput[] = []
  return {
    buildInputs,
    build: async (input: ModelInputBuildInput): Promise<BuiltModelInput> => {
      buildInputs.push(input)
      messages.length = 0
      if (input.mode === 'function_calling') {
        messages.push({ role: 'system', content: 'You are a search assistant. Use the web_search tool.' })
      } else {
        messages.push({ role: 'system', content: 'You are a search assistant. Provide a helpful answer.' })
      }
      // Segment D dynamic context (round feedback / phase-2 evidence) is rendered
      // as trailing user messages so the scripted provider request carries it too.
      for (const item of input.contextBundle?.orderedItems ?? []) {
        messages.push({ role: 'user', content: `[${item.itemId}] ${item.content}` })
      }
      if (input.currentUserMessage) {
        messages.push({ role: 'user', content: input.currentUserMessage })
      }
      return {
        messages: [...messages],
        segments: {
          staticPrefix: 'platform-base',
          tenantProject: '',
          toolPlane: input.toolProjection ? `Tools: ${input.toolProjection.toolIds.join(', ')}` : '',
          contextBundle: input.currentUserMessage || '',
        },
        segmentHashes: {
          segmentA: 'a'.repeat(64),
          segmentB: 'b'.repeat(64),
          segmentC: 'c'.repeat(64),
          segmentD: 'd'.repeat(64),
        },
        metadata: {
          mode: input.mode as 'structured_json' | 'function_calling',
          agentKind: input.agentKind ?? 'kernel',
          agentType: input.agentType ?? 'main',
          agentProfile: input.agentProfile ?? 'default',
          providerFamily: input.providerFamily,
          messageCount: messages.length,
        },
      }
    },
  } as unknown as MockModelInputBuilder
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const connections: ConnectionManager[] = []

function openMemoryConnection(): ConnectionManager {
  const connection = createConnectionManager(':memory:')
  connection.open()
  connections.push(connection)
  return connection
}

function applyAll(connection: ConnectionManager): void {
  const runner = createMigrationRunner(connection)
  runner.init()
  runner.apply(allStoreMigrations)
}

function registerFixtureTool(
  registry: ReturnType<typeof createToolRegistry>,
  name: string,
  category: ToolCategory,
): void {
  const tool: ToolDefinition = {
    name,
    description: `Fixture tool ${name}`,
    category,
    sensitivity: 'medium',
    schema: { type: 'object', properties: {}, additionalProperties: true },
    handler: () => ({ success: true, data: {} }),
  }
  registry.register(tool)
}

interface Harness {
  sessionStore: SessionStore
  runStore: SubagentRunStore
  transcriptStore: SubagentTranscriptStore
  runtime: ChildSessionTaskRuntime
  provider: ScriptedSearchProvider
  deps: SearchSubagentToolDeps
  webSearchExecutor: ReturnType<typeof import('vitest').vi.fn>
  childToolProjection: string[]
  recorder: ReturnType<typeof createSearchPhaseRecorder>
  modelInputBuilder: ReturnType<typeof createMockModelInputBuilder>
}

function createHarness(options: { remainingTimeoutMs: number; roundPolicy?: SearchRoundPolicy }): Harness {
  const connection = openMemoryConnection()
  applyAll(connection)

  const sessionStore = createSessionStore(connection)
  const runStore = createSubagentRunStore(connection)
  const transcriptStore = createSubagentTranscriptStore(connection)

  sessionStore.create({ sessionId: 'sess_parent', userId: 'user_A', title: 'Parent' })

  const toolRegistry = createToolRegistry()
  registerFixtureTool(toolRegistry, 'web_search', 'search')
  registerFixtureTool(toolRegistry, 'todolist', 'read')

  const subagentRegistry = createSubagentRegistry()
  registerBuiltInSubagents(subagentRegistry)

  const envelopeRegistry = createAgentTypeToolEnvelopeRegistry()

  const provider = new ScriptedSearchProvider()
  const webSearchExecutor = vi.fn()
  const modelInputBuilder = createMockModelInputBuilder()
  webSearchExecutor.mockResolvedValue({
    success: true,
    query: QUERY,
    results: [
      { title: 'Tokyo Weather', url: 'https://weather.com/tokyo', snippet: 'Current temperature is 22°C' },
      { title: 'Tokyo Forecast', url: 'https://forecast.io/tokyo', snippet: 'Sunny with highs of 25°C' },
    ],
    total: 2,
    provider: 'searxng',
    endpointHost: 'localhost:8888',
  })

  // Specialized search runner wired into the real child-session runtime.
  const recorder = createSearchPhaseRecorder(transcriptStore)
  const searchSubagent = createSearchSubagent({
    llmAdapter: provider,
    webSearchExecutor: webSearchExecutor as unknown as (params: {
      query: string
    }) => Promise<WebSearchResult & { success: boolean }>,
    modelInputBuilder,
    providerFamily: 'openai',
    searchLlmProviderId: 'provider-search',
    searchLlmModel: 'gpt-4.1-mini',
    phaseObserver: recorder.observe,
    ...(options.roundPolicy !== undefined ? { roundPolicy: options.roundPolicy } : {}),
  })
  const searchRunner = createSearchChildSessionRunner({ searchSubagent, recorder })

  const runtime = createChildSessionTaskRuntime({
    sessionStore,
    runStore,
    transcriptStore,
    kernelAdapter: {
      execute: async () => {
        throw new Error('generic kernel adapter must not execute search children')
      },
    },
    registry: subagentRegistry,
    toolRegistry,
    envelopeRegistry,
    defaultMaxIterations: 10,
    defaultTimeoutMs: 60000,
    searchRunner,
  })

  const deps: SearchSubagentToolDeps = {
    searchSubagent,
    queryPlanner: new DefaultSearchQueryPlanner(),
    resultNormalizer: new DefaultSearchResultNormalizer(),
    scopeGuard: assertSearchScope,
    childSessionTaskRuntime: runtime,
    sessionStore,
    subagentRunStore: runStore,
    childTaskRemainingTimeoutMs: options.remainingTimeoutMs,
  }

  const childToolProjection = buildSearchChildProjection({ toolRegistry, envelopeRegistry }).toolIds

  return {
    sessionStore,
    runStore,
    transcriptStore,
    runtime,
    provider,
    deps,
    webSearchExecutor,
    childToolProjection,
    recorder,
    modelInputBuilder,
  }
}

function searchInput(overrides: Partial<SearchSubagentToolInput> = {}): SearchSubagentToolInput {
  return { originalQuestion: QUERY, intent: 'weather' as const, freshnessRequired: true, ...overrides }
}

const IDENTITY = { userId: 'user_A', sessionId: 'sess_parent', turnId: 'krun_parent' }

async function runSearchTool(
  h: Harness,
  input: SearchSubagentToolInput = searchInput(),
): Promise<SearchSubagentToolResult> {
  const result = await handleSearchSubagentTool(h.deps, input, IDENTITY)
  if (!result.success || !result.data) {
    throw new Error(`expected search success, got: ${JSON.stringify(result.error ?? result)}`)
  }
  return result.data
}

async function expectSearchError(
  h: Harness,
  input: SearchSubagentToolInput = searchInput(),
): Promise<{ code: string; message: string; recoverable: boolean }> {
  const result = await handleSearchSubagentTool(h.deps, input, IDENTITY)
  if (result.success) {
    throw new Error('expected search failure')
  }
  return { code: result.error!.code, message: result.error!.message, recoverable: result.error!.recoverable }
}

afterEach(() => {
  while (connections.length > 0) {
    connections.pop()?.close()
  }
})

describe('search_subagent runs inside a search child session (Todo 16)', () => {
  describe('happy path — child session + unchanged evidence + phase timeline', () => {
    it(
      'creates a search child session/run, returns the byte-compatible SearchSubagentToolResult and records search phases on the child timeline',
      { timeout: 20000 },
      async () => {
        const h = createHarness({ remainingTimeoutMs: 60000 })

        h.provider.enqueue({
          toolCalls: [
            { id: 'tc_phase1', name: 'web_search', arguments: JSON.stringify({ query: 'tokyo weather today' }) },
          ],
        })
        h.provider.enqueue({ content: 'Tokyo is 22°C and sunny today.' })

        const data = await runSearchTool(h)

        // ---- Byte-compatible evidence shape (SearchSubagentToolResult).
        expect(data.originalQuestion).toBe(QUERY)
        expect(typeof data.searchQuery).toBe('string')
        expect(data.results.length).toBeGreaterThan(0)
        expect(Array.isArray(data.extractedFacts)).toBe(true)
        expect(Array.isArray(data.warnings)).toBe(true)
        expect(data.queryPlan).toBeDefined()
        expect(data.metadata.resultCount).toBe(data.results.length)
        expect(data).not.toHaveProperty('finalAnswer')
        expect(data).not.toHaveProperty('userVisibleResponse')

        // ---- A search child session + one run attempt exist.
        const runs = h.runStore.query({})
        expect(runs).toHaveLength(1)
        const run = runs[0]!
        expect(run.status).toBe('completed')
        expect(run.childSessionId).toBeDefined()
        expect(run.taskId).toBe(run.childSessionId)
        expect(run.agentProfile).toBe(SEARCH_CHILD_PROFILE_ID)

        const child = h.sessionStore.getChildSessionById(run.childSessionId!)
        expect(child).toBeDefined()
        expect(child!.sessionKind).toBe('subagent')
        expect(child!.parentSessionId).toBe('sess_parent')
        expect(child!.userId).toBe('user_A')
        expect(child!.taskId).toBe(child!.sessionId)

        // ---- The run's persisted result carries the raw two-phase evidence.
        const resultJson = JSON.parse(run.resultJson ?? '{}')
        expect(resultJson.structuredResult).toBeDefined()
        expect(resultJson.structuredResult.answer).toBe('Tokyo is 22°C and sunny today.')
        expect(resultJson.structuredResult.toolResult.results.length).toBe(2)

        // ---- Child timeline records the search phases + lifecycle + completed turn.
        const events = h.transcriptStore.getByRunId(run.subagentRunId)
        const eventTypes = events.map((e) => e.eventType)
        expect(eventTypes).toContain('SubagentRunCreated')
        expect(eventTypes).toContain('SubagentRunStarted')
        expect(eventTypes).toContain('SubagentRunCompleted')
        expect(eventTypes).toContain('ChildTurnCompleted')
        const phases = events.filter((e) => e.eventType === 'SearchPhase').map((e) => JSON.parse(e.contentJson).phase)
        expect(phases).toContain('phase1')
        expect(phases).toContain('backend_search')
        expect(phases).toContain('phase2')
        const completedPhase = events.find((e) => e.eventType === 'SearchPhaseCompleted')
        expect(completedPhase).toBeDefined()
        expect(JSON.parse(completedPhase!.contentJson).providerId).toBe('provider-search')
      },
    )

    it(
      'persists optional round/reason/count fields through the best-effort recorder and keeps default phases intact',
      { timeout: 20000 },
      async () => {
        const h = createHarness({ remainingTimeoutMs: 60000 })

        h.provider.enqueue({
          toolCalls: [{ id: 'tc_obs', name: 'web_search', arguments: JSON.stringify({ query: 'tokyo weather' }) }],
        })
        h.provider.enqueue({ content: 'Tokyo is 22°C.' })

        const data = await runSearchTool(h)

        // Default one-round internal counters are produced by the real executor.
        expect(data.metadata.searchCallCount).toBe(1)
        expect(data.metadata).not.toHaveProperty('executedQueries')
        expect(data.metadata.roundCount).toBeUndefined()
        expect(data.metadata.replanCount).toBeUndefined()
        expect(data.metadata.llmCallCount).toBeUndefined()
        expect(data.metadata.stopReason).toBeUndefined()
        expect(data.metadata.budgetExhausted).toBeUndefined()

        const run = h.runStore.query({})[0]!
        const persisted = JSON.parse(run.resultJson ?? '{}')
        expect(persisted.structuredResult.metadata.roundCount).toBe(1)
        expect(persisted.structuredResult.metadata.replanCount).toBe(0)
        expect(persisted.structuredResult.metadata.searchCallCount).toBe(1)
        expect(persisted.structuredResult.metadata.llmCallCount).toBe(2)
        expect(persisted.structuredResult.metadata.executedQueries).toEqual(['tokyo weather'])
        expect(persisted.structuredResult.metadata.stopReason).toBeUndefined()

        // Existing consumers still find the default phases in order.
        const events = h.transcriptStore.getByRunId(run.subagentRunId)
        const phases = events.filter((e) => e.eventType === 'SearchPhase').map((e) => JSON.parse(e.contentJson))
        expect(phases.map((p) => p.phase)).toEqual(['phase1', 'backend_search', 'phase2'])

        // A round-2 evaluation observation with a typed reason persists additively.
        h.recorder.setActive({
          subagentRunId: run.subagentRunId,
          childSessionId: run.childSessionId ?? run.subagentRunId,
          userId: run.userId,
          tenantId: run.tenantId ?? DEFAULT_TENANT_ID,
        })
        h.recorder.observe({
          phase: 'evaluation',
          round: 2,
          replanReason: 'low_diversity',
          roundCount: 2,
          searchCallCount: 2,
          llmCallCount: 4,
        })
        h.recorder.observe({
          phase: 'evaluation',
          round: 3,
          stopReason: 'duplicate_query',
          roundCount: 2,
          searchCallCount: 2,
          llmCallCount: 4,
        })
        h.recorder.setActive(undefined)

        const after = h.transcriptStore.getByRunId(run.subagentRunId)
        const evaluationEvents = after
          .filter((e) => e.eventType === 'SearchPhase')
          .map((e) => JSON.parse(e.contentJson))
          .filter((p) => p.phase === 'evaluation')
        expect(evaluationEvents).toHaveLength(2)
        expect(evaluationEvents[0]).toMatchObject({
          phase: 'evaluation',
          round: 2,
          replanReason: 'low_diversity',
          roundCount: 2,
          searchCallCount: 2,
          llmCallCount: 4,
        })
        expect(evaluationEvents[1]).toMatchObject({
          phase: 'evaluation',
          round: 3,
          stopReason: 'duplicate_query',
          roundCount: 2,
          searchCallCount: 2,
          llmCallCount: 4,
        })
      },
    )

    it(
      'propagates multi-round internal counters into the parent public metadata without executedQueries',
      { timeout: 20000 },
      async () => {
        const h = createHarness({ remainingTimeoutMs: 60000 })

        // A multi-round-style success result produced by the search executor.
        vi.spyOn(h.deps.searchSubagent, 'execute').mockResolvedValue({
          success: true,
          answer: 'Merged answer.',
          toolResult: {
            query: 'tokyo weather',
            results: [
              { title: 'Tokyo Weather', url: 'https://weather.com/tokyo', snippet: 'Current temperature is 22°C' },
              { title: 'Tokyo Weather 2', url: 'https://weather.com/tokyo', snippet: 'Duplicate of the first' },
            ],
            total: 2,
            provider: 'searxng',
            endpointHost: 'localhost:8888',
          },
          metadata: {
            providerId: 'provider-search',
            model: 'gpt-4.1-mini',
            querySource: 'search_subagent',
            durationMs: 120,
            executedQueries: ['tokyo weather', 'tokyo weather forecast'],
            roundCount: 2,
            replanCount: 1,
            searchCallCount: 2,
            llmCallCount: 4,
            stopReason: 'max_rounds',
          },
        })

        const data = await runSearchTool(h)

        // The real counters surface in the parent tool's public metadata.
        expect(data.metadata.searchCallCount).toBe(2)
        expect(data.metadata.roundCount).toBe(2)
        expect(data.metadata.replanCount).toBe(1)
        expect(data.metadata.llmCallCount).toBe(4)
        expect(data.metadata.stopReason).toBe('max_rounds')
        expect(data.metadata).not.toHaveProperty('executedQueries')
        expect(data).not.toHaveProperty('executedQueries')
        expect(data).not.toHaveProperty('finalAnswer')
        expect(data).not.toHaveProperty('userVisibleResponse')

        // Evidence counts still come from the parent post-processing over the final selected data.
        expect(data.results).toHaveLength(1)
        expect(data.metadata.resultCount).toBe(1)
        expect(data.metadata.uniqueSourceCount).toBe(1)
      },
    )

    it('returns the SAME evidence shape as the legacy synchronous path', { timeout: 20000 }, async () => {
      const h = createHarness({ remainingTimeoutMs: 60000 })

      // Child path.
      h.provider.enqueue({
        toolCalls: [{ id: 'tc_1', name: 'web_search', arguments: JSON.stringify({ query: 'tokyo weather today' }) }],
      })
      h.provider.enqueue({ content: 'Tokyo is 22°C.' })
      const childData = await runSearchTool(h)

      // Legacy path (no runtime wired, fresh searchSubagent over the SAME executor).
      const { createSearchSubagent } = await import('../../../src/search/search-subagent.js')
      const legacySubagent = createSearchSubagent({
        llmAdapter: h.provider,
        webSearchExecutor: h.webSearchExecutor as unknown as (params: {
          query: string
        }) => Promise<WebSearchResult & { success: boolean }>,
        modelInputBuilder: createMockModelInputBuilder(),
        providerFamily: 'openai',
        searchLlmProviderId: 'provider-search',
        searchLlmModel: 'gpt-4.1-mini',
      })
      h.provider.enqueue({
        toolCalls: [{ id: 'tc_1', name: 'web_search', arguments: JSON.stringify({ query: 'tokyo weather today' }) }],
      })
      h.provider.enqueue({ content: 'Tokyo is 22°C.' })
      const legacyResult = await handleSearchSubagentTool(
        {
          searchSubagent: legacySubagent,
          queryPlanner: h.deps.queryPlanner,
          resultNormalizer: h.deps.resultNormalizer,
          scopeGuard: assertSearchScope,
        },
        searchInput(),
      )
      if (!legacyResult.success || !legacyResult.data) throw new Error('legacy search failed')

      // Shared evidence fields deep-equal; only durationMs/taskId metadata differ.
      const { durationMs: _cd, taskId: _ct, ...childMeta } = childData.metadata
      const { durationMs: _ld, taskId: _lt, ...legacyMeta } = legacyResult.data.metadata
      void _cd
      void _ct
      void _ld
      void _lt
      expect(childData.originalQuestion).toBe(legacyResult.data.originalQuestion)
      expect(childData.searchQuery).toBe(legacyResult.data.searchQuery)
      expect(childData.intent).toBe(legacyResult.data.intent)
      expect(childData.freshness).toBe(legacyResult.data.freshness)
      expect(childData.results).toEqual(legacyResult.data.results)
      expect(childData.extractedFacts).toEqual(legacyResult.data.extractedFacts)
      expect(childData.warnings).toEqual(legacyResult.data.warnings)
      expect(childData.queryPlan).toEqual(legacyResult.data.queryPlan)
      expect(childMeta).toEqual(legacyMeta)
      // Child path surfaces the resumable taskId additively.
      expect(childData.metadata.taskId).toBeDefined()
    })
  })

  describe('search-only permission + projection', () => {
    it('restricts the search child projection to web_search exactly', { timeout: 20000 }, async () => {
      const h = createHarness({ remainingTimeoutMs: 60000 })

      h.provider.enqueue({
        toolCalls: [{ id: 'tc_p', name: 'web_search', arguments: JSON.stringify({ query: 'tokyo weather' }) }],
      })
      h.provider.enqueue({ content: 'answer' })

      const data = await runSearchTool(h)
      void data

      // Projection used by the search child path is exactly ['web_search'].
      expect(h.childToolProjection).toEqual(['web_search'])

      // The persisted run requests web_search only.
      const run = h.runStore.query({})[0]!
      const taskSpec = JSON.parse(run.taskSpecJson)
      expect(taskSpec.tools).toEqual(['web_search'])
      expect(taskSpec.profileId).toBe(SEARCH_CHILD_PROFILE_ID)
    })
  })

  describe('taskId resume', () => {
    it(
      'resumes the same search child session with a new run attempt and prior child history',
      { timeout: 20000 },
      async () => {
        const h = createHarness({ remainingTimeoutMs: 60000 })

        h.provider.enqueue({
          toolCalls: [{ id: 'tc_r1', name: 'web_search', arguments: JSON.stringify({ query: 'tokyo weather' }) }],
        })
        h.provider.enqueue({ content: 'First search answer.' })
        const first = await runSearchTool(h)
        expect(first.metadata.taskId).toBeDefined()
        const firstChildSessionId = h.runStore.query({})[0]!.childSessionId

        // Resume via taskId — same child session, second run attempt.
        h.provider.enqueue({
          toolCalls: [{ id: 'tc_r2', name: 'web_search', arguments: JSON.stringify({ query: 'tokyo tomorrow' }) }],
        })
        h.provider.enqueue({ content: 'Second search answer.' })
        const second = await runSearchTool(h, searchInput({ taskId: first.metadata.taskId }))

        expect(second.metadata.taskId).toBe(first.metadata.taskId)
        const runs = h.runStore.query({})
        expect(runs).toHaveLength(2)
        const run1 = runs.find((r) => r.status === 'completed' && r.taskId === first.metadata.taskId)
        expect(run1).toBeDefined()
        for (const run of runs) {
          expect(run.childSessionId).toBe(firstChildSessionId)
        }
        // Prior child conversation was persisted before the resume attempt.
        const runIds = runs.map((r) => r.subagentRunId)
        const allEvents = runIds.flatMap((id) => h.transcriptStore.getByRunId(id))
        const priorTurn = allEvents.find(
          (e) => e.eventType === 'ChildTurnCompleted' && e.contentJson.includes('First search answer.'),
        )
        expect(priorTurn).toBeDefined()
        expect(priorTurn!.contentJson).toContain('First search answer.')
      },
    )
  })

  describe('typed search plan hints contract', () => {
    it(
      'carries originalQuestion/intent/freshness/locale/missing context from the parent plan through the real child runtime',
      { timeout: 20000 },
      async () => {
        const h = createHarness({ remainingTimeoutMs: 60000 })
        h.provider.enqueue({
          toolCalls: [{ id: 'tc_h', name: 'web_search', arguments: JSON.stringify({ query: 'tokyo weather today' }) }],
        })
        h.provider.enqueue({ content: 'Tokyo is 22°C and sunny.' })

        const executeSpy = vi.spyOn(h.deps.searchSubagent, 'execute')
        const data = await runSearchTool(h, searchInput({ locale: 'en-US' }))
        void data

        // Persisted: hints ride inside task_spec_json (no schema migration).
        const run = h.runStore.query({})[0]!
        const spec = JSON.parse(run.taskSpecJson) as { searchPlanHints?: SearchPlanHints }
        expect(spec.searchPlanHints).toEqual({
          originalQuestion: QUERY,
          intent: 'weather',
          freshness: true,
          locale: 'en-US',
          missingCriticalContext: [],
        })

        // Runner boundary: normalized hints reach the search executor input.
        const executeInput = executeSpy.mock.calls[0]![0] as SearchSubagentInput & {
          searchPlanHints?: SearchPlanHints
        }
        expect(executeInput.searchPlanHints).toEqual({
          originalQuestion: QUERY,
          intent: 'weather',
          freshness: true,
          locale: 'en-US',
          missingCriticalContext: [],
        })
      },
    )

    it(
      'an old persisted task spec without hints executes with documented fallback and unchanged projection',
      { timeout: 20000 },
      async () => {
        const h = createHarness({ remainingTimeoutMs: 60000 })
        h.sessionStore.createChildSession({
          sessionId: 'sess_legacy_search',
          userId: 'user_A',
          parentSessionId: 'sess_parent',
          agentProfile: SEARCH_CHILD_PROFILE_ID,
          taskId: 'sess_legacy_search',
          launchMode: 'foreground',
          title: 'Legacy search child',
        })
        h.runStore.create({
          subagentRunId: 'subagent-legacy-1',
          userId: 'user_A',
          sessionId: 'sess_legacy_search',
          childSessionId: 'sess_legacy_search',
          taskId: 'sess_legacy_search',
          agentType: 'subagent',
          agentProfile: SEARCH_CHILD_PROFILE_ID,
          status: 'queued',
          taskSpecJson: JSON.stringify({
            objective: 'tokyo weather today',
            profileId: SEARCH_CHILD_PROFILE_ID,
            tools: ['web_search'],
            parentSessionId: 'sess_parent',
            parentTurnId: 'krun_parent',
            launchMode: 'foreground',
            timeoutMs: 60000,
            prompt: 'Search assistant platform instruction.',
          }),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })

        h.provider.enqueue({
          toolCalls: [{ id: 'tc_legacy', name: 'web_search', arguments: JSON.stringify({ query: 'tokyo weather' }) }],
        })
        h.provider.enqueue({ content: 'Legacy answer.' })
        const executeSpy = vi.spyOn(h.deps.searchSubagent, 'execute')

        const result = await h.runtime.executeRun('subagent-legacy-1')
        expect(result.status).toBe('completed')

        const executeInput = executeSpy.mock.calls[0]![0] as SearchSubagentInput & {
          searchPlanHints?: SearchPlanHints
        }
        expect(executeInput.searchPlanHints).toEqual({
          originalQuestion: 'tokyo weather today',
          intent: 'general',
        })
        expect(h.childToolProjection).toEqual(['web_search'])
      },
    )

    it(
      'a malformed persisted hints payload falls back safely and cannot affect tool projection or permissions',
      { timeout: 20000 },
      async () => {
        const h = createHarness({ remainingTimeoutMs: 60000 })
        h.sessionStore.createChildSession({
          sessionId: 'sess_malformed_search',
          userId: 'user_A',
          parentSessionId: 'sess_parent',
          agentProfile: SEARCH_CHILD_PROFILE_ID,
          taskId: 'sess_malformed_search',
          launchMode: 'foreground',
          title: 'Malformed-hints search child',
        })
        h.runStore.create({
          subagentRunId: 'subagent-malformed-1',
          userId: 'user_A',
          sessionId: 'sess_malformed_search',
          childSessionId: 'sess_malformed_search',
          taskId: 'sess_malformed_search',
          agentType: 'subagent',
          agentProfile: SEARCH_CHILD_PROFILE_ID,
          status: 'queued',
          taskSpecJson: JSON.stringify({
            objective: 'malformed query',
            profileId: SEARCH_CHILD_PROFILE_ID,
            tools: ['web_search'],
            parentSessionId: 'sess_parent',
            launchMode: 'foreground',
            timeoutMs: 60000,
            searchPlanHints: { originalQuestion: 42, intent: 'banana', freshness: 'yes', locale: 7 },
          }),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })

        h.provider.enqueue({
          toolCalls: [{ id: 'tc_mal', name: 'web_search', arguments: JSON.stringify({ query: 'malformed' }) }],
        })
        h.provider.enqueue({ content: 'Safe fallback answer.' })
        const executeSpy = vi.spyOn(h.deps.searchSubagent, 'execute')

        const result = await h.runtime.executeRun('subagent-malformed-1')
        expect(result.status).toBe('completed')

        const executeInput = executeSpy.mock.calls[0]![0] as SearchSubagentInput & {
          searchPlanHints?: SearchPlanHints
        }
        expect(executeInput.searchPlanHints).toEqual({
          originalQuestion: 'malformed query',
          intent: 'general',
        })
        expect(h.childToolProjection).toEqual(['web_search'])
      },
    )
  })

  describe('typed safe errors', () => {
    it(
      'maps a backend failure to SEARCH_BACKEND_ERROR (recoverable) and records a safe backend error without raw provider content',
      { timeout: 20000 },
      async () => {
        const h = createHarness({ remainingTimeoutMs: 60000 })
        h.webSearchExecutor.mockResolvedValueOnce({
          success: false,
          query: QUERY,
          results: [],
          total: 0,
          provider: 'none',
          endpointHost: '',
        })

        h.provider.enqueue({
          toolCalls: [{ id: 'tc_b', name: 'web_search', arguments: JSON.stringify({ query: 'tokyo' }) }],
        })
        h.provider.enqueue({ content: 'unused' })

        const err = await expectSearchError(h)
        expect(err.code).toBe(SEARCH_BACKEND_ERROR)
        expect(err.recoverable).toBe(true)
        // No raw provider body / captcha / stack in the surfaced message.
        expect(err.message).not.toMatch(/captcha|searxng.*raw|capture/i)

        const run = h.runStore.query({})[0]!
        const events = h.transcriptStore.getByRunId(run.subagentRunId)
        const backendError = events.find((e) => e.eventType === 'SearchBackendError')
        expect(backendError).toBeDefined()
        expect(JSON.parse(backendError!.contentJson).errorCode).toBe(SEARCH_BACKEND_ERROR)
      },
    )

    it(
      'returns SEARCH_TIMEOUT (recoverable) when the search child exceeds the remaining budget and leaves no orphan run',
      { timeout: 20000 },
      async () => {
        const h = createHarness({ remainingTimeoutMs: 120 })
        h.provider.enqueue({
          toolCalls: [{ id: 'tc_t', name: 'web_search', arguments: JSON.stringify({ query: 'tokyo' }) }],
          delayMs: 5000,
        })

        const err = await expectSearchError(h)
        expect(err.code).toBe(SEARCH_TIMEOUT)
        expect(err.recoverable).toBe(true)

        // cancelRun fired: the child run reaches cancelled — no orphan running row.
        const deadline = Date.now() + 5000
        while (Date.now() < deadline) {
          const run = h.runStore.query({})[0]
          if (run && run.status === 'cancelled') break
          await new Promise((resolve) => setTimeout(resolve, 50))
        }
        const finalRun = h.runStore.query({})[0]!
        expect(finalRun.status).toBe('cancelled')
        const result = JSON.parse(finalRun.resultJson ?? '{}')
        expect(result.status).toBe('cancelled')
      },
    )

    it(
      'maps an invalid model tool call to a typed INVALID_TOOL_CALL failure (non-recoverable) with no backend execution',
      { timeout: 20000 },
      async () => {
        const h = createHarness({ remainingTimeoutMs: 60000 })
        h.provider.enqueue({
          toolCalls: [{ id: 'tc_x', name: 'web_fetch', arguments: JSON.stringify({ url: 'https://example.com' }) }],
        })

        const err = await expectSearchError(h)
        expect(err.code).toBe('INVALID_TOOL_CALL')
        expect(err.recoverable).toBe(false)
        expect(h.webSearchExecutor).not.toHaveBeenCalled()

        const run = h.runStore.query({})[0]!
        const events = h.transcriptStore.getByRunId(run.subagentRunId)
        const failedPhase = events.find((e) => e.eventType === 'SearchPhaseFailed')
        expect(failedPhase).toBeDefined()
        expect(JSON.parse(failedPhase!.contentJson).errorCode).toBe('INVALID_TOOL_CALL')
      },
    )
  })

  describe('real tool calls, iterations, and round timeline (Todo 9)', () => {
    it('keeps one web_search toolCall and iterationsUsed=2 for a normal single round', { timeout: 20000 }, async () => {
      const h = createHarness({ remainingTimeoutMs: 60000 })
      h.provider.enqueue({
        toolCalls: [{ id: 'tc_s1', name: 'web_search', arguments: JSON.stringify({ query: 'tokyo weather' }) }],
      })
      h.provider.enqueue({ content: 'Tokyo is 22°C.' })
      await runSearchTool(h)

      const run = h.runStore.query({})[0]!
      expect(run.status).toBe('completed')
      const persisted = JSON.parse(run.resultJson ?? '{}')
      expect(persisted.toolCalls).toHaveLength(1)
      expect(persisted.toolCalls[0]).toMatchObject({
        toolName: 'web_search',
        params: { query: 'tokyo weather' },
      })
      expect(persisted.iterationsUsed).toBe(2)
    })

    it('counts three LLM calls when the forced tool choice falls back to auto', { timeout: 20000 }, async () => {
      const h = createHarness({ remainingTimeoutMs: 60000 })
      h.provider.enqueue({ fail: { code: 'ALL_PROVIDERS_FAILED', message: 'All providers failed after 1 attempts' } })
      h.provider.enqueue({
        toolCalls: [{ id: 'tc_auto', name: 'web_search', arguments: JSON.stringify({ query: 'tokyo weather' }) }],
      })
      h.provider.enqueue({ content: 'Recovered answer.' })
      await runSearchTool(h)

      const run = h.runStore.query({})[0]!
      const persisted = JSON.parse(run.resultJson ?? '{}')
      expect(persisted.status).toBe('completed')
      expect(persisted.toolCalls).toHaveLength(1)
      expect(persisted.toolCalls[0].params.query).toBe('tokyo weather')
      expect(persisted.structuredResult.metadata.llmCallCount).toBe(3)
      expect(persisted.iterationsUsed).toBe(3)
    })

    it(
      'persists two query toolCalls in order with iterationsUsed equal to the real llmCallCount and round-attributed timeline',
      { timeout: 20000 },
      async () => {
        const h = createHarness({ remainingTimeoutMs: 60000, roundPolicy: MULTI_ROUND_SEARCH_POLICY })
        h.provider.enqueue({
          toolCalls: [
            { id: 'tc_2r1', name: 'web_search', arguments: JSON.stringify({ query: 'tokyo weather today' }) },
          ],
        })
        h.provider.enqueue({
          toolCalls: [
            { id: 'tc_2r2', name: 'web_search', arguments: JSON.stringify({ query: 'tokyo weather forecast' }) },
          ],
        })
        h.provider.enqueue({ content: 'Merged two-round answer.' })
        await runSearchTool(h)

        const run = h.runStore.query({})[0]!
        const persisted = JSON.parse(run.resultJson ?? '{}')
        expect(persisted.status).toBe('completed')
        expect(persisted.toolCalls).toHaveLength(2)
        expect(persisted.toolCalls.map((tc: { params: { query: string } }) => tc.params.query)).toEqual([
          'tokyo weather today',
          'tokyo weather forecast',
        ])
        for (const tc of persisted.toolCalls) {
          expect(tc.toolName).toBe('web_search')
          expect(typeof tc.toolCallId).toBe('string')
        }
        expect(persisted.structuredResult.metadata.executedQueries).toEqual([
          'tokyo weather today',
          'tokyo weather forecast',
        ])
        expect(persisted.iterationsUsed).toBe(3)
        expect(persisted.iterationsUsed).toBe(persisted.structuredResult.metadata.llmCallCount)

        const events = h.transcriptStore.getByRunId(run.subagentRunId)
        const phaseRecords = events.filter((e) => e.eventType === 'SearchPhase').map((e) => JSON.parse(e.contentJson))
        expect(phaseRecords.filter((p) => p.phase === 'phase1').map((p) => p.round)).toEqual([1, 2])
        expect(phaseRecords.filter((p) => p.phase === 'phase2')).toHaveLength(1)
        const completed = events.find((e) => e.eventType === 'SearchPhaseCompleted')
        expect(completed).toBeDefined()
        const completedContent = JSON.parse(completed!.contentJson)
        expect(completedContent.roundCount).toBe(2)
        expect(completedContent.searchCallCount).toBe(2)
        expect(completedContent.llmCallCount).toBe(3)
      },
    )

    it('cannot fail the run when the timeline recorder throws', { timeout: 20000 }, async () => {
      const h = createHarness({ remainingTimeoutMs: 60000 })
      h.provider.enqueue({
        toolCalls: [{ id: 'tc_rf', name: 'web_search', arguments: JSON.stringify({ query: 'tokyo weather' }) }],
      })
      h.provider.enqueue({ content: 'Answer despite recorder failure.' })

      const originalAppend = h.transcriptStore.append.bind(h.transcriptStore)
      vi.spyOn(h.transcriptStore, 'append').mockImplementation((event, tenantId) => {
        if (event.eventType.startsWith('SearchPhase')) {
          throw new Error('recorder storage boom')
        }
        return originalAppend(event, tenantId)
      })

      const data = await runSearchTool(h)
      expect(data.results.length).toBeGreaterThan(0)

      const run = h.runStore.query({})[0]!
      expect(run.status).toBe('completed')
    })
  })

  describe('multi-round end-to-end child scenarios (Todo 13)', () => {
    it(
      'scenario 1: sufficient first round keeps one toolCall, iterationsUsed=2, one phase2 and one-round counters',
      {
        timeout: 20000,
      },
      async () => {
        // Given a multi-round search child with a scripted provider that only
        // plans one round and a backend that returns dated weather evidence.
        const h = createHarness({ remainingTimeoutMs: 60000, roundPolicy: MULTI_ROUND_SEARCH_POLICY })
        h.provider.enqueue({
          toolCalls: [{ id: 'tc_a1', name: 'web_search', arguments: JSON.stringify({ query: 'tokyo weather today' }) }],
        })
        h.provider.enqueue({ content: 'Tokyo is 22°C and sunny.' })

        // When the parent tool runs the search end to end.
        const data = await runSearchTool(h, searchInput({ freshnessRequired: false }))

        // Then the public metadata reports exactly one round with no query leak.
        expect(data.metadata.searchCallCount).toBe(1)
        expect(data.metadata.roundCount).toBe(1)
        expect(data.metadata.replanCount).toBe(0)
        expect(data.metadata.llmCallCount).toBe(2)
        expect(data.metadata.stopReason).toBe('sufficient_evidence')
        expect(data.metadata).not.toHaveProperty('executedQueries')
        expect(data).not.toHaveProperty('executedQueries')
        expect(data).not.toHaveProperty('finalAnswer')

        // And the child run persisted one web_search toolCall + real iterations.
        const run = h.runStore.query({})[0]!
        expect(run.status).toBe('completed')
        const persisted = JSON.parse(run.resultJson ?? '{}')
        expect(persisted.toolCalls).toHaveLength(1)
        expect(persisted.toolCalls[0]).toMatchObject({
          toolName: 'web_search',
          params: { query: 'tokyo weather today' },
        })
        expect(persisted.iterationsUsed).toBe(2)
        expect(persisted.structuredResult.metadata.executedQueries).toEqual(['tokyo weather today'])

        // And the timeline has exactly one phase2 across the single round.
        const events = h.transcriptStore.getByRunId(run.subagentRunId)
        const phaseRecords = events.filter((e) => e.eventType === 'SearchPhase').map((e) => JSON.parse(e.contentJson))
        expect(phaseRecords.filter((p) => p.phase === 'phase2')).toHaveLength(1)
        expect(phaseRecords.filter((p) => p.phase === 'phase1').map((p) => p.round)).toEqual([1])
        expect(phaseRecords.find((p) => p.phase === 'evaluation')).toMatchObject({
          round: 1,
          stopReason: 'sufficient_evidence',
        })
      },
    )

    it(
      'scenario 2+12+11: empty first round replans into a unique second round, merges evidence, carries replan context and one phase2',
      {
        timeout: 20000,
      },
      async () => {
        // Given round 1 returns zero results so the evaluator asks for a replan.
        const h = createHarness({ remainingTimeoutMs: 60000, roundPolicy: MULTI_ROUND_SEARCH_POLICY })
        h.webSearchExecutor.mockResolvedValueOnce({
          success: true,
          query: 'tokyo weather today',
          results: [],
          total: 0,
          provider: 'searxng',
          endpointHost: 'localhost:8888',
        })
        h.provider.enqueue({
          toolCalls: [{ id: 'tc_b1', name: 'web_search', arguments: JSON.stringify({ query: 'tokyo weather today' }) }],
        })
        h.provider.enqueue({
          toolCalls: [
            { id: 'tc_b2', name: 'web_search', arguments: JSON.stringify({ query: 'tokyo weather forecast' }) },
          ],
        })
        h.provider.enqueue({ content: 'Merged two-round answer.' })

        // When the second round's unique query returns useful evidence.
        const data = await runSearchTool(h, searchInput({ freshnessRequired: false }))

        // Then counters + merged selected evidence surface on the parent tool.
        expect(data.metadata.searchCallCount).toBe(2)
        expect(data.metadata.roundCount).toBe(2)
        expect(data.metadata.replanCount).toBe(1)
        expect(data.metadata.llmCallCount).toBe(3)
        expect(data.metadata.stopReason).toBe('sufficient_evidence')
        expect(data.results.length).toBeGreaterThan(0)
        expect(data.metadata.resultCount).toBe(data.results.length)

        // And the child run persisted two ordered web_search toolCalls.
        const run = h.runStore.query({})[0]!
        const persisted = JSON.parse(run.resultJson ?? '{}')
        expect(persisted.toolCalls.map((tc: { params: { query: string } }) => tc.params.query)).toEqual([
          'tokyo weather today',
          'tokyo weather forecast',
        ])
        for (const tc of persisted.toolCalls) {
          expect(tc.toolName).toBe('web_search')
        }
        expect(persisted.structuredResult.metadata.executedQueries).toEqual([
          'tokyo weather today',
          'tokyo weather forecast',
        ])
        expect(persisted.iterationsUsed).toBe(3)

        // And the timeline is ordered with exactly one phase2.
        const events = h.transcriptStore.getByRunId(run.subagentRunId)
        const phaseRecords = events.filter((e) => e.eventType === 'SearchPhase').map((e) => JSON.parse(e.contentJson))
        expect(phaseRecords.filter((p) => p.phase === 'phase2')).toHaveLength(1)
        expect(phaseRecords.filter((p) => p.phase === 'phase1').map((p) => p.round)).toEqual([1, 2])
        expect(phaseRecords.filter((p) => p.phase === 'backend_search').map((p) => p.round)).toEqual([1, 2])
        expect(phaseRecords.filter((p) => p.phase === 'replan').map((p) => p.round)).toEqual([2])
        expect(phaseRecords.find((p) => p.phase === 'evaluation' && p.replanReason === 'no_results')).toMatchObject({
          round: 1,
          replanReason: 'no_results',
        })
        expect(
          phaseRecords.find((p) => p.phase === 'evaluation' && p.stopReason === 'sufficient_evidence'),
        ).toMatchObject({
          round: 2,
          stopReason: 'sufficient_evidence',
        })

        // And the round-2 function_calling build carries the replan dynamic context items.
        const functionCallingBuilds = h.modelInputBuilder.buildInputs.filter((b) => b.mode === 'function_calling')
        expect(functionCallingBuilds).toHaveLength(2)
        expect(functionCallingBuilds[0]!.contextBundle).toBeUndefined()
        const replanItems = functionCallingBuilds[1]!.contextBundle?.orderedItems ?? []
        expect(replanItems.map((item) => item.itemId)).toEqual([
          'search-round-progress',
          'original-question',
          'prior-queries',
          'search-round-feedback',
          'top-results',
        ])
        const roundProgress = replanItems.find((item) => item.itemId === 'search-round-progress')!.content
        expect(roundProgress).toContain('Round 2 of 3')
        expect(roundProgress).toContain('max replans remaining: 1')
        const priorQueries = replanItems.find((item) => item.itemId === 'prior-queries')!.content
        expect(priorQueries).toContain('tokyo weather today')
        const feedback = replanItems.find((item) => item.itemId === 'search-round-feedback')!.content
        expect(feedback).toContain('no results')

        // And the search-only projection holds across the multi-round run.
        const spec = JSON.parse(run.taskSpecJson)
        expect(spec.tools).toEqual(['web_search'])
        expect(h.childToolProjection).toEqual(['web_search'])
      },
    )

    it(
      'scenario 3: a duplicate replan query stops before a second backend call and returns the current evidence',
      {
        timeout: 20000,
      },
      async () => {
        // Given round 1 returns a single source (insufficient for a technical
        // intent) and the round-2 phase-1 replan call scripts the SAME query.
        const h = createHarness({ remainingTimeoutMs: 60000, roundPolicy: MULTI_ROUND_SEARCH_POLICY })
        h.webSearchExecutor.mockResolvedValue({
          success: true,
          query: 'tokyo documentation',
          results: [
            {
              title: 'Tokyo Docs',
              url: 'https://example.com/docs',
              snippet: 'The Tokyo documentation covers the public API in full detail.',
            },
          ],
          total: 1,
          provider: 'searxng',
          endpointHost: 'localhost:8888',
        })
        h.provider.enqueue({
          toolCalls: [{ id: 'tc_c1', name: 'web_search', arguments: JSON.stringify({ query: 'tokyo documentation' }) }],
        })
        h.provider.enqueue({
          toolCalls: [{ id: 'tc_c2', name: 'web_search', arguments: JSON.stringify({ query: 'tokyo documentation' }) }],
        })
        h.provider.enqueue({ content: 'Answer with the current single-source evidence.' })

        // When the duplicate is detected after the replan phase-1 call.
        const data = await runSearchTool(h, searchInput({ intent: 'technical', freshnessRequired: false }))

        // Then no second backend call happens and the current evidence is returned.
        expect(data.metadata.searchCallCount).toBe(1)
        expect(data.metadata.roundCount).toBe(1)
        expect(data.metadata.replanCount).toBe(1)
        expect(data.metadata.stopReason).toBe('duplicate_query')
        expect(h.webSearchExecutor).toHaveBeenCalledTimes(1)
        expect(data.results).toHaveLength(1)

        // And only the round-1 query was executed against the backend.
        const run = h.runStore.query({})[0]!
        const persisted = JSON.parse(run.resultJson ?? '{}')
        expect(persisted.toolCalls).toHaveLength(1)
        expect(persisted.structuredResult.metadata.executedQueries).toEqual(['tokyo documentation'])

        // And the timeline shows the executed phase-1 round, the replan call, one backend round, one phase2.
        const events = h.transcriptStore.getByRunId(run.subagentRunId)
        const phaseRecords = events.filter((e) => e.eventType === 'SearchPhase').map((e) => JSON.parse(e.contentJson))
        expect(phaseRecords.filter((p) => p.phase === 'phase1').map((p) => p.round)).toEqual([1])
        expect(phaseRecords.filter((p) => p.phase === 'replan').map((p) => p.round)).toEqual([2])
        expect(phaseRecords.filter((p) => p.phase === 'backend_search').map((p) => p.round)).toEqual([1])
        expect(phaseRecords.filter((p) => p.phase === 'phase2')).toHaveLength(1)
        expect(phaseRecords.find((p) => p.phase === 'evaluation' && p.stopReason === 'duplicate_query')).toMatchObject({
          round: 2,
          stopReason: 'duplicate_query',
        })
      },
    )

    it(
      'scenario 4: three insufficient rounds exhaust the budget with max_rounds, three toolCalls and one final phase2',
      {
        timeout: 20000,
      },
      async () => {
        // Given every round returns a single source on the same domain so the
        // merged evidence never reaches the technical diversity minimum.
        const h = createHarness({ remainingTimeoutMs: 60000, roundPolicy: MULTI_ROUND_SEARCH_POLICY })
        h.webSearchExecutor.mockResolvedValue({
          success: true,
          query: 'tokyo documentation',
          results: [
            {
              title: 'Tokyo Docs',
              url: 'https://example.com/docs',
              snippet: 'The Tokyo documentation covers the public API in full detail.',
            },
          ],
          total: 1,
          provider: 'searxng',
          endpointHost: 'localhost:8888',
        })
        h.provider.enqueue({
          toolCalls: [
            { id: 'tc_d1', name: 'web_search', arguments: JSON.stringify({ query: 'tokyo documentation guide' }) },
          ],
        })
        h.provider.enqueue({
          toolCalls: [
            { id: 'tc_d2', name: 'web_search', arguments: JSON.stringify({ query: 'tokyo documentation examples' }) },
          ],
        })
        h.provider.enqueue({
          toolCalls: [
            { id: 'tc_d3', name: 'web_search', arguments: JSON.stringify({ query: 'tokyo documentation official' }) },
          ],
        })
        h.provider.enqueue({ content: 'Final max-round answer.' })

        // When all three rounds stay below the evidence bar.
        const data = await runSearchTool(h, searchInput({ intent: 'technical', freshnessRequired: false }))

        // Then the loop stops at max_rounds with real three-round counters.
        expect(data.metadata.searchCallCount).toBe(3)
        expect(data.metadata.roundCount).toBe(3)
        expect(data.metadata.replanCount).toBe(2)
        expect(data.metadata.llmCallCount).toBe(4)
        expect(data.metadata.stopReason).toBe('max_rounds')
        expect(h.webSearchExecutor).toHaveBeenCalledTimes(3)

        // And the child persisted three ordered toolCalls with real iterations.
        const run = h.runStore.query({})[0]!
        const persisted = JSON.parse(run.resultJson ?? '{}')
        expect(persisted.toolCalls.map((tc: { params: { query: string } }) => tc.params.query)).toEqual([
          'tokyo documentation guide',
          'tokyo documentation examples',
          'tokyo documentation official',
        ])
        expect(persisted.iterationsUsed).toBe(4)
        expect(persisted.structuredResult.metadata.executedQueries).toHaveLength(3)

        // And the timeline records three rounds and exactly one phase2.
        const events = h.transcriptStore.getByRunId(run.subagentRunId)
        const phaseRecords = events.filter((e) => e.eventType === 'SearchPhase').map((e) => JSON.parse(e.contentJson))
        expect(phaseRecords.filter((p) => p.phase === 'phase1').map((p) => p.round)).toEqual([1, 2, 3])
        expect(phaseRecords.filter((p) => p.phase === 'backend_search').map((p) => p.round)).toEqual([1, 2, 3])
        expect(phaseRecords.filter((p) => p.phase === 'phase2')).toHaveLength(1)
        expect(phaseRecords.filter((p) => p.phase === 'evaluation' && p.replanReason === 'low_diversity')).toHaveLength(
          2,
        )
        expect(phaseRecords.find((p) => p.phase === 'evaluation' && p.stopReason === 'max_rounds')).toMatchObject({
          round: 3,
          stopReason: 'max_rounds',
        })
      },
    )

    it(
      'scenario 5: short-budget evidence returns partial success with budgetExhausted and a degraded answer',
      {
        timeout: 20000,
      },
      async () => {
        // Given a tight total budget whose completion deadline settles while the
        // final phase-2 synthesis call is still in flight — evidence already in hand.
        const h = createHarness({ remainingTimeoutMs: 800, roundPolicy: PARTIAL_BUDGET_POLICY })
        h.provider.enqueue({
          toolCalls: [{ id: 'tc_e1', name: 'web_search', arguments: JSON.stringify({ query: 'tokyo weather today' }) }],
        })
        h.provider.enqueue({ content: 'This answer is too late.', delayMs: 2000 })

        // When the completion deadline expires before phase-2 answers.
        const data = await runSearchTool(h, searchInput({ freshnessRequired: false }))

        // Then the run still completes with partial success and a budget flag.
        expect(data.metadata.budgetExhausted).toBe(true)
        expect(data.metadata.searchCallCount).toBe(1)
        expect(data.metadata.roundCount).toBe(1)
        expect(data.results.length).toBeGreaterThan(0)

        // And the child run COMPLETES (partial success), not cancelled by the wait.
        const run = h.runStore.query({})[0]!
        expect(run.status).toBe('completed')
        const persisted = JSON.parse(run.resultJson ?? '{}')
        expect(persisted.structuredResult.metadata.budgetExhausted).toBe(true)
        expect(persisted.structuredResult.answer).toBe(DEGRADED_ANSWER)

        // And the abandoned phase-2 provider call settles benignly with one phase2 only.
        await h.provider.flush()
        const events = h.transcriptStore.getByRunId(run.subagentRunId)
        const phaseRecords = events.filter((e) => e.eventType === 'SearchPhase').map((e) => JSON.parse(e.contentJson))
        expect(phaseRecords.filter((p) => p.phase === 'phase2')).toHaveLength(1)
        expect(h.runStore.query({})[0]!.status).toBe('completed')
      },
    )

    it(
      'scenario 6: zero-evidence budget expiry is a typed recoverable SEARCH_TIMEOUT, terminal with no later phase event',
      {
        timeout: 20000,
      },
      async () => {
        // Given the round-1 phase-1 call is delayed past the round deadline with no evidence anywhere.
        const h = createHarness({ remainingTimeoutMs: 800, roundPolicy: PARTIAL_BUDGET_POLICY })
        h.provider.enqueue({
          toolCalls: [{ id: 'tc_f1', name: 'web_search', arguments: JSON.stringify({ query: 'tokyo weather' }) }],
          delayMs: 2000,
        })

        // When the zero-evidence deadline settles.
        const err = await expectSearchError(h, searchInput({ freshnessRequired: false }))
        expect(err.code).toBe(SEARCH_TIMEOUT)
        expect(err.recoverable).toBe(true)

        // Then the child run FAILS (typed controller timeout), terminal — not cancelled.
        const run = h.runStore.query({})[0]!
        expect(run.status).toBe('failed')
        const result = JSON.parse(run.resultJson ?? '{}')
        expect(result.error.code).toBe(SEARCH_TIMEOUT)
        expect(result.error.recoverable).toBe(true)

        // And no phase1/backend/phase2 SearchPhase record nor completion appears.
        const events = h.transcriptStore.getByRunId(run.subagentRunId)
        const phaseRecords = events.filter((e) => e.eventType === 'SearchPhase').map((e) => JSON.parse(e.contentJson))
        expect(phaseRecords.some((p) => p.phase === 'phase1')).toBe(false)
        expect(phaseRecords.some((p) => p.phase === 'backend_search')).toBe(false)
        expect(phaseRecords.some((p) => p.phase === 'phase2')).toBe(false)
        expect(events.some((e) => e.eventType === 'SearchPhaseCompleted')).toBe(false)

        // And the abandoned provider call settling later changes nothing.
        await h.provider.flush()
        const after = h.transcriptStore.getByRunId(run.subagentRunId)
        expect(after).toHaveLength(events.length)
        expect(h.runStore.query({})[0]!.status).toBe('failed')
      },
    )

    it(
      'scenario 7: external cancellation aborts mid-run and a later abandoned provider settle cannot change the terminal state',
      {
        timeout: 20000,
      },
      async () => {
        // Given a phase-1 provider call that stays in flight long past the abort.
        const h = createHarness({ remainingTimeoutMs: 60000, roundPolicy: MULTI_ROUND_SEARCH_POLICY })
        h.provider.enqueue({
          toolCalls: [{ id: 'tc_g1', name: 'web_search', arguments: JSON.stringify({ query: 'tokyo weather' }) }],
          delayMs: 2000,
        })

        // When the parent aborts the search mid-run.
        const controller = new AbortController()
        const resultPromise = handleSearchSubagentTool(h.deps, searchInput(), {
          ...IDENTITY,
          signal: controller.signal,
        })

        const deadline = Date.now() + 5000
        while (Date.now() < deadline) {
          const run = h.runStore.query({})[0]
          if (run && run.status === 'running') break
          await new Promise((resolve) => setTimeout(resolve, 20))
        }
        controller.abort()

        // Then the parent tool reports a recoverable CANCELLED error.
        const result = await resultPromise
        expect(result.success).toBe(false)
        expect(result.error!.code).toBe('CANCELLED')
        expect(result.error!.recoverable).toBe(true)

        // And the child run is cancelled with no phase milestone recorded.
        const run = h.runStore.query({})[0]!
        expect(run.status).toBe('cancelled')
        const events = h.transcriptStore.getByRunId(run.subagentRunId)
        const phaseRecords = events.filter((e) => e.eventType === 'SearchPhase').map((e) => JSON.parse(e.contentJson))
        expect(phaseRecords.some((p) => p.phase === 'phase1')).toBe(false)
        expect(phaseRecords.some((p) => p.phase === 'backend_search')).toBe(false)
        expect(phaseRecords.some((p) => p.phase === 'phase2')).toBe(false)
        expect(events.some((e) => e.eventType === 'SearchPhaseCompleted')).toBe(false)

        // And the abandoned provider promise settling later keeps the terminal state.
        await h.provider.flush()
        expect(h.runStore.query({})[0]!.status).toBe('cancelled')
        const after = h.transcriptStore.getByRunId(run.subagentRunId)
        expect(after).toHaveLength(events.length)
      },
    )

    it(
      'scenario 8a: a multi-round backend failure is terminal SEARCH_BACKEND_ERROR without a blind retry',
      {
        timeout: 20000,
      },
      async () => {
        // Given the round-1 backend returns success:false while the 3-round budget remains.
        const h = createHarness({ remainingTimeoutMs: 60000, roundPolicy: MULTI_ROUND_SEARCH_POLICY })
        h.webSearchExecutor.mockResolvedValueOnce({
          success: false,
          query: 'tokyo weather',
          results: [],
          total: 0,
          provider: 'none',
          endpointHost: '',
        })
        h.provider.enqueue({
          toolCalls: [{ id: 'tc_h1', name: 'web_search', arguments: JSON.stringify({ query: 'tokyo weather' }) }],
        })

        // When the parent tool maps the failed backend.
        const err = await expectSearchError(h)
        expect(err.code).toBe(SEARCH_BACKEND_ERROR)
        expect(err.recoverable).toBe(true)
        // Then the generic sanitized message surfaces — never raw provider content.
        expect(err.message).not.toMatch(/captcha|searxng/i)
        // And no blind retry: the 3-round budget never sees a second backend call.
        expect(h.webSearchExecutor).toHaveBeenCalledTimes(1)

        const run = h.runStore.query({})[0]!
        expect(run.status).toBe('failed')
        const events = h.transcriptStore.getByRunId(run.subagentRunId)
        const backendError = events.find((e) => e.eventType === 'SearchBackendError')
        expect(backendError).toBeDefined()
        expect(JSON.parse(backendError!.contentJson).errorCode).toBe(SEARCH_BACKEND_ERROR)
        expect(events.some((e) => e.eventType === 'SearchPhaseCompleted')).toBe(false)
      },
    )

    it(
      'scenario 8b: a raw backend rejection is sanitized into a recoverable SEARCH_EXECUTION_ERROR without blind retry',
      {
        timeout: 20000,
      },
      async () => {
        // Given the backend throws a raw error carrying an API key and stack text.
        const h = createHarness({ remainingTimeoutMs: 60000, roundPolicy: MULTI_ROUND_SEARCH_POLICY })
        h.webSearchExecutor.mockImplementationOnce(() => {
          throw new Error(
            'SearXNG request failed: status 429 body <html>CAPTCHA</html> api_key=sk-ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890 stack at WebSearchProvider.search (providers/searxng.ts:88)',
          )
        })
        h.provider.enqueue({
          toolCalls: [{ id: 'tc_h2', name: 'web_search', arguments: JSON.stringify({ query: 'tokyo weather' }) }],
        })

        // When the runner sanitizes the thrown error.
        const err = await expectSearchError(h)
        expect(err.code).toBe(SEARCH_EXECUTION_ERROR)
        expect(err.recoverable).toBe(true)
        // Then the raw secret is redacted and the message is bounded.
        expect(err.message).not.toContain('sk-ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890')
        expect(err.message).toContain('[REDACTED_API_KEY]')
        expect(err.message.length).toBeLessThanOrEqual(500)
        // And no blind retry follows the throw.
        expect(h.webSearchExecutor).toHaveBeenCalledTimes(1)
      },
    )

    it(
      'scenario 9: a taskId resume keeps the same search child and round-trips the typed plan hints',
      {
        timeout: 20000,
      },
      async () => {
        // Given a first multi-round search completes inside a resumable child session.
        const h = createHarness({ remainingTimeoutMs: 60000, roundPolicy: MULTI_ROUND_SEARCH_POLICY })
        const executeSpy = vi.spyOn(h.deps.searchSubagent, 'execute')

        h.provider.enqueue({
          toolCalls: [{ id: 'tc_i1', name: 'web_search', arguments: JSON.stringify({ query: 'tokyo weather today' }) }],
        })
        h.provider.enqueue({ content: 'First answer.' })
        const first = await runSearchTool(h, searchInput({ locale: 'en-US', freshnessRequired: false }))

        // When the same parent resumes via taskId.
        h.provider.enqueue({
          toolCalls: [{ id: 'tc_i2', name: 'web_search', arguments: JSON.stringify({ query: 'tokyo tomorrow' }) }],
        })
        h.provider.enqueue({ content: 'Second answer.' })
        const second = await runSearchTool(
          h,
          searchInput({ locale: 'en-US', freshnessRequired: false, taskId: first.metadata.taskId }),
        )

        // Then the same child session hosts both run attempts.
        expect(second.metadata.taskId).toBe(first.metadata.taskId)
        const runs = h.runStore.query({})
        expect(runs).toHaveLength(2)
        expect(runs.every((run) => run.childSessionId === runs[0]!.childSessionId)).toBe(true)

        // And the typed hints round-trip through the real runtime on BOTH attempts.
        expect(executeSpy).toHaveBeenCalledTimes(2)
        for (const [input] of executeSpy.mock.calls) {
          const executeInput = input as SearchSubagentInput & { searchPlanHints?: SearchPlanHints }
          expect(executeInput.searchPlanHints).toEqual({
            originalQuestion: QUERY,
            intent: 'weather',
            freshness: false,
            locale: 'en-US',
            missingCriticalContext: [],
          })
        }
      },
    )

    it(
      'scenario 10: a legacy persisted task spec without hints runs the multi-round controller with the documented fallback',
      {
        timeout: 20000,
      },
      async () => {
        // Given an old persisted search task row that predates typed plan hints.
        const h = createHarness({ remainingTimeoutMs: 60000, roundPolicy: MULTI_ROUND_SEARCH_POLICY })
        h.sessionStore.createChildSession({
          sessionId: 'sess_legacy_multi',
          userId: 'user_A',
          parentSessionId: 'sess_parent',
          agentProfile: SEARCH_CHILD_PROFILE_ID,
          taskId: 'sess_legacy_multi',
          launchMode: 'foreground',
          title: 'Legacy multi-round search child',
        })
        h.runStore.create({
          subagentRunId: 'subagent-legacy-multi-1',
          userId: 'user_A',
          sessionId: 'sess_legacy_multi',
          childSessionId: 'sess_legacy_multi',
          taskId: 'sess_legacy_multi',
          agentType: 'subagent',
          agentProfile: SEARCH_CHILD_PROFILE_ID,
          status: 'queued',
          taskSpecJson: JSON.stringify({
            objective: 'tokyo weather today',
            profileId: SEARCH_CHILD_PROFILE_ID,
            tools: ['web_search'],
            parentSessionId: 'sess_parent',
            parentTurnId: 'krun_parent',
            launchMode: 'foreground',
            timeoutMs: 60000,
            prompt: 'Search assistant platform instruction.',
          }),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })

        // When the legacy run executes under the multi-round policy.
        h.provider.enqueue({
          toolCalls: [{ id: 'tc_j1', name: 'web_search', arguments: JSON.stringify({ query: 'tokyo weather today' }) }],
        })
        h.provider.enqueue({ content: 'Legacy fallback answer.' })
        const executeSpy = vi.spyOn(h.deps.searchSubagent, 'execute')

        const result = await h.runtime.executeRun('subagent-legacy-multi-1')
        expect(result.status).toBe('completed')

        // Then the objective falls back to originalQuestion with a general intent.
        const executeInput = executeSpy.mock.calls[0]![0] as SearchSubagentInput & { searchPlanHints?: SearchPlanHints }
        expect(executeInput.searchPlanHints).toEqual({
          originalQuestion: 'tokyo weather today',
          intent: 'general',
        })

        // And the multi-round controller ran end-to-end with those fallback hints
        // (general intent needs 2 unique sources; the default backend supplies them).
        const run = h.runStore.getById('subagent-legacy-multi-1')!
        const persisted = JSON.parse(run.resultJson ?? '{}')
        expect(persisted.status).toBe('completed')
        expect(persisted.structuredResult.metadata.searchCallCount).toBe(1)
        expect(persisted.structuredResult.metadata.roundCount).toBe(1)
        expect(persisted.structuredResult.metadata.stopReason).toBe('sufficient_evidence')
        expect(h.childToolProjection).toEqual(['web_search'])
      },
    )
  })
})
