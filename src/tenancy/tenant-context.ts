export interface TenantContext {
  tenantId: string;
  resolvedFrom: 'user' | 'header' | 'default';
  orgName?: string;
  orgSlug?: string;
}

export function createTenantContext(
  tenantId: string,
  resolvedFrom: TenantContext['resolvedFrom'] = 'default'
): TenantContext {
  return { tenantId, resolvedFrom };
}

export const DEFAULT_TENANT_ID = 'org_default';
