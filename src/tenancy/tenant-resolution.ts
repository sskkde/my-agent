import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { OrganizationStore } from '../storage/organization-store.js';
import type { TenantContext } from './tenant-context.js';
import { DEFAULT_TENANT_ID, createTenantContext } from './tenant-context.js';

export interface TenantResolutionOptions {
  organizationStore: OrganizationStore;
  tenantHeader?: string;
}

/**
 * Resolution order:
 * 1. X-Tenant-Id header (admin only) — future multi-tenant
 * 2. User org associations — future multi-tenant
 * 3. Default tenant fallback
 *
 * For GA: all users resolve to 'org_default'.
 */
export function resolveTenant(
  userId: string | undefined,
  organizationStore: OrganizationStore,
  tenantHeader?: string
): TenantContext {
  void userId;
  void organizationStore;
  void tenantHeader;

  return createTenantContext(DEFAULT_TENANT_ID, 'default');
}

export function registerTenantResolution(
  server: FastifyInstance,
  options: TenantResolutionOptions
): void {
  const tenantHeader = options.tenantHeader ?? 'X-Tenant-Id';

  server.addHook('onRequest', async (request: FastifyRequest) => {
    const userId = request.user?.userId;
    const context = resolveTenant(userId, options.organizationStore, tenantHeader);

    (request as any).tenantContext = context;

    if (request.user) {
      (request.user as any).tenantId = context.tenantId;
    }
  });
}
