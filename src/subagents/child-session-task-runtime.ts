/**
 * Child Session Task Runtime — unified create/resume/launch-attempt/execute
 * runtime for delegated child tasks (Todo 7 of opencode-like-subagent-sessions).
 *
 * Every delegated task runs in its own tenant/user-owned child conversation:
 *
 *   - `sessions` is the observable conversation shell. A fresh launch creates a
 *     `session_kind='subagent'` child linked to the parent; a resume reuses the
 *     existing child (fixed identity rule: `taskId === childSessionId`).
 *   - `subagent_runs` is the attempt truth. EVERY launch and EVERY resume creates
 *     a NEW `subagent_runs` row (with `child_session_id`/`task_id` linkage) that
 *     persists the full task spec — objective, prompt, approved references
 *     (attachments/file refs), workdir and parent-turn lineage.
 *   - Execution delegates to a profile-specific runner (the generic kernel
 *     adapter for now; the specialized search runner arrives in Todo 16).
 *
 * Fresh children receive EXPLICIT task input ONLY: objective + approved
 * references + workdir + platform prompt. The parent context bundle is NEVER
 * cloned into a fresh child — the parent conversation text cannot leak into the
 * child model input. `taskId` resume additionally loads only the prior child
 * transcript/context summary.
 *
 * Child work never flows through the public parent `/messages` route, and the
 * parent transcript is never duplicated.
 *
 * All rejections are decision-level: unknown / foreign / archived / non-child
 * taskIds and every policy violation (`evaluateChildLaunch`) are raised BEFORE
 * any session/run row could be created or any kernel work could happen.
 *
 * @module subagents/child-session-task-runtime
 */

import { generateId, SESSION_ID_PREFIX } from '../shared/ids.js'
import { DEFAULT_TENANT_ID } from '../tenancy/tenant-context.js'
import type { ContextBundle, ContextItem } from '../context/types.js'
import type { Session, SessionStore } from '../storage/session-store.js'
import type { SubagentRunStore, SubagentRunRecord } from '../storage/subagent-run-store.js'
import type { SubagentTranscriptStore } from '../storage/subagent-transcript-store.js'
import type { EventRecord, EventStore } from '../storage/event-store.js'
import type { SubagentDefinition, SubagentRegistry } from './registry.js'
import type { SubagentTaskSpec, SubagentResult, SubagentRunState, KernelAdapter } from './types.js'
import {
  evaluateChildLaunch,
  resolveChildProfile,
  buildChildToolProjection,
  buildSearchChildProjection,
  SEARCH_CHILD_PROFILE_ID,
  assertChildTaskIdMatchesSession,
  type ChildLaunchDecision,
} from './child-task-policy.js'
import type { ToolPlaneProjection } from '../kernel/model-input/model-input-types.js'
import type { ToolRegistry } from '../tools/types.js'
import type { AgentTypeToolEnvelopeRegistry } from '../permissions/agent-type-tool-envelope.js'
import type { KernelRunResult, InternalToolHandler } from '../kernel/types.js'
import type { SearchChildRunner } from '../search/search-child-runner.js'
import { parseSearchPlanHints } from '../search/search-subagent-types.js'
import type { PlannerRuntime } from '../planner/planner-runtime.js'
import type { PlanGenerator } from '../planner/plan-generator-interface.js'
import { mapSchemaPlanStepsToStorage } from '../planner/plan-step-mapper.js'
import type { PlanStep } from '../storage/plan-store.js'

// ---------------------------------------------------------------------------
// Typed runtime errors (rejection before execution)
// ---------------------------------------------------------------------------

/** Unknown taskId — no such task exists (also covers cross-tenant/cross-user lookups). */
export const CHILD_TASK_NOT_FOUND = 'CHILD_TASK_NOT_FOUND'
/** The task belongs to another user or another parent session. */
export const CHILD_TASK_FOREIGN = 'CHILD_TASK_FOREIGN'
/** The task's child session is archived/closed and cannot be resumed. */
export const CHILD_TASK_ARCHIVED = 'CHILD_TASK_ARCHIVED'
/** The taskId resolves to a session that is not a subagent child session. */
export const CHILD_TASK_NOT_CHILD = 'CHILD_TASK_NOT_CHILD'
/** No subagent_runs attempt row exists for the given run id. */
export const CHILD_TASK_RUN_NOT_FOUND = 'CHILD_TASK_RUN_NOT_FOUND'

export type ChildTaskRuntimeErrorCode =
  | typeof CHILD_TASK_NOT_FOUND
  | typeof CHILD_TASK_FOREIGN
  | typeof CHILD_TASK_ARCHIVED
  | typeof CHILD_TASK_NOT_CHILD
  | typeof CHILD_TASK_RUN_NOT_FOUND

/**
 * Typed error raised by the child task runtime. Callers distinguish rejection
 * causes by `code` instead of parsing messages.
 */
export class ChildTaskRuntimeError extends Error {
  readonly code: ChildTaskRuntimeErrorCode

  constructor(code: ChildTaskRuntimeErrorCode, message: string) {
    super(message)
    this.name = 'ChildTaskRuntimeError'
    this.code = code
  }
}

// ---------------------------------------------------------------------------
// Task spec / references
// ---------------------------------------------------------------------------

/**
 * An approved reference supplied to a child task (attachment / file ref /
 * artifact). This is EXPLICIT task input — it is never derived from the parent
 * conversation.
 */
export interface ChildTaskReference {
  kind: 'file_ref' | 'attachment' | 'artifact'
  /** Reference id/path (e.g. workdir://docs/report.md). */
  ref: string
  label?: string
  /** Inline approved content — only what is explicitly approved for the child. */
  content?: string
}

/**
 * The full, persisted child task spec. Carries the objective plus every piece
 * of explicit task input and the parent-turn lineage.
 */
export interface ChildTaskSpec extends SubagentTaskSpec {
  /** Subagent profile to run (resolved by the policy — the label alone never expands permissions). */
  profileId: string
  /** Additional platform instructions rendered into the child system prompt. */
  prompt?: string
  /** Approved references (attachments/file refs/artifacts) for this attempt. */
  references?: ChildTaskReference[]
  /** Managed workdir passed to the child kernel. */
  workDirRoot?: string
  workDirId?: string
  /** Parent session that launched this task (lineage). */
  parentSessionId: string
  /** Parent turn/message lineage. */
  parentTurnId?: string
  parentMessageId?: string
  /** 'foreground' = parent waits; 'background' = notified later. */
  launchMode: 'foreground' | 'background'
  /** Explicitly permit orchestration launch tools (only below max depth). */
  allowNestedLaunch?: boolean
  /** Fixed identity: equals the child session id. Stamped at launch. */
  taskId?: string
  /** Planner run the child generates a plan for and writes progress back to. */
  plannerRunId?: string
  /** Plan id associated with plannerRunId (bookkeeping / context display). */
  planId?: string
}

// ---------------------------------------------------------------------------
// Launch input / results
// ---------------------------------------------------------------------------

export interface ChildTaskLaunchInput {
  /** Parent context — used ONLY for userId + run lineage, never cloned. */
  parentContext: ContextBundle
  /** Full explicit task input for this attempt. */
  taskSpec: ChildTaskSpec
  /** Depth of the CHILD being launched (parent depth + 1). */
  depth: number
  /** Number of child launches already made in the parent turn. */
  launchesInParentTurn: number
  /** Tools requested for the child (may be empty → profile defaults). */
  requestedTools?: string[]
  /** Resume target: the child session id of an existing task. */
  taskId?: string
  /** Parent run lineage override (defaults to parentContext.runId). */
  parentRunId?: string
  rootRunId?: string
  /** Background run linkage for subagent_runs.background_run_id. */
  backgroundRunId?: string
  tenantId?: string
}

export interface ChildTaskLaunchResult {
  childSessionId: string
  /** Fixed identity rule: equals childSessionId. */
  taskId: string
  /** New subagent_runs attempt id for THIS launch/resume. */
  subagentRunId: string
  childSession: Session
  /** True when the task resumed an existing child session. */
  isResume: boolean
}

export interface ChildTaskExecutionResult extends ChildTaskLaunchResult {
  result: SubagentResult
}

/** Snapshot of a run attempt (stored-backed). */
export interface ChildTaskRunSnapshot {
  subagentRunId: string
  taskId: string
  childSessionId: string
  userId: string
  status: SubagentRunState
  taskSpec: ChildTaskSpec
  result?: SubagentResult
  parentRunId?: string
  rootRunId?: string
  createdAt: string
  startedAt?: string
  completedAt?: string
  isCancelled: boolean
  tenantId: string
}

// ---------------------------------------------------------------------------
// Parent-side task lifecycle events (Todo 12)
// ---------------------------------------------------------------------------

/**
 * Stable metadata carried by every parent-side child task lifecycle event.
 * This is the ONLY per-task shape the parent timeline/UI consumes — child
 * reasoning/text/tool content is NEVER included.
 */
export interface ChildTaskLifecycleMetadata {
  /** Fixed identity: equals the child session id. */
  taskId: string
  childSessionId: string
  /** The subagent_runs attempt id (one lifecycle sequence per attempt). */
  runId: string
  /** Subagent profile label (e.g. 'document_processor'). */
  agentProfile: string
  launchMode: 'foreground' | 'background'
  status: SubagentRunState
  /** Optional 0-100 progress hint. */
  progress?: number
  /** Safe, sanitized terminal message (error text only on failure/cancel). */
  safeMessage?: string
}

/**
 * Lifecycle events REUSE the existing run event types so the console timeline
 * maps them with zero changes (`mapEventRecordToTimelineEvent` already maps
 * run_started / run_completed / run_failed / run_cancelled).
 */
export type ChildTaskLifecycleEventType = 'run_started' | 'run_completed' | 'run_failed' | 'run_cancelled'

const LIFECYCLE_STAGE_BY_TYPE: Record<ChildTaskLifecycleEventType, string> = {
  run_started: 'started',
  run_completed: 'completed',
  run_failed: 'failed',
  run_cancelled: 'cancelled',
}

/**
 * Structural broadcast surface for parent-side lifecycle events. The API
 * `TimelineBroadcaster` satisfies it — the runtime stays decoupled from
 * src/api by depending on this minimal shape.
 */
export interface ChildTaskLifecycleBroadcaster {
  broadcast(
    sessionId: string,
    event: {
      eventId: string
      eventType: string
      sessionId: string
      timestamp: string
      content?: string
      metadata?: Record<string, unknown>
      actor?: string
    },
  ): void
}

/**
 * Builds a deterministic parent-side lifecycle EventRecord.
 *
 * - `sessionId` is the PARENT session (the parent timeline/snapshot queries by
 *   it; the child timeline never sees lifecycle events).
 * - `eventId` is deterministic per (runId, stage): `child-task:<runId>:<stage>`.
 * - `idempotencyKey` is deterministic per (taskId, stage) so re-emission and
 *   reconnect reconstruction stay deduplicable.
 * - `payload` carries ONLY the stable metadata (+ `message` alias for the
 *   timeline `content` mapping). Never child response/transcript content.
 */
export function buildChildTaskLifecycleEvent(input: {
  parentSessionId: string
  userId: string
  eventType: ChildTaskLifecycleEventType
  metadata: ChildTaskLifecycleMetadata
  tenantId?: string
  createdAt?: string
}): EventRecord {
  const { parentSessionId, userId, eventType, metadata } = input
  const createdAt = input.createdAt ?? new Date().toISOString()
  const stage = LIFECYCLE_STAGE_BY_TYPE[eventType]

  return {
    eventId: `child-task:${metadata.runId}:${stage}`,
    eventType,
    sourceModule: 'subagent',
    userId,
    sessionId: parentSessionId,
    idempotencyKey: `child-task-lifecycle:${metadata.taskId}:${stage}`,
    relatedRefs: { subagentRunId: metadata.runId },
    payload: {
      ...metadata,
      ...(metadata.safeMessage !== undefined ? { message: metadata.safeMessage } : {}),
    },
    sensitivity: 'low',
    retentionClass: 'standard',
    createdAt,
  }
}

// ---------------------------------------------------------------------------
// Runtime deps / interface
// ---------------------------------------------------------------------------

export interface ChildSessionTaskRuntimeDeps {
  sessionStore: SessionStore
  runStore: SubagentRunStore
  transcriptStore: SubagentTranscriptStore
  /** Profile-specific runner — the generic kernel adapter for now. */
  kernelAdapter: KernelAdapter
  registry: SubagentRegistry
  toolRegistry: ToolRegistry
  envelopeRegistry: AgentTypeToolEnvelopeRegistry
  defaultMaxIterations?: number
  defaultTimeoutMs?: number
  /** Optional parent-side lifecycle event persistence (EventStore). */
  eventStore?: EventStore
  /** Optional best-effort live broadcast to the parent session stream. */
  lifecycleBroadcaster?: ChildTaskLifecycleBroadcaster
  /**
   * Specialized search runner (Todo 16). When wired AND the run's profile is
   * the search profile, executeRun delegates to this runner instead of the
   * generic kernel adapter — preserving the two-phase search contract while
   * still creating/resuming the search child session.
   */
  searchRunner?: SearchChildRunner
  /** Planner runtime for planner children to write generated plans / progress back to. */
  plannerRuntime?: PlannerRuntime
  /** Plan generator for planner children (LLM plan generation with deterministic fallback). */
  planGenerator?: PlanGenerator
}

export interface ChildSessionTaskRuntime {
  /**
   * Create OR resume the child session and persist a NEW subagent_runs attempt.
   * Throws {@link ChildTaskRuntimeError} (or policy errors) BEFORE any row is
   * created when the launch is invalid.
   */
  launchTask(input: ChildTaskLaunchInput): ChildTaskLaunchResult
  /** Execute a previously launched attempt through the profile-specific runner. */
  executeRun(subagentRunId: string, signal?: AbortSignal): Promise<SubagentResult>
  /** Cancel a live attempt idempotently. */
  cancelRun(subagentRunId: string): SubagentResult
  /** Convenience: launch then execute in one call. */
  runTask(input: ChildTaskLaunchInput, signal?: AbortSignal): Promise<ChildTaskExecutionResult>
  /** Read a run attempt snapshot (in-memory first, then the store). */
  getRun(subagentRunId: string): ChildTaskRunSnapshot | undefined
  /** Resolve a child session by taskId (undefined when not found/foreign/archived). */
  getChildSession(taskId: string, tenantId?: string): Session | undefined
}

// ---------------------------------------------------------------------------
// Explicit child context assembly (fresh children: NO parent transcript)
// ---------------------------------------------------------------------------

export function buildChildContextBundle(input: {
  childSession: Session
  runId: string
  definition: SubagentDefinition
  taskSpec: ChildTaskSpec
  toolProjection: ToolPlaneProjection
  /** Prior child transcript/context summary — resume ONLY. */
  priorConversation?: string
  /** Generated plan steps for planner children (injected as explicit context). */
  planSteps?: PlanStep[]
}): ContextBundle {
  const { childSession, runId, definition, taskSpec, toolProjection } = input
  const profileLabel = definition.agentProfile ?? definition.agentType
  const bundleId = `bundle-${runId}`
  const agentId = `subagent.${profileLabel}.${runId}`

  const items: ContextItem[] = []

  // 1. Platform prompt (explicit task input, layer 5-role content).
  items.push({
    itemId: `${bundleId}-system-prompt`,
    sourceType: 'system_note',
    semanticType: 'instruction',
    content: composeChildPlatformPrompt({ definition, taskSpec, toolProjection }),
    priority: 100,
    isPinned: true,
    isCompressible: false,
  })

  // 2. Objective (explicit task input).
  items.push({
    itemId: `${bundleId}-objective`,
    sourceType: 'system_note',
    semanticType: 'instruction',
    content: `Task Objective: ${taskSpec.objective}`,
    priority: 90,
    isPinned: true,
  })

  // 2b. Generated plan context for planner children (explicit input — dynamic
  //     data only; the execution protocol lives in the agentProfile:planner template).
  if (taskSpec.plannerRunId && input.planSteps && input.planSteps.length > 0) {
    const stepsText = input.planSteps
      .map((step, index) => `${index + 1}. [${step.stepId}] ${step.description}`)
      .join('\n')
    items.push({
      itemId: `${bundleId}-planner`,
      sourceType: 'system_note',
      semanticType: 'instruction',
      content:
        `当前计划（plannerRunId=${taskSpec.plannerRunId}${taskSpec.planId ? `, planId=${taskSpec.planId}` : ''}）：\n` +
        `${stepsText}\n` +
        `按既定执行协议逐步骤执行并回写进度。`,
      priority: 85,
      isPinned: true,
    })
  }

  // 3. Approved references (attachments / file refs) — explicit input only.
  for (const ref of taskSpec.references ?? []) {
    items.push({
      itemId: `${bundleId}-ref-${ref.ref.replace(/[^a-zA-Z0-9_-]/g, '_')}`,
      sourceType: ref.kind === 'attachment' ? 'attachment' : 'artifact',
      semanticType: ref.kind === 'attachment' ? 'attachment_ref' : 'fact',
      content: ref.content ?? (ref.label ? `${ref.label}: ${ref.ref}` : ref.ref),
      sourceRef: ref.ref,
      structuredPayload: { reference: ref },
      priority: 70,
      isPinned: true,
    })
  }

  // 4. Workdir (explicit task input).
  if (taskSpec.workDirRoot || taskSpec.workDirId) {
    items.push({
      itemId: `${bundleId}-workdir`,
      sourceType: 'system_note',
      semanticType: 'constraint',
      content: `Work Directory: ${taskSpec.workDirId ?? ''} (${taskSpec.workDirRoot ?? 'managed'})`,
      priority: 60,
      isPinned: true,
    })
  }

  // 5. Child session identity carrier — the kernel adapter extracts the
  //    sessionId from items; children stream/scope under the child session.
  items.push({
    itemId: `${bundleId}-session`,
    sourceType: 'system_note',
    semanticType: 'fact',
    content: '',
    structuredPayload: { sessionId: childSession.sessionId },
    priority: 10,
    isPinned: true,
  })

  // 6. Prior child transcript/context summary — resume ONLY.
  if (input.priorConversation) {
    items.push({
      itemId: `${bundleId}-prior-conversation`,
      sourceType: 'conversation_state',
      semanticType: 'summary',
      content: `Prior task context:\n${input.priorConversation}`,
      priority: 50,
      isPinned: true,
    })
  }

  const totalContent = items.reduce((sum, item) => sum + item.content.length, 0)

  const bundle: ContextBundle = {
    bundleId,
    runId,
    agentId,
    agentType: 'subagent',
    agentProfile: profileLabel,
    userId: childSession.userId,
    invocationSource: 'subagent_runtime',
    pinnedItems: items,
    orderedItems: [...items],
    tokenEstimate: Math.ceil(totalContent / 4),
  }

  if (taskSpec.workDirRoot) bundle.workDirRoot = taskSpec.workDirRoot
  if (taskSpec.workDirId) bundle.workDirId = taskSpec.workDirId

  return bundle
}

function composeChildPlatformPrompt(input: {
  definition: SubagentDefinition
  taskSpec: ChildTaskSpec
  toolProjection: ToolPlaneProjection
}): string {
  const { definition, taskSpec, toolProjection } = input
  const segments: string[] = []
  segments.push(definition.description)
  segments.push(`You are a "${definition.agentType}" subagent (${definition.displayName}).`)
  if (toolProjection.toolIds.length > 0) {
    segments.push(`Available Tool IDs: ${toolProjection.toolIds.join(', ')}`)
  }
  if (taskSpec.prompt) {
    segments.push(taskSpec.prompt)
  }
  return segments.join('\n\n')
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

const CHILD_TURN_COMPLETED = 'ChildTurnCompleted'

class ChildSessionTaskRuntimeImpl implements ChildSessionTaskRuntime {
  private readonly deps: ChildSessionTaskRuntimeDeps
  private readonly runs = new Map<string, ChildTaskRunSnapshot>()
  private readonly runControllers = new Map<string, AbortController>()

  constructor(deps: ChildSessionTaskRuntimeDeps) {
    this.deps = deps
  }

  launchTask(input: ChildTaskLaunchInput): ChildTaskLaunchResult {
    const tenantId = input.tenantId ?? DEFAULT_TENANT_ID

    // Resolve the child session (create or resume) — policy gate runs FIRST.
    const { childSession, isResume, decision } = this.resolveOrCreateChildSession(input, tenantId)

    // Create a NEW subagent_runs attempt for EVERY launch and EVERY resume.
    const subagentRunId = generateSubagentRunId()
    const now = new Date().toISOString()
    const profileLabel = decision.profile.agentProfile ?? decision.profile.agentType
    const parentRunId = input.parentRunId ?? input.parentContext.runId
    const rootRunId = input.rootRunId ?? parentRunId

    const taskSpec: ChildTaskSpec = {
      ...input.taskSpec,
      profileId: profileLabel,
      tools: input.requestedTools ?? input.taskSpec.tools,
      taskId: childSession.taskId ?? childSession.sessionId,
    }

    this.deps.runStore.create(
      {
        subagentRunId,
        userId: childSession.userId,
        sessionId: childSession.sessionId,
        childSessionId: childSession.sessionId,
        taskId: childSession.taskId ?? childSession.sessionId,
        parentRunId,
        rootRunId,
        backgroundRunId: input.backgroundRunId,
        agentType: decision.profile.agentType,
        agentProfile: profileLabel,
        status: 'queued',
        taskSpecJson: JSON.stringify(taskSpec),
        createdAt: now,
        updatedAt: now,
      },
      tenantId,
    )

    this.recordTranscript(
      subagentRunId,
      'SubagentRunCreated',
      {
        subagentRunId,
        childSessionId: childSession.sessionId,
        taskId: childSession.taskId ?? childSession.sessionId,
        objective: taskSpec.objective,
        isResume,
        parentRunId,
        rootRunId,
      },
      tenantId,
      childSession.userId,
      childSession.sessionId,
    )

    const snapshot: ChildTaskRunSnapshot = {
      subagentRunId,
      taskId: childSession.taskId ?? childSession.sessionId,
      childSessionId: childSession.sessionId,
      userId: childSession.userId,
      status: 'queued',
      taskSpec,
      parentRunId,
      rootRunId,
      createdAt: now,
      isCancelled: false,
      tenantId,
    }
    this.runs.set(subagentRunId, snapshot)

    this.emitLifecycleEvent({
      parentSessionId: taskSpec.parentSessionId,
      userId: childSession.userId,
      eventType: 'run_started',
      metadata: {
        taskId: childSession.taskId ?? childSession.sessionId,
        childSessionId: childSession.sessionId,
        runId: subagentRunId,
        agentProfile: profileLabel,
        launchMode: taskSpec.launchMode,
        status: 'running',
      },
    })

    return {
      childSessionId: childSession.sessionId,
      taskId: childSession.taskId ?? childSession.sessionId,
      subagentRunId,
      childSession,
      isResume,
    }
  }

  async executeRun(subagentRunId: string, signal?: AbortSignal): Promise<SubagentResult> {
    const run = this.loadRun(subagentRunId)
    if (!run) {
      throw new ChildTaskRuntimeError(CHILD_TASK_RUN_NOT_FOUND, `Subagent run not found: ${subagentRunId}`)
    }

    if (run.isCancelled) {
      const cancelledResult = this.createCancelledResult()
      run.result = cancelledResult
      run.status = 'cancelled'
      run.completedAt = new Date().toISOString()
      this.persistRunState(run)
      return cancelledResult
    }

    const childSession = this.deps.sessionStore.getChildSessionById(run.childSessionId, run.tenantId)
    if (!childSession) {
      throw new ChildTaskRuntimeError(CHILD_TASK_NOT_FOUND, `Child session no longer exists: ${run.childSessionId}`)
    }

    run.status = 'running'
    run.startedAt = new Date().toISOString()
    this.persistRunState(run)

    this.recordTranscript(
      run.subagentRunId,
      'SubagentRunStarted',
      { subagentRunId, startedAt: run.startedAt },
      run.tenantId,
      run.userId,
      run.childSessionId,
    )

    // Profile-specific runner: resolve the profile definition + envelope-intersected
    // tool projection, then delegate to the profile runner. Search children run
    // through the specialized search runner (Todo 16) with the hard-pinned
    // `web_search`-only projection; everything else uses the generic kernel loop.
    const definition = resolveChildProfile(
      run.taskSpec.profileId ?? childSession.agentProfile ?? run.taskSpec.agentType,
      this.deps.registry,
    )
    const isSearchChild =
      this.deps.searchRunner !== undefined &&
      (run.taskSpec.profileId === SEARCH_CHILD_PROFILE_ID || run.taskSpec.agentType === SEARCH_CHILD_PROFILE_ID)

    const toolProjection = isSearchChild
      ? buildSearchChildProjection({
          toolRegistry: this.deps.toolRegistry,
          envelopeRegistry: this.deps.envelopeRegistry,
        })
      : buildChildToolProjection({
          definition,
          taskSpec: run.taskSpec,
          toolRegistry: this.deps.toolRegistry,
          envelopeRegistry: this.deps.envelopeRegistry,
          depth: childSession.subagentDepth ?? 1,
          allowNestedLaunch: run.taskSpec.allowNestedLaunch,
        })

    // Explicit context: objective + refs + workdir + platform prompt. On resume
    // this includes ONLY the prior child transcript (never the parent's).
    const priorConversation = this.loadChildConversation(childSession.sessionId, run.tenantId)

    // Planner children: generate the real plan (LLM with deterministic fallback),
    // persist it into plan_store, then inject the steps into the child context so
    // the kernel loop executes against the written plan and writes progress back.
    const isPlannerChild = run.taskSpec.profileId === 'planner' || run.taskSpec.agentType === 'planner'
    let planSteps: PlanStep[] | undefined
    if (isPlannerChild && run.taskSpec.plannerRunId && this.deps.planGenerator && this.deps.plannerRuntime) {
      const toolDescriptions: Record<string, string> = {}
      for (const tool of toolProjection.tools ?? []) {
        const { name, description } = tool.function
        if (name && description) toolDescriptions[name] = description
      }
      const generated = await this.deps.planGenerator.generate({
        goal: run.taskSpec.objective,
        availableTools: toolProjection.toolIds,
        toolDescriptions: Object.keys(toolDescriptions).length > 0 ? toolDescriptions : undefined,
        constraints: { maxSteps: 10 },
      })
      planSteps = mapSchemaPlanStepsToStorage(generated.plan.steps)
      this.deps.plannerRuntime.setPlanSteps(run.taskSpec.plannerRunId, planSteps)
    }

    const contextBundle = buildChildContextBundle({
      childSession,
      runId: subagentRunId,
      definition,
      taskSpec: run.taskSpec,
      toolProjection,
      priorConversation,
      planSteps,
    })

    const internalToolHandlers =
      isPlannerChild && run.taskSpec.plannerRunId && this.deps.plannerRuntime
        ? buildPlannerInternalHandlers({
            plannerRuntime: this.deps.plannerRuntime,
            plannerRunId: run.taskSpec.plannerRunId,
          })
        : undefined

    const maxIterations = run.taskSpec.maxIterations ?? this.deps.defaultMaxIterations ?? 10
    const timeoutMs = run.taskSpec.timeoutMs ?? this.deps.defaultTimeoutMs ?? 60000

    try {
      let result: SubagentResult
      if (isSearchChild) {
        result = await this.deps.searchRunner!({
          subagentRunId: run.subagentRunId,
          childSessionId: run.childSessionId,
          userId: run.userId,
          tenantId: run.tenantId,
          query: run.taskSpec.objective,
          searchPlanHints: parseSearchPlanHints(run.taskSpec.searchPlanHints, run.taskSpec.objective),
          timeoutMs,
          signal: this.buildRunSignal(subagentRunId, signal),
        })
      } else {
        const kernelResult = await this.deps.kernelAdapter.execute({
          contextBundle,
          maxIterations,
          timeoutMs,
          onCancel: () => run.isCancelled,
          taskSpec: run.taskSpec,
          definition,
          signal: this.buildRunSignal(subagentRunId, signal),
          internalToolHandlers,
        })
        result = this.mapKernelResultToSubagentResult(kernelResult)
      }

      // Planner child completion fallback: close the planner run even when the
      // child LLM never called foreground_complete_planner explicitly.
      if (result.status === 'completed' && run.taskSpec.plannerRunId && this.deps.plannerRuntime) {
        try {
          this.deps.plannerRuntime.completePlannerRun(
            run.taskSpec.plannerRunId,
            typeof result.response === 'string' ? result.response.slice(0, 500) : undefined,
          )
        } catch {
          // Best-effort: the run may already be terminal (completePlannerRun is idempotent).
        }
      }

      // Idempotent terminal write: a concurrent cancel wins over late completion.
      if (run.isCancelled) {
        return run.result ?? this.createCancelledResult()
      }

      run.result = result
      run.status = result.status
      run.completedAt = new Date().toISOString()
      this.persistRunState(run)
      this.emitLifecycleEvent({
        parentSessionId: run.taskSpec.parentSessionId,
        userId: run.userId,
        eventType:
          result.status === 'completed'
            ? 'run_completed'
            : result.status === 'cancelled'
              ? 'run_cancelled'
              : 'run_failed',
        metadata: {
          taskId: run.taskId,
          childSessionId: run.childSessionId,
          runId: run.subagentRunId,
          agentProfile: run.taskSpec.profileId,
          launchMode: run.taskSpec.launchMode,
          status: run.status,
          ...(result.error?.message ? { safeMessage: result.error.message.slice(0, 500) } : {}),
        },
      })
      this.persistChildConversation(run, result)
      this.recordTranscript(
        run.subagentRunId,
        'SubagentRunCompleted',
        { subagentRunId, status: run.status, iterationsUsed: result.iterationsUsed, completedAt: run.completedAt },
        run.tenantId,
        run.userId,
        run.childSessionId,
      )

      return result
    } catch (error) {
      if (run.isCancelled) {
        const cancelledResult = this.createCancelledResult()
        run.result = cancelledResult
        run.status = 'cancelled'
        run.completedAt = new Date().toISOString()
        this.persistRunState(run)
        return cancelledResult
      }

      const errorMessage = error instanceof Error ? error.message : String(error)
      const failedResult: SubagentResult = {
        status: 'failed',
        response: undefined,
        toolCalls: [],
        error: { code: 'EXECUTION_ERROR', message: errorMessage },
        iterationsUsed: 0,
        startedAt: run.startedAt,
        completedAt: new Date().toISOString(),
      }
      run.result = failedResult
      run.status = 'failed'
      run.completedAt = new Date().toISOString()
      this.persistRunState(run)
      this.emitLifecycleEvent({
        parentSessionId: run.taskSpec.parentSessionId,
        userId: run.userId,
        eventType: 'run_failed',
        metadata: {
          taskId: run.taskId,
          childSessionId: run.childSessionId,
          runId: run.subagentRunId,
          agentProfile: run.taskSpec.profileId,
          launchMode: run.taskSpec.launchMode,
          status: 'failed',
          safeMessage: errorMessage.slice(0, 500),
        },
      })
      this.recordTranscript(
        run.subagentRunId,
        'SubagentRunFailed',
        { subagentRunId, errorCode: 'EXECUTION_ERROR', errorMessage, completedAt: run.completedAt },
        run.tenantId,
        run.userId,
        run.childSessionId,
      )
      return failedResult
    } finally {
      this.runControllers.delete(subagentRunId)
    }
  }

  cancelRun(subagentRunId: string): SubagentResult {
    const run = this.loadRun(subagentRunId)
    if (!run) {
      throw new ChildTaskRuntimeError(CHILD_TASK_RUN_NOT_FOUND, `Subagent run not found: ${subagentRunId}`)
    }

    // Idempotent cancel: an already-terminal run returns its existing result.
    if (run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled') {
      return run.result ?? this.createCancelledResult()
    }

    run.isCancelled = true
    this.runControllers.get(subagentRunId)?.abort()

    const cancelledResult = this.createCancelledResult()
    run.result = cancelledResult
    run.status = 'cancelled'
    run.completedAt = new Date().toISOString()
    this.persistRunState(run)
    this.emitLifecycleEvent({
      parentSessionId: run.taskSpec.parentSessionId,
      userId: run.userId,
      eventType: 'run_cancelled',
      metadata: {
        taskId: run.taskId,
        childSessionId: run.childSessionId,
        runId: run.subagentRunId,
        agentProfile: run.taskSpec.profileId,
        launchMode: run.taskSpec.launchMode,
        status: 'cancelled',
        safeMessage: 'Subagent execution was cancelled',
      },
    })
    this.recordTranscript(
      run.subagentRunId,
      'SubagentRunCancelled',
      { subagentRunId, completedAt: run.completedAt },
      run.tenantId,
      run.userId,
      run.childSessionId,
    )

    return cancelledResult
  }

  async runTask(input: ChildTaskLaunchInput, signal?: AbortSignal): Promise<ChildTaskExecutionResult> {
    const launch = this.launchTask(input)
    const result = await this.executeRun(launch.subagentRunId, signal)
    return { ...launch, result }
  }

  getRun(subagentRunId: string): ChildTaskRunSnapshot | undefined {
    return this.loadRun(subagentRunId)
  }

  getChildSession(taskId: string, tenantId: string = DEFAULT_TENANT_ID): Session | undefined {
    return this.deps.sessionStore.getChildSessionById(taskId, tenantId) ?? undefined
  }

  // -------------------------------------------------------------------------
  // Private: child session resolution
  // -------------------------------------------------------------------------

  private resolveOrCreateChildSession(
    input: ChildTaskLaunchInput,
    tenantId: string,
  ): { childSession: Session; isResume: boolean; decision: ChildLaunchDecision } {
    const { taskSpec, depth, launchesInParentTurn } = input

    if (input.taskId !== undefined && input.taskId !== '') {
      // ---- RESUME path: taskId must resolve to a live child of this user+parent.
      const existing = this.deps.sessionStore.getById(input.taskId, tenantId)
      if (!existing) {
        throw new ChildTaskRuntimeError(CHILD_TASK_NOT_FOUND, `No task found for taskId "${input.taskId}"`)
      }
      if (existing.sessionKind !== 'subagent' || existing.taskId !== existing.sessionId) {
        throw new ChildTaskRuntimeError(
          CHILD_TASK_NOT_CHILD,
          `taskId "${input.taskId}" does not reference a child session`,
        )
      }
      if (existing.userId !== input.parentContext.userId) {
        throw new ChildTaskRuntimeError(CHILD_TASK_FOREIGN, `taskId "${input.taskId}" belongs to another user`)
      }
      if (existing.parentSessionId !== taskSpec.parentSessionId) {
        throw new ChildTaskRuntimeError(
          CHILD_TASK_FOREIGN,
          `taskId "${input.taskId}" belongs to a different parent session than "${taskSpec.parentSessionId}"`,
        )
      }
      if (existing.status === 'archived' || existing.status === 'closed') {
        throw new ChildTaskRuntimeError(
          CHILD_TASK_ARCHIVED,
          `taskId "${input.taskId}" is archived and cannot be resumed`,
        )
      }
      assertChildTaskIdMatchesSession(input.taskId, existing.sessionId)

      // Policy gate BEFORE any new row is created (depth/launch/profile/tools).
      const decision = evaluateChildLaunch({
        childSessionId: existing.sessionId,
        depth,
        launchesInParentTurn,
        profileId: taskSpec.profileId,
        requestedTools: input.requestedTools ?? taskSpec.tools ?? [],
        registry: this.deps.registry,
        toolRegistry: this.deps.toolRegistry,
        envelopeRegistry: this.deps.envelopeRegistry,
        allowNestedLaunch: taskSpec.allowNestedLaunch,
      })
      return { childSession: existing, isResume: true, decision }
    }

    // ---- FRESH path: generate the child session id first, then evaluate the
    //      policy so the identity rule (taskId === childSessionId) holds.
    const childSessionId = generateId(SESSION_ID_PREFIX)
    const decision = evaluateChildLaunch({
      childSessionId,
      depth,
      launchesInParentTurn,
      profileId: taskSpec.profileId,
      requestedTools: input.requestedTools ?? taskSpec.tools ?? [],
      registry: this.deps.registry,
      toolRegistry: this.deps.toolRegistry,
      envelopeRegistry: this.deps.envelopeRegistry,
      allowNestedLaunch: taskSpec.allowNestedLaunch,
    })

    const childSession = this.deps.sessionStore.createChildSession(
      {
        sessionId: childSessionId,
        userId: input.parentContext.userId,
        parentSessionId: taskSpec.parentSessionId,
        taskId: childSessionId,
        agentProfile: decision.profile.agentProfile ?? decision.profile.agentType,
        launchMode: taskSpec.launchMode,
        subagentDepth: depth,
        title: taskSpec.objective.slice(0, 80),
      },
      tenantId,
    )
    return { childSession, isResume: false, decision }
  }

  // -------------------------------------------------------------------------
  // Private: run persistence
  // -------------------------------------------------------------------------

  private loadRun(subagentRunId: string): ChildTaskRunSnapshot | undefined {
    const cached = this.runs.get(subagentRunId)
    if (cached) return cached

    const record = this.deps.runStore.getById(subagentRunId)
    if (!record) return undefined

    const snapshot = this.recordToSnapshot(record)
    this.runs.set(subagentRunId, snapshot)
    return snapshot
  }

  private recordToSnapshot(record: SubagentRunRecord): ChildTaskRunSnapshot {
    let taskSpec: ChildTaskSpec
    try {
      taskSpec = JSON.parse(record.taskSpecJson) as ChildTaskSpec
    } catch {
      taskSpec = {
        objective: 'Unknown task',
        profileId: record.agentProfile ?? record.agentType,
        parentSessionId: '',
        launchMode: 'foreground',
      }
    }

    let result: SubagentResult | undefined
    if (record.resultJson) {
      try {
        result = JSON.parse(record.resultJson) as SubagentResult
      } catch {
        result = undefined
      }
    }

    return {
      subagentRunId: record.subagentRunId,
      taskId: record.taskId ?? record.childSessionId ?? record.subagentRunId,
      childSessionId: record.childSessionId ?? record.sessionId ?? record.subagentRunId,
      userId: record.userId,
      status: record.status as SubagentRunState,
      taskSpec,
      result,
      parentRunId: record.parentRunId,
      rootRunId: record.rootRunId,
      createdAt: record.createdAt,
      startedAt: record.startedAt,
      completedAt: record.completedAt,
      isCancelled: record.status === 'cancelled',
      tenantId: record.tenantId ?? DEFAULT_TENANT_ID,
    }
  }

  private persistRunState(run: ChildTaskRunSnapshot): void {
    this.deps.runStore.updateStatus(run.subagentRunId, run.status, run.tenantId)
    if (run.result) {
      this.deps.runStore.saveResult(run.subagentRunId, run.result, run.tenantId)
    }
  }

  /**
   * Persist + best-effort broadcast one parent-side task lifecycle event.
   * Observability must never fail child/parent processing (project
   * anti-pattern #11): persistence and broadcast failures are swallowed
   * independently, and persistence always happens before broadcast so a
   * throwing broadcaster cannot drop the event.
   */
  private emitLifecycleEvent(input: {
    parentSessionId: string
    userId: string
    eventType: ChildTaskLifecycleEventType
    metadata: ChildTaskLifecycleMetadata
  }): void {
    if (!input.parentSessionId) return

    try {
      const event = buildChildTaskLifecycleEvent({
        parentSessionId: input.parentSessionId,
        userId: input.userId,
        eventType: input.eventType,
        metadata: input.metadata,
      })
      this.deps.eventStore?.append(event)
      try {
        this.deps.lifecycleBroadcaster?.broadcast(input.parentSessionId, {
          eventId: event.eventId,
          eventType: event.eventType,
          sessionId: event.sessionId!,
          timestamp: event.createdAt,
          content: input.metadata.safeMessage,
          metadata: { ...input.metadata },
          actor: event.sourceModule,
        })
      } catch {
        // Best-effort broadcast — an observability failure must not fail the run.
      }
    } catch {
      // Best-effort persistence — same guarantee.
    }
  }

  // -------------------------------------------------------------------------
  // Private: child transcript persistence + resume loading
  // -------------------------------------------------------------------------

  private recordTranscript(
    subagentRunId: string,
    eventType: string,
    content: unknown,
    tenantId: string,
    userId: string,
    sessionId?: string,
  ): void {
    this.deps.transcriptStore.append(
      {
        id: `transcript-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        subagentRunId,
        eventType,
        contentJson: JSON.stringify(content),
        createdAt: new Date().toISOString(),
        tenantId,
        sessionId,
        userId,
      },
      tenantId,
    )
  }

  /** Persist the child's completed turn so a later resume can restore it. */
  private persistChildConversation(run: ChildTaskRunSnapshot, result: SubagentResult): void {
    if (!run.completedAt) run.completedAt = new Date().toISOString()
    this.deps.transcriptStore.append(
      {
        id: `transcript-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        subagentRunId: run.subagentRunId,
        eventType: CHILD_TURN_COMPLETED,
        contentJson: JSON.stringify({
          role: 'assistant',
          task: run.taskSpec.objective,
          content: result.response ?? '',
          finalStatus: result.status,
          completedAt: run.completedAt,
        }),
        createdAt: new Date().toISOString(),
        tenantId: run.tenantId,
        sessionId: run.childSessionId,
        userId: run.userId,
      },
      run.tenantId,
    )
  }

  /**
   * Load the prior child transcript for a resume. Reads ONLY the child's own
   * persisted conversation (subagent_runs scoped by childSessionId + their
   * ChildTurnCompleted transcript events) — the parent conversation is never
   * consulted.
   */
  private loadChildConversation(childSessionId: string, tenantId: string): string | undefined {
    const priorRuns = this.deps.runStore.query({ childSessionId }, tenantId).filter((run) => run.status === 'completed')

    const lines: string[] = []
    for (const run of priorRuns) {
      const records = this.deps.transcriptStore.getByRunId(run.subagentRunId, tenantId)
      for (const record of records) {
        if (record.eventType !== CHILD_TURN_COMPLETED) continue
        try {
          const data = JSON.parse(record.contentJson) as { task?: string; content?: string }
          if (data.task) lines.push(`[Prior task] ${data.task}`)
          if (data.content) lines.push(`[Prior result] ${data.content}`)
        } catch {
          // A malformed transcript event is skipped — resume stays safe.
        }
      }
    }

    return lines.length > 0 ? lines.join('\n') : undefined
  }

  // -------------------------------------------------------------------------
  // Private: kernel result mapping / cancellation signals
  // -------------------------------------------------------------------------

  private mapKernelResultToSubagentResult(kernelResult: KernelRunResult): SubagentResult {
    const status = this.mapKernelStatusToSubagentStatus(kernelResult.finalStatus)
    const error =
      status === 'cancelled' ? { code: 'CANCELLED', message: 'Subagent execution was cancelled' } : kernelResult.error

    return {
      status,
      response: kernelResult.finalResponse,
      toolCalls: kernelResult.toolCalls.map((tc) => ({
        toolCallId: tc.toolCallId,
        toolName: tc.toolName,
        params: tc.params,
      })),
      error,
      iterationsUsed: kernelResult.iterationsUsed,
    }
  }

  private mapKernelStatusToSubagentStatus(kernelStatus: KernelRunResult['finalStatus']): SubagentResult['status'] {
    switch (kernelStatus) {
      case 'completed':
        return 'completed'
      case 'cancelled':
        return 'cancelled'
      default:
        return 'failed'
    }
  }

  private createCancelledResult(): SubagentResult {
    return {
      status: 'cancelled',
      response: undefined,
      toolCalls: [],
      error: { code: 'CANCELLED', message: 'Subagent execution was cancelled' },
      iterationsUsed: 0,
      completedAt: new Date().toISOString(),
    }
  }

  /**
   * Merge the external (parent dispatch) signal with the per-run cancellation
   * controller so cancelRun can abort a live child kernel.
   */
  private buildRunSignal(subagentRunId: string, external?: AbortSignal): AbortSignal | undefined {
    let controller = this.runControllers.get(subagentRunId)
    if (!controller) {
      controller = new AbortController()
      this.runControllers.set(subagentRunId, controller)
    }

    const signals: AbortSignal[] = [controller.signal]
    if (external) signals.push(external)

    if (signals.length === 1) return signals[0]

    const merged = new AbortController()
    const propagate = (): void => merged.abort()
    for (const signal of signals) {
      if (signal.aborted) {
        merged.abort()
        return merged.signal
      }
      signal.addEventListener('abort', propagate, { once: true })
    }
    return merged.signal
  }
}

function generateSubagentRunId(): string {
  return `subagent-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export function createChildSessionTaskRuntime(deps: ChildSessionTaskRuntimeDeps): ChildSessionTaskRuntime {
  return new ChildSessionTaskRuntimeImpl(deps)
}

function buildPlannerInternalHandlers(deps: {
  plannerRuntime: PlannerRuntime
  plannerRunId: string
}): Record<string, InternalToolHandler> {
  return {
    foreground_mark_planner_step: async (request) => {
      const params = (request.params ?? {}) as { stepId?: string; status?: string; result?: string }
      if (!params.stepId || typeof params.stepId !== 'string') {
        return {
          toolResult: {
            toolCallId: request.toolCallId,
            result: null,
            error: { code: 'INVALID_ARGUMENTS', message: 'stepId is required', recoverable: true },
          },
        }
      }
      const status =
        params.status === 'failed' ? 'failed' : params.status === 'in_progress' ? 'in_progress' : 'completed'
      try {
        deps.plannerRuntime.markStep(deps.plannerRunId, params.stepId, status, params.result)
        return {
          toolResult: {
            toolCallId: request.toolCallId,
            result: { stepId: params.stepId, status },
          },
        }
      } catch (error) {
        return {
          toolResult: {
            toolCallId: request.toolCallId,
            result: null,
            error: {
              code: 'MARK_STEP_FAILED',
              message: error instanceof Error ? error.message : String(error),
              recoverable: true,
            },
          },
        }
      }
    },
    foreground_complete_planner: async (request) => {
      const params = (request.params ?? {}) as { summary?: string }
      try {
        const outcome = deps.plannerRuntime.completePlannerRun(
          deps.plannerRunId,
          typeof params.summary === 'string' ? params.summary : undefined,
        )
        return {
          toolResult: {
            toolCallId: request.toolCallId,
            result: { plannerRunId: deps.plannerRunId, status: outcome.status },
          },
          stop: true,
        }
      } catch (error) {
        return {
          toolResult: {
            toolCallId: request.toolCallId,
            result: null,
            error: {
              code: 'COMPLETE_PLANNER_FAILED',
              message: error instanceof Error ? error.message : String(error),
              recoverable: true,
            },
          },
        }
      }
    },
  }
}

// ---------------------------------------------------------------------------
// Budget-bounded wait (shared by foreground waits / the search child tool)
// ---------------------------------------------------------------------------

export type ChildWaitOutcome =
  | { outcome: 'completed'; result: SubagentResult }
  | { outcome: 'timeout' }
  | { outcome: 'aborted' }

/**
 * Wait for a child attempt with a hard budget. On budget expiry OR external
 * abort, `cancelRun` fires so the live child run is aborted (no orphan) and a
 * late terminal can never overwrite the cancelled run.
 */
export function waitForChildExecution(
  runtime: ChildSessionTaskRuntime,
  subagentRunId: string,
  budgetMs: number,
  signal?: AbortSignal,
): Promise<ChildWaitOutcome> {
  return new Promise((resolve) => {
    let settled = false
    let timeoutId: ReturnType<typeof setTimeout> | undefined

    const settle = (outcome: ChildWaitOutcome): void => {
      if (settled) return
      settled = true
      if (timeoutId !== undefined) clearTimeout(timeoutId)
      signal?.removeEventListener('abort', onAbort)
      resolve(outcome)
    }

    const cancel = (): void => {
      try {
        runtime.cancelRun(subagentRunId)
      } catch {
        // cancelRun is idempotent; an unknown run simply has nothing to cancel.
      }
    }

    const onAbort = (): void => {
      cancel()
      settle({ outcome: 'aborted' })
    }

    if (signal?.aborted) {
      onAbort()
      return
    }
    signal?.addEventListener('abort', onAbort, { once: true })

    timeoutId = setTimeout(
      () => {
        cancel()
        settle({ outcome: 'timeout' })
      },
      Math.max(0, budgetMs),
    )

    void runtime.executeRun(subagentRunId, signal).then(
      (result) => settle({ outcome: 'completed', result }),
      () => settle({ outcome: 'timeout' }),
    )
  })
}
