import { describe, it, expect, beforeEach } from 'vitest'
import { createSkillRegistry } from '../../../src/skills/skill-registry.js'
import { isValidSkillId, sanitizeSkillId } from '../../../src/skills/skill-name.js'
import type {
  SkillDefinition,
  SkillCategory,
  SkillSensitivity,
  SkillSource,
} from '../../../src/skills/types.js'

// ---------------------------------------------------------------------------
// Type-level tests: SkillDefinition must NOT expose executable fields.
// These are compile-time assertions. If the type ever gains a handler/schema/
// command/script field, the lines below will fail to compile.
// ---------------------------------------------------------------------------

type SkillKeys = keyof SkillDefinition

// Each const assignment fails to compile if the forbidden key exists.
const _noHandler: 'handler' extends SkillKeys ? never : true = true
const _noSchema: 'schema' extends SkillKeys ? never : true = true
const _noCommand: 'command' extends SkillKeys ? never : true = true
const _noScript: 'script' extends SkillKeys ? never : true = true

// Required keys must be present.
const _hasSkillId: 'skillId' extends SkillKeys ? true : never = true
const _hasName: 'name' extends SkillKeys ? true : never = true
const _hasDescription: 'description' extends SkillKeys ? true : never = true
const _hasCategory: 'category' extends SkillKeys ? true : never = true
const _hasSensitivity: 'sensitivity' extends SkillKeys ? true : never = true
const _hasEnabled: 'enabled' extends SkillKeys ? true : never = true
const _hasSource: 'source' extends SkillKeys ? true : never = true
const _hasAllowedAgentTypes: 'allowedAgentTypes' extends SkillKeys ? true : never = true
const _hasDefaultAgentProfiles: 'defaultAgentProfiles' extends SkillKeys ? true : never = true
const _hasDocumentPath: 'documentPath' extends SkillKeys ? true : never = true

// Optional keys must be present as optional.
const _hasSummary: 'summary' extends SkillKeys ? true : never = true
const _hasTags: 'tags' extends SkillKeys ? true : never = true

// Silence unused-variable warnings.
void [
  _noHandler,
  _noSchema,
  _noCommand,
  _noScript,
  _hasSkillId,
  _hasName,
  _hasDescription,
  _hasCategory,
  _hasSensitivity,
  _hasEnabled,
  _hasSource,
  _hasAllowedAgentTypes,
  _hasDefaultAgentProfiles,
  _hasDocumentPath,
  _hasSummary,
  _hasTags,
]

// ---------------------------------------------------------------------------
// Factory helper for valid skill definitions in tests.
// ---------------------------------------------------------------------------

function makeValidSkill(overrides: Partial<SkillDefinition> = {}): SkillDefinition {
  return {
    skillId: 'test-skill',
    name: 'Test Skill',
    description: 'A test skill for unit testing',
    category: 'read' as SkillCategory,
    sensitivity: 'low' as SkillSensitivity,
    enabled: true,
    source: 'builtin' as SkillSource,
    allowedAgentTypes: ['main'],
    defaultAgentProfiles: ['default'],
    documentPath: '/docs/skills/test-skill.md',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// isValidSkillId
// ---------------------------------------------------------------------------

describe('isValidSkillId', () => {
  it('accepts simple alphanumeric names', () => {
    expect(isValidSkillId('read_file')).toBe(true)
    expect(isValidSkillId('search')).toBe(true)
    expect(isValidSkillId('skill42')).toBe(true)
  })

  it('accepts names with hyphens and underscores', () => {
    expect(isValidSkillId('my-skill')).toBe(true)
    expect(isValidSkillId('my_skill-v2')).toBe(true)
  })

  it('accepts names exactly at max length 64', () => {
    const name = 'A'.repeat(64)
    expect(isValidSkillId(name)).toBe(true)
  })

  it('rejects names longer than 64 characters', () => {
    const name = 'A'.repeat(65)
    expect(isValidSkillId(name)).toBe(false)
  })

  it('rejects names with dots', () => {
    expect(isValidSkillId('connector.github.list_repos')).toBe(false)
    expect(isValidSkillId('mcp.server.tool')).toBe(false)
  })

  it('rejects names with spaces', () => {
    expect(isValidSkillId('my skill')).toBe(false)
  })

  it('rejects names with special characters', () => {
    expect(isValidSkillId('skill@name')).toBe(false)
    expect(isValidSkillId('skill/name')).toBe(false)
    expect(isValidSkillId('skill:name')).toBe(false)
  })

  it('rejects empty string', () => {
    expect(isValidSkillId('')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// sanitizeSkillId
// ---------------------------------------------------------------------------

describe('sanitizeSkillId', () => {
  it('passes through already-valid names', () => {
    expect(sanitizeSkillId('valid_name')).toBe('valid_name')
    expect(sanitizeSkillId('my-skill-42')).toBe('my-skill-42')
  })

  it('replaces dots with underscores', () => {
    expect(sanitizeSkillId('connector.github.list_repos')).toBe('connector_github_list_repos')
  })

  it('replaces spaces and special chars with underscores', () => {
    expect(sanitizeSkillId('my skill@name!')).toBe('my_skill_name')
  })

  it('collapses consecutive underscores', () => {
    expect(sanitizeSkillId('a..b')).toBe('a_b')
  })

  it('truncates to max 64 characters', () => {
    const long = 'A'.repeat(100)
    const result = sanitizeSkillId(long)
    expect(result.length).toBeLessThanOrEqual(64)
    expect(isValidSkillId(result)).toBe(true)
  })

  it('returns "skill" for empty or all-invalid input', () => {
    expect(sanitizeSkillId('!!!')).toBe('skill')
    expect(sanitizeSkillId('.')).toBe('skill')
  })
})

// ---------------------------------------------------------------------------
// SkillRegistry
// ---------------------------------------------------------------------------

describe('SkillRegistry', () => {
  let registry: ReturnType<typeof createSkillRegistry>

  beforeEach(() => {
    registry = createSkillRegistry()
  })

  describe('register', () => {
    it('should register a skill definition', () => {
      registry.register(makeValidSkill({ skillId: 'test-skill' }))

      expect(registry.has('test-skill')).toBe(true)
    })

    it('should throw when registering duplicate skill without overwrite option', () => {
      registry.register(makeValidSkill({ skillId: 'test-skill' }))

      expect(() => registry.register(makeValidSkill({ skillId: 'test-skill' }))).toThrow(
        'Skill already registered: test-skill',
      )
    })

    it('should allow overwriting when overwriteExisting is true', () => {
      registry.register(makeValidSkill({ skillId: 'test-skill', description: 'First version' }))
      registry.register(
        makeValidSkill({ skillId: 'test-skill', description: 'Second version' }),
        { overwriteExisting: true },
      )

      const retrieved = registry.get('test-skill')
      expect(retrieved?.description).toBe('Second version')
    })

    it('should reject invalid skill IDs', () => {
      expect(() => registry.register(makeValidSkill({ skillId: 'my.skill' }))).toThrow(
        /Invalid skill ID/,
      )
      expect(() => registry.register(makeValidSkill({ skillId: '' }))).toThrow(/Invalid skill ID/)
      expect(() => registry.register(makeValidSkill({ skillId: 'a'.repeat(65) }))).toThrow(
        /Invalid skill ID/,
      )
    })

    it('should accept legal IDs with hyphens and underscores', () => {
      expect(() => registry.register(makeValidSkill({ skillId: 'my-skill_v1' }))).not.toThrow()
      expect(() => registry.register(makeValidSkill({ skillId: 'skill-123' }))).not.toThrow()
      expect(() => registry.register(makeValidSkill({ skillId: '_leading_underscore' }))).not.toThrow()
    })
  })

  describe('get', () => {
    it('should return registered skill', () => {
      registry.register(makeValidSkill({ skillId: 'test-skill' }))

      const retrieved = registry.get('test-skill')

      expect(retrieved).toBeDefined()
      expect(retrieved?.skillId).toBe('test-skill')
      expect(retrieved?.category).toBe('read')
    })

    it('should return null for unregistered skill', () => {
      const result = registry.get('nonexistent')
      expect(result).toBeNull()
    })
  })

  describe('has', () => {
    it('should return true for registered skill', () => {
      registry.register(makeValidSkill({ skillId: 'test-skill' }))

      expect(registry.has('test-skill')).toBe(true)
    })

    it('should return false for unregistered skill', () => {
      expect(registry.has('nonexistent')).toBe(false)
    })
  })

  describe('list', () => {
    it('should return all registered skills sorted by skillId', () => {
      registry.register(makeValidSkill({ skillId: 'zebra-skill' }))
      registry.register(makeValidSkill({ skillId: 'alpha-skill' }))
      registry.register(makeValidSkill({ skillId: 'mid-skill' }))

      const skills = registry.list()

      expect(skills).toHaveLength(3)
      expect(skills.map((s) => s.skillId)).toEqual(['alpha-skill', 'mid-skill', 'zebra-skill'])
    })

    it('should return empty array when no skills registered', () => {
      const skills = registry.list()
      expect(skills).toEqual([])
    })

    it('should produce stable ordering regardless of registration order', () => {
      // Register in one order
      registry.register(makeValidSkill({ skillId: 'delta-skill' }))
      registry.register(makeValidSkill({ skillId: 'alpha-skill' }))
      registry.register(makeValidSkill({ skillId: 'charlie-skill' }))
      registry.register(makeValidSkill({ skillId: 'bravo-skill' }))

      const order1 = registry.list().map((s) => s.skillId)

      // Register in a different order in a fresh registry
      const registry2 = createSkillRegistry()
      registry2.register(makeValidSkill({ skillId: 'alpha-skill' }))
      registry2.register(makeValidSkill({ skillId: 'charlie-skill' }))
      registry2.register(makeValidSkill({ skillId: 'bravo-skill' }))
      registry2.register(makeValidSkill({ skillId: 'delta-skill' }))

      const order2 = registry2.list().map((s) => s.skillId)

      expect(order1).toEqual(order2)
      expect(order1).toEqual(['alpha-skill', 'bravo-skill', 'charlie-skill', 'delta-skill'])
    })
  })

  describe('unregister', () => {
    it('should unregister a skill', () => {
      registry.register(makeValidSkill({ skillId: 'test-skill' }))
      expect(registry.has('test-skill')).toBe(true)

      const result = registry.unregister('test-skill')

      expect(result).toBe(true)
      expect(registry.has('test-skill')).toBe(false)
    })

    it('should return false when unregistering nonexistent skill', () => {
      const result = registry.unregister('nonexistent')
      expect(result).toBe(false)
    })
  })

  describe('listByCategory', () => {
    it('should return skills filtered by category', () => {
      registry.register(makeValidSkill({ skillId: 'read-skill', category: 'read' }))
      registry.register(makeValidSkill({ skillId: 'write-skill', category: 'write' }))

      const readSkills = registry.listByCategory('read')
      expect(readSkills).toHaveLength(1)
      expect(readSkills[0].skillId).toBe('read-skill')
    })
  })

  describe('listBySource', () => {
    it('should return skills filtered by source', () => {
      registry.register(makeValidSkill({ skillId: 'builtin-skill', source: 'builtin' }))
      registry.register(makeValidSkill({ skillId: 'user-skill', source: 'user' }))

      const builtinSkills = registry.listBySource('builtin')
      expect(builtinSkills).toHaveLength(1)
      expect(builtinSkills[0].skillId).toBe('builtin-skill')
    })
  })
})