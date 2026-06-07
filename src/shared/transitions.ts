import {
  FOREGROUND_STATES,
  PLANNER_STATES,
  EXECUTION_PLAN_STATES,
  RUNTIME_ACTION_STATES,
  KERNEL_RUN_STATES,
  TOOL_EXECUTION_STATES,
  BACKGROUND_SUBAGENT_STATES,
  WORKFLOW_RUN_STATES,
  APPROVAL_STATES,
  WAIT_CONDITION_STATES,
  TRIGGER_EVENT_STATES,
  SUMMARY_STATES,
  MEMORY_STATES,
  ACTIVE_STATES,
  WAITING_STATES,
  TERMINAL_STATES,
} from './states'

export interface TransitionError {
  code: string
  message: string
}

export interface TransitionResult {
  valid: boolean
  error: TransitionError | null
}

function createError(code: string, message: string): TransitionError {
  return { code, message }
}

function createSuccess(): TransitionResult {
  return { valid: true, error: null }
}

function createFailure(error: TransitionError): TransitionResult {
  return { valid: false, error }
}

export function isActiveState(state: string): boolean {
  return ACTIVE_STATES.includes(state as (typeof ACTIVE_STATES)[number])
}

export function isWaitingState(state: string): boolean {
  return WAITING_STATES.includes(state as (typeof WAITING_STATES)[number])
}

export function isTerminalState(state: string): boolean {
  return TERMINAL_STATES.includes(state as (typeof TERMINAL_STATES)[number])
}

function checkTerminalTransition(from: string, terminalStates: string[]): TransitionResult | null {
  if (terminalStates.includes(from)) {
    return createFailure(createError('INVALID_FROM_TERMINAL', `Cannot transition from terminal state ${from}`))
  }
  return null
}

function isValidState(state: string, validStates: readonly string[]): boolean {
  return validStates.includes(state)
}

const RUNTIME_ACTION_TERMINAL = [
  RUNTIME_ACTION_STATES.DUPLICATE,
  RUNTIME_ACTION_STATES.DENIED,
  RUNTIME_ACTION_STATES.COMPLETED,
  RUNTIME_ACTION_STATES.FAILED,
  RUNTIME_ACTION_STATES.TIMEOUT,
  RUNTIME_ACTION_STATES.CANCELLED,
]

const TOOL_EXECUTION_TERMINAL = [
  TOOL_EXECUTION_STATES.COMPLETED,
  TOOL_EXECUTION_STATES.FAILED,
  TOOL_EXECUTION_STATES.TIMEOUT,
  TOOL_EXECUTION_STATES.CANCELLED,
  TOOL_EXECUTION_STATES.ABORTED,
  TOOL_EXECUTION_STATES.DISCARDED,
  TOOL_EXECUTION_STATES.DENIED,
]

const APPROVAL_TERMINAL = [
  APPROVAL_STATES.APPROVED,
  APPROVAL_STATES.REJECTED,
  APPROVAL_STATES.EXPIRED,
  APPROVAL_STATES.CANCELLED,
]

const WAIT_CONDITION_TERMINAL = [
  WAIT_CONDITION_STATES.SATISFIED,
  WAIT_CONDITION_STATES.FAILED,
  WAIT_CONDITION_STATES.TIMEOUT,
  WAIT_CONDITION_STATES.CANCELLED,
]

const TRIGGER_EVENT_TERMINAL = [
  TRIGGER_EVENT_STATES.HANDLED,
  TRIGGER_EVENT_STATES.FAILED,
  TRIGGER_EVENT_STATES.DUPLICATE,
]

const SUMMARY_TERMINAL = [SUMMARY_STATES.SUPERSEDED, SUMMARY_STATES.ARCHIVED, SUMMARY_STATES.EXPIRED]

const MEMORY_TERMINAL = [MEMORY_STATES.ARCHIVED, MEMORY_STATES.EXPIRED, MEMORY_STATES.DELETED]

export function validateForegroundTransition(from: string, to: string): TransitionResult {
  const validStates = Object.values(FOREGROUND_STATES)
  if (!isValidState(from, validStates)) {
    return createFailure(createError('INVALID_SOURCE_STATE', `Invalid source state: ${from}`))
  }
  if (!isValidState(to, validStates)) {
    return createFailure(createError('INVALID_TARGET_STATE', `Invalid target state: ${to}`))
  }

  const terminalCheck = checkTerminalTransition(from, TERMINAL_STATES as unknown as string[])
  if (terminalCheck) return terminalCheck

  return createSuccess()
}

export function validatePlannerTransition(from: string, to: string): TransitionResult {
  const validStates = Object.values(PLANNER_STATES)
  if (!isValidState(from, validStates)) {
    return createFailure(createError('INVALID_SOURCE_STATE', `Invalid source state: ${from}`))
  }
  if (!isValidState(to, validStates)) {
    return createFailure(createError('INVALID_TARGET_STATE', `Invalid target state: ${to}`))
  }

  const terminalCheck = checkTerminalTransition(from, TERMINAL_STATES as unknown as string[])
  if (terminalCheck) return terminalCheck

  return createSuccess()
}

const EXECUTION_PLAN_RULES: Record<string, string[]> = {
  [EXECUTION_PLAN_STATES.DRAFT]: [EXECUTION_PLAN_STATES.APPROVED],
  [EXECUTION_PLAN_STATES.APPROVED]: [EXECUTION_PLAN_STATES.IN_EXECUTION],
  [EXECUTION_PLAN_STATES.IN_EXECUTION]: [
    EXECUTION_PLAN_STATES.BLOCKED,
    EXECUTION_PLAN_STATES.WAITING_FOR_USER,
    EXECUTION_PLAN_STATES.WAITING_FOR_APPROVAL,
    EXECUTION_PLAN_STATES.REPLANNING,
    EXECUTION_PLAN_STATES.COMPLETED,
    EXECUTION_PLAN_STATES.FAILED,
    EXECUTION_PLAN_STATES.ABANDONED,
  ],
  [EXECUTION_PLAN_STATES.BLOCKED]: [
    EXECUTION_PLAN_STATES.IN_EXECUTION,
    EXECUTION_PLAN_STATES.WAITING_FOR_USER,
    EXECUTION_PLAN_STATES.WAITING_FOR_APPROVAL,
  ],
  [EXECUTION_PLAN_STATES.WAITING_FOR_USER]: [EXECUTION_PLAN_STATES.IN_EXECUTION, EXECUTION_PLAN_STATES.REPLANNING],
  [EXECUTION_PLAN_STATES.WAITING_FOR_APPROVAL]: [
    EXECUTION_PLAN_STATES.IN_EXECUTION,
    EXECUTION_PLAN_STATES.REPLANNING,
    EXECUTION_PLAN_STATES.ABANDONED,
  ],
  [EXECUTION_PLAN_STATES.REPLANNING]: [EXECUTION_PLAN_STATES.IN_EXECUTION],
}

export function validateExecutionPlanTransition(from: string, to: string): TransitionResult {
  const validStates = Object.values(EXECUTION_PLAN_STATES)
  if (!isValidState(from, validStates)) {
    return createFailure(createError('INVALID_SOURCE_STATE', `Invalid source state: ${from}`))
  }
  if (!isValidState(to, validStates)) {
    return createFailure(createError('INVALID_TARGET_STATE', `Invalid target state: ${to}`))
  }

  const terminalCheck = checkTerminalTransition(from, TERMINAL_STATES as unknown as string[])
  if (terminalCheck) return terminalCheck

  const allowed = EXECUTION_PLAN_RULES[from]
  if (allowed && !allowed.includes(to)) {
    return createFailure(createError('TRANSITION_NOT_ALLOWED', `Transition from ${from} to ${to} is not allowed`))
  }

  return createSuccess()
}

export function validateRuntimeActionTransition(from: string, to: string): TransitionResult {
  const validStates = Object.values(RUNTIME_ACTION_STATES)
  if (!isValidState(from, validStates)) {
    return createFailure(createError('INVALID_SOURCE_STATE', `Invalid source state: ${from}`))
  }
  if (!isValidState(to, validStates)) {
    return createFailure(createError('INVALID_TARGET_STATE', `Invalid target state: ${to}`))
  }

  const terminalCheck = checkTerminalTransition(from, RUNTIME_ACTION_TERMINAL)
  if (terminalCheck) return terminalCheck

  return createSuccess()
}

export function validateKernelRunTransition(from: string, to: string): TransitionResult {
  const validStates = Object.values(KERNEL_RUN_STATES)
  if (!isValidState(from, validStates)) {
    return createFailure(createError('INVALID_SOURCE_STATE', `Invalid source state: ${from}`))
  }
  if (!isValidState(to, validStates)) {
    return createFailure(createError('INVALID_TARGET_STATE', `Invalid target state: ${to}`))
  }

  const terminalCheck = checkTerminalTransition(from, TERMINAL_STATES as unknown as string[])
  if (terminalCheck) return terminalCheck

  return createSuccess()
}

export function validateToolExecutionTransition(from: string, to: string): TransitionResult {
  const validStates = Object.values(TOOL_EXECUTION_STATES)
  if (!isValidState(from, validStates)) {
    return createFailure(createError('INVALID_SOURCE_STATE', `Invalid source state: ${from}`))
  }
  if (!isValidState(to, validStates)) {
    return createFailure(createError('INVALID_TARGET_STATE', `Invalid target state: ${to}`))
  }

  const terminalCheck = checkTerminalTransition(from, TOOL_EXECUTION_TERMINAL)
  if (terminalCheck) return terminalCheck

  return createSuccess()
}

export function validateBackgroundSubagentTransition(from: string, to: string): TransitionResult {
  const validStates = Object.values(BACKGROUND_SUBAGENT_STATES)
  if (!isValidState(from, validStates)) {
    return createFailure(createError('INVALID_SOURCE_STATE', `Invalid source state: ${from}`))
  }
  if (!isValidState(to, validStates)) {
    return createFailure(createError('INVALID_TARGET_STATE', `Invalid target state: ${to}`))
  }

  const terminalCheck = checkTerminalTransition(from, TERMINAL_STATES as unknown as string[])
  if (terminalCheck) return terminalCheck

  return createSuccess()
}

export function validateWorkflowRunTransition(from: string, to: string): TransitionResult {
  const validStates = Object.values(WORKFLOW_RUN_STATES)
  if (!isValidState(from, validStates)) {
    return createFailure(createError('INVALID_SOURCE_STATE', `Invalid source state: ${from}`))
  }
  if (!isValidState(to, validStates)) {
    return createFailure(createError('INVALID_TARGET_STATE', `Invalid target state: ${to}`))
  }

  const terminalCheck = checkTerminalTransition(from, TERMINAL_STATES as unknown as string[])
  if (terminalCheck) return terminalCheck

  return createSuccess()
}

const APPROVAL_RULES: Record<string, string[]> = {
  [APPROVAL_STATES.PENDING]: [
    APPROVAL_STATES.APPROVED,
    APPROVAL_STATES.REJECTED,
    APPROVAL_STATES.EXPIRED,
    APPROVAL_STATES.CANCELLED,
  ],
}

export function validateApprovalTransition(from: string, to: string): TransitionResult {
  const validStates = Object.values(APPROVAL_STATES)
  if (!isValidState(from, validStates)) {
    return createFailure(createError('INVALID_SOURCE_STATE', `Invalid source state: ${from}`))
  }
  if (!isValidState(to, validStates)) {
    return createFailure(createError('INVALID_TARGET_STATE', `Invalid target state: ${to}`))
  }

  const terminalCheck = checkTerminalTransition(from, APPROVAL_TERMINAL)
  if (terminalCheck) return terminalCheck

  const allowed = APPROVAL_RULES[from]
  if (allowed && !allowed.includes(to)) {
    return createFailure(createError('TRANSITION_NOT_ALLOWED', `Transition from ${from} to ${to} is not allowed`))
  }

  return createSuccess()
}

const WAIT_CONDITION_RULES: Record<string, string[]> = {
  [WAIT_CONDITION_STATES.REGISTERED]: [WAIT_CONDITION_STATES.ACTIVE],
  [WAIT_CONDITION_STATES.ACTIVE]: [
    WAIT_CONDITION_STATES.SATISFIED,
    WAIT_CONDITION_STATES.FAILED,
    WAIT_CONDITION_STATES.TIMEOUT,
    WAIT_CONDITION_STATES.CANCELLED,
  ],
}

export function validateWaitConditionTransition(from: string, to: string): TransitionResult {
  const validStates = Object.values(WAIT_CONDITION_STATES)
  if (!isValidState(from, validStates)) {
    return createFailure(createError('INVALID_SOURCE_STATE', `Invalid source state: ${from}`))
  }
  if (!isValidState(to, validStates)) {
    return createFailure(createError('INVALID_TARGET_STATE', `Invalid target state: ${to}`))
  }

  const terminalCheck = checkTerminalTransition(from, WAIT_CONDITION_TERMINAL)
  if (terminalCheck) return terminalCheck

  const allowed = WAIT_CONDITION_RULES[from]
  if (allowed && !allowed.includes(to)) {
    return createFailure(createError('TRANSITION_NOT_ALLOWED', `Transition from ${from} to ${to} is not allowed`))
  }

  return createSuccess()
}

const TRIGGER_EVENT_RULES: Record<string, string[]> = {
  [TRIGGER_EVENT_STATES.CREATED]: [TRIGGER_EVENT_STATES.MATCHED],
  [TRIGGER_EVENT_STATES.MATCHED]: [TRIGGER_EVENT_STATES.ACTION_CREATED, TRIGGER_EVENT_STATES.DUPLICATE],
  [TRIGGER_EVENT_STATES.ACTION_CREATED]: [TRIGGER_EVENT_STATES.DISPATCHED],
  [TRIGGER_EVENT_STATES.DISPATCHED]: [TRIGGER_EVENT_STATES.HANDLED, TRIGGER_EVENT_STATES.FAILED],
}

export function validateTriggerEventTransition(from: string, to: string): TransitionResult {
  const validStates = Object.values(TRIGGER_EVENT_STATES)
  if (!isValidState(from, validStates)) {
    return createFailure(createError('INVALID_SOURCE_STATE', `Invalid source state: ${from}`))
  }
  if (!isValidState(to, validStates)) {
    return createFailure(createError('INVALID_TARGET_STATE', `Invalid target state: ${to}`))
  }

  const terminalCheck = checkTerminalTransition(from, TRIGGER_EVENT_TERMINAL)
  if (terminalCheck) return terminalCheck

  const allowed = TRIGGER_EVENT_RULES[from]
  if (allowed && !allowed.includes(to)) {
    return createFailure(createError('TRANSITION_NOT_ALLOWED', `Transition from ${from} to ${to} is not allowed`))
  }

  return createSuccess()
}

const SUMMARY_RULES: Record<string, string[]> = {
  [SUMMARY_STATES.CANDIDATE]: [SUMMARY_STATES.VALIDATED],
  [SUMMARY_STATES.VALIDATED]: [SUMMARY_STATES.ACTIVE],
  [SUMMARY_STATES.ACTIVE]: [SUMMARY_STATES.SUPERSEDED, SUMMARY_STATES.ARCHIVED, SUMMARY_STATES.EXPIRED],
}

export function validateSummaryTransition(from: string, to: string): TransitionResult {
  const validStates = Object.values(SUMMARY_STATES)
  if (!isValidState(from, validStates)) {
    return createFailure(createError('INVALID_SOURCE_STATE', `Invalid source state: ${from}`))
  }
  if (!isValidState(to, validStates)) {
    return createFailure(createError('INVALID_TARGET_STATE', `Invalid target state: ${to}`))
  }

  const terminalCheck = checkTerminalTransition(from, SUMMARY_TERMINAL)
  if (terminalCheck) return terminalCheck

  const allowed = SUMMARY_RULES[from]
  if (allowed && !allowed.includes(to)) {
    return createFailure(createError('TRANSITION_NOT_ALLOWED', `Transition from ${from} to ${to} is not allowed`))
  }

  return createSuccess()
}

const MEMORY_RULES: Record<string, string[]> = {
  [MEMORY_STATES.CANDIDATE]: [MEMORY_STATES.VALIDATED],
  [MEMORY_STATES.VALIDATED]: [MEMORY_STATES.ACTIVE],
  [MEMORY_STATES.ACTIVE]: [
    MEMORY_STATES.LOW_PRIORITY,
    MEMORY_STATES.COMPRESSED,
    MEMORY_STATES.ARCHIVED,
    MEMORY_STATES.EXPIRED,
    MEMORY_STATES.DELETED,
  ],
}

export function validateMemoryTransition(from: string, to: string): TransitionResult {
  const validStates = Object.values(MEMORY_STATES)
  if (!isValidState(from, validStates)) {
    return createFailure(createError('INVALID_SOURCE_STATE', `Invalid source state: ${from}`))
  }
  if (!isValidState(to, validStates)) {
    return createFailure(createError('INVALID_TARGET_STATE', `Invalid target state: ${to}`))
  }

  const terminalCheck = checkTerminalTransition(from, MEMORY_TERMINAL)
  if (terminalCheck) return terminalCheck

  const allowed = MEMORY_RULES[from]
  if (allowed && !allowed.includes(to)) {
    return createFailure(createError('TRANSITION_NOT_ALLOWED', `Transition from ${from} to ${to} is not allowed`))
  }

  return createSuccess()
}
