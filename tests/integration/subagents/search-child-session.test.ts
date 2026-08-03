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
} from '../../../src/search/search-child-runner.js'
import { createSearchSubagent } from '../../../src/search/search-subagent.js'
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
import type { SearchSubagentToolResult } from '../../../src/search/search-subagent-types.js'
import type { WebSearchResult } from '../../../src/search/types.js'
import type { LLMRequest } from '../../../src/llm/types.js'

const QUERY = 'what is the weather in Tokyo today'

// ---------------------------------------------------------------------------
// Scripted two-phase search provider — queue based; never throws on empty.
// ---------------------------------------------------------------------------

interface ScriptedResponse {
  content?: string
  toolCalls?: Array<{ id: string; name: string; arguments: string }>
  delayMs?: number
}

class ScriptedSearchProvider {
  readonly queue: ScriptedResponse[] = []
  readonly requests: LLMRequest[] = []

  enqueue(entry: ScriptedResponse): void {
    this.queue.push(entry)
  }

  get hasPending(): boolean {
    return this.queue.length > 0
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
    if (next.delayMs && next.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, next.delayMs))
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

function createMockModelInputBuilder(): ModelInputBuilder {
  const messages: Array<{ role: 'system' | 'user'; content: string }> = []
  return {
    build: async (input: ModelInputBuildInput): Promise<BuiltModelInput> => {
      messages.length = 0
      if (input.mode === 'function_calling') {
        messages.push({ role: 'system', content: 'You are a search assistant. Use the web_search tool.' })
      } else {
        messages.push({ role: 'system', content: 'You are a search assistant. Provide a helpful answer.' })
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
  } as unknown as ModelInputBuilder
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
}

function createHarness(options: { remainingTimeoutMs: number }): Harness {
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
    modelInputBuilder: createMockModelInputBuilder(),
    providerFamily: 'openai',
    searchLlmProviderId: 'provider-search',
    searchLlmModel: 'gpt-4.1-mini',
    phaseObserver: recorder.observe,
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

  return { sessionStore, runStore, transcriptStore, runtime, provider, deps, webSearchExecutor, childToolProjection }
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
})
