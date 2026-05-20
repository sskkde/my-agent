export type Role = 'admin' | 'user' | 'service';

export enum ResourceType {
  sessions = 'sessions',
  workflows = 'workflows',
  triggers = 'triggers',
  connectors = 'connectors',
  memory = 'memory',
  apiKeys = 'api-keys',
  users = 'users',
  settings = 'settings',
  observability = 'observability',
  approval = 'approval',
  run = 'run',
  provider = 'provider',
  toolResult = 'tool-result',
  organizations = 'organizations',
}

export enum Action {
  create = 'create',
  read = 'read',
  update = 'update',
  delete = 'delete',
  execute = 'execute',
  manage = 'manage',
}

export interface Permission {
  resource: ResourceType;
  action: Action;
}

export type RolePermissions = Record<Role, Permission[]>;

function generateAllPermissions(): Permission[] {
  const permissions: Permission[] = [];
  const resources = Object.values(ResourceType);
  const actions = Object.values(Action);
  
  for (const resource of resources) {
    for (const action of actions) {
      permissions.push({ resource, action });
    }
  }
  
  return permissions;
}

function generateUserPermissions(): Permission[] {
  const permissions: Permission[] = [];
  
  const ownResources = [
    ResourceType.sessions,
    ResourceType.workflows,
    ResourceType.triggers,
    ResourceType.memory,
  ];
  
  const crudActions = [Action.create, Action.read, Action.update, Action.delete];
  
  for (const resource of ownResources) {
    for (const action of crudActions) {
      permissions.push({ resource, action });
    }
  }
  
  permissions.push({ resource: ResourceType.connectors, action: Action.read });
  permissions.push({ resource: ResourceType.observability, action: Action.read });
  permissions.push({ resource: ResourceType.apiKeys, action: Action.read });
  permissions.push({ resource: ResourceType.apiKeys, action: Action.create });
  permissions.push({ resource: ResourceType.apiKeys, action: Action.delete });
  
  permissions.push({ resource: ResourceType.approval, action: Action.read });
  permissions.push({ resource: ResourceType.approval, action: Action.update });
  permissions.push({ resource: ResourceType.run, action: Action.read });
  permissions.push({ resource: ResourceType.provider, action: Action.read });
  permissions.push({ resource: ResourceType.toolResult, action: Action.read });
  
  permissions.push({ resource: ResourceType.organizations, action: Action.read });
  
  return permissions;
}

function generateServicePermissions(): Permission[] {
  const permissions: Permission[] = [];
  
  const executeResources = [
    ResourceType.workflows,
    ResourceType.triggers,
    ResourceType.connectors,
  ];
  
  for (const resource of executeResources) {
    permissions.push({ resource, action: Action.execute });
  }
  
  permissions.push({ resource: ResourceType.sessions, action: Action.read });
  
  return permissions;
}

export const ROLE_PERMISSIONS: RolePermissions = {
  admin: generateAllPermissions(),
  user: generateUserPermissions(),
  service: generateServicePermissions(),
};

export function hasPermission(role: Role, resource: ResourceType, action: Action): boolean {
  const permissions = ROLE_PERMISSIONS[role];
  return permissions.some((p) => p.resource === resource && p.action === action);
}

export function getAllPermissionsForRole(role: Role): Permission[] {
  return ROLE_PERMISSIONS[role];
}
