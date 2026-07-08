import { describe, it, expect } from 'vitest'
import { buildObservationSummary } from '../../../src/kernel/observation-summary-builder.js'
import type { ToolUseResult } from '../../../src/kernel/types.js'

function makeResult(overrides: Partial<ToolUseResult> & { result?: unknown }): ToolUseResult {
  return {
    toolCallId: 'call_1',
    result: null,
    ...overrides,
  }
}

describe('buildObservationSummary', () => {
  describe('search_subagent → search_facts', () => {
    it('extracts top-3 facts from search_subagent result', () => {
      const result = makeResult({
        toolCallId: 'call_search',
        result: {
          extractedFacts: [
            { fact: 'TypeScript is a typed superset of JavaScript', sourceUrl: 'https://ts.dev', confidence: 0.95 },
            { fact: 'TypeScript 5.0 introduced decorators', sourceUrl: 'https://ts.dev/5.0', confidence: 0.9 },
            { fact: 'TypeScript compiles to plain JavaScript', sourceUrl: 'https://ts.dev', confidence: 0.85 },
            { fact: 'TypeScript supports generics', sourceUrl: 'https://ts.dev/generics', confidence: 0.8 },
          ],
        },
      })
      const summary = buildObservationSummary('search_subagent', result)
      expect(summary.summaryType).toBe('search_facts')
      expect(summary.summary).toContain('TypeScript is a typed superset')
      expect(summary.summary).toContain('TypeScript 5.0 introduced decorators')
      expect(summary.summary).toContain('TypeScript compiles')
      expect(summary.evidenceCount).toBe(4)
    })

    it('handles search_subagent with no facts', () => {
      const result = makeResult({
        toolCallId: 'call_empty',
        result: { extractedFacts: [] },
      })
      const summary = buildObservationSummary('search_subagent', result)
      expect(summary.summaryType).toBe('search_facts')
      expect(summary.summary).toBe('No facts extracted')
      expect(summary.evidenceCount).toBe(0)
    })

    it('handles search_subagent with error', () => {
      const result = makeResult({
        toolCallId: 'call_err',
        result: null,
        error: { code: 'SEARCH_FAILED', message: 'API error', recoverable: true },
      })
      const summary = buildObservationSummary('search_subagent', result)
      expect(summary.summaryType).toBe('search_facts')
      expect(summary.summary).toContain('Search failed')
      expect(summary.evidenceCount).toBeUndefined()
    })
  })

  describe('web_search → search_facts', () => {
    it('extracts facts from web_search result', () => {
      const result = makeResult({
        toolCallId: 'call_web',
        result: {
          extractedFacts: [
            { fact: 'TypeScript 5.5 released', sourceUrl: 'https://ts.dev', confidence: 0.9 },
            { fact: 'New type narrowing features', sourceUrl: 'https://ts.dev', confidence: 0.85 },
          ],
        },
      })
      const summary = buildObservationSummary('web_search', result)
      expect(summary.summaryType).toBe('search_facts')
      expect(summary.summary).toContain('TypeScript 5.5 released')
      expect(summary.evidenceCount).toBe(2)
    })
  })

  describe('file_read → file_preview', () => {
    it('includes first 200 chars and line/char count', () => {
      const content = 'a'.repeat(500)
      const result = makeResult({
        toolCallId: 'call_read',
        result: { content, path: '/test.txt' },
      })
      const summary = buildObservationSummary('file_read', result)
      expect(summary.summaryType).toBe('file_preview')
      expect(summary.summary).toContain('a'.repeat(200))
      expect(summary.summary).toContain('(500 chars)')
    })

    it('handles short content without trimming', () => {
      const result = makeResult({
        toolCallId: 'call_read_short',
        result: { content: 'Hello world', path: '/test.txt' },
      })
      const summary = buildObservationSummary('file_read', result)
      expect(summary.summary).toBe('Hello world (11 chars)')
    })

    it('handles file_read error', () => {
      const result = makeResult({
        toolCallId: 'call_read_err',
        result: null,
        error: { code: 'FILE_NOT_FOUND', message: '/test.txt not found', recoverable: false },
      })
      const summary = buildObservationSummary('file_read', result)
      expect(summary.summaryType).toBe('file_preview')
      expect(summary.summary).toContain('Read failed')
    })
  })

  describe('file_glob → file_preview', () => {
    it('lists matched files with count', () => {
      const result = makeResult({
        toolCallId: 'call_glob',
        result: { files: ['src/a.ts', 'src/b.ts', 'src/c.ts'] },
      })
      const summary = buildObservationSummary('file_glob', result)
      expect(summary.summaryType).toBe('file_preview')
      expect(summary.summary).toContain('3')
      expect(summary.summary).toContain('src/a.ts')
      expect(summary.evidenceCount).toBe(3)
    })
  })

  describe('memory_retrieve → memory_keywords', () => {
    it('includes count and top-3 keywords', () => {
      const result = makeResult({
        toolCallId: 'call_mem',
        result: {
          entries: [
            { id: '1', keyword: 'typescript', content: '...' },
            { id: '2', keyword: 'react', content: '...' },
            { id: '3', keyword: 'testing', content: '...' },
            { id: '4', keyword: 'decorators', content: '...' },
          ],
          keywords: ['typescript', 'react', 'testing', 'decorators'],
        },
      })
      const summary = buildObservationSummary('memory_retrieve', result)
      expect(summary.summaryType).toBe('memory_keywords')
      expect(summary.summary).toContain('4')
      expect(summary.summary).toContain('typescript')
      expect(summary.summary).toContain('react')
      expect(summary.summary).toContain('testing')
      expect(summary.evidenceCount).toBe(4)
    })

    it('handles memory_retrieve with fewer than 3 keywords', () => {
      const result = makeResult({
        toolCallId: 'call_mem2',
        result: {
          entries: [{ id: '1', keyword: 'hello', content: '...' }],
          keywords: ['hello'],
        },
      })
      const summary = buildObservationSummary('memory_retrieve', result)
      expect(summary.summary).toContain('1')
      expect(summary.summary).toContain('hello')
    })
  })

  describe('generic fallback', () => {
    it('truncates result to 500 chars', () => {
      const result = makeResult({
        toolCallId: 'call_generic',
        result: { data: 'x'.repeat(1000) },
      })
      const summary = buildObservationSummary('other_tool', result)
      expect(summary.summaryType).toBe('generic')
      expect(summary.summary.length).toBeLessThanOrEqual(500)
      expect(summary.summary).toContain('...[truncated]')
    })

    it('short result is not truncated', () => {
      const result = makeResult({
        toolCallId: 'call_short',
        result: { data: 'short result' },
      })
      const summary = buildObservationSummary('other_tool', result)
      expect(summary.summary).toBe(JSON.stringify({ data: 'short result' }))
    })

    it('handles error in generic tool', () => {
      const result = makeResult({
        toolCallId: 'call_err',
        result: null,
        error: { code: 'ERR', message: 'Something broke', recoverable: true },
      })
      const summary = buildObservationSummary('other_tool', result)
      expect(summary.summaryType).toBe('generic')
      expect(summary.summary).toContain('failed')
    })
  })
})
