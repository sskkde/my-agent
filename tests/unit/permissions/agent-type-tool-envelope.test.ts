import { describe, it, expect } from 'vitest'
import {
  createAgentTypeToolEnvelopeRegistry,
  intersectToolIdSets,
} from '../../../src/permissions/agent-type-tool-envelope.js'
import type { ToolCategory } from '../../../src/tools/types.js'

describe('AgentTypeToolEnvelopeRegistry', () => {
  const registry = createAgentTypeToolEnvelopeRegistry()

  describe('getEnvelope', () => {
    it('returns envelope for main agentType', () => {
      const envelope = registry.getEnvelope('main')
      expect(envelope).toBeDefined()
      expect(envelope!.agentType).toBe('main')
      expect(envelope!.allowedCategories.has('read')).toBe(true)
      expect(envelope!.allowedCategories.has('search')).toBe(true)
      expect(envelope!.allowedCategories.has('internal')).toBe(true)
    })

    it('returns envelope for subagent agentType', () => {
      const envelope = registry.getEnvelope('subagent')
      expect(envelope).toBeDefined()
      expect(envelope!.agentType).toBe('subagent')
      expect(envelope!.allowedCategories.has('write')).toBe(true)
    })

    it('returns envelope for background agentType', () => {
      const envelope = registry.getEnvelope('background')
      expect(envelope).toBeDefined()
      expect(envelope!.agentType).toBe('background')
      expect(envelope!.allowedCategories.has('read')).toBe(true)
      expect(envelope!.allowedCategories.has('write')).toBe(false)
    })

    it('returns envelope for workflow_step agentType', () => {
      const envelope = registry.getEnvelope('workflow_step')
      expect(envelope).toBeDefined()
      expect(envelope!.agentType).toBe('workflow_step')
      expect(envelope!.allowedCategories.has('execute')).toBe(true)
    })

    it('returns envelope for remote agentType (hard-deny)', () => {
      const envelope = registry.getEnvelope('remote')
      expect(envelope).toBeDefined()
      expect(envelope!.agentType).toBe('remote')
      expect(envelope!.allowedCategories.size).toBe(0)
    })
  })

  describe('isToolAllowedByEnvelope', () => {
    it('main: allows read/search/internal categories', () => {
      expect(registry.isToolAllowedByEnvelope('main', 'file_read', 'read')).toBe(true)
      expect(registry.isToolAllowedByEnvelope('main', 'web_search', 'search')).toBe(true)
      expect(registry.isToolAllowedByEnvelope('main', 'status_query', 'internal')).toBe(true)
    })

    it('main: denies write/delete/execute/admin categories', () => {
      expect(registry.isToolAllowedByEnvelope('main', 'file_write', 'write')).toBe(false)
      expect(registry.isToolAllowedByEnvelope('main', 'file_delete', 'delete')).toBe(false)
      expect(registry.isToolAllowedByEnvelope('main', 'exec', 'execute')).toBe(false)
      expect(registry.isToolAllowedByEnvelope('main', 'admin_config', 'admin')).toBe(false)
    })

    it('subagent: allows read/search/internal/write categories', () => {
      expect(registry.isToolAllowedByEnvelope('subagent', 'file_read', 'read')).toBe(true)
      expect(registry.isToolAllowedByEnvelope('subagent', 'artifact_create', 'write')).toBe(true)
    })

    it('subagent: denies exec and admin tools even if category is allowed', () => {
      expect(registry.isToolAllowedByEnvelope('subagent', 'exec', 'execute')).toBe(false)
      expect(registry.isToolAllowedByEnvelope('subagent', 'bash', 'execute')).toBe(false)
      expect(registry.isToolAllowedByEnvelope('subagent', 'admin_config', 'admin')).toBe(false)
    })

    it('background: allows only read/search/internal', () => {
      expect(registry.isToolAllowedByEnvelope('background', 'file_read', 'read')).toBe(true)
      expect(registry.isToolAllowedByEnvelope('background', 'web_search', 'search')).toBe(true)
      expect(registry.isToolAllowedByEnvelope('background', 'artifact_create', 'write')).toBe(false)
    })

    it('workflow_step: allows read/search/internal/write/execute', () => {
      expect(registry.isToolAllowedByEnvelope('workflow_step', 'file_read', 'read')).toBe(true)
      expect(registry.isToolAllowedByEnvelope('workflow_step', 'artifact_create', 'write')).toBe(true)
      expect(registry.isToolAllowedByEnvelope('workflow_step', 'exec', 'execute')).toBe(true)
    })

    it('remote: denies ALL tools unconditionally', () => {
      expect(registry.isToolAllowedByEnvelope('remote', 'file_read', 'read')).toBe(false)
      expect(registry.isToolAllowedByEnvelope('remote', 'web_search', 'search')).toBe(false)
      expect(registry.isToolAllowedByEnvelope('remote', 'status_query', 'internal')).toBe(false)
      expect(registry.isToolAllowedByEnvelope('remote', 'file_write', 'write')).toBe(false)
      expect(registry.isToolAllowedByEnvelope('remote', 'exec', 'execute')).toBe(false)
    })
  })

  describe('getAllowedToolIds', () => {
    const catalog = [
      { id: 'file_read', category: 'read' as ToolCategory },
      { id: 'web_search', category: 'search' as ToolCategory },
      { id: 'status_query', category: 'internal' as ToolCategory },
      { id: 'artifact_create', category: 'write' as ToolCategory },
      { id: 'exec', category: 'execute' as ToolCategory },
      { id: 'admin_config', category: 'admin' as ToolCategory },
    ]

    it('main: returns only read/search/internal tools', () => {
      const allowed = registry.getAllowedToolIds('main', catalog)
      expect(allowed).toContain('file_read')
      expect(allowed).toContain('web_search')
      expect(allowed).toContain('status_query')
      expect(allowed).not.toContain('artifact_create')
      expect(allowed).not.toContain('exec')
      expect(allowed).not.toContain('admin_config')
    })

    it('subagent: returns read/search/internal/write minus denied IDs', () => {
      const allowed = registry.getAllowedToolIds('subagent', catalog)
      expect(allowed).toContain('file_read')
      expect(allowed).toContain('web_search')
      expect(allowed).toContain('status_query')
      expect(allowed).toContain('artifact_create')
      expect(allowed).not.toContain('exec')
      expect(allowed).not.toContain('admin_config')
    })

    it('remote: returns empty array', () => {
      const allowed = registry.getAllowedToolIds('remote', catalog)
      expect(allowed).toEqual([])
    })
  })
})

describe('intersectToolIdSets', () => {
  it('returns intersection of two sets', () => {
    const result = intersectToolIdSets(
      new Set(['a', 'b', 'c']),
      new Set(['b', 'c', 'd']),
    )
    expect(result).toEqual(expect.arrayContaining(['b', 'c']))
    expect(result).toHaveLength(2)
  })

  it('returns intersection of three sets', () => {
    const result = intersectToolIdSets(
      new Set(['a', 'b', 'c']),
      new Set(['b', 'c', 'd']),
      new Set(['c', 'd', 'e']),
    )
    expect(result).toEqual(['c'])
  })

  it('returns empty when one set is empty', () => {
    const result = intersectToolIdSets(
      new Set(['a', 'b']),
      new Set([]),
    )
    expect(result).toEqual([])
  })

  it('skips undefined sets', () => {
    const result = intersectToolIdSets(
      new Set(['a', 'b']),
      undefined,
      new Set(['b', 'c']),
    )
    expect(result).toEqual(['b'])
  })

  it('returns empty when no sets provided', () => {
    const result = intersectToolIdSets()
    expect(result).toEqual([])
  })

  it('works with arrays', () => {
    const result = intersectToolIdSets(['a', 'b', 'c'], ['b', 'c', 'd'])
    expect(result).toEqual(expect.arrayContaining(['b', 'c']))
    expect(result).toHaveLength(2)
  })
})
