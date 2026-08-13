import { describe, it, expect, afterEach } from 'vitest'
import { createConnectionManager, type ConnectionManager } from '../../../src/storage/connection.js'
import { createMigrationRunner, type MigrationRunner } from '../../../src/storage/migrations.js'
import { allStoreMigrations } from '../../../src/storage/all-stores-migrations.js'
import { createAskStore, type AskStore } from '../../../src/storage/ask-store.js'
import { ASK_STATES } from '../../../src/storage/ask-store.js'

const connections: ConnectionManager[] = []

function openMemoryConnection(): ConnectionManager {
  const connection = createConnectionManager(':memory:')
  connection.open()
  connections.push(connection)
  return connection
}

function applyAll(connection: ConnectionManager): MigrationRunner {
  const runner = createMigrationRunner(connection)
  runner.init()
  runner.apply(allStoreMigrations)
  return runner
}

function makeStore(): AskStore {
  const connection = openMemoryConnection()
  applyAll(connection)
  return createAskStore(connection)
}

afterEach(() => {
  while (connections.length > 0) {
    connections.pop()?.close()
  }
})

describe('AskStore', () => {
  it('creates and reads back a pending ask', () => {
    const store = makeStore()
    const ask = store.create({
      id: 'ask_1',
      userId: 'user-1',
      sessionId: 'sess-1',
      status: ASK_STATES.PENDING,
      question: 'Which city should I book the hotel in?',
      options: [
        { value: 'shanghai', label: 'Shanghai' },
        { value: 'beijing', label: 'Beijing' },
      ],
      multiSelect: false,
      context: 'Trip planning',
      requestedBy: 'user-1',
      requestedAt: '2026-08-09T00:00:00.000Z',
    })

    const read = store.getById(ask.id)
    expect(read).not.toBeNull()
    expect(read?.question).toBe('Which city should I book the hotel in?')
    expect(read?.options).toEqual([
      { value: 'shanghai', label: 'Shanghai' },
      { value: 'beijing', label: 'Beijing' },
    ])
    expect(read?.multiSelect).toBe(false)
    expect(read?.context).toBe('Trip planning')
    expect(read?.status).toBe(ASK_STATES.PENDING)
    expect(read?.answers).toBeNull()
    expect(read?.responseClaimedAt).toBeNull()
    expect(read?.createdAt).toBeDefined()
  })

  it('returns null for unknown ask id', () => {
    const store = makeStore()
    expect(store.getById('ask_missing')).toBeNull()
  })

  it('answers a pending ask via update', () => {
    const store = makeStore()
    const ask = store.create({
      id: 'ask_1',
      userId: 'user-1',
      sessionId: 'sess-1',
      status: ASK_STATES.PENDING,
      question: 'Pick one',
      requestedBy: 'user-1',
      requestedAt: '2026-08-09T00:00:00.000Z',
    })

    const updated = store.update(ask.id, {
      status: ASK_STATES.ANSWERED,
      answers: [{ value: 'shanghai', label: 'Shanghai' }],
      respondedAt: '2026-08-09T00:05:00.000Z',
      responseBy: 'user-1',
    })

    expect(updated.status).toBe(ASK_STATES.ANSWERED)
    expect(updated.answers).toEqual([{ value: 'shanghai', label: 'Shanghai' }])
    expect(updated.respondedAt).toBe('2026-08-09T00:05:00.000Z')
    expect(updated.responseBy).toBe('user-1')

    const read = store.getById(ask.id)
    expect(read?.status).toBe(ASK_STATES.ANSWERED)
    expect(read?.answers).toEqual([{ value: 'shanghai', label: 'Shanghai' }])
  })

  it('throws when updating an unknown ask', () => {
    const store = makeStore()
    expect(() => store.update('ask_missing', { status: ASK_STATES.ANSWERED })).toThrow(
      'Ask request not found: ask_missing',
    )
  })

  it('lists a user asks ordered by requested_at ASC with optional session filter', () => {
    const store = makeStore()
    store.create({
      id: 'ask_later',
      userId: 'user-1',
      sessionId: 'sess-1',
      status: ASK_STATES.ANSWERED,
      question: 'Later',
      requestedBy: 'user-1',
      requestedAt: '2026-08-09T00:02:00.000Z',
    })
    store.create({
      id: 'ask_earlier',
      userId: 'user-1',
      sessionId: 'sess-1',
      status: ASK_STATES.PENDING,
      question: 'Earlier',
      requestedBy: 'user-1',
      requestedAt: '2026-08-09T00:00:00.000Z',
    })
    store.create({
      id: 'ask_other_user',
      userId: 'user-2',
      sessionId: 'sess-1',
      status: ASK_STATES.PENDING,
      question: 'Other user',
      requestedBy: 'user-2',
      requestedAt: '2026-08-09T00:01:00.000Z',
    })
    store.create({
      id: 'ask_other_session',
      userId: 'user-1',
      sessionId: 'sess-2',
      status: ASK_STATES.PENDING,
      question: 'Other session',
      requestedBy: 'user-1',
      requestedAt: '2026-08-09T00:03:00.000Z',
    })

    const all = store.findByUser('user-1')
    expect(all.map((a) => a.id)).toEqual(['ask_earlier', 'ask_later', 'ask_other_session'])

    const sessionFiltered = store.findByUser('user-1', { sessionId: 'sess-1' })
    expect(sessionFiltered.map((a) => a.id)).toEqual(['ask_earlier', 'ask_later'])

    const pending = store.findPendingByUser('user-1')
    expect(pending.map((a) => a.id)).toEqual(['ask_earlier', 'ask_other_session'])
  })

  it('claims an unanswered response exactly once (second claim returns false)', () => {
    const store = makeStore()
    store.create({
      id: 'ask_1',
      userId: 'user-1',
      sessionId: 'sess-1',
      status: ASK_STATES.PENDING,
      question: 'Q',
      requestedBy: 'user-1',
      requestedAt: '2026-08-09T00:00:00.000Z',
    })

    expect(store.claimResponse('ask_1', '2026-08-09T00:05:00.000Z')).toBe(true)
    expect(store.claimResponse('ask_1', '2026-08-09T00:05:01.000Z')).toBe(false)
    expect(store.getById('ask_1')?.responseClaimedAt).toBe('2026-08-09T00:05:00.000Z')
  })

  it('does not claim an unknown ask', () => {
    const store = makeStore()
    expect(store.claimResponse('ask_missing', '2026-08-09T00:00:00.000Z')).toBe(false)
  })

  it('unclaims so a response can be claimed again', () => {
    const store = makeStore()
    store.create({
      id: 'ask_1',
      userId: 'user-1',
      sessionId: 'sess-1',
      status: ASK_STATES.PENDING,
      question: 'Q',
      requestedBy: 'user-1',
      requestedAt: '2026-08-09T00:00:00.000Z',
    })

    expect(store.claimResponse('ask_1', '2026-08-09T00:05:00.000Z')).toBe(true)
    store.unclaimResponse('ask_1')
    expect(store.getById('ask_1')?.responseClaimedAt).toBeNull()
    expect(store.claimResponse('ask_1', '2026-08-09T00:06:00.000Z')).toBe(true)
  })

  it('unclaim is a no-op for an unknown ask', () => {
    const store = makeStore()
    expect(() => store.unclaimResponse('ask_missing')).not.toThrow()
  })

  it('deletes an ask', () => {
    const store = makeStore()
    const ask = store.create({
      id: 'ask_1',
      userId: 'user-1',
      sessionId: 'sess-1',
      status: ASK_STATES.PENDING,
      question: 'Q',
      requestedBy: 'user-1',
      requestedAt: '2026-08-09T00:00:00.000Z',
    })

    store.delete(ask.id)
    expect(store.getById(ask.id)).toBeNull()
  })
})
