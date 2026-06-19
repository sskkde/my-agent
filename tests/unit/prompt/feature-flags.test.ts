import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  isToolLoopV2Enabled,
  isPromptT5TemplateConsumptionEnabled,
  isPromptT6TemplateConsumptionEnabled,
  isPromptT7TemplateConsumptionEnabled,
  isPromptSegmentBSubsectionsEnabled,
  isPromptSegmentDProvenanceEnabled,
  isPromptSummaryLayersTopLevelEnabled,
  isPromptRichPersonaEnabled,
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

    it('returns false when PROMPT_T5_TEMPLATE_CONSUMPTION_ENABLED is not set', () => {
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

    it('returns false when PROMPT_T6_TEMPLATE_CONSUMPTION_ENABLED is not set', () => {
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

    it('returns false when PROMPT_T7_TEMPLATE_CONSUMPTION_ENABLED is not set', () => {
      expect(isPromptT7TemplateConsumptionEnabled()).toBe(false)
    })

    it('returns true when PROMPT_T7_TEMPLATE_CONSUMPTION_ENABLED is set to "true"', () => {
      process.env.PROMPT_T7_TEMPLATE_CONSUMPTION_ENABLED = 'true'
      expect(isPromptT7TemplateConsumptionEnabled()).toBe(true)
    })
  })

  describe('isPromptSegmentBSubsectionsEnabled', () => {
    const originalEnv = process.env.PROMPT_SEGMENT_B_SUBSECTIONS_ENABLED

    beforeEach(() => {
      delete process.env.PROMPT_SEGMENT_B_SUBSECTIONS_ENABLED
    })

    afterEach(() => {
      if (originalEnv === undefined) {
        delete process.env.PROMPT_SEGMENT_B_SUBSECTIONS_ENABLED
      } else {
        process.env.PROMPT_SEGMENT_B_SUBSECTIONS_ENABLED = originalEnv
      }
    })

    it('returns false when PROMPT_SEGMENT_B_SUBSECTIONS_ENABLED is not set', () => {
      expect(isPromptSegmentBSubsectionsEnabled()).toBe(false)
    })

    it('returns true when PROMPT_SEGMENT_B_SUBSECTIONS_ENABLED is set to "true"', () => {
      process.env.PROMPT_SEGMENT_B_SUBSECTIONS_ENABLED = 'true'
      expect(isPromptSegmentBSubsectionsEnabled()).toBe(true)
    })
  })

  describe('isPromptSegmentDProvenanceEnabled', () => {
    const originalEnv = process.env.PROMPT_SEGMENT_D_PROVENANCE_ENABLED

    beforeEach(() => {
      delete process.env.PROMPT_SEGMENT_D_PROVENANCE_ENABLED
    })

    afterEach(() => {
      if (originalEnv === undefined) {
        delete process.env.PROMPT_SEGMENT_D_PROVENANCE_ENABLED
      } else {
        process.env.PROMPT_SEGMENT_D_PROVENANCE_ENABLED = originalEnv
      }
    })

    it('returns false when PROMPT_SEGMENT_D_PROVENANCE_ENABLED is not set', () => {
      expect(isPromptSegmentDProvenanceEnabled()).toBe(false)
    })

    it('returns true when PROMPT_SEGMENT_D_PROVENANCE_ENABLED is set to "true"', () => {
      process.env.PROMPT_SEGMENT_D_PROVENANCE_ENABLED = 'true'
      expect(isPromptSegmentDProvenanceEnabled()).toBe(true)
    })
  })

  describe('isPromptSummaryLayersTopLevelEnabled', () => {
    const originalEnv = process.env.PROMPT_SUMMARY_LAYERS_TOP_LEVEL_ENABLED

    beforeEach(() => {
      delete process.env.PROMPT_SUMMARY_LAYERS_TOP_LEVEL_ENABLED
    })

    afterEach(() => {
      if (originalEnv === undefined) {
        delete process.env.PROMPT_SUMMARY_LAYERS_TOP_LEVEL_ENABLED
      } else {
        process.env.PROMPT_SUMMARY_LAYERS_TOP_LEVEL_ENABLED = originalEnv
      }
    })

    it('returns false when PROMPT_SUMMARY_LAYERS_TOP_LEVEL_ENABLED is not set', () => {
      expect(isPromptSummaryLayersTopLevelEnabled()).toBe(false)
    })

    it('returns true when PROMPT_SUMMARY_LAYERS_TOP_LEVEL_ENABLED is set to "true"', () => {
      process.env.PROMPT_SUMMARY_LAYERS_TOP_LEVEL_ENABLED = 'true'
      expect(isPromptSummaryLayersTopLevelEnabled()).toBe(true)
    })
  })

  describe('isPromptRichPersonaEnabled', () => {
    const originalEnv = process.env.PROMPT_RICH_PERSONA_ENABLED

    beforeEach(() => {
      delete process.env.PROMPT_RICH_PERSONA_ENABLED
    })

    afterEach(() => {
      if (originalEnv === undefined) {
        delete process.env.PROMPT_RICH_PERSONA_ENABLED
      } else {
        process.env.PROMPT_RICH_PERSONA_ENABLED = originalEnv
      }
    })

    it('returns false when PROMPT_RICH_PERSONA_ENABLED is not set', () => {
      expect(isPromptRichPersonaEnabled()).toBe(false)
    })

    it('returns true when PROMPT_RICH_PERSONA_ENABLED is set to "true"', () => {
      process.env.PROMPT_RICH_PERSONA_ENABLED = 'true'
      expect(isPromptRichPersonaEnabled()).toBe(true)
    })
  })
})
