import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import {
  getFlagPhase,
  getPromptMemoryP0Phase,
  getToolLoopV2Phase,
  isPromptMemoryP0PhaseActive,
  isToolLoopV2PhaseActive,
} from '../../../src/prompt/feature-flag-phase.js'

const ORIGINAL_ENV = { ...process.env }

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV }
  delete process.env.PROMPT_MEMORY_P0_PHASE
  delete process.env.TOOL_LOOP_V2_PHASE
})

afterAll(() => {
  process.env = ORIGINAL_ENV
})

describe('getFlagPhase', () => {
  it('returns undefined when env var is not set', () => {
    delete process.env.TEST_PHASE
    expect(getFlagPhase('TEST_PHASE')).toBeUndefined()
  })

  it('returns shadow when env var is "shadow"', () => {
    process.env.TEST_PHASE = 'shadow'
    expect(getFlagPhase('TEST_PHASE')).toBe('shadow')
  })

  it('returns canary when env var is "canary"', () => {
    process.env.TEST_PHASE = 'canary'
    expect(getFlagPhase('TEST_PHASE')).toBe('canary')
  })

  it('returns default when env var is "default"', () => {
    process.env.TEST_PHASE = 'default'
    expect(getFlagPhase('TEST_PHASE')).toBe('default')
  })

  it('returns undefined for invalid phase value', () => {
    process.env.TEST_PHASE = 'invalid'
    expect(getFlagPhase('TEST_PHASE')).toBeUndefined()
  })
})

describe('getPromptMemoryP0Phase', () => {
  it('returns undefined when PROMPT_MEMORY_P0_PHASE is not set', () => {
    expect(getPromptMemoryP0Phase()).toBeUndefined()
  })

  it('returns the phase when set', () => {
    process.env.PROMPT_MEMORY_P0_PHASE = 'canary'
    expect(getPromptMemoryP0Phase()).toBe('canary')
  })
})

describe('getToolLoopV2Phase', () => {
  it('returns undefined when TOOL_LOOP_V2_PHASE is not set', () => {
    expect(getToolLoopV2Phase()).toBeUndefined()
  })

  it('returns the phase when set', () => {
    process.env.TOOL_LOOP_V2_PHASE = 'shadow'
    expect(getToolLoopV2Phase()).toBe('shadow')
  })
})

describe('isPromptMemoryP0PhaseActive', () => {
  it('returns false when phase is shadow', () => {
    process.env.PROMPT_MEMORY_P0_PHASE = 'shadow'
    expect(isPromptMemoryP0PhaseActive()).toBe(false)
  })

  it('returns true when phase is canary', () => {
    process.env.PROMPT_MEMORY_P0_PHASE = 'canary'
    expect(isPromptMemoryP0PhaseActive()).toBe(true)
  })

  it('returns true when phase is default', () => {
    process.env.PROMPT_MEMORY_P0_PHASE = 'default'
    expect(isPromptMemoryP0PhaseActive()).toBe(true)
  })

  it('returns false when phase is not set', () => {
    expect(isPromptMemoryP0PhaseActive()).toBe(false)
  })
})

describe('isToolLoopV2PhaseActive', () => {
  it('returns false when phase is shadow', () => {
    process.env.TOOL_LOOP_V2_PHASE = 'shadow'
    expect(isToolLoopV2PhaseActive()).toBe(false)
  })

  it('returns true when phase is canary', () => {
    process.env.TOOL_LOOP_V2_PHASE = 'canary'
    expect(isToolLoopV2PhaseActive()).toBe(true)
  })

  it('returns true when phase is default', () => {
    process.env.TOOL_LOOP_V2_PHASE = 'default'
    expect(isToolLoopV2PhaseActive()).toBe(true)
  })

  it('returns false when phase is not set', () => {
    expect(isToolLoopV2PhaseActive()).toBe(false)
  })
})
