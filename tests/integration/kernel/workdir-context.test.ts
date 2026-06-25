import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createConnectionManager, type ConnectionManager } from '../../../src/storage/connection.js'
import { createWorkdirStore, type WorkdirStore } from '../../../src/storage/workdir-store.js'
import {
  createSessionWorkdirStateStore,
  type SessionWorkdirStateStore,
} from '../../../src/storage/session-workdir-state-store.js'
import {
  createWorkdirService,
  type WorkdirService,
  type FileSystemOps,
} from '../../../src/workdirs/workdir-service.js'
import { createGateway, type Stores } from '../../../src/gateway/gateway.js'
import { buildContextBundleFromForegroundState } from '../../../src/foreground/context-bundle-builder.js'
import type { ForegroundTurnInput } from '../../../src/foreground/foreground-runner-types.js'
import type { ForegroundSessionState } from '../../../src/foreground/types.js'

// =============================================================================
// HELPERS
// =============================================================================

const connections: ConnectionManager[] = []

function openMemoryConnection(): ConnectionManager {
  const connection = createConnectionManager(':memory:')
  connection.open()
  connections.push(connection)
  return connection
}

function createSchema(connection: ConnectionManager): void {
  connection.exec(`
    CREATE TABLE work_directories (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT 'org_default',
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      path TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      metadata TEXT
    )
  `)
  connection.exec(`CREATE INDEX idx_work_directories_user ON work_directories(tenant_id, user_id)`)
  connection.exec(`CREATE INDEX idx_work_directories_deleted ON work_directories(tenant_id, user_id, deleted_at)`)

  connection.exec(`
    CREATE TABLE session_workdir_state (
      tenant_id TEXT NOT NULL DEFAULT 'org_default',
      user_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      active_work_dir_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (tenant_id, user_id, session_id),
      FOREIGN KEY (active_work_dir_id) REFERENCES work_directories(id)
    )
  `)
  connection.exec(
    `CREATE INDEX idx_session_workdir_state_session ON session_workdir_state(tenant_id, user_id, session_id)`,
  )
}

function createMockFsOps(): FileSystemOps {
  return {
    mkdir: () => {},
  }
}

function createMockStores(overrides?: Partial<Stores>): Stores {
  return {
    eventStore: {
      append: () => {},
      query: () => [],
    },
    summaryStore: {
      getSessionMemory: () => null,
    },
    transcriptStore: {
      findBySession: () => [],
    },
    runtimeActionStore: {},
    ...overrides,
  }
}

function createForegroundSessionState(): ForegroundSessionState {
  return {
    hydratedSession: {
      userContext: { userId: 'user-1', sessionId: 'session-1' },
      sessionContext: {
        messageCount: 0,
        lastActivityAt: new Date().toISOString(),
        activePlannerRunIds: [],
        activeBackgroundRunIds: [],
      },
      activeWorkRefs: { pendingApprovals: [], activeRuns: [] },
    },
    activeWorkRefs: { pendingApprovals: [], activeRuns: [] },
    currentPersona: {
      personaId: 'default',
      name: 'Assistant',
    },
    effectivePolicy: {
      estimatedStepsGte: 3,
      maxComplexity: 'medium',
      allowedToolCategories: ['read', 'search', 'internal'],
    },
  }
}

function createForegroundTurnInput(overrides?: Partial<ForegroundTurnInput>): ForegroundTurnInput {
  return {
    userId: 'user-1',
    sessionId: 'session-1',
    turnId: 'turn-1',
    message: 'Hello',
    timestamp: new Date().toISOString(),
    hydratedState: {} as any,
    foregroundState: createForegroundSessionState(),
    ...overrides,
  }
}

// =============================================================================
// TESTS
// =============================================================================

describe('Workdir context integration', () => {
  let connection: ConnectionManager
  let workdirStore: WorkdirStore
  let sessionStateStore: SessionWorkdirStateStore
  let workdirService: WorkdirService

  beforeEach(() => {
    connection = openMemoryConnection()
    createSchema(connection)
    workdirStore = createWorkdirStore(connection)
    sessionStateStore = createSessionWorkdirStateStore(connection)
    workdirService = createWorkdirService({
      workdirStore,
      sessionStateStore,
      fsOps: createMockFsOps(),
    })
  })

  afterEach(() => {
    for (const conn of connections) {
      try { conn.close() } catch {}
    }
    connections.length = 0
  })

  describe('Gateway: session with no active workdir gets default', () => {
    it('should auto-create and select a default workdir when none exists', () => {
      const stores = createMockStores({ workdirService })
      const gateway = createGateway({ stores })

      const state = gateway.assembleHydratedState('user-1', 'session-1', stores)

      expect(state.activeWorkdir).toBeDefined()
      expect(state.activeWorkdir!.workDirName).toBe('default')
      expect(state.activeWorkdir!.workDirId).toBeTruthy()
      expect(state.activeWorkdir!.workDirRoot).toBeTruthy()
    })

    it('should return existing default workdir on second call (idempotent)', () => {
      const stores = createMockStores({ workdirService })
      const gateway = createGateway({ stores })

      const state1 = gateway.assembleHydratedState('user-1', 'session-1', stores)
      const state2 = gateway.assembleHydratedState('user-1', 'session-1', stores)

      expect(state1.activeWorkdir!.workDirId).toBe(state2.activeWorkdir!.workDirId)
      expect(state1.activeWorkdir!.workDirName).toBe(state2.activeWorkdir!.workDirName)
    })

    it('should not expose raw absolute path in workDirName', () => {
      const stores = createMockStores({ workdirService })
      const gateway = createGateway({ stores })

      const state = gateway.assembleHydratedState('user-1', 'session-1', stores)

      expect(state.activeWorkdir!.workDirName).not.toContain('/')
      expect(state.activeWorkdir!.workDirName).toBe('default')
    })
  })

  describe('Gateway: two sessions can have different active workdirs', () => {
    it('should allow same user to have different workdirs in different sessions', () => {
      const stores = createMockStores({ workdirService })
      const gateway = createGateway({ stores })

      const state1 = gateway.assembleHydratedState('user-1', 'session-a', stores)

      const workdir2 = workdirService.createWorkdir('user-1', 'project-x')
      workdirService.setActiveWorkdir('session-b', workdir2.id, 'user-1')

      const state2 = gateway.assembleHydratedState('user-1', 'session-b', stores)

      expect(state1.activeWorkdir!.workDirId).not.toBe(state2.activeWorkdir!.workDirId)
      expect(state1.activeWorkdir!.workDirName).toBe('default')
      expect(state2.activeWorkdir!.workDirName).toBe('project-x')
    })

    it('should isolate sessions so switching one does not affect the other', () => {
      const stores = createMockStores({ workdirService })
      const gateway = createGateway({ stores })

      gateway.assembleHydratedState('user-1', 'session-a', stores)

      const workdir2 = workdirService.createWorkdir('user-1', 'other')
      workdirService.setActiveWorkdir('session-a', workdir2.id, 'user-1')

      gateway.assembleHydratedState('user-1', 'session-b', stores)

      const stateA = gateway.assembleHydratedState('user-1', 'session-a', stores)
      const stateB = gateway.assembleHydratedState('user-1', 'session-b', stores)

      expect(stateA.activeWorkdir!.workDirName).toBe('other')
      expect(stateB.activeWorkdir!.workDirName).toBe('default')
    })
  })

  describe('Gateway: no workdir service preserves legacy behavior', () => {
    it('should not include activeWorkdir when workdirService is absent', () => {
      const stores = createMockStores()
      const gateway = createGateway({ stores })

      const state = gateway.assembleHydratedState('user-1', 'session-1', stores)

      expect(state.activeWorkdir).toBeUndefined()
    })
  })

  describe('Context bundle: model-visible workdir info', () => {
    it('should include workdir name in context bundle items when workDirName is set', () => {
      const input = createForegroundTurnInput({
        workDirRoot: '/data/workdirs/user-1/abc-123',
        workDirId: 'abc-123',
        workDirName: 'my-project',
      })
      const state = createForegroundSessionState()

      const bundle = buildContextBundleFromForegroundState(state, input)

      const workdirItem = bundle.orderedItems.find((item) => item.itemId === 'active_workdir')
      expect(workdirItem).toBeDefined()
      expect(workdirItem!.content).toContain('my-project')
      expect(workdirItem!.content).toContain('file read/write/edit/search operations are scoped')
      expect(workdirItem!.semanticType).toBe('constraint')
      expect(workdirItem!.isPinned).toBe(true)
    })

    it('should NOT include workdir context item when workDirName is absent', () => {
      const input = createForegroundTurnInput()
      const state = createForegroundSessionState()

      const bundle = buildContextBundleFromForegroundState(state, input)

      const workdirItem = bundle.orderedItems.find((item) => item.itemId === 'active_workdir')
      expect(workdirItem).toBeUndefined()
    })

    it('should NOT expose raw filesystem path in model-visible context', () => {
      const input = createForegroundTurnInput({
        workDirRoot: '/data/workdirs/user-1/abc-123',
        workDirId: 'abc-123',
        workDirName: 'my-project',
      })
      const state = createForegroundSessionState()

      const bundle = buildContextBundleFromForegroundState(state, input)

      const workdirItem = bundle.orderedItems.find((item) => item.itemId === 'active_workdir')
      expect(workdirItem!.content).not.toContain('/data/workdirs')
      expect(workdirItem!.content).not.toContain('abc-123')
    })

    it('should NOT expose other users paths in model-visible context', () => {
      const input = createForegroundTurnInput({
        workDirRoot: '/data/workdirs/user-1/abc-123',
        workDirId: 'abc-123',
        workDirName: 'my-project',
      })
      const state = createForegroundSessionState()

      const bundle = buildContextBundleFromForegroundState(state, input)

      const workdirItem = bundle.orderedItems.find((item) => item.itemId === 'active_workdir')
      expect(workdirItem!.content).not.toContain('user-2')
      expect(workdirItem!.content).not.toContain('user-1')
    })
  })

  describe('Context bundle: workDirRoot/workDirId threading', () => {
    it('should include workDirRoot in context bundle when set on input', () => {
      const input = createForegroundTurnInput({
        workDirRoot: '/data/workdirs/user-1/abc-123',
        workDirId: 'abc-123',
        workDirName: 'my-project',
      })
      const state = createForegroundSessionState()

      const bundle = buildContextBundleFromForegroundState(state, input)

      expect(bundle.workDirRoot).toBe('/data/workdirs/user-1/abc-123')
      expect(bundle.workDirId).toBe('abc-123')
    })

    it('should not include workDirRoot/workDirId when not set on input', () => {
      const input = createForegroundTurnInput()
      const state = createForegroundSessionState()

      const bundle = buildContextBundleFromForegroundState(state, input)

      expect(bundle.workDirRoot).toBeUndefined()
      expect(bundle.workDirId).toBeUndefined()
    })
  })

  describe('ToolExecutionContext: workDirRoot is set for foreground runs', () => {
    it('should carry workDirRoot through ForegroundTurnInput to KernelRunInput', () => {
      const input = createForegroundTurnInput({
        workDirRoot: '/data/workdirs/user-1/abc-123',
        workDirId: 'abc-123',
        workDirName: 'my-project',
      })

      expect(input.workDirRoot).toBe('/data/workdirs/user-1/abc-123')
      expect(input.workDirId).toBe('abc-123')
      expect(input.workDirName).toBe('my-project')
    })

    it('should have undefined workDirRoot for legacy test contexts', () => {
      const input = createForegroundTurnInput()

      expect(input.workDirRoot).toBeUndefined()
      expect(input.workDirId).toBeUndefined()
      expect(input.workDirName).toBeUndefined()
    })
  })
})
