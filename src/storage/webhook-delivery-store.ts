import type { ConnectionManager } from './connection.js';

export const WEBHOOK_DELIVERY_STATUSES = {
  ACCEPTED: 'accepted',
  DUPLICATE: 'duplicate',
  REJECTED: 'rejected',
} as const;

export type WebhookDeliveryStatus = typeof WEBHOOK_DELIVERY_STATUSES[keyof typeof WEBHOOK_DELIVERY_STATUSES];

export interface WebhookDelivery {
  deliveryId: string;
  webhookId: string;
  eventId?: string | null;
  receivedAt: string;
  status: WebhookDeliveryStatus;
}

export interface CreateWebhookDelivery {
  deliveryId: string;
  webhookId: string;
  eventId?: string;
  status: WebhookDeliveryStatus;
}

export interface WebhookDeliveryStore {
  create(delivery: CreateWebhookDelivery): WebhookDelivery;
  exists(webhookId: string, deliveryId: string): boolean;
  findByWebhook(webhookId: string, limit?: number): WebhookDelivery[];
}

interface WebhookDeliveryRow {
  delivery_id: string;
  webhook_id: string;
  event_id: string | null;
  received_at: string;
  status: string;
}

class WebhookDeliveryStoreImpl implements WebhookDeliveryStore {
  private connection: ConnectionManager;

  constructor(connection: ConnectionManager) {
    this.connection = connection;
  }

  create(delivery: CreateWebhookDelivery): WebhookDelivery {
    const now = new Date().toISOString();
    const record: WebhookDelivery = {
      deliveryId: delivery.deliveryId,
      webhookId: delivery.webhookId,
      eventId: delivery.eventId ?? null,
      receivedAt: now,
      status: delivery.status,
    };

    this.connection.exec(
      `INSERT INTO webhook_deliveries (
        delivery_id, webhook_id, event_id, received_at, status
      ) VALUES (?, ?, ?, ?, ?)`,
      [
        record.deliveryId,
        record.webhookId,
        record.eventId,
        record.receivedAt,
        record.status,
      ]
    );

    return record;
  }

  exists(webhookId: string, deliveryId: string): boolean {
    const results = this.connection.query<{ count: number }>(
      'SELECT COUNT(*) as count FROM webhook_deliveries WHERE webhook_id = ? AND delivery_id = ?',
      [webhookId, deliveryId]
    );
    return results.length > 0 && (results[0]?.count ?? 0) > 0;
  }

  findByWebhook(webhookId: string, limit = 100): WebhookDelivery[] {
    const results = this.connection.query<WebhookDeliveryRow>(
      'SELECT * FROM webhook_deliveries WHERE webhook_id = ? ORDER BY received_at DESC LIMIT ?',
      [webhookId, limit]
    );
    return results.map(row => this.rowToDelivery(row));
  }

  private rowToDelivery(row: WebhookDeliveryRow): WebhookDelivery {
    return {
      deliveryId: row.delivery_id,
      webhookId: row.webhook_id,
      eventId: row.event_id,
      receivedAt: row.received_at,
      status: row.status as WebhookDeliveryStatus,
    };
  }
}

export function createWebhookDeliveryStore(connection: ConnectionManager): WebhookDeliveryStore {
  return new WebhookDeliveryStoreImpl(connection);
}
