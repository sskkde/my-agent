/**
 * Ensures legacy mock email_* tools are no longer registered as builtins.
 */

import { describe, it, expect } from 'vitest'
import { createToolRegistry } from '../../../src/tools/tool-registry.js'
import { registerBuiltInTools } from '../../../src/tools/builtins/index.js'
import { createConnectionManager } from '../../../src/storage/connection.js'
import { createArtifactStore } from '../../../src/storage/artifact-store.js'
import { createSummaryStore } from '../../../src/storage/summary-store.js'
import { createTranscriptStore } from '../../../src/storage/transcript-store.js'
import { createPlanStore } from '../../../src/storage/plan-store.js'
import { createLongTermMemoryStore } from '../../../src/storage/long-term-memory-store.js'
import { createSessionStore } from '../../../src/storage/session-store.js'

describe('builtin email tools removed', () => {
  it('registerBuiltInTools does not register email_search or email_send_draft', () => {
    const connection = createConnectionManager(':memory:')
    connection.open()
    const registry = createToolRegistry()
    registerBuiltInTools(registry, {
      artifactStore: createArtifactStore(connection),
      summaryStore: createSummaryStore(connection),
      transcriptStore: createTranscriptStore(connection),
      planStore: createPlanStore(connection),
      longTermMemoryStore: createLongTermMemoryStore(connection),
      sessionStore: createSessionStore(connection),
    })

    expect(registry.getTool('email_search')).toBeFalsy()
    expect(registry.getTool('email_send_draft')).toBeFalsy()
    expect(registry.getTool('calendar_list')).toBeDefined()
    connection.close()
  })
})
