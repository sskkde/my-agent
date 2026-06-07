import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createConnectionManager, type ConnectionManager } from '../../../src/storage/connection.js'
import { createMigrationRunner, type MigrationRunner } from '../../../src/storage/migrations.js'
import {
  createTranscriptStore,
  type TranscriptStore,
  type TurnTranscript,
  type Visibility,
} from '../../../src/storage/transcript-store.js'

describe('TranscriptStore', () => {
  let connection: ConnectionManager
  let migrations: MigrationRunner
  let store: TranscriptStore

  beforeEach(() => {
    connection = createConnectionManager(':memory:')
    connection.open()
    migrations = createMigrationRunner(connection)
    migrations.init()

    const migration = loadTranscriptMigration()
    migrations.apply([migration])

    store = createTranscriptStore(connection)
  })

  afterEach(() => {
    connection?.close()
  })

  function loadTranscriptMigration() {
    const fs = require('fs')
    const path = require('path')
    const content = fs.readFileSync(path.join(process.cwd(), 'migrations/001_create_transcripts_table.sql'), 'utf-8')
    const upMatch = content.match(/--\s*Up\s*migration\s*\n([\s\S]*?)(?=--\s*Down|$)/i)
    const downMatch = content.match(/--\s*Down\s*migration\s*\n([\s\S]*)/i)
    return {
      version: 1,
      name: 'create_transcripts_table',
      up: upMatch ? upMatch[1].trim() : '',
      down: downMatch ? downMatch[1].trim() : '',
    }
  }

  function createTestTranscript(overrides: Partial<TurnTranscript> = {}): TurnTranscript {
    return {
      turnId: `turn-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      sessionId: 'session-123',
      userId: 'user-456',
      input: {
        inboundEventId: 'event-1',
        userMessageSummary: 'Test message',
        contentRefs: ['ref-1', 'ref-2'],
      },
      output: {
        visibleMessages: [{ messageId: 'msg-1', role: 'assistant', content: 'Hello! How can I help?' }],
        artifactRefs: ['artifact-1'],
      },
      runtimeSummary: {
        foregroundDecisionId: 'decision-1',
        plannerRunIds: ['planner-1'],
        runtimeActionIds: ['action-1'],
        toolCallSummaries: [{ toolCallId: 'tc-1', toolName: 'test-tool', status: 'completed' as const }],
        approvalSummaries: [],
      },
      eventRange: {
        startEventId: 'event-1',
        endEventId: 'event-2',
      },
      visibility: 'public' as Visibility,
      createdAt: new Date().toISOString(),
      ...overrides,
    }
  }

  describe('saveTurn', () => {
    it('should save a turn transcript', () => {
      const transcript = createTestTranscript()
      const saved = store.saveTurn(transcript)
      expect(saved).toBe(true)
    })

    it('should save transcript without optional fields', () => {
      const transcript: TurnTranscript = {
        turnId: 'turn-minimal',
        sessionId: 'session-123',
        userId: 'user-456',
        input: {},
        output: {
          visibleMessages: [{ messageId: 'msg-1', role: 'assistant', content: 'Hi' }],
        },
        visibility: 'public',
        createdAt: new Date().toISOString(),
      }
      const saved = store.saveTurn(transcript)
      expect(saved).toBe(true)
    })

    it('should save transcript with different visibility levels', () => {
      const visibilities: Visibility[] = ['public', 'internal', 'confidential']
      for (const visibility of visibilities) {
        const transcript = createTestTranscript({
          turnId: `turn-${visibility}`,
          visibility,
        })
        const saved = store.saveTurn(transcript)
        expect(saved).toBe(true)
      }
    })

    it('should not store raw tool outputs in transcript', () => {
      const transcript = createTestTranscript({
        runtimeSummary: {
          toolCallSummaries: [{ toolCallId: 'tc-s1', toolName: 'tool_executed', status: 'completed' as const }],
          approvalSummaries: [],
        },
      })
      store.saveTurn(transcript)

      const rows = connection.query<{ toolCallSummaries: string }>(
        'SELECT toolCallSummaries FROM transcripts WHERE turnId = ?',
        [transcript.turnId],
      )
      expect(rows.length).toBe(1)
      const summaries = JSON.parse(rows[0].toolCallSummaries)
      expect(summaries).toEqual([{ toolCallId: 'tc-s1', toolName: 'tool_executed', status: 'completed' }])
    })
  })

  describe('getTurn', () => {
    it('should retrieve a saved turn by turnId', () => {
      const transcript = createTestTranscript()
      store.saveTurn(transcript)

      const retrieved = store.getTurn(transcript.turnId)
      expect(retrieved).not.toBeNull()
      expect(retrieved?.turnId).toBe(transcript.turnId)
      expect(retrieved?.sessionId).toBe(transcript.sessionId)
      expect(retrieved?.userId).toBe(transcript.userId)
    })

    it('should return null for non-existent turnId', () => {
      const retrieved = store.getTurn('non-existent')
      expect(retrieved).toBeNull()
    })

    it('should retrieve transcript with all fields', () => {
      const transcript = createTestTranscript({
        input: {
          inboundEventId: 'event-input',
          userMessageSummary: 'User asked about weather',
          contentRefs: ['doc-1', 'doc-2'],
        },
        output: {
          visibleMessages: [
            { messageId: 'msg-1', role: 'assistant', content: 'Let me check the weather' },
            { messageId: 'msg-2', role: 'assistant', content: 'It is sunny today' },
          ],
          artifactRefs: ['weather-data-1'],
        },
        runtimeSummary: {
          foregroundDecisionId: 'dec-1',
          plannerRunIds: ['planner-1', 'planner-2'],
          runtimeActionIds: ['action-1', 'action-2'],
          toolCallSummaries: [
            { toolCallId: 'tc-w1', toolName: 'weather_api', status: 'completed' as const },
            { toolCallId: 'tc-w2', toolName: 'parse_response', status: 'completed' as const },
          ],
          approvalSummaries: ['User approved weather check'],
        },
      })
      store.saveTurn(transcript)

      const retrieved = store.getTurn(transcript.turnId)
      expect(retrieved?.input.inboundEventId).toBe('event-input')
      expect(retrieved?.input.userMessageSummary).toBe('User asked about weather')
      expect(retrieved?.input.contentRefs).toEqual(['doc-1', 'doc-2'])
      expect(retrieved?.output.visibleMessages.length).toBe(2)
      expect(retrieved?.output.artifactRefs).toEqual(['weather-data-1'])
      expect(retrieved?.runtimeSummary?.plannerRunIds).toEqual(['planner-1', 'planner-2'])
      expect(retrieved?.runtimeSummary?.toolCallSummaries).toEqual([
        { toolCallId: 'tc-w1', toolName: 'weather_api', status: 'completed' },
        { toolCallId: 'tc-w2', toolName: 'parse_response', status: 'completed' },
      ])
    })
  })

  describe('findBySession', () => {
    it('should retrieve all turns for a session in chronological order', () => {
      const sessionId = 'session-test'
      const transcripts: TurnTranscript[] = []

      for (let i = 0; i < 3; i++) {
        const transcript = createTestTranscript({
          turnId: `turn-${i}`,
          sessionId,
          createdAt: new Date(2026, 0, 1, 10, i).toISOString(),
        })
        transcripts.push(transcript)
        store.saveTurn(transcript)
      }

      const results = store.findBySession(sessionId)
      expect(results.length).toBe(3)
      expect(results[0].turnId).toBe('turn-0')
      expect(results[1].turnId).toBe('turn-1')
      expect(results[2].turnId).toBe('turn-2')
    })

    it('should return empty array for session with no turns', () => {
      const results = store.findBySession('non-existent-session')
      expect(results).toEqual([])
    })

    it('should only return turns for specified session', () => {
      const session1 = 'session-1'
      const session2 = 'session-2'

      store.saveTurn(createTestTranscript({ turnId: 'turn-a', sessionId: session1 }))
      store.saveTurn(createTestTranscript({ turnId: 'turn-b', sessionId: session2 }))
      store.saveTurn(createTestTranscript({ turnId: 'turn-c', sessionId: session1 }))

      const results = store.findBySession(session1)
      expect(results.length).toBe(2)
      expect(results.map((t) => t.turnId).sort()).toEqual(['turn-a', 'turn-c'])
    })

    it('should support limit parameter', () => {
      const sessionId = 'session-limit-test'

      for (let i = 0; i < 5; i++) {
        store.saveTurn(
          createTestTranscript({
            turnId: `turn-${i}`,
            sessionId,
            createdAt: new Date(2026, 0, 1, 10, i).toISOString(),
          }),
        )
      }

      const results = store.findBySession(sessionId, { limit: 2 })
      expect(results.length).toBe(2)
      expect(results[0].turnId).toBe('turn-0')
      expect(results[1].turnId).toBe('turn-1')
    })

    it('should support offset parameter', () => {
      const sessionId = 'session-offset-test'

      for (let i = 0; i < 5; i++) {
        store.saveTurn(
          createTestTranscript({
            turnId: `turn-${i}`,
            sessionId,
            createdAt: new Date(2026, 0, 1, 10, i).toISOString(),
          }),
        )
      }

      const results = store.findBySession(sessionId, { offset: 2, limit: 2 })
      expect(results.length).toBe(2)
      expect(results[0].turnId).toBe('turn-2')
      expect(results[1].turnId).toBe('turn-3')
    })
  })

  describe('search', () => {
    it('should search transcripts by user-visible content', () => {
      store.saveTurn(
        createTestTranscript({
          turnId: 'turn-1',
          input: { userMessageSummary: 'question about weather' },
          output: {
            visibleMessages: [{ messageId: 'm1', role: 'assistant', content: 'Weather is sunny today' }],
          },
        }),
      )

      store.saveTurn(
        createTestTranscript({
          turnId: 'turn-2',
          input: { userMessageSummary: 'question about time' },
          output: {
            visibleMessages: [{ messageId: 'm2', role: 'assistant', content: 'The time is 3pm' }],
          },
        }),
      )

      const results = store.search('weather')
      expect(results.length).toBeGreaterThan(0)
      expect(results.some((r) => r.turnId === 'turn-1')).toBe(true)
    })

    it('should search by user message summary', () => {
      store.saveTurn(
        createTestTranscript({
          turnId: 'turn-search',
          input: { userMessageSummary: 'Looking for my lost keys' },
          output: {
            visibleMessages: [{ messageId: 'm1', role: 'assistant', content: 'I will help you search' }],
          },
        }),
      )

      const results = store.search('lost keys')
      expect(results.some((r) => r.turnId === 'turn-search')).toBe(true)
    })

    it('should filter by sessionId when provided', () => {
      store.saveTurn(
        createTestTranscript({
          turnId: 'turn-a',
          sessionId: 'session-a',
          input: { userMessageSummary: 'common term' },
        }),
      )

      store.saveTurn(
        createTestTranscript({
          turnId: 'turn-b',
          sessionId: 'session-b',
          input: { userMessageSummary: 'common term' },
        }),
      )

      const results = store.search('common term', { sessionId: 'session-a' })
      expect(results.length).toBe(1)
      expect(results[0].turnId).toBe('turn-a')
    })

    it('should return empty array when no matches found', () => {
      const results = store.search('xyznonexistent123')
      expect(results).toEqual([])
    })
  })

  describe('findByArtifactRef', () => {
    it('should find transcripts referencing an artifact', () => {
      store.saveTurn(
        createTestTranscript({
          turnId: 'turn-artifact',
          output: {
            visibleMessages: [{ messageId: 'm1', role: 'assistant', content: 'Here is the file' }],
            artifactRefs: ['artifact-abc-123'],
          },
        }),
      )

      const results = store.findByArtifactRef('artifact-abc-123')
      expect(results.length).toBe(1)
      expect(results[0].turnId).toBe('turn-artifact')
    })

    it('should find transcripts with multiple artifact refs', () => {
      store.saveTurn(
        createTestTranscript({
          turnId: 'turn-multi-artifact',
          output: {
            visibleMessages: [{ messageId: 'm1', role: 'assistant', content: 'Files attached' }],
            artifactRefs: ['artifact-1', 'artifact-2', 'artifact-3'],
          },
        }),
      )

      const results = store.findByArtifactRef('artifact-2')
      expect(results.length).toBe(1)
      expect(results[0].turnId).toBe('turn-multi-artifact')
    })

    it('should return empty array when no artifact match', () => {
      const results = store.findByArtifactRef('non-existent-artifact')
      expect(results).toEqual([])
    })
  })

  describe('findByPlannerRunId', () => {
    it('should find transcripts by plannerRunId', () => {
      store.saveTurn(
        createTestTranscript({
          turnId: 'turn-planner',
          runtimeSummary: {
            plannerRunIds: ['planner-run-abc'],
          },
        }),
      )

      const results = store.findByPlannerRunId('planner-run-abc')
      expect(results.length).toBe(1)
      expect(results[0].turnId).toBe('turn-planner')
    })

    it('should find transcripts with multiple planner runs', () => {
      store.saveTurn(
        createTestTranscript({
          turnId: 'turn-multi-planner',
          runtimeSummary: {
            plannerRunIds: ['planner-1', 'planner-2', 'planner-3'],
          },
        }),
      )

      const results = store.findByPlannerRunId('planner-2')
      expect(results.length).toBe(1)
      expect(results[0].turnId).toBe('turn-multi-planner')
    })

    it('should return empty array when no planner match', () => {
      const results = store.findByPlannerRunId('non-existent-planner')
      expect(results).toHaveLength(0)
    })
  })

  describe('inboundTimestamp', () => {
    it('should persist and retrieve inboundTimestamp via contentRefs encoding', () => {
      const inboundTs = '2024-01-15T09:59:00.000Z'
      const transcript = createTestTranscript({
        turnId: 'turn-inbound-ts',
        input: {
          inboundEventId: 'evt-1',
          userMessageSummary: 'Hello',
          contentRefs: ['doc-1'],
          inboundTimestamp: inboundTs,
        },
      })
      store.saveTurn(transcript)

      const retrieved = store.getTurn('turn-inbound-ts')
      expect(retrieved).not.toBeNull()
      expect(retrieved?.input.inboundTimestamp).toBe(inboundTs)
      expect(retrieved?.input.contentRefs).toEqual(['doc-1'])
    })

    it('should preserve contentRefs alongside inboundTimestamp', () => {
      const transcript = createTestTranscript({
        turnId: 'turn-refs-ts',
        input: {
          userMessageSummary: 'Test',
          contentRefs: ['ref-a', 'ref-b'],
          inboundTimestamp: '2024-06-01T12:00:00.000Z',
        },
      })
      store.saveTurn(transcript)

      const retrieved = store.getTurn('turn-refs-ts')
      expect(retrieved?.input.contentRefs).toEqual(['ref-a', 'ref-b'])
      expect(retrieved?.input.inboundTimestamp).toBe('2024-06-01T12:00:00.000Z')
    })

    it('should handle transcript without inboundTimestamp (backward compatible)', () => {
      const transcript = createTestTranscript({
        turnId: 'turn-no-ts',
        input: {
          userMessageSummary: 'Old format',
          contentRefs: ['old-ref'],
        },
      })
      store.saveTurn(transcript)

      const retrieved = store.getTurn('turn-no-ts')
      expect(retrieved).not.toBeNull()
      expect(retrieved?.input.inboundTimestamp).toBeUndefined()
      expect(retrieved?.input.contentRefs).toEqual(['old-ref'])
    })

    it('should handle transcript with inboundTimestamp but no contentRefs', () => {
      const transcript = createTestTranscript({
        turnId: 'turn-ts-only',
        input: {
          userMessageSummary: 'No refs',
          inboundTimestamp: '2024-07-01T08:00:00.000Z',
        },
      })
      store.saveTurn(transcript)

      const retrieved = store.getTurn('turn-ts-only')
      expect(retrieved?.input.inboundTimestamp).toBe('2024-07-01T08:00:00.000Z')
      expect(retrieved?.input.contentRefs).toBeUndefined()
    })
  })
})
