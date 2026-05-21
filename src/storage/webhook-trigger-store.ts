import type { ConnectionManager } from './connection.js';
import { DEFAULT_TENANT_ID } from '../tenancy/tenant-context.js';

export const WEBHOOK_TRIGGER_STATUSES = {
  ACTIVE: 'active',
  PAUSED: 'paused',
  DELETED: 'deleted',
} as const;

export type WebhookTriggerStatus = typeof WEBHOOK_TRIGGER_STATUSES[keyof typeof WEBHOOK_TRIGGER_STATUSES];

export interface WebhookTrigger {
  webhookId: string;
  ownerUserId: string;
  name: string;
  secretHash: string;
  secretLast4: string;
  status: WebhookTriggerStatus;
  triggerRegistrationId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateWebhookTrigger {
  webhookId: string;
  ownerUserId: string;
  name: string;
  secretHash: string;
  secretLast4: string;
  status?: WebhookTriggerStatus;
  triggerRegistrationId?: string;
}

export interface WebhookTriggerStore {
  create(trigger: CreateWebhookTrigger, tenantId?: string): WebhookTrigger;
  getById(webhookId: string, tenantId?: string): WebhookTrigger | null;
  findByOwner(ownerUserId: string, tenantId?: string): WebhookTrigger[];
  updateStatus(webhookId: string, status: WebhookTriggerStatus, tenantId?: string): WebhookTrigger | null;
  delete(webhookId: string, tenantId?: string): void;
}

interface WebhookTriggerRow {
  webhook_id: string;
  owner_user_id: string;
  name: string;
  secret_hash: string;
  secret_last4: string;
  status: string;
  trigger_registration_id: string | null;
  created_at: string;
  updated_at: string;
}

class WebhookTriggerStoreImpl implements WebhookTriggerStore {
  private connection: ConnectionManager;

  constructor(connection: ConnectionManager) {
    this.connection = connection;
  }

  create(trigger: CreateWebhookTrigger, tenantId: string = DEFAULT_TENANT_ID): WebhookTrigger {
    const now = new Date().toISOString();
    const record: WebhookTrigger = {
      webhookId: trigger.webhookId,
      ownerUserId: trigger.ownerUserId,
      name: trigger.name,
      secretHash: trigger.secretHash,
      secretLast4: trigger.secretLast4,
      status: trigger.status ?? WEBHOOK_TRIGGER_STATUSES.ACTIVE,
      triggerRegistrationId: trigger.triggerRegistrationId ?? null,
      createdAt: now,
      updatedAt: now,
    };

    this.connection.exec(
      `INSERT INTO webhook_triggers (
        webhook_id, owner_user_id, name, secret_hash, secret_last4,
        status, trigger_registration_id, created_at, updated_at, tenant_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        record.webhookId,
        record.ownerUserId,
        record.name,
        record.secretHash,
        record.secretLast4,
        record.status,
        record.triggerRegistrationId,
        record.createdAt,
        record.updatedAt,
        tenantId,
      ]
    );

    return record;
  }

  getById(webhookId: string, tenantId: string = DEFAULT_TENANT_ID): WebhookTrigger | null {
    const results = this.connection.query<WebhookTriggerRow>(
      'SELECT * FROM webhook_triggers WHERE webhook_id = ? AND tenant_id = ?',
      [webhookId, tenantId]
    );

    if (results.length === 0) {
      return null;
    }

    return this.rowToTrigger(results[0]!);
  }

  findByOwner(ownerUserId: string, tenantId: string = DEFAULT_TENANT_ID): WebhookTrigger[] {
    const results = this.connection.query<WebhookTriggerRow>(
      'SELECT * FROM webhook_triggers WHERE owner_user_id = ? AND tenant_id = ? ORDER BY created_at DESC',
      [ownerUserId, tenantId]
    );
    return results.map(row => this.rowToTrigger(row));
  }

  updateStatus(webhookId: string, status: WebhookTriggerStatus, tenantId: string = DEFAULT_TENANT_ID): WebhookTrigger | null {
    const existing = this.getById(webhookId, tenantId);
    if (!existing) {
      return null;
    }

    const now = new Date().toISOString();

    this.connection.exec(
      'UPDATE webhook_triggers SET status = ?, updated_at = ? WHERE webhook_id = ? AND tenant_id = ?',
      [status, now, webhookId, tenantId]
    );

    return {
      ...existing,
      status,
      updatedAt: now,
    };
  }

  delete(webhookId: string, tenantId: string = DEFAULT_TENANT_ID): void {
    this.connection.exec('DELETE FROM webhook_triggers WHERE webhook_id = ? AND tenant_id = ?', [webhookId, tenantId]);
  }

  private rowToTrigger(row: WebhookTriggerRow): WebhookTrigger {
    return {
      webhookId: row.webhook_id,
      ownerUserId: row.owner_user_id,
      name: row.name,
      secretHash: row.secret_hash,
      secretLast4: row.secret_last4,
      status: row.status as WebhookTriggerStatus,
      triggerRegistrationId: row.trigger_registration_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

export function createWebhookTriggerStore(connection: ConnectionManager): WebhookTriggerStore {
  return new WebhookTriggerStoreImpl(connection);
}
