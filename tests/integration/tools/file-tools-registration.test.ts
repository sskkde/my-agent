import { describe, it, expect, beforeEach } from 'vitest'
import type { ToolRegistry } from '../../../src/tools/types.js'
import { createToolRegistry } from '../../../src/tools/tool-registry.js'
import { registerBuiltInTools } from '../../../src/tools/builtins/index.js'
import type { ArtifactStore } from '../../../src/storage/artifact-store.js'
import type { SummaryStore } from '../../../src/storage/summary-store.js'
import type { TranscriptStore } from '../../../src/storage/transcript-store.js'
import type { PlanStore } from '../../../src/storage/plan-store.js'
import type { ToolResultStore } from '../../../src/storage/tool-result-store.js'
import type { LongTermMemoryStore } from '../../../src/storage/long-term-memory-store.js'
import type { SessionStore } from '../../../src/storage/session-store.js'
import { getFallbackToolCatalog, buildRuntimeToolCatalog } from '../../../src/tools/tool-catalog.js'
import { getToolCatalogWithMetadata } from '../../../src/api/tool-catalog.js'

class MockArtifactStore implements ArtifactStore {
  create() {
    return {} as any
  }
  findByArtifactId() {
    return undefined
  }
  findById() {
    return undefined
  }
  findByUserId() {
    return []
  }
  findBySessionId() {
    return []
  }
  findByType() {
    return []
  }
  findByStatus() {
    return []
  }
  update() {
    return undefined
  }
  delete() {
    return false
  }
  applyMigrations() {}
}

class MockSummaryStore implements SummaryStore {
  save() {}
  getBySummaryId() {
    return null
  }
  getByType() {
    return []
  }
  getWorkingSummary() {
    return null
  }
  getSessionMemory() {
    return null
  }
  applyPatch() {
    return {} as any
  }
}

class MockTranscriptStore implements TranscriptStore {
  saveTurn() {
    return true
  }
  getTurn() {
    return null
  }
  findBySession() {
    return []
  }
  search() {
    return []
  }
  findByArtifactRef() {
    return []
  }
  findByPlannerRunId() {
    return []
  }
  updateUserIdForSession() {
    return 0
  }
}

class MockPlanStore implements PlanStore {
  createPlan() {
    return {} as any
  }
  getPlan() {
    return null
  }
  applyPatch() {
    return {} as any
  }
  getPatches() {
    return []
  }
  findByObjectiveHash() {
    return []
  }
  updateStepStatus() {}
}

class MockToolResultStore implements ToolResultStore {
  create() {
    return {} as any
  }
  findById() {
    return undefined
  }
  findByToolCallId() {
    return []
  }
  findBySessionId() {
    return []
  }
  findByToolName() {
    return []
  }
  findBySensitivity() {
    return []
  }
  delete() {
    return false
  }
  applyMigrations() {}
}

class MockLongTermMemoryStore implements LongTermMemoryStore {
  save() {}
  getByMemoryId() {
    return null
  }
  getByUserId() {
    return []
  }
  getByType() {
    return []
  }
  search() {
    return []
  }
  delete() {}
  applyPatch() {
    return {} as any
  }
  findCurrentByFingerprint() {
    return null
  }
  upsertExtracted() {}
  createTombstone() {}
  hasTombstone() {
    return false
  }
  getTombstone() {
    return null
  }
  hasTombstoneForSource() {
    return false
  }
  searchActive() {
    return []
  }
  getByEntityName() {
    return []
  }
  getByDateRange() {
    return []
  }
}

class MockSessionStore implements SessionStore {
  create() {
    return {} as any
  }
  getById() {
    return null
  }
  list() {
    return []
  }
  updateActivity() {
    return false
  }
  updateMetadata() {
    return false
  }
  updateStatus() {
    return false
  }
  updateTitle() {
    return false
  }
  updateUserId() {
    return false
  }
  setModel() {
    return false
  }
  getCount() {
    return 0
  }
}

describe('File Tools Registration', () => {
  let registry: ToolRegistry

  beforeEach(() => {
    registry = createToolRegistry()
    registerBuiltInTools(registry, {
      artifactStore: new MockArtifactStore(),
      summaryStore: new MockSummaryStore(),
      transcriptStore: new MockTranscriptStore(),
      planStore: new MockPlanStore(),
      longTermMemoryStore: new MockLongTermMemoryStore(),
      toolResultStore: new MockToolResultStore(),
      sessionStore: new MockSessionStore(),
    })
  })

  it('should register file_write tool', () => {
    const tool = registry.getTool('file_write')
    expect(tool).toBeDefined()
    expect(tool?.name).toBe('file_write')
    expect(tool?.category).toBe('write')
    expect(tool?.sensitivity).toBe('high')
  })

  it('should register file_edit tool', () => {
    const tool = registry.getTool('file_edit')
    expect(tool).toBeDefined()
    expect(tool?.name).toBe('file_edit')
    expect(tool?.category).toBe('write')
    expect(tool?.sensitivity).toBe('high')
  })

  it('should register file_apply_patch tool', () => {
    const tool = registry.getTool('file_apply_patch')
    expect(tool).toBeDefined()
    expect(tool?.name).toBe('file_apply_patch')
    expect(tool?.category).toBe('write')
    expect(tool?.sensitivity).toBe('high')
  })

  it('should include all 3 tools in buildRuntimeToolCatalog', () => {
    const catalog = buildRuntimeToolCatalog(registry)

    const fileWrite = catalog.find((t) => t.name === 'file_write')
    const fileEdit = catalog.find((t) => t.name === 'file_edit')
    const fileApplyPatch = catalog.find((t) => t.name === 'file_apply_patch')

    expect(fileWrite).toBeDefined()
    expect(fileWrite?.category).toBe('write')
    expect(fileWrite?.sensitivity).toBe('high')

    expect(fileEdit).toBeDefined()
    expect(fileEdit?.category).toBe('write')
    expect(fileEdit?.sensitivity).toBe('high')

    expect(fileApplyPatch).toBeDefined()
    expect(fileApplyPatch?.category).toBe('write')
    expect(fileApplyPatch?.sensitivity).toBe('high')
  })

  it('should include all 3 tools in getFallbackToolCatalog', () => {
    const catalog = getFallbackToolCatalog()

    const fileWrite = catalog.find((t) => t.name === 'file_write')
    const fileEdit = catalog.find((t) => t.name === 'file_edit')
    const fileApplyPatch = catalog.find((t) => t.name === 'file_apply_patch')

    expect(fileWrite).toBeDefined()
    expect(fileEdit).toBeDefined()
    expect(fileApplyPatch).toBeDefined()
  })

  it('should include all 3 tools in getToolCatalogWithMetadata', () => {
    const catalog = getToolCatalogWithMetadata(registry)

    const fileWrite = catalog.find((t) => t.name === 'file_write')
    const fileEdit = catalog.find((t) => t.name === 'file_edit')
    const fileApplyPatch = catalog.find((t) => t.name === 'file_apply_patch')

    expect(fileWrite).toBeDefined()
    expect(fileEdit).toBeDefined()
    expect(fileApplyPatch).toBeDefined()
  })
})
