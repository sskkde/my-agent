import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  isToolLoopV2Enabled,
  isPromptT5TemplateConsumptionEnabled,
  isPromptT6TemplateConsumptionEnabled,
  isPromptT7TemplateConsumptionEnabled,
} from '../../../src/prompt/feature-flags.js'

describe('feature-flags', () => {
  describe('isToolLoopV2Enabled', () => {
    const originalEnv = process.env.TOOL_LOOP_V2_ENABLED

    beforeEach(() => {
      delete process.env.TOOL_LOOP_V2_ENABLED
    })

    afterEach(() => {
      if (originalEnv === undefined) {
        delete process.env.TOOL_LOOP_V2_ENABLED
      } else {
        process.env.TOOL_LOOP_V2_ENABLED = originalEnv
      }
    })

    it('returns false when TOOL_LOOP_V2_ENABLED is not set', () => {
      expect(isToolLoopV2Enabled()).toBe(false)
    })

    it('returns true when TOOL_LOOP_V2_ENABLED is set to "true"', () => {
      process.env.TOOL_LOOP_V2_ENABLED = 'true'
      expect(isToolLoopV2Enabled()).toBe(true)
    })
  })

  describe('isPromptT5TemplateConsumptionEnabled', () => {
    const originalEnv = process.env.PROMPT_T5_TEMPLATE_CONSUMPTION_ENABLED

    beforeEach(() => {
      delete process.env.PROMPT_T5_TEMPLATE_CONSUMPTION_ENABLED
    })

    afterEach(() => {
      if (originalEnv === undefined) {
        delete process.env.PROMPT_T5_TEMPLATE_CONSUMPTION_ENABLED
      } else {
        process.env.PROMPT_T5_TEMPLATE_CONSUMPTION_ENABLED = originalEnv
      }
    })

    it('returns true when PROMPT_T5_TEMPLATE_CONSUMPTION_ENABLED is not set', () => {
      expect(isPromptT5TemplateConsumptionEnabled()).toBe(true)
    })

    it('returns false when PROMPT_T5_TEMPLATE_CONSUMPTION_ENABLED is set to "false"', () => {
      process.env.PROMPT_T5_TEMPLATE_CONSUMPTION_ENABLED = 'false'
      expect(isPromptT5TemplateConsumptionEnabled()).toBe(false)
    })

    it('returns true when PROMPT_T5_TEMPLATE_CONSUMPTION_ENABLED is set to "true"', () => {
      process.env.PROMPT_T5_TEMPLATE_CONSUMPTION_ENABLED = 'true'
      expect(isPromptT5TemplateConsumptionEnabled()).toBe(true)
    })
  })

  describe('isPromptT6TemplateConsumptionEnabled', () => {
    const originalEnv = process.env.PROMPT_T6_TEMPLATE_CONSUMPTION_ENABLED

    beforeEach(() => {
      delete process.env.PROMPT_T6_TEMPLATE_CONSUMPTION_ENABLED
    })

    afterEach(() => {
      if (originalEnv === undefined) {
        delete process.env.PROMPT_T6_TEMPLATE_CONSUMPTION_ENABLED
      } else {
        process.env.PROMPT_T6_TEMPLATE_CONSUMPTION_ENABLED = originalEnv
      }
    })

    it('returns true when PROMPT_T6_TEMPLATE_CONSUMPTION_ENABLED is not set', () => {
      expect(isPromptT6TemplateConsumptionEnabled()).toBe(true)
    })

    it('returns false when PROMPT_T6_TEMPLATE_CONSUMPTION_ENABLED is set to "false"', () => {
      process.env.PROMPT_T6_TEMPLATE_CONSUMPTION_ENABLED = 'false'
      expect(isPromptT6TemplateConsumptionEnabled()).toBe(false)
    })

    it('returns true when PROMPT_T6_TEMPLATE_CONSUMPTION_ENABLED is set to "true"', () => {
      process.env.PROMPT_T6_TEMPLATE_CONSUMPTION_ENABLED = 'true'
      expect(isPromptT6TemplateConsumptionEnabled()).toBe(true)
    })
  })

  describe('isPromptT7TemplateConsumptionEnabled', () => {
    const originalEnv = process.env.PROMPT_T7_TEMPLATE_CONSUMPTION_ENABLED

    beforeEach(() => {
      delete process.env.PROMPT_T7_TEMPLATE_CONSUMPTION_ENABLED
    })

    afterEach(() => {
      if (originalEnv === undefined) {
        delete process.env.PROMPT_T7_TEMPLATE_CONSUMPTION_ENABLED
      } else {
        process.env.PROMPT_T7_TEMPLATE_CONSUMPTION_ENABLED = originalEnv
      }
    })

    it('returns true when PROMPT_T7_TEMPLATE_CONSUMPTION_ENABLED is not set', () => {
      expect(isPromptT7TemplateConsumptionEnabled()).toBe(true)
    })

    it('returns false when PROMPT_T7_TEMPLATE_CONSUMPTION_ENABLED is set to "false"', () => {
      process.env.PROMPT_T7_TEMPLATE_CONSUMPTION_ENABLED = 'false'
      expect(isPromptT7TemplateConsumptionEnabled()).toBe(false)
    })

    it('returns true when PROMPT_T7_TEMPLATE_CONSUMPTION_ENABLED is set to "true"', () => {
      process.env.PROMPT_T7_TEMPLATE_CONSUMPTION_ENABLED = 'true'
      expect(isPromptT7TemplateConsumptionEnabled()).toBe(true)
    })
  })
})
