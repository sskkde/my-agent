import { describe, it, expect } from 'vitest';
import {
  Role,
  ResourceType,
  Action,
  Permission,
  ROLE_PERMISSIONS,
  hasPermission,
  getAllPermissionsForRole,
} from '../../../src/permissions/rbac-types.js';

describe('RBAC Types', () => {
  describe('Role definitions', () => {
    it('should define three roles: admin, user, service', () => {
      const roles: Role[] = ['admin', 'user', 'service'];
      expect(roles).toHaveLength(3);
      expect(roles).toContain('admin');
      expect(roles).toContain('user');
      expect(roles).toContain('service');
    });
  });

  describe('ResourceType enum', () => {
    it('should define all required resource types', () => {
      const expectedTypes = [
        'sessions',
        'workflows',
        'triggers',
        'connectors',
        'memory',
        'api-keys',
        'users',
        'settings',
        'observability',
      ];
      
      expectedTypes.forEach((type) => {
        expect(Object.values(ResourceType)).toContain(type);
      });
    });
  });

  describe('Action enum', () => {
    it('should define all required actions', () => {
      const expectedActions = ['create', 'read', 'update', 'delete', 'execute', 'manage'];
      
      expectedActions.forEach((action) => {
        expect(Object.values(Action)).toContain(action);
      });
    });
  });

  describe('Permission type', () => {
    it('should create valid permission objects', () => {
      const permission: Permission = {
        resource: ResourceType.sessions,
        action: Action.read,
      };
      
      expect(permission.resource).toBe(ResourceType.sessions);
      expect(permission.action).toBe(Action.read);
    });
  });

  describe('ROLE_PERMISSIONS mapping', () => {
    it('should have permissions defined for all roles', () => {
      expect(ROLE_PERMISSIONS.admin).toBeDefined();
      expect(ROLE_PERMISSIONS.user).toBeDefined();
      expect(ROLE_PERMISSIONS.service).toBeDefined();
    });

    it('admin should have ALL ResourceType x Action permissions', () => {
      const adminPermissions = ROLE_PERMISSIONS.admin;
      const allResourceTypes = Object.values(ResourceType);
      const allActions = Object.values(Action);
      
      // Admin should have every combination
      allResourceTypes.forEach((resource) => {
        allActions.forEach((action) => {
          expect(
            adminPermissions.some((p) => p.resource === resource && p.action === action)
          ).toBe(true);
        });
      });
    });

    it('user should have CRUD on own resources', () => {
      const userPermissions = ROLE_PERMISSIONS.user;
      const ownResourceTypes = [
        ResourceType.sessions,
        ResourceType.workflows,
        ResourceType.triggers,
        ResourceType.memory,
      ];
      const crudActions = [Action.create, Action.read, Action.update, Action.delete];
      
      ownResourceTypes.forEach((resource) => {
        crudActions.forEach((action) => {
          expect(
            userPermissions.some((p) => p.resource === resource && p.action === action)
          ).toBe(true);
        });
      });
    });

    it('user should have read on public resources', () => {
      const userPermissions = ROLE_PERMISSIONS.user;
      const publicResources = [
        ResourceType.connectors,
        ResourceType.observability,
      ];
      
      publicResources.forEach((resource) => {
        expect(
          userPermissions.some((p) => p.resource === resource && p.action === Action.read)
        ).toBe(true);
      });
    });

    it('user should NOT have manage or execute on most resources', () => {
      const userPermissions = ROLE_PERMISSIONS.user;
      
      // User should not have manage on sessions
      expect(
        userPermissions.some((p) => p.resource === ResourceType.sessions && p.action === Action.manage)
      ).toBe(false);
      
      // User should not have execute on connectors
      expect(
        userPermissions.some((p) => p.resource === ResourceType.connectors && p.action === Action.execute)
      ).toBe(false);
    });

    it('service should only have execute on authorized API endpoints', () => {
      const servicePermissions = ROLE_PERMISSIONS.service;
      
      // Service should have execute on specific resources
      const executeResources = [
        ResourceType.workflows,
        ResourceType.triggers,
        ResourceType.connectors,
      ];
      
      executeResources.forEach((resource) => {
        expect(
          servicePermissions.some((p) => p.resource === resource && p.action === Action.execute)
        ).toBe(true);
      });
      
      // Service should NOT have other actions
      expect(
        servicePermissions.some((p) => p.action === Action.create)
      ).toBe(false);
      expect(
        servicePermissions.some((p) => p.action === Action.update)
      ).toBe(false);
      expect(
        servicePermissions.some((p) => p.action === Action.delete)
      ).toBe(false);
      expect(
        servicePermissions.some((p) => p.action === Action.manage)
      ).toBe(false);
    });
  });

  describe('hasPermission helper', () => {
    it('should return true when role has the permission', () => {
      expect(
        hasPermission('admin', ResourceType.sessions, Action.create)
      ).toBe(true);
      expect(
        hasPermission('user', ResourceType.sessions, Action.read)
      ).toBe(true);
      expect(
        hasPermission('service', ResourceType.workflows, Action.execute)
      ).toBe(true);
    });

    it('should return false when role lacks the permission', () => {
      expect(
        hasPermission('user', ResourceType.users, Action.delete)
      ).toBe(false);
      expect(
        hasPermission('service', ResourceType.sessions, Action.create)
      ).toBe(false);
    });
  });

  describe('getAllPermissionsForRole helper', () => {
    it('should return all permissions for a role', () => {
      const adminPerms = getAllPermissionsForRole('admin');
      expect(adminPerms.length).toBeGreaterThan(0);
      expect(adminPerms).toEqual(ROLE_PERMISSIONS.admin);
      
      const userPerms = getAllPermissionsForRole('user');
      expect(userPerms.length).toBeGreaterThan(0);
      expect(userPerms).toEqual(ROLE_PERMISSIONS.user);
      
      const servicePerms = getAllPermissionsForRole('service');
      expect(servicePerms.length).toBeGreaterThan(0);
      expect(servicePerms).toEqual(ROLE_PERMISSIONS.service);
    });
  });
});
