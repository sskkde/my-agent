import { type Role, type Permission, ResourceType, Action, hasPermission, ROLE_PERMISSIONS } from './rbac-types.js'

export interface OwnershipContext {
  userId: string
  resourceOwnerId: string
}

const OWNERSHIP_REQUIRED_RESOURCES = new Set<ResourceType>([
  ResourceType.sessions,
  ResourceType.workflows,
  ResourceType.triggers,
  ResourceType.memory,
  ResourceType.apiKeys,
  ResourceType.files,
])

export function checkPermission(
  role: Role,
  resource: ResourceType,
  action: Action,
  context?: OwnershipContext,
): boolean {
  if (!hasPermission(role, resource, action)) {
    return false
  }

  if (role === 'admin' || role === 'service') {
    return true
  }

  if (context && OWNERSHIP_REQUIRED_RESOURCES.has(resource)) {
    return context.userId === context.resourceOwnerId
  }

  return true
}

export function getRolePermissions(role: Role): Permission[] {
  return ROLE_PERMISSIONS[role]
}

export function filterResources<T extends ResourceType>(role: Role, resources: T[], action: Action): T[] {
  return resources.filter((resource) => hasPermission(role, resource, action))
}
