import { describe, it, expect } from 'vitest'
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
  ACTIVE_STATES,
  WAITING_STATES,
  TERMINAL_STATES,
} from '../../src/shared/states.js'

describe('State Contracts', () => {
  describe('FOREGROUND_STATES', () => {
    it('has expected state values', () => {
      expect(Object.values(FOREGROUND_STATES)).toEqual([
        'received',
        'hydrating',
        'classifying',
        'deciding',
        'responding',
        'direct_delegating',
        'spawning_planner',
        'querying_status',
        'handling_approval',
        'handling_interrupt',
        'completed',
        'failed',
      ])
    })
  })

  describe('PLANNER_STATES', () => {
    it('has expected state values', () => {
      expect(Object.values(PLANNER_STATES)).toEqual([
        'initializing',
        'planning',
        'waiting_for_user',
        'waiting_for_approval',
        'waiting_for_execution_result',
        'waiting_for_external_event',
        'replanning',
        'paused',
        'completed',
        'failed',
        'cancelled',
        'archived',
      ])
    })
  })

  describe('EXECUTION_PLAN_STATES', () => {
    it('has expected state values', () => {
      expect(Object.values(EXECUTION_PLAN_STATES)).toEqual([
        'draft',
        'approved',
        'in_execution',
        'blocked',
        'waiting_for_user',
        'waiting_for_approval',
        'replanning',
        'completed',
        'failed',
        'abandoned',
      ])
    })
  })

  describe('RUNTIME_ACTION_STATES', () => {
    it('has expected state values', () => {
      expect(Object.values(RUNTIME_ACTION_STATES)).toEqual([
        'created',
        'validated',
        'duplicate',
        'denied',
        'accepted',
        'queued',
        'dispatching',
        'waiting_for_approval',
        'waiting_for_target',
        'completed',
        'failed',
        'timeout',
        'cancelled',
      ])
    })
  })

  describe('KERNEL_RUN_STATES', () => {
    it('has expected state values', () => {
      expect(Object.values(KERNEL_RUN_STATES)).toEqual([
        'initializing',
        'building_context',
        'building_model_input',
        'sampling_model',
        'parsing_model_output',
        'dispatching_tools',
        'launching_subagent',
        'waiting_for_approval',
        'waiting_for_user',
        'checking_compact',
        'compacting',
        'completed',
        'failed',
        'cancelled',
        'interrupted',
        'partial_success',
        'max_iterations_reached',
      ])
    })
  })

  describe('TOOL_EXECUTION_STATES', () => {
    it('has expected state values', () => {
      expect(Object.values(TOOL_EXECUTION_STATES)).toEqual([
        'received',
        'schema_validating',
        'permission_checking',
        'waiting_for_approval',
        'denied',
        'executing',
        'mapping_result',
        'completed',
        'failed',
        'timeout',
        'cancelled',
        'aborted',
        'discarded',
      ])
    })
  })

  describe('BACKGROUND_SUBAGENT_STATES', () => {
    it('has expected state values', () => {
      expect(Object.values(BACKGROUND_SUBAGENT_STATES)).toEqual([
        'queued',
        'running',
        'waiting_for_user',
        'waiting_for_approval',
        'waiting_for_external_event',
        'sleeping',
        'recovering',
        'completed',
        'failed',
        'cancelled',
        'expired',
      ])
    })
  })

  describe('WORKFLOW_RUN_STATES', () => {
    it('has expected state values', () => {
      expect(Object.values(WORKFLOW_RUN_STATES)).toEqual([
        'queued',
        'running',
        'waiting_for_user',
        'waiting_for_approval',
        'waiting_for_external_event',
        'sleeping',
        'paused',
        'completed',
        'failed',
        'cancelled',
        'timeout',
      ])
    })
  })

  describe('APPROVAL_STATES', () => {
    it('has expected state values', () => {
      expect(Object.values(APPROVAL_STATES)).toEqual(['pending', 'approved', 'rejected', 'expired', 'cancelled'])
    })
  })

  describe('WAIT_CONDITION_STATES', () => {
    it('has expected state values', () => {
      expect(Object.values(WAIT_CONDITION_STATES)).toEqual([
        'registered',
        'active',
        'satisfied',
        'failed',
        'timeout',
        'cancelled',
      ])
    })
  })

  describe('Global State Classifications', () => {
    it('ACTIVE_STATES contains expected values', () => {
      expect(ACTIVE_STATES).toEqual([
        'queued',
        'initializing',
        'planning',
        'running',
        'executing',
        'replanning',
        'recovering',
      ])
    })

    it('WAITING_STATES contains expected values', () => {
      expect(WAITING_STATES).toEqual([
        'waiting_for_user',
        'waiting_for_approval',
        'waiting_for_execution_result',
        'waiting_for_external_event',
        'sleeping',
        'paused',
      ])
    })

    it('TERMINAL_STATES contains expected values', () => {
      expect(TERMINAL_STATES).toEqual([
        'completed',
        'partial_success',
        'failed',
        'cancelled',
        'timeout',
        'expired',
        'archived',
      ])
    })
  })

  describe('State Consistency', () => {
    it('documents shared state names across enums', () => {
      const allStates = new Map<string, string[]>()
      const stateEnums = [
        { name: 'FOREGROUND_STATES', states: Object.values(FOREGROUND_STATES) },
        { name: 'PLANNER_STATES', states: Object.values(PLANNER_STATES) },
        { name: 'EXECUTION_PLAN_STATES', states: Object.values(EXECUTION_PLAN_STATES) },
        { name: 'RUNTIME_ACTION_STATES', states: Object.values(RUNTIME_ACTION_STATES) },
        { name: 'KERNEL_RUN_STATES', states: Object.values(KERNEL_RUN_STATES) },
        { name: 'TOOL_EXECUTION_STATES', states: Object.values(TOOL_EXECUTION_STATES) },
        { name: 'BACKGROUND_SUBAGENT_STATES', states: Object.values(BACKGROUND_SUBAGENT_STATES) },
        { name: 'WORKFLOW_RUN_STATES', states: Object.values(WORKFLOW_RUN_STATES) },
        { name: 'APPROVAL_STATES', states: Object.values(APPROVAL_STATES) },
        { name: 'WAIT_CONDITION_STATES', states: Object.values(WAIT_CONDITION_STATES) },
      ]

      for (const { name, states } of stateEnums) {
        for (const state of states) {
          if (!allStates.has(state)) {
            allStates.set(state, [])
          }
          allStates.get(state)!.push(name)
        }
      }

      const sharedStates: Array<{ state: string; enums: string[] }> = []
      for (const [state, enums] of allStates) {
        if (enums.length > 1) {
          sharedStates.push({ state, enums })
        }
      }

      const expectedSharedStates = [
        'completed',
        'failed',
        'cancelled',
        'waiting_for_user',
        'waiting_for_approval',
        'timeout',
        'received',
        'initializing',
        'waiting_for_external_event',
        'replanning',
        'paused',
        'approved',
        'denied',
        'queued',
        'running',
        'sleeping',
        'expired',
      ]

      for (const shared of sharedStates) {
        expect(expectedSharedStates).toContain(shared.state)
      }
    })

    it('all state values are lowercase strings with underscores', () => {
      const allStates = [
        ...Object.values(FOREGROUND_STATES),
        ...Object.values(PLANNER_STATES),
        ...Object.values(EXECUTION_PLAN_STATES),
        ...Object.values(RUNTIME_ACTION_STATES),
        ...Object.values(KERNEL_RUN_STATES),
        ...Object.values(TOOL_EXECUTION_STATES),
        ...Object.values(BACKGROUND_SUBAGENT_STATES),
        ...Object.values(WORKFLOW_RUN_STATES),
        ...Object.values(APPROVAL_STATES),
        ...Object.values(WAIT_CONDITION_STATES),
      ]

      const invalidStates = allStates.filter((state) => !/^[a-z_]+$/.test(state))

      if (invalidStates.length > 0) {
        throw new Error(`Invalid state names (must be lowercase with underscores): ${invalidStates.join(', ')}`)
      }

      expect(invalidStates).toHaveLength(0)
    })

    it('all states in global classifications are valid states', () => {
      const allValidStates = new Set([
        ...Object.values(FOREGROUND_STATES),
        ...Object.values(PLANNER_STATES),
        ...Object.values(EXECUTION_PLAN_STATES),
        ...Object.values(RUNTIME_ACTION_STATES),
        ...Object.values(KERNEL_RUN_STATES),
        ...Object.values(TOOL_EXECUTION_STATES),
        ...Object.values(BACKGROUND_SUBAGENT_STATES),
        ...Object.values(WORKFLOW_RUN_STATES),
        ...Object.values(APPROVAL_STATES),
        ...Object.values(WAIT_CONDITION_STATES),
      ])

      const globalStates = [...ACTIVE_STATES, ...WAITING_STATES, ...TERMINAL_STATES]
      const invalidGlobalStates = globalStates.filter((s) => !allValidStates.has(s))

      if (invalidGlobalStates.length > 0) {
        throw new Error(`Invalid states in global classifications: ${invalidGlobalStates.join(', ')}`)
      }

      expect(invalidGlobalStates).toHaveLength(0)
    })
  })
})
