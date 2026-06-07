import { describe, it, expect } from 'vitest'
import { InstructionResolver } from '../../../src/instructions/instruction-resolver.js'
import type { InstructionResolutionParams } from '../../../src/instructions/instruction-types.js'

describe('InstructionResolver', () => {
  const resolver = new InstructionResolver()

  describe('tenant isolation', () => {
    it('produces different hashes for different tenants with same config', () => {
      const config = {
        systemPrompt: 'You are a helpful assistant.',
        routingPrompt: 'Route tasks appropriately.',
      }

      const tenant1Result = resolver.resolve({
        tenantId: 'tenant-1',
        agentConfig: config,
      })

      const tenant2Result = resolver.resolve({
        tenantId: 'tenant-2',
        agentConfig: config,
      })

      expect(tenant1Result.instructionHash).not.toBe(tenant2Result.instructionHash)
      expect(tenant1Result.blocks).toEqual(tenant2Result.blocks)
    })

    it('produces same hash for same tenant with same config', () => {
      const params: InstructionResolutionParams = {
        tenantId: 'same-tenant',
        agentConfig: {
          systemPrompt: 'Consistent prompt.',
          routingPrompt: 'Consistent routing.',
        },
      }

      const result1 = resolver.resolve(params)
      const result2 = resolver.resolve(params)

      expect(result1.instructionHash).toBe(result2.instructionHash)
    })
  })

  describe('empty config handling', () => {
    it('returns empty blocks for minimal config', () => {
      const result = resolver.resolve({
        tenantId: 'test-tenant',
      })

      expect(result.blocks).toEqual([])
      expect(result.instructionHash).toBeDefined()
      expect(typeof result.instructionHash).toBe('string')
      expect(result.instructionHash.length).toBe(64)
    })

    it('handles null systemPrompt gracefully', () => {
      const result = resolver.resolve({
        tenantId: 'test-tenant',
        agentConfig: {
          systemPrompt: null,
          routingPrompt: 'Only routing prompt.',
        },
      })

      expect(result.blocks).toHaveLength(1)
      expect(result.blocks[0].source).toBe('routing_prompt')
    })

    it('handles null routingPrompt gracefully', () => {
      const result = resolver.resolve({
        tenantId: 'test-tenant',
        agentConfig: {
          systemPrompt: 'Only system prompt.',
          routingPrompt: null,
        },
      })

      expect(result.blocks).toHaveLength(1)
      expect(result.blocks[0].source).toBe('system_prompt')
    })

    it('handles undefined agentConfig gracefully', () => {
      const result = resolver.resolve({
        tenantId: 'test-tenant',
        agentConfig: undefined,
      })

      expect(result.blocks).toEqual([])
    })
  })

  describe('block ordering', () => {
    it('sorts blocks by priority (system_prompt before routing_prompt)', () => {
      const result = resolver.resolve({
        tenantId: 'test-tenant',
        agentConfig: {
          systemPrompt: 'System prompt content.',
          routingPrompt: 'Routing prompt content.',
        },
      })

      expect(result.blocks).toHaveLength(2)
      expect(result.blocks[0].source).toBe('system_prompt')
      expect(result.blocks[0].priority).toBeLessThan(result.blocks[1].priority)
      expect(result.blocks[1].source).toBe('routing_prompt')
    })

    it('only includes blocks with content', () => {
      const result = resolver.resolve({
        tenantId: 'test-tenant',
        agentConfig: {
          systemPrompt: '',
          routingPrompt: 'Routing only.',
        },
      })

      expect(result.blocks).toHaveLength(1)
      expect(result.blocks[0].source).toBe('routing_prompt')
    })
  })

  describe('hash properties', () => {
    it('does not include requestId/currentDate/userMessage in hash', () => {
      const result = resolver.resolve({
        tenantId: 'test-tenant',
        agentConfig: {
          systemPrompt: 'Static content.',
        },
      })

      const hash = result.instructionHash
      expect(hash).not.toContain('requestId')
      expect(hash).not.toContain('currentDate')
      expect(hash).not.toContain('userMessage')
    })

    it('hash is deterministic SHA-256 (64 hex chars)', () => {
      const result = resolver.resolve({
        tenantId: 'deterministic-test',
        agentConfig: {
          systemPrompt: 'Test prompt.',
        },
      })

      expect(result.instructionHash).toMatch(/^[a-f0-9]{64}$/)
    })
  })
})
