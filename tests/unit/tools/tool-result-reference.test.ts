import { describe, it, expect } from 'vitest'
import {
  shouldStoreAsRef,
  createResultRef,
  getOutputSize,
  processToolOutput,
  INLINE_THRESHOLD,
} from '../../../src/tools/tool-result-reference.js'
import { createConnectionManager } from '../../../src/storage/connection.js'
import { createToolResultStore } from '../../../src/storage/tool-result-store.js'
import { createMigrationRunner } from '../../../src/storage/migrations.js'

describe('Tool Result Reference', () => {
  describe('shouldStoreAsRef', () => {
    it('should return false for outputs < 32 KiB', () => {
      const smallOutput = { message: 'Hello, world!' }
      expect(shouldStoreAsRef(smallOutput)).toBe(false)
    })

    it('should return true for outputs >= 32 KiB', () => {
      const largeString = 'x'.repeat(INLINE_THRESHOLD)
      const largeOutput = { data: largeString }
      expect(shouldStoreAsRef(largeOutput)).toBe(true)
    })

    it('should return false for outputs just below threshold', () => {
      const almostLargeString = 'x'.repeat(INLINE_THRESHOLD - 100)
      const output = { data: almostLargeString }
      expect(shouldStoreAsRef(output)).toBe(false)
    })

    it('should return false for null', () => {
      expect(shouldStoreAsRef(null)).toBe(false)
    })

    it('should return false for undefined', () => {
      expect(shouldStoreAsRef(undefined)).toBe(false)
    })

    it('should return false for small primitive values', () => {
      expect(shouldStoreAsRef(42)).toBe(false)
      expect(shouldStoreAsRef(true)).toBe(false)
      expect(shouldStoreAsRef('small string')).toBe(false)
    })

    it('should return false for non-serializable values', () => {
      const circular: Record<string, unknown> = {}
      circular.self = circular
      expect(shouldStoreAsRef(circular)).toBe(false)
    })
  })

  describe('getOutputSize', () => {
    it('should return correct size for small output', () => {
      const output = { message: 'test' }
      const size = getOutputSize(output)
      expect(size).toBeGreaterThan(0)
      expect(size).toBeLessThan(INLINE_THRESHOLD)
    })

    it('should return 0 for non-serializable values', () => {
      const circular: Record<string, unknown> = {}
      circular.self = circular
      expect(getOutputSize(circular)).toBe(0)
    })
  })

  describe('createResultRef', () => {
    it('should persist large outputs correctly', () => {
      const connection = createConnectionManager(':memory:')
      connection.open()
      const store = createToolResultStore(connection)
      const runner = createMigrationRunner(connection)
      runner.init()
      store.applyMigrations(runner)

      const largeData = 'x'.repeat(INLINE_THRESHOLD)
      const output = { data: largeData }
      const toolExecutionId = 'test-tool-call-123'
      const options = {
        toolName: 'test.tool',
        userId: 'user-123',
        sessionId: 'session-123',
        sensitivity: 'low' as const,
      }

      const resultRef = createResultRef(store, toolExecutionId, output, options)

      expect(resultRef.resultId).toBeDefined()
      expect(resultRef.toolExecutionId).toBe(toolExecutionId)
      expect(resultRef.sizeBytes).toBeGreaterThanOrEqual(INLINE_THRESHOLD)
      expect(resultRef.contentType).toBeDefined()
      expect(resultRef.createdAt).toBeDefined()

      const persisted = store.findByToolCallId(toolExecutionId)
      expect(persisted.length).toBeGreaterThan(0)
      expect(persisted[0].resultRef).toBe(resultRef.resultId)
      expect(persisted[0].toolCallId).toBe(toolExecutionId)
      expect(persisted[0].toolName).toBe('test.tool')
      expect(persisted[0].userId).toBe('user-123')
      expect(persisted[0].sessionId).toBe('session-123')

      connection.close()
    })

    it('should include resultId in metadata', () => {
      const connection = createConnectionManager(':memory:')
      connection.open()
      const store = createToolResultStore(connection)
      const runner = createMigrationRunner(connection)
      runner.init()
      store.applyMigrations(runner)

      const output = { data: 'test' }
      const resultRef = createResultRef(store, 'tool-call-1', output, {
        toolName: 'test.tool',
        userId: 'user-1',
      })

      expect(resultRef.resultId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)

      connection.close()
    })

    it('should include toolExecutionId in metadata', () => {
      const connection = createConnectionManager(':memory:')
      connection.open()
      const store = createToolResultStore(connection)
      const runner = createMigrationRunner(connection)
      runner.init()
      store.applyMigrations(runner)

      const output = { data: 'test' }
      const resultRef = createResultRef(store, 'tool-exec-123', output, {
        toolName: 'test.tool',
        userId: 'user-1',
      })

      expect(resultRef.toolExecutionId).toBe('tool-exec-123')

      connection.close()
    })

    it('should include sizeBytes in metadata', () => {
      const connection = createConnectionManager(':memory:')
      connection.open()
      const store = createToolResultStore(connection)
      const runner = createMigrationRunner(connection)
      runner.init()
      store.applyMigrations(runner)

      const output = { data: 'test content' }
      const resultRef = createResultRef(store, 'tool-call-1', output, {
        toolName: 'test.tool',
        userId: 'user-1',
      })

      expect(resultRef.sizeBytes).toBeGreaterThan(0)
      expect(typeof resultRef.sizeBytes).toBe('number')

      connection.close()
    })

    it('should include contentType in metadata', () => {
      const connection = createConnectionManager(':memory:')
      connection.open()
      const store = createToolResultStore(connection)
      const runner = createMigrationRunner(connection)
      runner.init()
      store.applyMigrations(runner)

      const output = { data: 'test' }
      const resultRef = createResultRef(store, 'tool-call-1', output, {
        toolName: 'test.tool',
        userId: 'user-1',
      })

      expect(resultRef.contentType).toBeDefined()
      expect(typeof resultRef.contentType).toBe('string')

      connection.close()
    })

    it('should include createdAt in metadata', () => {
      const connection = createConnectionManager(':memory:')
      connection.open()
      const store = createToolResultStore(connection)
      const runner = createMigrationRunner(connection)
      runner.init()
      store.applyMigrations(runner)

      const before = new Date().toISOString()
      const output = { data: 'test' }
      const resultRef = createResultRef(store, 'tool-call-1', output, {
        toolName: 'test.tool',
        userId: 'user-1',
      })
      const after = new Date().toISOString()

      expect(resultRef.createdAt).toBeDefined()
      expect(resultRef.createdAt >= before).toBe(true)
      expect(resultRef.createdAt <= after).toBe(true)

      connection.close()
    })

    it('should determine correct content type for object', () => {
      const connection = createConnectionManager(':memory:')
      connection.open()
      const store = createToolResultStore(connection)
      const runner = createMigrationRunner(connection)
      runner.init()
      store.applyMigrations(runner)

      const output = { key: 'value' }
      const resultRef = createResultRef(store, 'tool-call-1', output, {
        toolName: 'test.tool',
        userId: 'user-1',
      })

      expect(resultRef.contentType).toBe('application/json; type=object')

      connection.close()
    })

    it('should determine correct content type for array', () => {
      const connection = createConnectionManager(':memory:')
      connection.open()
      const store = createToolResultStore(connection)
      const runner = createMigrationRunner(connection)
      runner.init()
      store.applyMigrations(runner)

      const output = [1, 2, 3]
      const resultRef = createResultRef(store, 'tool-call-1', output, {
        toolName: 'test.tool',
        userId: 'user-1',
      })

      expect(resultRef.contentType).toBe('application/json; type=array')

      connection.close()
    })

    it('should determine correct content type for string', () => {
      const connection = createConnectionManager(':memory:')
      connection.open()
      const store = createToolResultStore(connection)
      const runner = createMigrationRunner(connection)
      runner.init()
      store.applyMigrations(runner)

      const output = 'plain text string'
      const resultRef = createResultRef(store, 'tool-call-1', output, {
        toolName: 'test.tool',
        userId: 'user-1',
      })

      expect(resultRef.contentType).toBe('text/plain')

      connection.close()
    })
  })

  describe('processToolOutput', () => {
    it('should return inline output for small data', () => {
      const connection = createConnectionManager(':memory:')
      connection.open()
      const store = createToolResultStore(connection)
      const runner = createMigrationRunner(connection)
      runner.init()
      store.applyMigrations(runner)

      const output = { message: 'small' }
      const result = processToolOutput(store, 'tool-call-1', output, {
        toolName: 'test.tool',
        userId: 'user-1',
      })

      expect(result.isRef).toBe(false)
      expect(result.inlineOutput).toEqual(output)
      expect(result.resultRef).toBeUndefined()

      connection.close()
    })

    it('should return reference for large data', () => {
      const connection = createConnectionManager(':memory:')
      connection.open()
      const store = createToolResultStore(connection)
      const runner = createMigrationRunner(connection)
      runner.init()
      store.applyMigrations(runner)

      const largeData = 'x'.repeat(INLINE_THRESHOLD)
      const output = { data: largeData }
      const result = processToolOutput(store, 'tool-call-1', output, {
        toolName: 'test.tool',
        userId: 'user-1',
      })

      expect(result.isRef).toBe(true)
      expect(result.inlineOutput).toBeUndefined()
      expect(result.resultRef).toBeDefined()
      expect(result.resultRef?.toolExecutionId).toBe('tool-call-1')

      connection.close()
    })
  })
})
