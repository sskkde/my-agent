import type { ConnectionManager } from './connection.js';

export const TRIGGER_STATUSES = {
  ACTIVE: 'active',
  PAUSED: 'paused',
  EXPIRED: 'expired',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
} as const;

export type TriggerStatus = typeof TRIGGER_STATUSES[keyof typeof TRIGGER_STATUSES];

export interface TriggerRegistration {
  id: string;
  triggerType: string;
  conditionType: string;
  conditionPattern: string;
  targetType: string;
  targetRef: string;
  status: TriggerStatus;
  priority: number;
  maxTriggers?: number | null;
  triggerCount: number;
  expiresAt?: string | null;
  metadata?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTriggerRegistration {
  id: string;
  triggerType: string;
  conditionType: string;
  conditionPattern: string;
  targetType: string;
  targetRef: string;
  status: TriggerStatus;
  priority?: number;
  maxTriggers?: number;
  expiresAt?: string;
  metadata?: string;
}

export interface TriggerStore {
  create(trigger: CreateTriggerRegistration): TriggerRegistration;
  getById(id: string): TriggerRegistration | null;
  findByTarget(targetType: string, targetRef: string): TriggerRegistration[];
  findByStatus(status: TriggerStatus): TriggerRegistration[];
  incrementTriggerCount(id: string): TriggerRegistration;
  updateStatus(id: string, status: TriggerStatus): TriggerRegistration;
  updateMetadata(id: string, metadata: string): TriggerRegistration;
  findExpired(before: string): TriggerRegistration[];
  delete(id: string): void;
}

class TriggerStoreImpl implements TriggerStore {
  private connection: ConnectionManager;

  constructor(connection: ConnectionManager) {
    this.connection = connection;
  }

  create(trigger: CreateTriggerRegistration): TriggerRegistration {
    const now = new Date().toISOString();
    const registration: TriggerRegistration = {
      id: trigger.id,
      triggerType: trigger.triggerType,
      conditionType: trigger.conditionType,
      conditionPattern: trigger.conditionPattern,
      targetType: trigger.targetType,
      targetRef: trigger.targetRef,
      status: trigger.status,
      priority: trigger.priority ?? 0,
      maxTriggers: trigger.maxTriggers ?? null,
      triggerCount: 0,
      expiresAt: trigger.expiresAt ?? null,
      metadata: trigger.metadata ?? null,
      createdAt: now,
      updatedAt: now,
    };

    this.connection.exec(
      `INSERT INTO trigger_registrations (
        id, trigger_type, condition_type, condition_pattern, target_type, target_ref,
        status, priority, max_triggers, trigger_count, expires_at, metadata, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        registration.id,
        registration.triggerType,
        registration.conditionType,
        registration.conditionPattern,
        registration.targetType,
        registration.targetRef,
        registration.status,
        registration.priority,
        registration.maxTriggers,
        registration.triggerCount,
        registration.expiresAt,
        registration.metadata,
        registration.createdAt,
        registration.updatedAt,
      ]
    );

    return registration;
  }

  getById(id: string): TriggerRegistration | null {
    const results = this.connection.query<TriggerRegistrationRow>(
      'SELECT * FROM trigger_registrations WHERE id = ?',
      [id]
    );

    if (results.length === 0) {
      return null;
    }

    return this.rowToRegistration(results[0]);
  }

  findByTarget(targetType: string, targetRef: string): TriggerRegistration[] {
    const results = this.connection.query<TriggerRegistrationRow>(
      'SELECT * FROM trigger_registrations WHERE target_type = ? AND target_ref = ?',
      [targetType, targetRef]
    );
    return results.map(row => this.rowToRegistration(row));
  }

  findByStatus(status: TriggerStatus): TriggerRegistration[] {
    const results = this.connection.query<TriggerRegistrationRow>(
      'SELECT * FROM trigger_registrations WHERE status = ?',
      [status]
    );
    return results.map(row => this.rowToRegistration(row));
  }

  incrementTriggerCount(id: string): TriggerRegistration {
    const existing = this.getById(id);
    if (!existing) {
      throw new Error(`Trigger registration not found: ${id}`);
    }

    const now = new Date().toISOString();
    const newCount = existing.triggerCount + 1;
    const status = existing.maxTriggers && newCount >= existing.maxTriggers
      ? TRIGGER_STATUSES.COMPLETED
      : existing.status;

    this.connection.exec(
      `UPDATE trigger_registrations SET
        trigger_count = ?,
        status = ?,
        updated_at = ?
      WHERE id = ?`,
      [newCount, status, now, id]
    );

    return {
      ...existing,
      triggerCount: newCount,
      status,
      updatedAt: now,
    };
  }

  updateStatus(id: string, status: TriggerStatus): TriggerRegistration {
    const existing = this.getById(id);
    if (!existing) {
      throw new Error(`Trigger registration not found: ${id}`);
    }

    const now = new Date().toISOString();

    this.connection.exec(
      'UPDATE trigger_registrations SET status = ?, updated_at = ? WHERE id = ?',
      [status, now, id]
    );

    return {
      ...existing,
      status,
      updatedAt: now,
    };
  }

  updateMetadata(id: string, metadata: string): TriggerRegistration {
    const existing = this.getById(id);
    if (!existing) {
      throw new Error(`Trigger registration not found: ${id}`);
    }

    const now = new Date().toISOString();
    this.connection.exec(
      'UPDATE trigger_registrations SET metadata = ?, updated_at = ? WHERE id = ?',
      [metadata, now, id]
    );

    return {
      ...existing,
      metadata,
      updatedAt: now,
    };
  }

  findExpired(before: string): TriggerRegistration[] {
    const results = this.connection.query<TriggerRegistrationRow>(
      'SELECT * FROM trigger_registrations WHERE expires_at IS NOT NULL AND expires_at < ?',
      [before]
    );
    return results.map(row => this.rowToRegistration(row));
  }

  delete(id: string): void {
    this.connection.exec('DELETE FROM trigger_registrations WHERE id = ?', [id]);
  }

  private rowToRegistration(row: TriggerRegistrationRow): TriggerRegistration {
    return {
      id: row.id,
      triggerType: row.trigger_type,
      conditionType: row.condition_type,
      conditionPattern: row.condition_pattern,
      targetType: row.target_type,
      targetRef: row.target_ref,
      status: row.status as TriggerStatus,
      priority: row.priority,
      maxTriggers: row.max_triggers,
      triggerCount: row.trigger_count,
      expiresAt: row.expires_at,
      metadata: row.metadata,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

interface TriggerRegistrationRow {
  id: string;
  trigger_type: string;
  condition_type: string;
  condition_pattern: string;
  target_type: string;
  target_ref: string;
  status: string;
  priority: number;
  max_triggers: number | null;
  trigger_count: number;
  expires_at: string | null;
  metadata: string | null;
  created_at: string;
  updated_at: string;
}

export function createTriggerStore(connection: ConnectionManager): TriggerStore {
  return new TriggerStoreImpl(connection);
}
