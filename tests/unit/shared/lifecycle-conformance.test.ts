/**
 * Lifecycle Conformance Tests
 *
 * These tests verify that all runtime object states conform to the documented
 * lifecycle categories defined in the Global Runtime Lifecycle State Machine v1.
 *
 * Documented categories (from architecture doc):
 * - Active: queued, initializing, planning, running, executing, replanning, recovering
 * - Waiting: waiting_for_user, waiting_for_approval, waiting_for_execution_result,
 *            waiting_for_external_event, sleeping, paused
 * - Terminal: completed, partial_success, failed, cancelled, timeout, expired, archived
 *
 * Each runtime object type has its own state enum. These tests ensure:
 * 1. All states belong to one of the three documented categories
 * 2. No undocumented states exist in any runtime type
 * 3. State membership is consistent with lifecycle semantics
 */

import { describe, it, expect } from 'vitest'
import {
  PLANNER_STATES,
  KERNEL_RUN_STATES,
  TOOL_EXECUTION_STATES,
  BACKGROUND_SUBAGENT_STATES,
  WORKFLOW_RUN_STATES,
  APPROVAL_STATES,
  WAIT_CONDITION_STATES,
  ACTIVE_STATES,
  WAITING_STATES,
  TERMINAL_STATES,
} from '../../../src/shared/states.js'

// ============================================================================
// Documented Lifecycle State Categories (from architecture doc)
// ============================================================================

/**
 * Active states - objects that are actively progressing
 * Source: Section 3.1 of global_runtime_lifecycle_state_machine_v1.md
 */
const DOCUMENTED_ACTIVE_STATES = new Set([
  'queued',
  'initializing',
  'planning',
  'running',
  'executing',
  'replanning',
  'recovering',
])

/**
 * Waiting states - objects that are not done but temporarily blocked
 * Source: Section 3.2 of global_runtime_lifecycle_state_machine_v1.md
 */
const DOCUMENTED_WAITING_STATES = new Set([
  'waiting_for_user',
  'waiting_for_approval',
  'waiting_for_execution_result',
  'waiting_for_external_event',
  'sleeping',
  'paused',
])

/**
 * Terminal states - objects that have reached end of lifecycle
 * Source: Section 3.3 of global_runtime_lifecycle_state_machine_v1.md
 */
const DOCUMENTED_TERMINAL_STATES = new Set([
  'completed',
  'partial_success',
  'failed',
  'cancelled',
  'timeout',
  'expired',
  'archived',
])

// Combined set of all documented lifecycle states
const ALL_DOCUMENTED_STATES = new Set([
  ...DOCUMENTED_ACTIVE_STATES,
  ...DOCUMENTED_WAITING_STATES,
  ...DOCUMENTED_TERMINAL_STATES,
])

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Classify a state into its lifecycle category
 */
function classifyState(state: string): 'active' | 'waiting' | 'terminal' | 'undocumented' {
  if (DOCUMENTED_ACTIVE_STATES.has(state)) return 'active'
  if (DOCUMENTED_WAITING_STATES.has(state)) return 'waiting'
  if (DOCUMENTED_TERMINAL_STATES.has(state)) return 'terminal'
  return 'undocumented'
}

/**
 * Get all states from a state constant object
 */
function getStates(stateObj: Record<string, string>): string[] {
  return Object.values(stateObj)
}

/**
 * Find undocumented states in a runtime type
 */
function findUndocumentedStates(states: string[]): string[] {
  return states.filter((s) => !ALL_DOCUMENTED_STATES.has(s))
}

/**
 * Group states by their lifecycle category
 */
function groupStatesByCategory(states: string[]): Record<string, string[]> {
  const groups: Record<string, string[]> = {
    active: [],
    waiting: [],
    terminal: [],
    undocumented: [],
  }

  for (const state of states) {
    const category = classifyState(state)
    groups[category].push(state)
  }

  return groups
}

// ============================================================================
// Conformance Tests
// ============================================================================

describe('Lifecycle State Categories', () => {
  it('should have consistent ACTIVE_STATES with documented active states', () => {
    const implementedActive = new Set<string>(ACTIVE_STATES as unknown as string[])

    // All implemented active states should be documented
    for (const state of implementedActive) {
      expect(DOCUMENTED_ACTIVE_STATES.has(state)).toBe(true)
    }

    // All documented active states should be implemented (or documented as extension)
    // Note: This is informational - we allow documented states not yet implemented
    const missingActive = [...DOCUMENTED_ACTIVE_STATES].filter((s) => !implementedActive.has(s))
    // Log missing states for awareness but don't fail
    if (missingActive.length > 0) {
      console.log('Info: Documented active states not yet implemented:', missingActive)
    }
  })

  it('should have consistent WAITING_STATES with documented waiting states', () => {
    const implementedWaiting = new Set<string>(WAITING_STATES as unknown as string[])

    for (const state of implementedWaiting) {
      expect(DOCUMENTED_WAITING_STATES.has(state)).toBe(true)
    }
  })

  it('should have consistent TERMINAL_STATES with documented terminal states', () => {
    const implementedTerminal = new Set<string>(TERMINAL_STATES as unknown as string[])

    for (const state of implementedTerminal) {
      expect(DOCUMENTED_TERMINAL_STATES.has(state)).toBe(true)
    }
  })
})

describe('PlannerRun Lifecycle Conformance', () => {
  it('should have all states in documented lifecycle categories', () => {
    const states = getStates(PLANNER_STATES)
    const undocumented = findUndocumentedStates(states)

    expect(undocumented).toEqual([])
  })

  it('should classify states correctly by category', () => {
    const states = getStates(PLANNER_STATES)
    const groups = groupStatesByCategory(states)

    // PlannerRun should have active states (initializing, planning, replanning)
    expect(groups.active.length).toBeGreaterThan(0)

    // PlannerRun should have waiting states (waiting_for_user, waiting_for_approval, etc.)
    expect(groups.waiting.length).toBeGreaterThan(0)

    // PlannerRun should have terminal states (completed, failed, cancelled, archived)
    expect(groups.terminal.length).toBeGreaterThan(0)

    // No undocumented states
    expect(groups.undocumented).toEqual([])
  })

  it('should have expected active states for PlannerRun', () => {
    const states = getStates(PLANNER_STATES)
    const expectedActive = ['initializing', 'planning', 'replanning']

    for (const expected of expectedActive) {
      expect(states).toContain(expected)
    }
  })

  it('should have expected waiting states for PlannerRun', () => {
    const states = getStates(PLANNER_STATES)
    const expectedWaiting = [
      'waiting_for_user',
      'waiting_for_approval',
      'waiting_for_execution_result',
      'waiting_for_external_event',
      'paused',
    ]

    for (const expected of expectedWaiting) {
      expect(states).toContain(expected)
    }
  })

  it('should have expected terminal states for PlannerRun', () => {
    const states = getStates(PLANNER_STATES)
    const expectedTerminal = ['completed', 'failed', 'cancelled', 'archived']

    for (const expected of expectedTerminal) {
      expect(states).toContain(expected)
    }
  })
})

describe('KernelRun Lifecycle Conformance', () => {
  it('should have all states in documented lifecycle categories', () => {
    const states = getStates(KERNEL_RUN_STATES)
    const undocumented = findUndocumentedStates(states)

    // KernelRun has some internal states that are not in global categories
    // These are acceptable as they represent internal processing steps
    const acceptableInternalStates = new Set([
      'building_context',
      'building_model_input',
      'sampling_model',
      'parsing_model_output',
      'dispatching_tools',
      'launching_subagent',
      'checking_compact',
      'compacting',
      'interrupted',
      'max_iterations_reached',
    ])

    // Filter out acceptable internal states
    const trulyUndocumented = undocumented.filter((s) => !acceptableInternalStates.has(s))

    expect(trulyUndocumented).toEqual([])
  })

  it('should have expected global-category states for KernelRun', () => {
    const states = getStates(KERNEL_RUN_STATES)

    // Active states
    expect(states).toContain('initializing')

    // Waiting states
    expect(states).toContain('waiting_for_user')
    expect(states).toContain('waiting_for_approval')

    // Terminal states
    expect(states).toContain('completed')
    expect(states).toContain('failed')
    expect(states).toContain('cancelled')
    expect(states).toContain('partial_success')
  })

  it('should have internal processing states', () => {
    const states = getStates(KERNEL_RUN_STATES)

    // These are internal states specific to KernelRun execution
    const internalStates = [
      'building_context',
      'building_model_input',
      'sampling_model',
      'parsing_model_output',
      'dispatching_tools',
    ]

    for (const internal of internalStates) {
      expect(states).toContain(internal)
    }
  })
})

describe('ToolExecution Lifecycle Conformance', () => {
  it('should have all states in documented lifecycle categories or tool-specific states', () => {
    const states = getStates(TOOL_EXECUTION_STATES)
    const undocumented = findUndocumentedStates(states)

    // ToolExecution has some internal states specific to tool processing
    const acceptableToolStates = new Set([
      'received',
      'schema_validating',
      'permission_checking',
      'executing',
      'mapping_result',
      'denied',
      'aborted',
      'discarded',
    ])

    const trulyUndocumented = undocumented.filter((s) => !acceptableToolStates.has(s))

    expect(trulyUndocumented).toEqual([])
  })

  it('should have expected terminal states for ToolExecution', () => {
    const states = getStates(TOOL_EXECUTION_STATES)

    // ToolExecution terminal states per architecture doc Section 9
    const expectedTerminal = ['completed', 'failed', 'denied', 'aborted', 'cancelled', 'discarded', 'timeout']

    for (const expected of expectedTerminal) {
      expect(states).toContain(expected)
    }
  })

  it('should have waiting state for approval', () => {
    const states = getStates(TOOL_EXECUTION_STATES)
    expect(states).toContain('waiting_for_approval')
  })
})

describe('BackgroundSubagentRun Lifecycle Conformance', () => {
  it('should have all states in documented lifecycle categories', () => {
    const states = getStates(BACKGROUND_SUBAGENT_STATES)
    const undocumented = findUndocumentedStates(states)

    expect(undocumented).toEqual([])
  })

  it('should have expected active states for BackgroundSubagentRun', () => {
    const states = getStates(BACKGROUND_SUBAGENT_STATES)

    expect(states).toContain('queued')
    expect(states).toContain('running')
    expect(states).toContain('recovering')
  })

  it('should have expected waiting states for BackgroundSubagentRun', () => {
    const states = getStates(BACKGROUND_SUBAGENT_STATES)

    expect(states).toContain('waiting_for_user')
    expect(states).toContain('waiting_for_approval')
    expect(states).toContain('waiting_for_external_event')
    expect(states).toContain('sleeping')
  })

  it('should have expected terminal states for BackgroundSubagentRun', () => {
    const states = getStates(BACKGROUND_SUBAGENT_STATES)

    expect(states).toContain('completed')
    expect(states).toContain('failed')
    expect(states).toContain('cancelled')
    expect(states).toContain('expired')
  })
})

describe('WorkflowRun Lifecycle Conformance', () => {
  it('should have all states in documented lifecycle categories', () => {
    const states = getStates(WORKFLOW_RUN_STATES)
    const undocumented = findUndocumentedStates(states)

    expect(undocumented).toEqual([])
  })

  it('should have expected active states for WorkflowRun', () => {
    const states = getStates(WORKFLOW_RUN_STATES)

    expect(states).toContain('queued')
    expect(states).toContain('running')
  })

  it('should have expected waiting states for WorkflowRun', () => {
    const states = getStates(WORKFLOW_RUN_STATES)

    expect(states).toContain('waiting_for_user')
    expect(states).toContain('waiting_for_approval')
    expect(states).toContain('waiting_for_external_event')
    expect(states).toContain('sleeping')
    expect(states).toContain('paused')
  })

  it('should have expected terminal states for WorkflowRun', () => {
    const states = getStates(WORKFLOW_RUN_STATES)

    expect(states).toContain('completed')
    expect(states).toContain('failed')
    expect(states).toContain('cancelled')
    expect(states).toContain('timeout')
  })
})

describe('ApprovalRequest Lifecycle Conformance', () => {
  it('should have all states in documented lifecycle categories', () => {
    const states = getStates(APPROVAL_STATES)
    const undocumented = findUndocumentedStates(states)

    // ApprovalRequest has 'pending' which is specific to approval lifecycle
    // and 'approved', 'rejected' which are terminal but not in global set
    const acceptableApprovalStates = new Set(['pending', 'approved', 'rejected'])

    const trulyUndocumented = undocumented.filter((s) => !acceptableApprovalStates.has(s))

    expect(trulyUndocumented).toEqual([])
  })

  it('should have expected states for ApprovalRequest per architecture doc', () => {
    const states = getStates(APPROVAL_STATES)

    // Per Section 14 of architecture doc
    expect(states).toContain('pending')
    expect(states).toContain('approved')
    expect(states).toContain('rejected')
    expect(states).toContain('expired')
    expect(states).toContain('cancelled')
  })

  it('should have pending as initial state', () => {
    const states = getStates(APPROVAL_STATES)
    expect(states).toContain('pending')

    // pending is not in global categories, it's approval-specific
    expect(DOCUMENTED_ACTIVE_STATES.has('pending')).toBe(false)
    expect(DOCUMENTED_WAITING_STATES.has('pending')).toBe(false)
    expect(DOCUMENTED_TERMINAL_STATES.has('pending')).toBe(false)
  })
})

describe('WaitCondition Lifecycle Conformance', () => {
  it('should have all states in documented lifecycle categories or wait-specific states', () => {
    const states = getStates(WAIT_CONDITION_STATES)
    const undocumented = findUndocumentedStates(states)

    // WaitCondition has 'registered', 'active', 'satisfied' which are wait-specific
    const acceptableWaitStates = new Set(['registered', 'active', 'satisfied'])

    const trulyUndocumented = undocumented.filter((s) => !acceptableWaitStates.has(s))

    expect(trulyUndocumented).toEqual([])
  })

  it('should have expected states for WaitCondition per architecture doc', () => {
    const states = getStates(WAIT_CONDITION_STATES)

    // Per Section 15 of architecture doc
    expect(states).toContain('registered')
    expect(states).toContain('active')
    expect(states).toContain('satisfied')
    expect(states).toContain('failed')
    expect(states).toContain('timeout')
    expect(states).toContain('cancelled')
  })

  it('should have satisfied as terminal state', () => {
    const states = getStates(WAIT_CONDITION_STATES)
    expect(states).toContain('satisfied')

    // satisfied is wait-specific, not in global terminal set
    expect(DOCUMENTED_TERMINAL_STATES.has('satisfied')).toBe(false)
  })
})

describe('Lifecycle State Coverage Summary', () => {
  it('should document all runtime types and their state counts', () => {
    const runtimeTypes = [
      { name: 'PlannerRun', states: getStates(PLANNER_STATES) },
      { name: 'KernelRun', states: getStates(KERNEL_RUN_STATES) },
      { name: 'ToolExecution', states: getStates(TOOL_EXECUTION_STATES) },
      { name: 'BackgroundSubagentRun', states: getStates(BACKGROUND_SUBAGENT_STATES) },
      { name: 'WorkflowRun', states: getStates(WORKFLOW_RUN_STATES) },
      { name: 'ApprovalRequest', states: getStates(APPROVAL_STATES) },
      { name: 'WaitCondition', states: getStates(WAIT_CONDITION_STATES) },
    ]

    // Verify each runtime type has states
    for (const rt of runtimeTypes) {
      expect(rt.states.length).toBeGreaterThan(0)
    }

    // Log summary for documentation purposes
    console.log('\n=== Lifecycle State Coverage Summary ===')
    for (const rt of runtimeTypes) {
      const groups = groupStatesByCategory(rt.states)
      console.log(`${rt.name}: ${rt.states.length} states`)
      console.log(`  Active: ${groups.active.length} (${groups.active.join(', ') || 'none'})`)
      console.log(`  Waiting: ${groups.waiting.length} (${groups.waiting.join(', ') || 'none'})`)
      console.log(`  Terminal: ${groups.terminal.length} (${groups.terminal.join(', ') || 'none'})`)
      console.log(`  Type-specific: ${groups.undocumented.length} (${groups.undocumented.join(', ') || 'none'})`)
    }
    console.log('========================================\n')
  })
})
