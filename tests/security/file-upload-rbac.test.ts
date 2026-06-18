/**
 * File Upload RBAC Security Tests
 *
 * Unit tests for file resource RBAC permissions.
 * Tests verify direct RBAC function behavior (hasPermission, checkPermission)
 * without going through HTTP routes.
 *
 * Security Requirements:
 * 1. Admin has all file permissions (via generateAllPermissions)
 * 2. User has create/read/delete on own files (no update, no manage)
 * 3. User cannot access other user's files (ownership enforcement)
 * 4. Service role has no file permissions
 * 5. Ownership context check works correctly for files
 */

import { describe, it, expect } from 'vitest'
import { ResourceType, Action, hasPermission } from '../../src/permissions/rbac-types.js'
import { checkPermission, type OwnershipContext } from '../../src/permissions/rbac-engine.js'

// =============================================================================
// FILE UPLOAD RBAC SECURITY TESTS
// =============================================================================

describe('File Upload RBAC Security Tests', () => {
  // ===========================================================================
  // Admin role - has all permissions on files
  // ===========================================================================
  describe('Admin role has all file permissions', () => {
    it('should allow admin to create files', () => {
      expect(hasPermission('admin', ResourceType.files, Action.create)).toBe(true)
    })

    it('should allow admin to read files', () => {
      expect(hasPermission('admin', ResourceType.files, Action.read)).toBe(true)
    })

    it('should allow admin to update files', () => {
      expect(hasPermission('admin', ResourceType.files, Action.update)).toBe(true)
    })

    it('should allow admin to delete files', () => {
      expect(hasPermission('admin', ResourceType.files, Action.delete)).toBe(true)
    })

    it('should allow admin to manage files', () => {
      expect(hasPermission('admin', ResourceType.files, Action.manage)).toBe(true)
    })

    it('should allow admin to execute files', () => {
      expect(hasPermission('admin', ResourceType.files, Action.execute)).toBe(true)
    })

    it('should bypass ownership check for admin', () => {
      const context: OwnershipContext = {
        userId: 'admin-1',
        resourceOwnerId: 'other-user-1',
      }
      expect(checkPermission('admin', ResourceType.files, Action.create, context)).toBe(true)
    })
  })

  // ===========================================================================
  // User role - has create/read/delete on own files only
  // ===========================================================================
  describe('User role has create/read/delete on own files', () => {
    it('should allow user to create files', () => {
      expect(hasPermission('user', ResourceType.files, Action.create)).toBe(true)
    })

    it('should allow user to read files', () => {
      expect(hasPermission('user', ResourceType.files, Action.read)).toBe(true)
    })

    it('should allow user to delete files', () => {
      expect(hasPermission('user', ResourceType.files, Action.delete)).toBe(true)
    })

    it('should NOT allow user to update files', () => {
      expect(hasPermission('user', ResourceType.files, Action.update)).toBe(false)
    })

    it('should NOT allow user to manage files', () => {
      expect(hasPermission('user', ResourceType.files, Action.manage)).toBe(false)
    })

    it('should NOT allow user to execute files', () => {
      expect(hasPermission('user', ResourceType.files, Action.execute)).toBe(false)
    })
  })

  // ===========================================================================
  // Service role - has no file permissions
  // ===========================================================================
  describe('Service role has no file permissions', () => {
    it('should NOT allow service to create files', () => {
      expect(hasPermission('service', ResourceType.files, Action.create)).toBe(false)
    })

    it('should NOT allow service to read files', () => {
      expect(hasPermission('service', ResourceType.files, Action.read)).toBe(false)
    })

    it('should NOT allow service to update files', () => {
      expect(hasPermission('service', ResourceType.files, Action.update)).toBe(false)
    })

    it('should NOT allow service to delete files', () => {
      expect(hasPermission('service', ResourceType.files, Action.delete)).toBe(false)
    })

    it('should NOT allow service to manage files', () => {
      expect(hasPermission('service', ResourceType.files, Action.manage)).toBe(false)
    })

    it('should NOT allow service to execute files', () => {
      expect(hasPermission('service', ResourceType.files, Action.execute)).toBe(false)
    })
  })

  // ===========================================================================
  // Ownership enforcement - user cannot access other user's files
  // ===========================================================================
  describe('Ownership enforcement for files', () => {
    it('should allow user to access own files via checkPermission', () => {
      const context: OwnershipContext = {
        userId: 'user-1',
        resourceOwnerId: 'user-1',
      }
      expect(checkPermission('user', ResourceType.files, Action.read, context)).toBe(true)
    })

    it('should deny user from reading another user\'s files', () => {
      const context: OwnershipContext = {
        userId: 'user-1',
        resourceOwnerId: 'user-2',
      }
      expect(checkPermission('user', ResourceType.files, Action.read, context)).toBe(false)
    })

    it('should deny user from creating files for another user', () => {
      const context: OwnershipContext = {
        userId: 'user-1',
        resourceOwnerId: 'user-2',
      }
      expect(checkPermission('user', ResourceType.files, Action.create, context)).toBe(false)
    })

    it('should deny user from deleting another user\'s files', () => {
      const context: OwnershipContext = {
        userId: 'user-1',
        resourceOwnerId: 'user-2',
      }
      expect(checkPermission('user', ResourceType.files, Action.delete, context)).toBe(false)
    })

    it('should allow user access without ownership context', () => {
      // When no context provided, ownership check is skipped
      expect(checkPermission('user', ResourceType.files, Action.read)).toBe(true)
    })

    it('should deny already-forbidden actions even with matching ownership', () => {
      const context: OwnershipContext = {
        userId: 'user-1',
        resourceOwnerId: 'user-1',
      }
      // User does not have update permission regardless of ownership
      expect(checkPermission('user', ResourceType.files, Action.update, context)).toBe(false)
    })
  })

  // ===========================================================================
  // Service role ownership bypass (but still no permissions)
  // ===========================================================================
  describe('Service role cannot bypass lack of permissions via ownership', () => {
    it('should deny service even with matching ownership context', () => {
      const context: OwnershipContext = {
        userId: 'service-1',
        resourceOwnerId: 'service-1',
      }
      // Service has no file permissions at all, ownership doesn't help
      expect(checkPermission('service', ResourceType.files, Action.read, context)).toBe(false)
    })

    it('should deny service even without ownership context', () => {
      expect(checkPermission('service', ResourceType.files, Action.create)).toBe(false)
    })
  })

  // ===========================================================================
  // All three roles compared
  // ===========================================================================
  describe('Role comparison matrix for files resource', () => {
    const fileActions = [Action.create, Action.read, Action.update, Action.delete, Action.manage, Action.execute]

    it('admin should have all file actions', () => {
      for (const action of fileActions) {
        expect(hasPermission('admin', ResourceType.files, action)).toBe(true)
      }
    })

    it('user should have only create/read/delete for files', () => {
      const allowed = [Action.create, Action.read, Action.delete]
      const denied = [Action.update, Action.manage, Action.execute]

      for (const action of allowed) {
        expect(hasPermission('user', ResourceType.files, action)).toBe(true)
      }
      for (const action of denied) {
        expect(hasPermission('user', ResourceType.files, action)).toBe(false)
      }
    })

    it('service should have no file actions', () => {
      for (const action of fileActions) {
        expect(hasPermission('service', ResourceType.files, action)).toBe(false)
      }
    })
  })

  // ===========================================================================
  // Files resource is in OWNERSHIP_REQUIRED_RESOURCES
  // ===========================================================================
  describe('Files resource requires ownership check', () => {
    it('should enforce ownership when context provided for user role', () => {
      const ownContext: OwnershipContext = {
        userId: 'user-1',
        resourceOwnerId: 'user-1',
      }
      const otherContext: OwnershipContext = {
        userId: 'user-1',
        resourceOwnerId: 'user-2',
      }

      // Own file: allowed
      expect(checkPermission('user', ResourceType.files, Action.read, ownContext)).toBe(true)
      // Other's file: denied
      expect(checkPermission('user', ResourceType.files, Action.read, otherContext)).toBe(false)
    })

    it('should let admin bypass ownership for files', () => {
      const context: OwnershipContext = {
        userId: 'admin-1',
        resourceOwnerId: 'other-user',
      }
      expect(checkPermission('admin', ResourceType.files, Action.read, context)).toBe(true)
      expect(checkPermission('admin', ResourceType.files, Action.delete, context)).toBe(true)
    })
  })
})
