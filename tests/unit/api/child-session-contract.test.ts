/**
 * Child Session Contracts — Todo 17 composition-root / catalog / OpenAPI /
 * debug / metrics compatibility lock.
 *
 * Proves (additively — nothing existing is renamed or removed):
 *   1. `createApiContext` wires the unified ChildSessionTaskRuntime (and by
 *      construction the specialized search runner) so child tasks can launch,
 *      execute, cancel, resume and be read back through the composition root.
 *   2. Legacy `subagent_runs` rows WITHOUT child-session linkage stay fully
 *      queryable (historical runs must remain readable).
 *   3. Child task lifecycle events are queryable by PARENT session with
 *      parent/task/profile correlation (taskId, childSessionId, agentProfile,
 *      launchMode, subagentRunId).
 *   4. Public tool catalogs keep the legacy tool IDs and describe child-task
 *      capabilities additively.
 *   5. OpenAPI keeps legacy session fields and adds child-session fields
 *      (sessionKind/parentSessionId/taskId/agentProfile/launchMode/subagentDepth)
 *      plus the approved parent-scoped child endpoints.
 *   6. The kernel per-tool timeout covers foreground child launches so the
 *      dispatcher race cannot cut off a bounded child wait (Todo 8 alignment).
 *   7. Metrics keep the legacy subagent run metric and add child-session
 *      dimensions (parent/task/profile/launch-mode correlation).
 */

import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import { createApiContext, isApiContextError } from '../../../src/api/context.js'
import { getFallbackToolCatalog } from '../../../src/tools/tool-catalog.js'
import { buildChildTaskLifecycleEvent } from '../../../src/subagents/child-session-task-runtime.js'

const OPENAPI_PATH = path.resolve(__dirname, '../../../docs/api/openapi.yaml')

describe('child session composition-root contracts', () => {
  it('wires the unified child session task runtime with launch/execute/cancel/resume/get surface', () => {
    const context = createApiContext({ dbPath: ':memory:' })
    expect(isApiContextError(context)).toBe(false)

    const runtime = (context as Exclude<typeof context, { code: string }>).childSessionTaskRuntime
    expect(runtime).toBeDefined()
    expect(typeof runtime!.launchTask).toBe('function')
    expect(typeof runtime!.executeRun).toBe('function')
    expect(typeof runtime!.cancelRun).toBe('function')
    expect(typeof runtime!.runTask).toBe('function')
    expect(typeof runtime!.getRun).toBe('function')
    expect(typeof runtime!.getChildSession).toBe('function')
  })

  it('keeps legacy subagent_runs rows without child linkage queryable', () => {
    const context = createApiContext({ dbPath: ':memory:' })
    expect(isApiContextError(context)).toBe(false)
    if (isApiContextError(context)) return

    const now = new Date().toISOString()
    context.subagentRunStore.create({
      subagentRunId: 'subagent-legacy-fixture-1',
      userId: 'user-legacy',
      agentType: 'document_processor',
      status: 'completed',
      taskSpecJson: '{"objective":"legacy"}',
      createdAt: now,
      updatedAt: now,
    })

    const byId = context.subagentRunStore.getById('subagent-legacy-fixture-1')
    expect(byId).not.toBeNull()
    expect(byId!.subagentRunId).toBe('subagent-legacy-fixture-1')
    expect(byId!.status).toBe('completed')
    expect(byId!.childSessionId).toBeUndefined()
    expect(byId!.taskId).toBeUndefined()

    const byUser = context.subagentRunStore.query({ userId: 'user-legacy' })
    expect(byUser.map((r) => r.subagentRunId)).toContain('subagent-legacy-fixture-1')
  })

  it('makes child task lifecycle events queryable by parent session with correlation', () => {
    const context = createApiContext({ dbPath: ':memory:' })
    expect(isApiContextError(context)).toBe(false)
    if (isApiContextError(context)) return

    const parentSessionId = 'sess_parent_correlation'
    const childSessionId = 'sess_child_correlation'
    const runId = 'subagent-run-correlation-1'
    const event = buildChildTaskLifecycleEvent({
      parentSessionId,
      userId: 'user-1',
      eventType: 'run_started',
      metadata: {
        taskId: childSessionId,
        childSessionId,
        runId,
        agentProfile: 'search_processor',
        launchMode: 'foreground',
        status: 'running',
      },
    })
    context.stores.eventStore.append(event)

    const parentEvents = context.stores.eventStore.query({ sessionId: parentSessionId })
    expect(parentEvents.length).toBeGreaterThan(0)
    const lifecycle = parentEvents.find((e) => e.relatedRefs?.subagentRunId === runId)
    expect(lifecycle).toBeDefined()
    expect(lifecycle!.eventType).toBe('run_started')
    expect(lifecycle!.payload).toMatchObject({
      taskId: childSessionId,
      childSessionId,
      agentProfile: 'search_processor',
      launchMode: 'foreground',
    })
  })
})

describe('child session catalog contracts', () => {
  it('keeps legacy tool IDs in the fallback catalog', () => {
    const fallbackCatalog = getFallbackToolCatalog()
    const names = new Set(fallbackCatalog.map((e) => e.name))

    expect(names).toContain('search_subagent')
    expect(names).toContain('foreground_launch_subagent')

    // Additive child-task description: the public entries now describe child
    // sessions / task correlation without renaming the tool IDs.
    const launch = fallbackCatalog.find((e) => e.name === 'foreground_launch_subagent')!
    expect(launch.description.toLowerCase()).toMatch(/child session|child task|taskId|task id/)
  })
})

describe('child session OpenAPI contracts', () => {
  it('keeps legacy session response fields and adds child-session fields', () => {
    expect(fs.existsSync(OPENAPI_PATH)).toBe(true)
    const content = fs.readFileSync(OPENAPI_PATH, 'utf-8')

    // Legacy fields must remain present in the SessionInfo schema.
    expect(content).toMatch(/sessionId/)
    expect(content).toMatch(/status/)

    // Additive child-session dimensions (Todo 11/17).
    for (const field of ['sessionKind', 'parentSessionId', 'taskId', 'agentProfile', 'launchMode', 'subagentDepth']) {
      expect(content).toContain(field)
    }

    // Approved parent-scoped child endpoints (children/resume/cancel).
    expect(content).toContain('/sessions/{sessionId}/children')
    expect(content).toMatch(/children\/\{childSessionId\}\/resume/)
    expect(content).toMatch(/children\/\{childSessionId\}\/cancel/)
  })
})

describe('child session kernel timeout alignment', () => {
  it('covers foreground child launches so the dispatcher race cannot cut off a bounded wait', async () => {
    const { PER_TOOL_TIMEOUT_MS } = (await import('../../../src/kernel/agent-kernel.js')) as {
      PER_TOOL_TIMEOUT_MS?: Record<string, number>
    }
    expect(PER_TOOL_TIMEOUT_MS).toBeDefined()
    expect(PER_TOOL_TIMEOUT_MS!['foreground_launch_subagent']).toBeGreaterThanOrEqual(60_000)
  })
})

describe('child session metrics contracts', () => {
  it('keeps the legacy subagent run metric and adds child-session dimensions', async () => {
    const { getSubagentRunMetrics } = (await import('../../../src/observability/subagent-metrics.js')) as {
      getSubagentRunMetrics?: () => { name: string; labelNames: string[] }
    }
    expect(getSubagentRunMetrics).toBeDefined()
    const metrics = getSubagentRunMetrics!()

    expect(metrics.name).toContain('subagent_runs')

    // Additive correlation dimensions — never renamed away from the legacy set.
    const labels = metrics.labelNames
    expect(labels).toContain('agent_profile')
    expect(labels).toContain('parent_session_id')
    expect(labels).toContain('task_id')
    expect(labels).toContain('launch_mode')
  })
})
