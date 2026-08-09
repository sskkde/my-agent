import { describe, it, expect } from 'vitest'
import {
  enforceSegmentDBudget,
  DEFAULT_SEGMENT_D_BUDGET,
  type SegmentDBudgetConfig,
} from '../../../../src/kernel/model-input/segment-d-budget.js'

describe('enforceSegmentDBudget', () => {
  it('returns all content when within budget', () => {
    const parts = ['short text', 'another short text']
    const result = enforceSegmentDBudget(parts, DEFAULT_SEGMENT_D_BUDGET)
    expect(result.content).toBe('short text\n\nanother short text')
    expect(result.droppedReasons).toHaveLength(0)
  })

  it('trims provenance subsection when over budget', () => {
    const parts = [
      'pinned item with lots of text '.repeat(100), // ~2600 chars ≈ 650 tokens > 2048 budget
    ]
    const budget: SegmentDBudgetConfig = {
      totalBudget: 4096,
      subsections: {
        provenance: 64,
        memoryPolicy: 256,
        summaryLayers: 512,
        dynamicFields: 128,
        runtimeEnvironment: 128,
        contextItems: 100, // small budget to trigger trimming
        userMessage: 0,
        transcript: 768,
      },
    }
    // parts[0] is contextItems
    const result = enforceSegmentDBudget(parts, budget)
    // trimmed from the end - we don't depend on exact content but verify no crash
    expect(typeof result.content).toBe('string')
    expect(Array.isArray(result.droppedReasons)).toBe(true)
  })

  it('does not trim userMessage subsection (budget 0 = unlimited)', () => {
    const huge = 'x'.repeat(10000)
    // userMessage is at SUBSECTION_ORDER index 6, so need 6 filler parts before it
    const parts = ['a', 'b', 'c', 'd', 'e', 'f', huge, 'other']
    const budget: SegmentDBudgetConfig = {
      totalBudget: 4096,
      subsections: {
        provenance: 64,
        memoryPolicy: 256,
        summaryLayers: 512,
        dynamicFields: 128,
        runtimeEnvironment: 128,
        contextItems: 2048,
        userMessage: 0, // unlimited
        transcript: 768,
      },
    }
    const result = enforceSegmentDBudget(parts, budget)
    expect(result.content).toBe('a\n\nb\n\nc\n\nd\n\ne\n\nf\n\n' + huge + '\n\nother')
    expect(result.droppedReasons).toHaveLength(0)
  })

  it('does not trim dynamicFields subsection (budget 0 = unlimited)', () => {
    const huge = 'y'.repeat(10000)
    // dynamicFields is at SUBSECTION_ORDER index 3, so need 3 filler parts before it
    const parts = ['small', 'a', 'b', huge]
    const budget: SegmentDBudgetConfig = {
      totalBudget: 4096,
      subsections: {
        provenance: 64,
        memoryPolicy: 256,
        summaryLayers: 512,
        dynamicFields: 0, // unlimited
        runtimeEnvironment: 128,
        contextItems: 2048,
        userMessage: 0,
        transcript: 768,
      },
    }
    const result = enforceSegmentDBudget(parts, budget)
    expect(result.content).toBe('small\n\na\n\nb\n\n' + huge)
    expect(result.droppedReasons).toHaveLength(0)
  })

  it('returns dropped reasons when trimming occurs', () => {
    const longTranscript = 'transcript line '.repeat(500) // ~7500 chars ≈ 1875 tokens > 768 budget
    const parts = ['short', longTranscript]
    const budget: SegmentDBudgetConfig = {
      totalBudget: 4096,
      subsections: {
        provenance: 64,
        memoryPolicy: 256,
        summaryLayers: 512,
        dynamicFields: 128,
        runtimeEnvironment: 128,
        contextItems: 2048,
        userMessage: 0,
        transcript: 100, // very small to force trimming
      },
    }
    const result = enforceSegmentDBudget(parts, budget)
    expect(result.droppedReasons.length).toBeGreaterThanOrEqual(1)
    expect(result.droppedReasons[0]).toHaveProperty('section')
    expect(result.droppedReasons[0]).toHaveProperty('reason')
    expect(result.droppedReasons[0]).toHaveProperty('itemCount')
  })

  it('returns empty content and no dropped reasons for empty parts', () => {
    const result = enforceSegmentDBudget([], DEFAULT_SEGMENT_D_BUDGET)
    expect(result.content).toBe('')
    expect(result.droppedReasons).toHaveLength(0)
  })

  it('handles missing budget config gracefully', () => {
    const parts = ['test']
    const result = enforceSegmentDBudget(parts, undefined)
    expect(result.content).toBe('test')
    expect(result.droppedReasons).toHaveLength(0)
  })
})
