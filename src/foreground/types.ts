/**
 * Foreground Conversation Agent Types
 * Based on foreground_conversation_agent_and_planner_agent_v1.md
 */

import type { PermissionContext } from '../permissions/types.js'
import type { ToolCategory } from '../tools/types.js'
import type { TargetRuntime, RuntimeAction } from '../dispatcher/types.js'
import type { Stores } from '../gateway/types.js'
import type { HydratedSessionState, ActiveWorkRefs } from '../gateway/types.js'
import type { AgentConfig } from '../storage/agent-config-store.js'

/**
 * Decision routes for foreground conversation agent
 */
export type ForegroundDecisionRoute =
  | 'answer_directly'
  | 'dispatch_tool'
  | 'dispatch_subagent'
  | 'spawn_planner'
  | 'resume_existing_planner'
  | 'approval_handler'
  | 'cancel_or_modify_task'
  | 'status_query'

/**
 * Complexity levels for tasks
 */
export type TaskComplexity = 'low' | 'medium' | 'high' | 'critical'

/**
 * Direct Delegation Policy
 * Controls when direct tool/subagent dispatch is allowed vs spawning a planner
 */
export interface DirectDelegationPolicy {
  /** Threshold for spawning planner (default: 3 steps) */
  estimatedStepsGte: number
  /** Maximum complexity allowed for direct dispatch */
  maxComplexity: TaskComplexity
  /** Which tool categories can be dispatched directly */
  allowedToolCategories: ToolCategory[]
  /** Operation types requiring confirmation even within allowed categories */
  requireConfirmationFor?: string[]
}

/**
 * Default direct delegation policy
 */
export const DEFAULT_DIRECT_DELEGATION_POLICY: DirectDelegationPolicy = {
  estimatedStepsGte: 3,
  maxComplexity: 'medium',
  allowedToolCategories: ['read', 'search', 'internal'],
}

/**
 * Behavior preferences for the assistant persona.
 * Structured knobs controlling expression style.
 */
export interface BehaviorPreferences {
  /** Response verbosity level */
  verbosity?: 'concise' | 'balanced' | 'verbose'
  /** Code comment style preference */
  codeCommentStyle?: 'minimal' | 'explanatory' | 'documented'
  /** Depth of explanations */
  explanationDepth?: 'brief' | 'moderate' | 'detailed'
  /** Formality level */
  formality?: 'casual' | 'professional' | 'formal'
}

/**
 * User address preferences for the assistant persona.
 */
export interface UserAddressPreferences {
  /** Preferred name for the user */
  preferredName?: string
  /** User's pronouns */
  pronouns?: string
  /** Preferred language */
  language?: string
}

/**
 * Assistant Persona Profile — Canonical Rich Type
 *
 * Defines the persona for the foreground conversation agent.
 * This is the SINGLE source of truth for AssistantPersonaProfile.
 * The context/types.ts version re-exports this type.
 *
 * Persona-owned fields (style, tone, boundaries) affect expression
 * but cannot override system rules, safety constraints, tool authorization,
 * output schemas, or tenant boundaries.
 */
export interface AssistantPersonaProfile {
  // ── Identity ────────────────────────────────────────────────────────────
  /** Unique identifier for this persona */
  personaId: string
  /** Display name of the assistant */
  name: string
  /** Optional display identity (e.g., "Your friendly AI helper") */
  displayIdentity?: string

  // ── Background ──────────────────────────────────────────────────────────
  /** Optional description of the persona */
  description?: string
  /** Background information or expertise area */
  background?: string

  // ── Expression ──────────────────────────────────────────────────────────
  /** Tone of the assistant (e.g., "warm and professional") */
  tone?: string
  /** Personality traits (e.g., "patient, detail-oriented, encouraging") */
  personality?: string

  // ── Behavior Preferences ────────────────────────────────────────────────
  /** Structured behavior preference knobs */
  behaviorPreferences?: BehaviorPreferences
  /** User address preferences */
  userAddressPreferences?: UserAddressPreferences

  // ── Boundaries & Constraints ────────────────────────────────────────────
  /** Soft boundaries the persona should respect (advisory) */
  boundaries?: string[]
  /** Hard non-overridable constraints (platform-enforced) */
  nonOverridableConstraints?: string[]

  // ── Legacy Fields (backward compat) ─────────────────────────────────────
  /** @legacy Direct delegation policy for this persona */
  directDelegationPolicy?: DirectDelegationPolicy
  /** @legacy Constraints that cannot be overridden */
  constraints?: {
    /** Maximum tokens for direct responses */
    maxDirectResponseTokens?: number
    /** Whether planner is required for multi-step tasks */
    requirePlannerForMultiStep?: boolean
    /** Whether approvals are required for certain operations */
    requireApprovalsFor?: string[]
  }
}

/**
 * Default assistant persona
 */
export const DEFAULT_ASSISTANT_PERSONA: AssistantPersonaProfile = {
  personaId: 'default-assistant',
  name: 'Assistant',
  description: 'Default helpful assistant',
  directDelegationPolicy: DEFAULT_DIRECT_DELEGATION_POLICY,
  constraints: {
    requirePlannerForMultiStep: true,
  },
}

/**
 * Foreground Agent Configuration
 */
export interface ForegroundAgentConfig {
  /** The assistant persona to use */
  persona: AssistantPersonaProfile
  /** Permission context for the session */
  permissionContext: PermissionContext
  /** Available stores for state management */
  stores: Stores
  /** System-level delegation policy (takes precedence over persona) */
  systemDelegationPolicy?: Partial<DirectDelegationPolicy>
}

/**
 * Target reference for runtime actions
 */
export interface ForegroundTargetRef {
  /** Planner run ID if applicable */
  plannerRunId?: string
  /** Plan ID if applicable */
  planId?: string
  /** Runtime action ID for active work */
  runtimeActionId?: string
  /** Subagent run ID if applicable */
  subagentRunId?: string
  /** Workflow run ID if applicable */
  workflowRunId?: string
}

/**
 * Foreground Decision
 * Result of processing a user message
 *
 * @deprecated This type is NOT the main foreground output. Use
 * `ForegroundTurnResult` from `foreground-runner-types.ts` instead.
 * `ForegroundDecision` is retained for diagnostic logging and response metadata.
 *
 * @historical Pre-dates the kernel-driven turn architecture.
 */
export interface ForegroundDecision {
  /** The decision route to take */
  route: ForegroundDecisionType
  /** Whether a planner is required for this task */
  requiresPlanner: boolean
  /** Target runtime for the action (if not answer_directly) */
  targetRuntime?: TargetRuntime
  /** Target action type (if not answer_directly) */
  targetAction?: string
  /** Reason for the decision */
  reason: string
  /** Human-readable response to show the user immediately */
  userVisibleResponse?: string
  /** Reference to target objects */
  targetRef?: ForegroundTargetRef
  /** Runtime action to dispatch (for non-direct routes) */
  runtimeAction?: RuntimeAction
  /** Estimated number of steps for this task */
  estimatedSteps?: number
  /** Suggested tools for dispatch_tool route */
  suggestedTools?: string[]
  /** Detected complexity level */
  complexity?: TaskComplexity
}

/**
 * Input for processing a message
 */
export interface ForegroundMessageInput {
  /** User message text */
  message: string
  /** User ID */
  userId: string
  /** Session ID */
  sessionId: string
  /** Current turn ID */
  turnId: string
  /** Timestamp of the message */
  timestamp: string
  /** Optional message metadata */
  metadata?: {
    /** Whether this is an approval response */
    isApprovalResponse?: boolean
    /** Approval response details if applicable */
    approvalResponse?: {
      requestId: string
      approved: boolean
      reason?: string
    }
    /** Referenced message IDs */
    references?: string[]
    /** Source channel */
    channel?: string
  }
}

/**
 * State for foreground conversation processing
 */
export interface ForegroundSessionState {
  /** Hydrated session state from gateway */
  hydratedSession: HydratedSessionState
  /** Active work references */
  activeWorkRefs: ActiveWorkRefs
  /** Current persona in use */
  currentPersona: AssistantPersonaProfile
  /** Effective delegation policy (system + persona merged) */
  effectivePolicy: DirectDelegationPolicy
  /** Effective agent configuration (merged global + user override) */
  agentConfig?: AgentConfig
  /** Resolved LLM provider ID from provider resolution */
  resolvedProvider?: string
  /** Resolved LLM model from provider resolution */
  resolvedModel?: string
  /** Conversation history for context */
  conversationHistory?: Array<{
    turnId: string
    role: 'user' | 'assistant'
    message: string
    timestamp: string
  }>
  /** Pending approvals waiting for user response */
  pendingApprovals?: Array<{
    approvalId: string
    actionSummary: string
    requestedAt: string
  }>
}

/**
 * Keywords and patterns for intent detection
 */
export interface IntentPatterns {
  /** Words indicating cancellation */
  cancelKeywords: string[]
  /** Words indicating status query */
  statusKeywords: string[]
  /** Words indicating approval responses */
  approveKeywords: string[]
  rejectKeywords: string[]
  /** Question indicators */
  questionIndicators: string[]
  /** Action verbs that indicate non-question tasks */
  actionVerbs: string[]
  /** Complex task indicators */
  complexTaskIndicators: string[]
  /** Multi-step indicators */
  multiStepIndicators: string[]
}

/**
 * Default intent patterns
 */
export const DEFAULT_INTENT_PATTERNS: IntentPatterns = {
  cancelKeywords: ['cancel', 'stop', 'abort', 'terminate', '取消', '停止', '中止', '终止'],
  statusKeywords: [
    'status',
    'progress',
    'how is',
    'what is the status',
    'active work',
    'my tasks',
    'going',
    'show me',
    '状态',
    '进度',
    '进展',
    '情况',
  ],
  approveKeywords: ['approve', 'yes', 'ok', 'confirm', 'allow', 'proceed', '批准', '同意', '确认', '允许', '好的'],
  rejectKeywords: ['reject', 'no', 'deny', 'decline', 'disallow', '拒绝', '不同意', '不允许', '不行'],
  questionIndicators: [
    '?',
    '？',
    '吗',
    '呢',
    'what',
    'how',
    'why',
    'when',
    'where',
    '什么',
    '怎么',
    '为什么',
    '什么时候',
    '哪里',
    '如何',
  ],
  actionVerbs: [
    'send',
    'create',
    'update',
    'delete',
    'search',
    'find',
    'get',
    'make',
    'build',
    'write',
    'generate',
    'schedule',
    'book',
    '发送',
    '创建',
    '更新',
    '删除',
    '搜索',
    '查找',
    '获取',
    '制作',
    '构建',
    '编写',
    '写',
    '生成',
    '安排',
    '预订',
  ],
  complexTaskIndicators: [
    'plan',
    'organize',
    'prepare',
    'coordinate',
    'manage',
    '规划',
    '安排',
    '准备',
    '协调',
    '管理',
  ],
  multiStepIndicators: [
    'and then',
    'after that',
    'next',
    'first',
    'second',
    '和',
    '然后',
    '接着',
    '之后',
    '首先',
    '其次',
    '第一步',
    '第二步',
  ],
}

/**
 * Task analysis result
 */
export interface TaskAnalysis {
  /** Estimated number of steps */
  estimatedSteps: number
  /** Detected complexity */
  complexity: TaskComplexity
  /** Whether this appears to be a question */
  isQuestion: boolean
  /** Whether this contains multiple actions */
  hasMultipleActions: boolean
  /** Detected tool category if applicable */
  toolCategory?: ToolCategory
  /** Detected tool name if applicable */
  toolName?: string
  /** Whether this is a simple read operation */
  isSimpleRead: boolean
}

/**
 * Foreground decision types
 * (Alias for backward compatibility)
 */
export type ForegroundDecisionType = ForegroundDecisionRoute

/**
 * Active work resolution result
 */
export interface ActiveWorkResolution {
  /** Type of active work found */
  workType: 'planner_run' | 'runtime_action' | 'subagent_run' | 'workflow_run' | 'approval' | null
  /** ID of the active work */
  workId?: string
  /** Summary of the active work */
  workSummary?: string
  /** Whether the work can be cancelled/modified */
  canCancel: boolean
  /** Current status of the work */
  status?: string
}

export type InterruptActionType = 'cancel' | 'modify' | 'pause' | 'resume' | 'query'

export interface StatusQueryResult {
  success: boolean
  activePlannerRuns: Array<{
    runId: string
    status: string
    objective?: string
    progress?: number
  }>
  activeBackgroundRuns: Array<{
    runId: string
    status: string
    objective?: string
  }>
  pendingApprovals: Array<{
    approvalId: string
    actionSummary: string
    requestedAt: string
  }>
  totalActive: number
  queriedAt: string
  error?: string
}

export interface InterruptRequest {
  actionType: InterruptActionType
  targetWorkType: 'planner_run' | 'runtime_action' | 'subagent_run' | 'workflow_run' | null
  targetWorkId?: string
  newObjective?: string
  reason: string
  userId: string
  sessionId: string
}

export interface InterruptResult {
  success: boolean
  actionTaken: string
  targetWorkId?: string
  error?: string
  needsClarification?: boolean
  clarificationPrompt?: string
  activeWorkOptions?: Array<{
    workId: string
    workType: string
    description: string
  }>
}

export interface InterruptActionFactory {
  createCancelAction(request: InterruptRequest): RuntimeAction
  createModifyAction(request: InterruptRequest): RuntimeAction
  createPauseAction(request: InterruptRequest): RuntimeAction
  createResumeAction(request: InterruptRequest): RuntimeAction
  createStatusQueryAction(userId: string, sessionId: string): RuntimeAction
}

export interface ResolvedActiveWork {
  isAmbiguous: boolean
  activeWorkCount: number
  targetWork?: ActiveWorkResolution
  allActiveWork?: ActiveWorkResolution[]
}
