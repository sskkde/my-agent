import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createConnectionManager, type ConnectionManager } from '../../../src/storage/connection.js'
import { createMigrationRunner } from '../../../src/storage/migrations.js'
import { allStoreMigrations } from '../../../src/storage/all-stores-migrations.js'
import { createSummaryStore, type SummaryStore, type SourceRefs } from '../../../src/storage/summary-store.js'
import { createTranscriptStore, type TranscriptStore } from '../../../src/storage/transcript-store.js'
import { createSummaryManager, type SummaryManager } from '../../../src/memory/summary-manager.js'
import { PromptTemplateRegistry, type PromptTemplateRecord } from '../../../src/prompt/prompt-template-registry.js'
import { TemplateLoader } from '../../../src/prompt/template-loader.js'
import { ModelInputBuilder } from '../../../src/kernel/model-input/model-input-builder.js'
import type { ModelInputBuildInput } from '../../../src/kernel/model-input/model-input-types.js'
import { renderSummaryLayers } from '../../../src/kernel/model-input/model-input-types.js'

/**
 * PM-15 Integration Test: Weekly Summary Roundtrip
 *
 * Full roundtrip for weekly summary:
 * - Write via writeWeeklySummary
 * - Read back via summaryStore
 * - Verify summaryType and structuredState.weekRange
 * - Test retrieval via MemorySearch
 * - Test injection in ModelInputBuilder context
 */
describe('Weekly Summary Roundtrip Integration', () => {
  let connection: ConnectionManager
  let summaryStore: SummaryStore
  let transcriptStore: TranscriptStore
  let summaryManager: SummaryManager

  beforeEach(() => {
    connection = createConnectionManager(':memory:')
    connection.open()

    const migrationRunner = createMigrationRunner(connection)
    migrationRunner.init()
    migrationRunner.apply(allStoreMigrations)

    summaryStore = createSummaryStore(connection)
    transcriptStore = createTranscriptStore(connection)
    summaryManager = createSummaryManager(summaryStore, transcriptStore)
  })

  afterEach(() => {
    connection.close()
  })

  function makeTestTemplates(): Map<string, PromptTemplateRecord> {
    return new Map([
      [
        'platform:base',
        {
          id: 'platform:base',
          version: '2026-05-23',
          path: 'platform/base.md',
          agentKind: '*',
          providerFamily: '*',
          layer: 1,
          content: 'Platform Base for {agentKind}.',
          description: 'Test platform base',
        },
      ],
      [
        'platform:safety',
        {
          id: 'platform:safety',
          version: '2026-05-23',
          path: 'platform/safety.md',
          agentKind: '*',
          providerFamily: '*',
          layer: 1,
          content: 'Safety rules.',
          description: 'Test safety',
        },
      ],
      [
        'provider:openai',
        {
          id: 'provider:openai',
          version: '2026-05-23',
          path: 'provider/openai.md',
          agentKind: '*',
          providerFamily: 'openai',
          layer: 2,
          content: 'OpenAI provider config.',
          description: 'Test openai',
        },
      ],
      [
        'agents:foreground',
        {
          id: 'agents:foreground',
          version: '2026-05-23',
          path: 'agents/foreground.md',
          agentKind: 'foreground',
          providerFamily: '*',
          layer: 3,
          content: 'Foreground agent instructions.',
          description: 'Test foreground',
        },
      ],
      [
        'output:foreground.schema',
        {
          id: 'output:foreground.schema',
          version: '2026-05-23',
          path: 'output/foreground.schema.md',
          agentKind: 'foreground',
          providerFamily: '*',
          layer: 4,
          content: 'Output schema.',
          description: 'Test schema',
        },
      ],
    ])
  }

  function makeBuilder(): ModelInputBuilder {
    const templates = makeTestTemplates()
    const registry = new PromptTemplateRegistry(templates, '/nonexistent')
    const loader = new TemplateLoader('/nonexistent')
    return new ModelInputBuilder({ templateRegistry: registry, templateLoader: loader })
  }

  describe('writeWeeklySummary roundtrip', () => {
    it('should write and read weekly summary with correct summaryType', async () => {
      const userId = 'user-123'
      const sourceRefs: SourceRefs = {
        transcriptRefs: ['turn-1', 'turn-2', 'turn-3'],
        previousSummaryRefs: ['daily-sum-1', 'daily-sum-2'],
      }

      const result = await summaryManager.writeWeeklySummary(
        userId,
        {
          summary: 'This week the user completed 3 major features and fixed 5 bugs.',
          weekRange: {
            startDate: '2026-05-18',
            endDate: '2026-05-24',
          },
          retrieval: {
            keywords: ['features', 'bugs', 'productivity'],
            importance: 'high',
          },
        },
        { sourceRefs },
      )

      expect(result.success).toBe(true)
      if (!result.success) throw new Error('Write failed')

      expect(result.data.summaryType).toBe('weekly_summary')
      expect(result.data.userId).toBe(userId)
      expect(result.data.summary).toBe('This week the user completed 3 major features and fixed 5 bugs.')
    })

    it('should store weekRange in structuredState', async () => {
      const userId = 'user-456'
      const sourceRefs: SourceRefs = {
        transcriptRefs: ['turn-week-1'],
      }

      const result = await summaryManager.writeWeeklySummary(
        userId,
        {
          summary: 'Weekly summary content',
          weekRange: {
            startDate: '2026-05-11',
            endDate: '2026-05-17',
          },
        },
        { sourceRefs },
      )

      expect(result.success).toBe(true)
      if (!result.success) throw new Error('Write failed')

      expect(result.data.structuredState?.weekRange).toEqual({
        startDate: '2026-05-11',
        endDate: '2026-05-17',
      })
    })

    it('should read back via summaryStore.getByType', async () => {
      const userId = 'user-789'
      const sourceRefs: SourceRefs = {
        transcriptRefs: ['turn-a', 'turn-b'],
      }

      await summaryManager.writeWeeklySummary(
        userId,
        {
          summary: 'Another weekly summary',
          weekRange: {
            startDate: '2026-05-04',
            endDate: '2026-05-10',
          },
        },
        { sourceRefs },
      )

      const weeklySummaries = summaryStore.getByType('weekly_summary')
      const userWeekly = weeklySummaries.filter((s) => s.userId === userId)

      expect(userWeekly.length).toBeGreaterThan(0)
      expect(userWeekly[0]!.summaryType).toBe('weekly_summary')
    })

    it('should preserve sourceRefs in stored summary', async () => {
      const userId = 'user-source-test'
      const sourceRefs: SourceRefs = {
        transcriptRefs: ['turn-x', 'turn-y', 'turn-z'],
        previousSummaryRefs: ['prev-sum-1'],
      }

      const result = await summaryManager.writeWeeklySummary(
        userId,
        {
          summary: 'Summary with source refs',
          weekRange: {
            startDate: '2026-04-27',
            endDate: '2026-05-03',
          },
        },
        { sourceRefs },
      )

      expect(result.success).toBe(true)
      if (!result.success) throw new Error('Write failed')

      expect(result.data.sourceRefs.transcriptRefs).toEqual(['turn-x', 'turn-y', 'turn-z'])
      expect(result.data.sourceRefs.previousSummaryRefs).toEqual(['prev-sum-1'])
    })
  })

  describe('MemorySearch retrieval', () => {
    it('should find weekly summary via summaryStore.getByType', async () => {
      const userId = 'user-search-test'
      const sourceRefs: SourceRefs = {
        transcriptRefs: ['turn-search-1'],
      }

      await summaryManager.writeWeeklySummary(
        userId,
        {
          summary: 'User worked on authentication module and API integration',
          weekRange: {
            startDate: '2026-05-18',
            endDate: '2026-05-24',
          },
          retrieval: {
            keywords: ['authentication', 'api', 'integration'],
            importance: 'high',
          },
        },
        { sourceRefs },
      )

      const weeklySummaries = summaryStore.getByType('weekly_summary')
      const userWeekly = weeklySummaries.filter((s) => s.userId === userId)

      expect(userWeekly.length).toBeGreaterThan(0)
      expect(userWeekly[0]!.summary).toContain('authentication')
    })

    it('should filter by userId via summaryStore', async () => {
      const user1 = 'user-filter-1'
      const user2 = 'user-filter-2'

      await summaryManager.writeWeeklySummary(
        user1,
        {
          summary: 'User 1 weekly work',
          weekRange: { startDate: '2026-05-18', endDate: '2026-05-24' },
        },
        { sourceRefs: { transcriptRefs: ['t1'] } },
      )

      await summaryManager.writeWeeklySummary(
        user2,
        {
          summary: 'User 2 weekly work',
          weekRange: { startDate: '2026-05-18', endDate: '2026-05-24' },
        },
        { sourceRefs: { transcriptRefs: ['t2'] } },
      )

      const weeklySummaries = summaryStore.getByType('weekly_summary')
      const user1Summaries = weeklySummaries.filter((s) => s.userId === user1)

      expect(user1Summaries.every((s) => s.userId === user1)).toBe(true)
    })

    it('should return sourceRefs in stored summary', async () => {
      const userId = 'user-sourcerefs-test'
      const sourceRefs: SourceRefs = {
        transcriptRefs: ['turn-sr-1', 'turn-sr-2'],
      }

      const result = await summaryManager.writeWeeklySummary(
        userId,
        {
          summary: 'Summary for sourceRefs test',
          weekRange: { startDate: '2026-05-18', endDate: '2026-05-24' },
          retrieval: { keywords: ['test'] },
        },
        { sourceRefs },
      )

      expect(result.success).toBe(true)
      if (!result.success) throw new Error('Write failed')

      expect(result.data.sourceRefs.transcriptRefs).toEqual(['turn-sr-1', 'turn-sr-2'])
    })
  })

  describe('ModelInputBuilder injection', () => {
    it('should include weekly summary in Segment D via summaryLayers', async () => {
      const userId = 'user-builder-test'
      const sourceRefs: SourceRefs = {
        transcriptRefs: ['turn-builder-1'],
      }

      const result = await summaryManager.writeWeeklySummary(
        userId,
        {
          summary: 'Weekly progress: completed 10 tasks',
          weekRange: { startDate: '2026-05-18', endDate: '2026-05-24' },
        },
        { sourceRefs },
      )

      expect(result.success).toBe(true)
      if (!result.success) throw new Error('Write failed')

      const builder = makeBuilder()

      const input: ModelInputBuildInput = {
        mode: 'routing_json',
        agentKind: 'foreground',
        providerFamily: 'openai',
        contextBundle: {
          summaryLayers: {
            weekly: result.data.summary,
          },
        },
      }

      const built = await builder.build(input)

      expect(built.segments.contextBundle).toContain('## Weekly Summary')
      expect(built.segments.contextBundle).toContain('Weekly progress: completed 10 tasks')
    })

    it('should not include weekly summary in other segments', async () => {
      const builder = makeBuilder()

      const input: ModelInputBuildInput = {
        mode: 'routing_json',
        agentKind: 'foreground',
        providerFamily: 'openai',
        contextBundle: {
          summaryLayers: {
            weekly: 'Weekly content here',
          },
        },
      }

      const built = await builder.build(input)

      expect(built.segments.staticPrefix).not.toContain('## Weekly Summary')
      expect(built.segments.tenantProject).not.toContain('## Weekly Summary')
      expect(built.segments.toolPlane).not.toContain('## Weekly Summary')
    })

    it('should combine weekly with other summary layers', async () => {
      const builder = makeBuilder()

      const input: ModelInputBuildInput = {
        mode: 'routing_json',
        agentKind: 'foreground',
        providerFamily: 'openai',
        contextBundle: {
          summaryLayers: {
            session: 'Current session summary',
            daily: 'Today I fixed 3 bugs',
            weekly: 'This week I completed 15 tasks',
          },
        },
      }

      const built = await builder.build(input)

      expect(built.segments.contextBundle).toContain('## Session Summary')
      expect(built.segments.contextBundle).toContain('Current session summary')
      expect(built.segments.contextBundle).toContain('## Daily Summary')
      expect(built.segments.contextBundle).toContain('Today I fixed 3 bugs')
      expect(built.segments.contextBundle).toContain('## Weekly Summary')
      expect(built.segments.contextBundle).toContain('This week I completed 15 tasks')
    })
  })

  describe('renderSummaryLayers', () => {
    it('renders weekly summary correctly', () => {
      const result = renderSummaryLayers({
        weekly: 'Productive week with many achievements',
      })

      expect(result).toContain('## Weekly Summary')
      expect(result).toContain('Productive week with many achievements')
    })

    it('skips null weekly summary', () => {
      const result = renderSummaryLayers({
        weekly: null,
        daily: 'Daily content',
      })

      expect(result).not.toContain('## Weekly Summary')
      expect(result).toContain('## Daily Summary')
    })
  })

  describe('version tracking', () => {
    it('should track version for weekly summary', async () => {
      const userId = 'user-version-test'
      const sourceRefs: SourceRefs = {
        transcriptRefs: ['turn-ver-1'],
      }

      const result = await summaryManager.writeWeeklySummary(
        userId,
        {
          summary: 'Version test summary',
          weekRange: { startDate: '2026-05-18', endDate: '2026-05-24' },
        },
        { sourceRefs },
      )

      expect(result.success).toBe(true)
      if (!result.success) throw new Error('Write failed')

      expect(result.version).toBe(1)

      const history = summaryManager.getVersionHistory(result.data.summaryId)
      expect(history.length).toBe(1)
      expect(history[0]!.version).toBe(1)
    })
  })
})
