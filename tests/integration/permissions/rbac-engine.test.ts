import { describe, it, expect } from 'vitest'
import { checkPermission, getRolePermissions, filterResources } from '../../../src/permissions/rbac-engine.js'
import { Role, ResourceType, Action, hasPermission, ROLE_PERMISSIONS } from '../../../src/permissions/rbac-types.js'

describe('RBAC Engine', () => {
  describe('checkPermission', () => {
    describe('admin role', () => {
      it('should pass ALL permission checks for admin', () => {
        const resources = Object.values(ResourceType)
        const actions = Object.values(Action)

        for (const resource of resources) {
          for (const action of actions) {
            expect(checkPermission('admin', resource, action), `admin should be allowed ${action} on ${resource}`).toBe(
              true,
            )
          }
        }
      })

      it('should allow admin to manage users', () => {
        expect(checkPermission('admin', ResourceType.users, Action.manage)).toBe(true)
      })

      it('should allow admin to manage settings', () => {
        expect(checkPermission('admin', ResourceType.settings, Action.manage)).toBe(true)
      })

      it('should allow admin to execute connectors', () => {
        expect(checkPermission('admin', ResourceType.connectors, Action.execute)).toBe(true)
      })
    })

    describe('user role', () => {
      it('should allow user to CRUD own sessions', () => {
        expect(checkPermission('user', ResourceType.sessions, Action.create)).toBe(true)
        expect(checkPermission('user', ResourceType.sessions, Action.read)).toBe(true)
        expect(checkPermission('user', ResourceType.sessions, Action.update)).toBe(true)
        expect(checkPermission('user', ResourceType.sessions, Action.delete)).toBe(true)
      })

      it('should allow user to CRUD own workflows', () => {
        expect(checkPermission('user', ResourceType.workflows, Action.create)).toBe(true)
        expect(checkPermission('user', ResourceType.workflows, Action.read)).toBe(true)
        expect(checkPermission('user', ResourceType.workflows, Action.update)).toBe(true)
        expect(checkPermission('user', ResourceType.workflows, Action.delete)).toBe(true)
      })

      it('should allow user to CRUD own triggers', () => {
        expect(checkPermission('user', ResourceType.triggers, Action.create)).toBe(true)
        expect(checkPermission('user', ResourceType.triggers, Action.read)).toBe(true)
        expect(checkPermission('user', ResourceType.triggers, Action.update)).toBe(true)
        expect(checkPermission('user', ResourceType.triggers, Action.delete)).toBe(true)
      })

      it('should allow user to CRUD own memory', () => {
        expect(checkPermission('user', ResourceType.memory, Action.create)).toBe(true)
        expect(checkPermission('user', ResourceType.memory, Action.read)).toBe(true)
        expect(checkPermission('user', ResourceType.memory, Action.update)).toBe(true)
        expect(checkPermission('user', ResourceType.memory, Action.delete)).toBe(true)
      })

      it('should allow user to read connectors', () => {
        expect(checkPermission('user', ResourceType.connectors, Action.read)).toBe(true)
      })

      it('should deny user from managing connectors', () => {
        expect(checkPermission('user', ResourceType.connectors, Action.manage)).toBe(false)
      })

      it('should deny user from executing connectors', () => {
        expect(checkPermission('user', ResourceType.connectors, Action.execute)).toBe(false)
      })

      it('should deny user from managing users', () => {
        expect(checkPermission('user', ResourceType.users, Action.manage)).toBe(false)
      })

      it('should deny user from reading users', () => {
        expect(checkPermission('user', ResourceType.users, Action.read)).toBe(false)
      })

      it('should deny user from managing settings', () => {
        expect(checkPermission('user', ResourceType.settings, Action.manage)).toBe(false)
      })

      it('should deny user from reading settings', () => {
        expect(checkPermission('user', ResourceType.settings, Action.read)).toBe(false)
      })

      it('should allow user to read observability', () => {
        expect(checkPermission('user', ResourceType.observability, Action.read)).toBe(true)
      })

      it('should allow user to create/read/delete API keys', () => {
        expect(checkPermission('user', ResourceType.apiKeys, Action.create)).toBe(true)
        expect(checkPermission('user', ResourceType.apiKeys, Action.read)).toBe(true)
        expect(checkPermission('user', ResourceType.apiKeys, Action.delete)).toBe(true)
      })

      it('should deny user from updating API keys', () => {
        expect(checkPermission('user', ResourceType.apiKeys, Action.update)).toBe(false)
      })

      it('should deny user from executing workflows', () => {
        expect(checkPermission('user', ResourceType.workflows, Action.execute)).toBe(false)
      })
    })

    describe('user role with ownership context', () => {
      it('should allow user to access own resources', () => {
        const context = { userId: 'user-1', resourceOwnerId: 'user-1' }
        expect(checkPermission('user', ResourceType.sessions, Action.read, context)).toBe(true)
      })

      it('should deny user from accessing other users resources', () => {
        const context = { userId: 'user-1', resourceOwnerId: 'user-2' }
        expect(checkPermission('user', ResourceType.sessions, Action.read, context)).toBe(false)
      })

      it('should allow admin to access any users resources regardless of ownership', () => {
        const context = { userId: 'admin-1', resourceOwnerId: 'user-2' }
        expect(checkPermission('admin', ResourceType.sessions, Action.read, context)).toBe(true)
      })

      it('should allow service to access resources without ownership check', () => {
        const context = { userId: 'service-1', resourceOwnerId: 'user-2' }
        expect(checkPermission('service', ResourceType.sessions, Action.read, context)).toBe(true)
      })

      it('should allow user to read connectors regardless of ownership (public resource)', () => {
        const context = { userId: 'user-1', resourceOwnerId: 'user-2' }
        expect(checkPermission('user', ResourceType.connectors, Action.read, context)).toBe(true)
      })

      it('should allow user to read observability regardless of ownership', () => {
        const context = { userId: 'user-1', resourceOwnerId: 'user-2' }
        expect(checkPermission('user', ResourceType.observability, Action.read, context)).toBe(true)
      })

      it('should deny user from reading other users API keys', () => {
        const context = { userId: 'user-1', resourceOwnerId: 'user-2' }
        expect(checkPermission('user', ResourceType.apiKeys, Action.read, context)).toBe(false)
      })

      it('should allow user to read own API keys', () => {
        const context = { userId: 'user-1', resourceOwnerId: 'user-1' }
        expect(checkPermission('user', ResourceType.apiKeys, Action.read, context)).toBe(true)
      })
    })

    describe('service role', () => {
      it('should allow service to execute workflows', () => {
        expect(checkPermission('service', ResourceType.workflows, Action.execute)).toBe(true)
      })

      it('should allow service to execute triggers', () => {
        expect(checkPermission('service', ResourceType.triggers, Action.execute)).toBe(true)
      })

      it('should allow service to execute connectors', () => {
        expect(checkPermission('service', ResourceType.connectors, Action.execute)).toBe(true)
      })

      it('should allow service to read sessions', () => {
        expect(checkPermission('service', ResourceType.sessions, Action.read)).toBe(true)
      })

      it('should deny service from creating sessions', () => {
        expect(checkPermission('service', ResourceType.sessions, Action.create)).toBe(false)
      })

      it('should deny service from managing users', () => {
        expect(checkPermission('service', ResourceType.users, Action.manage)).toBe(false)
      })

      it('should deny service from reading memory', () => {
        expect(checkPermission('service', ResourceType.memory, Action.read)).toBe(false)
      })

      it('should deny service from managing settings', () => {
        expect(checkPermission('service', ResourceType.settings, Action.manage)).toBe(false)
      })

      it('should deny service from reading observability', () => {
        expect(checkPermission('service', ResourceType.observability, Action.read)).toBe(false)
      })
    })
  })

  describe('getRolePermissions', () => {
    it('should return all permissions for admin', () => {
      const permissions = getRolePermissions('admin')
      const totalPermissions = Object.keys(ResourceType).length * Object.keys(Action).length
      expect(permissions).toHaveLength(totalPermissions)
    })

    it('should return user permissions', () => {
      const permissions = getRolePermissions('user')
      // sessions(4) + workflows(4) + triggers(4) + memory(4) + connectors(read) + observability(read) + apiKeys(read,create,delete) + approval(read,update) + run(read) + provider(read) + toolResult(read) + organizations(read) = 27
      expect(permissions).toHaveLength(27)
    })

    it('should return service permissions', () => {
      const permissions = getRolePermissions('service')
      // workflows(execute) + triggers(execute) + connectors(execute) + sessions(read) = 4
      expect(permissions).toHaveLength(4)
    })

    it('should return same result as ROLE_PERMISSIONS', () => {
      expect(getRolePermissions('admin')).toEqual(ROLE_PERMISSIONS.admin)
      expect(getRolePermissions('user')).toEqual(ROLE_PERMISSIONS.user)
      expect(getRolePermissions('service')).toEqual(ROLE_PERMISSIONS.service)
    })
  })

  describe('filterResources', () => {
    const allResources = Object.values(ResourceType)

    it('should return all resources for admin with any action', () => {
      const result = filterResources('admin', allResources, Action.read)
      expect(result).toEqual(allResources)
    })

    it('should filter resources for user with read action', () => {
      const result = filterResources('user', allResources, Action.read)
      expect(result).toContain(ResourceType.sessions)
      expect(result).toContain(ResourceType.workflows)
      expect(result).toContain(ResourceType.triggers)
      expect(result).toContain(ResourceType.memory)
      expect(result).toContain(ResourceType.connectors)
      expect(result).toContain(ResourceType.observability)
      expect(result).toContain(ResourceType.apiKeys)
      expect(result).not.toContain(ResourceType.users)
      expect(result).not.toContain(ResourceType.settings)
    })

    it('should filter resources for user with manage action', () => {
      const result = filterResources('user', allResources, Action.manage)
      expect(result).toHaveLength(0)
    })

    it('should filter resources for service with execute action', () => {
      const result = filterResources('service', allResources, Action.execute)
      expect(result).toContain(ResourceType.workflows)
      expect(result).toContain(ResourceType.triggers)
      expect(result).toContain(ResourceType.connectors)
      expect(result).toHaveLength(3)
    })

    it('should filter resources for service with read action', () => {
      const result = filterResources('service', allResources, Action.read)
      expect(result).toContain(ResourceType.sessions)
      expect(result).toHaveLength(1)
    })

    it('should return empty array for service with create action', () => {
      const result = filterResources('service', allResources, Action.create)
      expect(result).toHaveLength(0)
    })

    it('should handle empty resource list', () => {
      const result = filterResources('admin', [], Action.read)
      expect(result).toEqual([])
    })

    it('should preserve order of input resources', () => {
      const customOrder = [ResourceType.memory, ResourceType.sessions, ResourceType.workflows]
      const result = filterResources('user', customOrder, Action.read)
      expect(result).toEqual([ResourceType.memory, ResourceType.sessions, ResourceType.workflows])
    })
  })

  describe('hasPermission (from rbac-types)', () => {
    it('should be consistent with checkPermission for basic checks', () => {
      const roles: Role[] = ['admin', 'user', 'service']
      const resources = Object.values(ResourceType)
      const actions = Object.values(Action)

      for (const role of roles) {
        for (const resource of resources) {
          for (const action of actions) {
            expect(hasPermission(role, resource, action)).toBe(checkPermission(role, resource, action))
          }
        }
      }
    })
  })
})
