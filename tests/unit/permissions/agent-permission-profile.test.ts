import { describe, it, expect } from 'vitest'
import {
  type PermissionMode,
  ALL_PERMISSION_MODES,
  resolvePermissionMode,
  modeAllowsOperation,
} from '../../../src/permissions/types.js'
import { isDeniedByRestricted } from '../../../src/permissions/tool-risk-policy.js'

describe('PermissionMode unified model', () => {
  describe('ALL_PERMISSION_MODES', () => {
    it('should contain exactly 6 modes', () => {
      expect(ALL_PERMISSION_MODES).toHaveLength(6)
    })

    it('should include all expected modes', () => {
      const expected: PermissionMode[] = [
        'read_only',
        'ask_on_write',
        'write_allowed',
        'restricted',
        'background_limited',
        'hard_deny',
      ]
      for (const mode of expected) {
        expect(ALL_PERMISSION_MODES).toContain(mode)
      }
    })
  })

  describe('resolvePermissionMode', () => {
    it('should resolve read_only unchanged', () => {
      expect(resolvePermissionMode('read_only')).toBe('read_only')
    })

    it('should resolve ask_on_write unchanged', () => {
      expect(resolvePermissionMode('ask_on_write')).toBe('ask_on_write')
    })

    it('should resolve write_allowed unchanged', () => {
      expect(resolvePermissionMode('write_allowed')).toBe('write_allowed')
    })

    it('should resolve restricted unchanged', () => {
      expect(resolvePermissionMode('restricted')).toBe('restricted')
    })

    it('should resolve background_limited unchanged', () => {
      expect(resolvePermissionMode('background_limited')).toBe('background_limited')
    })

    it('should resolve hard_deny unchanged', () => {
      expect(resolvePermissionMode('hard_deny')).toBe('hard_deny')
    })

    it('should throw for unknown profile', () => {
      expect(() => resolvePermissionMode('unknown_profile')).toThrow('Unknown permission profile')
    })
  })

  describe('modeAllowsOperation — read_only', () => {
    it('should allow read operations', () => {
      expect(modeAllowsOperation('read_only', 'read')).toBe(true)
    })

    it('should allow query operations', () => {
      expect(modeAllowsOperation('read_only', 'query')).toBe(true)
    })

    it('should deny write operations', () => {
      expect(modeAllowsOperation('read_only', 'write')).toBe(false)
    })

    it('should deny delete operations', () => {
      expect(modeAllowsOperation('read_only', 'delete')).toBe(false)
    })

    it('should deny execute operations', () => {
      expect(modeAllowsOperation('read_only', 'execute')).toBe(false)
    })
  })

  describe('modeAllowsOperation — ask_on_write', () => {
    it('should allow read operations', () => {
      expect(modeAllowsOperation('ask_on_write', 'read')).toBe(true)
    })

    it('should allow write operations (engine handles approval gate)', () => {
      expect(modeAllowsOperation('ask_on_write', 'write')).toBe(true)
    })

    it('should allow delete operations', () => {
      expect(modeAllowsOperation('ask_on_write', 'delete')).toBe(true)
    })

    it('should allow execute operations', () => {
      expect(modeAllowsOperation('ask_on_write', 'execute')).toBe(true)
    })
  })

  describe('modeAllowsOperation — write_allowed', () => {
    it('should allow read operations', () => {
      expect(modeAllowsOperation('write_allowed', 'read')).toBe(true)
    })

    it('should allow write operations', () => {
      expect(modeAllowsOperation('write_allowed', 'write')).toBe(true)
    })

    it('should allow delete operations', () => {
      expect(modeAllowsOperation('write_allowed', 'delete')).toBe(true)
    })

    it('should allow execute operations', () => {
      expect(modeAllowsOperation('write_allowed', 'execute')).toBe(true)
    })
  })

  describe('modeAllowsOperation — restricted', () => {
    it('should allow read operations', () => {
      expect(modeAllowsOperation('restricted', 'read')).toBe(true)
    })

    it('should allow write operations (engine denies high-risk)', () => {
      expect(modeAllowsOperation('restricted', 'write')).toBe(true)
    })

    it('should allow delete operations', () => {
      expect(modeAllowsOperation('restricted', 'delete')).toBe(true)
    })

    it('should allow execute operations', () => {
      expect(modeAllowsOperation('restricted', 'execute')).toBe(true)
    })
  })

  describe('modeAllowsOperation — background_limited', () => {
    it('should allow read operations', () => {
      expect(modeAllowsOperation('background_limited', 'read')).toBe(true)
    })

    it('should allow query operations', () => {
      expect(modeAllowsOperation('background_limited', 'query')).toBe(true)
    })

    it('should allow internal_read operations', () => {
      expect(modeAllowsOperation('background_limited', 'internal_read')).toBe(true)
    })

    it('should deny write operations', () => {
      expect(modeAllowsOperation('background_limited', 'write')).toBe(false)
    })

    it('should deny delete operations', () => {
      expect(modeAllowsOperation('background_limited', 'delete')).toBe(false)
    })

    it('should deny execute operations', () => {
      expect(modeAllowsOperation('background_limited', 'execute')).toBe(false)
    })
  })

  describe('modeAllowsOperation — hard_deny', () => {
    it('should deny read operations', () => {
      expect(modeAllowsOperation('hard_deny', 'read')).toBe(false)
    })

    it('should deny write operations', () => {
      expect(modeAllowsOperation('hard_deny', 'write')).toBe(false)
    })

    it('should deny delete operations', () => {
      expect(modeAllowsOperation('hard_deny', 'delete')).toBe(false)
    })

    it('should deny execute operations', () => {
      expect(modeAllowsOperation('hard_deny', 'execute')).toBe(false)
    })
  })
})

describe('isDeniedByRestricted', () => {
  it('should deny critical risk', () => {
    expect(isDeniedByRestricted('critical')).toBe(true)
  })

  it('should deny high risk', () => {
    expect(isDeniedByRestricted('high')).toBe(true)
  })

  it('should allow medium risk', () => {
    expect(isDeniedByRestricted('medium')).toBe(false)
  })

  it('should allow low risk', () => {
    expect(isDeniedByRestricted('low')).toBe(false)
  })
})

describe('Legacy profile mapping', () => {
  it('should map all old registry profiles to valid PermissionModes', () => {
    const legacyProfiles = ['read_only', 'ask_on_write', 'write_allowed', 'restricted']
    for (const profile of legacyProfiles) {
      const mode = resolvePermissionMode(profile)
      expect(ALL_PERMISSION_MODES).toContain(mode)
    }
  })

  it('should map all engine modes as valid PermissionModes', () => {
    const engineModes = ['read_only', 'ask_on_write', 'background_limited', 'hard_deny']
    for (const mode of engineModes) {
      expect(ALL_PERMISSION_MODES).toContain(mode as PermissionMode)
    }
  })
})
