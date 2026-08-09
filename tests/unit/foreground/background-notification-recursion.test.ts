import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  handleLaunchSubagent,
  type LaunchSubagentDeps,
  type LaunchSubagentInput,
} from '../../../src/foreground/tools/subagent-launch-tool.js'
import type { RuntimeDispatcher, DispatchResult } from '../../../src/dispatcher/types.js'
import { createAgentProfileRegistry, registerSystemProfiles } from '../../../src/taxonomy/agent-profile-registry.js'
import type { AgentProfileRegistry } from '../../../src/taxonomy/agent-profile-registry.js'
import type { ChildSessionTaskRuntime } from '../../../src/subagents/child-session-task-runtime.js'
import type { BackgroundRuntime } from '../../../src/subagents/background-runtime.js'

describe('Subagent launches from auto-continued (background notification) turns', () => {
  let profileRegistry: AgentProfileRegistry

  beforeEach(() => {
    profileRegistry = createAgentProfileRegistry()
    registerSystemProfiles(profileRegistry)
  })

  const completedDispatchResult: DispatchResult = {
    requestId: 'turn-1',
    actionId: 'action-123',
    status: 'completed',
    targetRuntime: 'subagent_runtime',
    createdAt: '2024-01-01T00:00:00Z',
  }

  describe('turnSource === "background_notification"', () => {
    it('rejects a background=true launch with SUBAGENT_LAUNCH_FROM_NOTIFICATION_TURN and enqueues nothing', async () => {
      const mockRuntimeDispatcher = { dispatch: vi.fn() } as unknown as RuntimeDispatcher
      const enqueueBackgroundRun = vi.fn().mockReturnValue('bg_run_1')

      const deps: LaunchSubagentDeps = {
        runtimeDispatcher: mockRuntimeDispatcher,
        userId: 'user-1',
        sessionId: 'session-1',
        turnId: 'turn-1',
        profileRegistry,
        turnSource: 'background_notification',
        childSessionTaskRuntime: {} as unknown as ChildSessionTaskRuntime,
        backgroundRuntime: { enqueueBackgroundRun } as unknown as BackgroundRuntime,
      }

      const input: LaunchSubagentInput = {
        objective: 'Launch a background task',
        agentType: 'document_processor',
        background: true,
      }

      const result = await handleLaunchSubagent(deps, input)

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('SUBAGENT_LAUNCH_FROM_NOTIFICATION_TURN')
      expect(result.error?.message).toBe(
        'Subagent launches are not allowed in auto-continued turns; please send a user message to start a task.',
      )
      expect(result.error?.recoverable).toBe(false)
      expect(result.userVisibleSummary).toBe('Task cannot be launched from this turn.')
      expect(result.runtimeSummary?.runtimeActionIds).toEqual([])
      expect(enqueueBackgroundRun).not.toHaveBeenCalled()
      expect(mockRuntimeDispatcher.dispatch).not.toHaveBeenCalled()
    })

    it('rejects a foreground (background=false/omitted) launch with the same typed error and launches no child', async () => {
      const mockRuntimeDispatcher = { dispatch: vi.fn() } as unknown as RuntimeDispatcher
      const launchTask = vi.fn()

      const deps: LaunchSubagentDeps = {
        runtimeDispatcher: mockRuntimeDispatcher,
        userId: 'user-1',
        sessionId: 'session-1',
        turnId: 'turn-1',
        profileRegistry,
        turnSource: 'background_notification',
        childSessionTaskRuntime: { launchTask } as unknown as ChildSessionTaskRuntime,
      }

      const input: LaunchSubagentInput = {
        objective: 'Launch a foreground task',
        agentType: 'document_processor',
        background: false,
      }

      const result = await handleLaunchSubagent(deps, input)

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('SUBAGENT_LAUNCH_FROM_NOTIFICATION_TURN')
      expect(result.error?.recoverable).toBe(false)
      expect(result.userVisibleSummary).toBe('Task cannot be launched from this turn.')
      expect(launchTask).not.toHaveBeenCalled()
      expect(mockRuntimeDispatcher.dispatch).not.toHaveBeenCalled()
    })
  })

  describe('turnSource is undefined or "user" (normal user turns)', () => {
    it('foreground launch proceeds unchanged when turnSource is undefined', async () => {
      const mockRuntimeDispatcher = {
        dispatch: vi.fn().mockResolvedValue(completedDispatchResult),
      } as unknown as RuntimeDispatcher

      const deps: LaunchSubagentDeps = {
        runtimeDispatcher: mockRuntimeDispatcher,
        userId: 'user-1',
        sessionId: 'session-1',
        turnId: 'turn-1',
        profileRegistry,
      }

      const input: LaunchSubagentInput = {
        objective: 'Process the PDF document',
        agentType: 'document_processor',
      }

      const result = await handleLaunchSubagent(deps, input)

      expect(result.success).toBe(true)
      expect(result.data?.agentType).toBe('document_processor')
      expect(result.runtimeSummary?.runtimeActionIds).toHaveLength(1)
      expect(mockRuntimeDispatcher.dispatch).toHaveBeenCalledTimes(1)
    })

    it('foreground launch proceeds unchanged when turnSource is "user"', async () => {
      const mockRuntimeDispatcher = {
        dispatch: vi.fn().mockResolvedValue(completedDispatchResult),
      } as unknown as RuntimeDispatcher

      const deps: LaunchSubagentDeps = {
        runtimeDispatcher: mockRuntimeDispatcher,
        userId: 'user-1',
        sessionId: 'session-1',
        turnId: 'turn-1',
        profileRegistry,
        turnSource: 'user',
      }

      const input: LaunchSubagentInput = {
        objective: 'Process the PDF document',
        agentType: 'document_processor',
      }

      const result = await handleLaunchSubagent(deps, input)

      expect(result.success).toBe(true)
      expect(result.data?.agentType).toBe('document_processor')
      expect(result.runtimeSummary?.runtimeActionIds).toHaveLength(1)
      expect(mockRuntimeDispatcher.dispatch).toHaveBeenCalledTimes(1)
    })
  })
})
