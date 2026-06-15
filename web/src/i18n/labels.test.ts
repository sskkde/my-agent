import { describe, expect, it } from 'vitest'
import type { ConsoleSessionInfo, UserRole, WorkflowStepType } from '../api/types'
import {
  CHANNEL_STATUS_LABELS,
  SESSION_STATUS_LABELS,
  USER_ROLE_LABELS,
  WORKFLOW_STATUS_LABELS,
  WORKFLOW_STEP_TYPES,
  WORKFLOW_STEP_TYPE_LABELS,
  formatDateTimeZhCN,
  formatSessionTitleDate,
  formatUsdCents,
  getChannelStatusLabel,
  getSessionStatusLabel,
  getSkillTypeLabel,
  getToolDisplayName,
  getUserRoleLabel,
  getWorkflowStatusLabel,
  getWorkflowStepTypeLabel,
} from './labels'

const SESSION_STATUSES = ['active', 'archived', 'closed'] satisfies Array<ConsoleSessionInfo['status']>
const WORKFLOW_STEP_TYPE_VALUES = [
  'tool_call',
  'agent_run',
  'subagent_run',
  'approval',
  'wait',
] satisfies WorkflowStepType[]
const USER_ROLES = ['admin', 'user', 'service'] satisfies UserRole[]

describe('localized labels', () => {
  it('covers every session status', () => {
    expect(Object.keys(SESSION_STATUS_LABELS).sort()).toEqual([...SESSION_STATUSES].sort())
    for (const status of SESSION_STATUSES) {
      expect(getSessionStatusLabel(status)).toMatch(/[^a-z_]/i)
    }
  })

  it('covers every workflow step type', () => {
    expect(WORKFLOW_STEP_TYPES).toEqual(WORKFLOW_STEP_TYPE_VALUES)
    expect(Object.keys(WORKFLOW_STEP_TYPE_LABELS).sort()).toEqual([...WORKFLOW_STEP_TYPE_VALUES].sort())
    for (const stepType of WORKFLOW_STEP_TYPE_VALUES) {
      expect(getWorkflowStepTypeLabel(stepType)).not.toBe(stepType)
    }
  })

  it('covers common workflow and channel statuses', () => {
    for (const status of Object.keys(WORKFLOW_STATUS_LABELS)) {
      expect(getWorkflowStatusLabel(status)).not.toBe(status)
    }
    for (const status of Object.keys(CHANNEL_STATUS_LABELS)) {
      expect(getChannelStatusLabel(status)).not.toBe(status)
    }
  })

  it('covers every user role', () => {
    expect(Object.keys(USER_ROLE_LABELS).sort()).toEqual([...USER_ROLES].sort())
    for (const role of USER_ROLES) {
      expect(getUserRoleLabel(role)).not.toBe(role)
    }
  })

  it('localizes known tool and skill names while preserving unknown values', () => {
    expect(getToolDisplayName('read_file')).toBe('读取文件')
    expect(getToolDisplayName('unknown_tool')).toBe('unknown_tool')
    expect(getSkillTypeLabel('builtin')).toBe('内置')
    expect(getSkillTypeLabel('external')).toBe('external')
  })

  it('centralizes date, number, and money formatting', () => {
    const date = new Date('2026-06-11T08:09:00')
    expect(formatDateTimeZhCN(date)).toContain('2026')
    expect(formatDateTimeZhCN(date)).toContain('08:09')
    expect(formatSessionTitleDate(date)).toContain('2026')
    expect(formatUsdCents(1234)).toBe('$12.34')
    expect(formatUsdCents(null)).toBe('未配置')
  })
})
