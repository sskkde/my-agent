import type { ConnectionManager } from './connection.js';
import type { MigrationRunner, Migration } from './migrations.js';
import { DEFAULT_TENANT_ID } from '../tenancy/tenant-context.js';

export type ConnectorType = 'api' | 'messaging' | 'storage' | 'database' | 'custom';
export type ConnectorStatus = 'draft' | 'active' | 'deprecated' | 'inactive';

export interface ConnectorDefinition {
  id: string;
  connectorId: string;
  name: string;
  connectorType: ConnectorType;
  version: string;
  description?: string;
  capabilities: string[];
  configSchema?: Record<string, unknown>;
  status: ConnectorStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ConnectorInstance {
  id: string;
  connectorInstanceId: string;
  connectorDefinitionId: string;
  userId: string;
  name: string;
  authStateRef: string;
  config?: Record<string, unknown>;
  status: ConnectorStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ConnectorEvent {
  id: string;
  eventId: string;
  connectorInstanceId: string;
  eventType: string;
  payload?: Record<string, unknown>;
  processed: boolean;
  createdAt: string;
}

export interface ConnectorStore {
  applyMigrations(runner: MigrationRunner): void;

  createDefinition(data: Omit<ConnectorDefinition, 'id' | 'createdAt' | 'updatedAt'>, tenantId?: string): ConnectorDefinition;
  findDefinitionById(id: string, tenantId?: string): ConnectorDefinition | undefined;
  findDefinitionByConnectorId(connectorId: string, tenantId?: string): ConnectorDefinition | undefined;
  findDefinitionsByType(connectorType: ConnectorType, tenantId?: string): ConnectorDefinition[];
  updateDefinition(id: string, data: Partial<Omit<ConnectorDefinition, 'id' | 'createdAt' | 'updatedAt'>>, tenantId?: string): ConnectorDefinition | undefined;

  createInstance(data: Omit<ConnectorInstance, 'id' | 'createdAt' | 'updatedAt'>, tenantId?: string): ConnectorInstance;
  findInstanceById(id: string, tenantId?: string): ConnectorInstance | undefined;
  findInstancesByUserAndConnector(userId: string, connectorDefinitionId: string, tenantId?: string): ConnectorInstance[];
  findInstancesByStatus(status: ConnectorStatus, tenantId?: string): ConnectorInstance[];
  updateInstance(id: string, data: Partial<Omit<ConnectorInstance, 'id' | 'createdAt' | 'updatedAt'>>, tenantId?: string): ConnectorInstance | undefined;
  deleteInstance(id: string, tenantId?: string): boolean;

  createEvent(data: Omit<ConnectorEvent, 'id' | 'createdAt'>, tenantId?: string): ConnectorEvent;
  findEventsByInstanceId(connectorInstanceId: string, tenantId?: string): ConnectorEvent[];
  findEventsByProcessedStatus(processed: boolean, tenantId?: string): ConnectorEvent[];
  markEventProcessed(id: string, tenantId?: string): ConnectorEvent | undefined;
}

class ConnectorStoreImpl implements ConnectorStore {
  private connection: ConnectionManager;

  constructor(connection: ConnectionManager) {
    this.connection = connection;
  }

  applyMigrations(runner: MigrationRunner): void {
    const migrations: Migration[] = [
      {
        version: 3,
        name: 'create_connector_definitions_table',
        up: `
          CREATE TABLE connector_definitions (
            id TEXT PRIMARY KEY,
            connector_id TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL,
            connector_type TEXT NOT NULL CHECK(connector_type IN ('api', 'messaging', 'storage', 'database', 'custom')),
            version TEXT NOT NULL,
            description TEXT,
            capabilities TEXT NOT NULL,
            config_schema TEXT,
            status TEXT NOT NULL CHECK(status IN ('draft', 'active', 'deprecated', 'inactive')),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            tenant_id TEXT NOT NULL DEFAULT 'org_default'
          );
          CREATE INDEX idx_connector_defs_type ON connector_definitions(connector_type);
          CREATE INDEX idx_connector_defs_status ON connector_definitions(status);
        `,
        down: `
          DROP INDEX IF EXISTS idx_connector_defs_status;
          DROP INDEX IF EXISTS idx_connector_defs_type;
          DROP TABLE IF EXISTS connector_definitions;
        `
      },
      {
        version: 4,
        name: 'create_connector_instances_table',
        up: `
          CREATE TABLE connector_instances (
            id TEXT PRIMARY KEY,
            connector_instance_id TEXT NOT NULL UNIQUE,
            connector_definition_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            name TEXT NOT NULL,
            auth_state_ref TEXT NOT NULL,
            config TEXT,
            status TEXT NOT NULL CHECK(status IN ('draft', 'active', 'deprecated', 'inactive')),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            tenant_id TEXT NOT NULL DEFAULT 'org_default'
          );
          CREATE INDEX idx_connector_instances_user_def ON connector_instances(user_id, connector_definition_id);
          CREATE INDEX idx_connector_instances_status ON connector_instances(status);
          CREATE INDEX idx_connector_instances_def_id ON connector_instances(connector_definition_id);
        `,
        down: `
          DROP INDEX IF EXISTS idx_connector_instances_def_id;
          DROP INDEX IF EXISTS idx_connector_instances_status;
          DROP INDEX IF EXISTS idx_connector_instances_user_def;
          DROP TABLE IF EXISTS connector_instances;
        `
      },
      {
        version: 5,
        name: 'create_connector_events_table',
        up: `
          CREATE TABLE connector_events (
            id TEXT PRIMARY KEY,
            event_id TEXT NOT NULL UNIQUE,
            connector_instance_id TEXT NOT NULL,
            event_type TEXT NOT NULL,
            payload TEXT,
            processed INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            tenant_id TEXT NOT NULL DEFAULT 'org_default'
          );
          CREATE INDEX idx_connector_events_instance ON connector_events(connector_instance_id);
          CREATE INDEX idx_connector_events_processed ON connector_events(processed);
          CREATE INDEX idx_connector_events_type ON connector_events(event_type);
        `,
        down: `
          DROP INDEX IF EXISTS idx_connector_events_type;
          DROP INDEX IF EXISTS idx_connector_events_processed;
          DROP INDEX IF EXISTS idx_connector_events_instance;
          DROP TABLE IF EXISTS connector_events;
        `
      }
    ];
    runner.apply(migrations);
  }

  createDefinition(data: Omit<ConnectorDefinition, 'id' | 'createdAt' | 'updatedAt'>, tenantId: string = DEFAULT_TENANT_ID): ConnectorDefinition {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    this.connection.exec(
      `INSERT INTO connector_definitions (
        id, connector_id, name, connector_type, version, description,
        capabilities, config_schema, status, created_at, updated_at, tenant_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        data.connectorId,
        data.name,
        data.connectorType,
        data.version,
        data.description ?? null,
        JSON.stringify(data.capabilities),
        data.configSchema ? JSON.stringify(data.configSchema) : null,
        data.status,
        now,
        now,
        tenantId
      ]
    );

    return {
      ...data,
      id,
      createdAt: now,
      updatedAt: now
    };
  }

  findDefinitionById(id: string, tenantId: string = DEFAULT_TENANT_ID): ConnectorDefinition | undefined {
    const rows = this.connection.query<{
      id: string;
      connector_id: string;
      name: string;
      connector_type: ConnectorType;
      version: string;
      description: string | null;
      capabilities: string;
      config_schema: string | null;
      status: ConnectorStatus;
      created_at: string;
      updated_at: string;
    }>('SELECT * FROM connector_definitions WHERE tenant_id = ? AND id = ?', [tenantId, id]);

    if (rows.length === 0) {
      return undefined;
    }

    return this.mapDefinitionRow(rows[0]);
  }

  findDefinitionByConnectorId(connectorId: string, tenantId: string = DEFAULT_TENANT_ID): ConnectorDefinition | undefined {
    const rows = this.connection.query<{
      id: string;
      connector_id: string;
      name: string;
      connector_type: ConnectorType;
      version: string;
      description: string | null;
      capabilities: string;
      config_schema: string | null;
      status: ConnectorStatus;
      created_at: string;
      updated_at: string;
    }>('SELECT * FROM connector_definitions WHERE tenant_id = ? AND connector_id = ?', [tenantId, connectorId]);

    if (rows.length === 0) {
      return undefined;
    }

    return this.mapDefinitionRow(rows[0]);
  }

  findDefinitionsByType(connectorType: ConnectorType, tenantId: string = DEFAULT_TENANT_ID): ConnectorDefinition[] {
    const rows = this.connection.query<{
      id: string;
      connector_id: string;
      name: string;
      connector_type: ConnectorType;
      version: string;
      description: string | null;
      capabilities: string;
      config_schema: string | null;
      status: ConnectorStatus;
      created_at: string;
      updated_at: string;
    }>('SELECT * FROM connector_definitions WHERE tenant_id = ? AND connector_type = ?', [tenantId, connectorType]);

    return rows.map(row => this.mapDefinitionRow(row));
  }

  updateDefinition(id: string, data: Partial<Omit<ConnectorDefinition, 'id' | 'createdAt' | 'updatedAt'>>, tenantId: string = DEFAULT_TENANT_ID): ConnectorDefinition | undefined {
    const existing = this.findDefinitionById(id, tenantId);
    if (!existing) {
      return undefined;
    }

    const updates: string[] = [];
    const values: unknown[] = [];

    if (data.connectorId !== undefined) {
      updates.push('connector_id = ?');
      values.push(data.connectorId);
    }
    if (data.name !== undefined) {
      updates.push('name = ?');
      values.push(data.name);
    }
    if (data.connectorType !== undefined) {
      updates.push('connector_type = ?');
      values.push(data.connectorType);
    }
    if (data.version !== undefined) {
      updates.push('version = ?');
      values.push(data.version);
    }
    if (data.description !== undefined) {
      updates.push('description = ?');
      values.push(data.description);
    }
    if (data.capabilities !== undefined) {
      updates.push('capabilities = ?');
      values.push(JSON.stringify(data.capabilities));
    }
    if (data.configSchema !== undefined) {
      updates.push('config_schema = ?');
      values.push(JSON.stringify(data.configSchema));
    }
    if (data.status !== undefined) {
      updates.push('status = ?');
      values.push(data.status);
    }

    if (updates.length === 0) {
      return existing;
    }

    const updatedAt = new Date().toISOString();
    updates.push('updated_at = ?');
    values.push(updatedAt);
    values.push(tenantId);
    values.push(id);

    this.connection.exec(
      `UPDATE connector_definitions SET ${updates.join(', ')} WHERE tenant_id = ? AND id = ?`,
      values
    );

    return this.findDefinitionById(id, tenantId);
  }

  createInstance(data: Omit<ConnectorInstance, 'id' | 'createdAt' | 'updatedAt'>, tenantId: string = DEFAULT_TENANT_ID): ConnectorInstance {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    this.connection.exec(
      `INSERT INTO connector_instances (
        id, connector_instance_id, connector_definition_id, user_id, name,
        auth_state_ref, config, status, created_at, updated_at, tenant_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        data.connectorInstanceId,
        data.connectorDefinitionId,
        data.userId,
        data.name,
        data.authStateRef,
        data.config ? JSON.stringify(data.config) : null,
        data.status,
        now,
        now,
        tenantId
      ]
    );

    return {
      ...data,
      id,
      createdAt: now,
      updatedAt: now
    };
  }

  findInstanceById(id: string, tenantId: string = DEFAULT_TENANT_ID): ConnectorInstance | undefined {
    const rows = this.connection.query<{
      id: string;
      connector_instance_id: string;
      connector_definition_id: string;
      user_id: string;
      name: string;
      auth_state_ref: string;
      config: string | null;
      status: ConnectorStatus;
      created_at: string;
      updated_at: string;
    }>('SELECT * FROM connector_instances WHERE tenant_id = ? AND id = ?', [tenantId, id]);

    if (rows.length === 0) {
      return undefined;
    }

    return this.mapInstanceRow(rows[0]);
  }

  findInstancesByUserAndConnector(userId: string, connectorDefinitionId: string, tenantId: string = DEFAULT_TENANT_ID): ConnectorInstance[] {
    const rows = this.connection.query<{
      id: string;
      connector_instance_id: string;
      connector_definition_id: string;
      user_id: string;
      name: string;
      auth_state_ref: string;
      config: string | null;
      status: ConnectorStatus;
      created_at: string;
      updated_at: string;
    }>('SELECT * FROM connector_instances WHERE tenant_id = ? AND user_id = ? AND connector_definition_id = ?', [tenantId, userId, connectorDefinitionId]);

    return rows.map(row => this.mapInstanceRow(row));
  }

  findInstancesByStatus(status: ConnectorStatus, tenantId: string = DEFAULT_TENANT_ID): ConnectorInstance[] {
    const rows = this.connection.query<{
      id: string;
      connector_instance_id: string;
      connector_definition_id: string;
      user_id: string;
      name: string;
      auth_state_ref: string;
      config: string | null;
      status: ConnectorStatus;
      created_at: string;
      updated_at: string;
    }>('SELECT * FROM connector_instances WHERE tenant_id = ? AND status = ?', [tenantId, status]);

    return rows.map(row => this.mapInstanceRow(row));
  }

  updateInstance(id: string, data: Partial<Omit<ConnectorInstance, 'id' | 'createdAt' | 'updatedAt'>>, tenantId: string = DEFAULT_TENANT_ID): ConnectorInstance | undefined {
    const existing = this.findInstanceById(id, tenantId);
    if (!existing) {
      return undefined;
    }

    const updates: string[] = [];
    const values: unknown[] = [];

    if (data.connectorInstanceId !== undefined) {
      updates.push('connector_instance_id = ?');
      values.push(data.connectorInstanceId);
    }
    if (data.connectorDefinitionId !== undefined) {
      updates.push('connector_definition_id = ?');
      values.push(data.connectorDefinitionId);
    }
    if (data.userId !== undefined) {
      updates.push('user_id = ?');
      values.push(data.userId);
    }
    if (data.name !== undefined) {
      updates.push('name = ?');
      values.push(data.name);
    }
    if (data.authStateRef !== undefined) {
      updates.push('auth_state_ref = ?');
      values.push(data.authStateRef);
    }
    if (data.config !== undefined) {
      updates.push('config = ?');
      values.push(JSON.stringify(data.config));
    }
    if (data.status !== undefined) {
      updates.push('status = ?');
      values.push(data.status);
    }

    if (updates.length === 0) {
      return existing;
    }

    const updatedAt = new Date().toISOString();
    updates.push('updated_at = ?');
    values.push(updatedAt);
    values.push(tenantId);
    values.push(id);

    this.connection.exec(
      `UPDATE connector_instances SET ${updates.join(', ')} WHERE tenant_id = ? AND id = ?`,
      values
    );

    return this.findInstanceById(id, tenantId);
  }

  deleteInstance(id: string, tenantId: string = DEFAULT_TENANT_ID): boolean {
    const before = this.findInstanceById(id, tenantId);
    if (!before) {
      return false;
    }
    this.connection.exec('DELETE FROM connector_instances WHERE tenant_id = ? AND id = ?', [tenantId, id]);
    return this.findInstanceById(id, tenantId) === undefined;
  }

  createEvent(data: Omit<ConnectorEvent, 'id' | 'createdAt'>, tenantId: string = DEFAULT_TENANT_ID): ConnectorEvent {
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();

    this.connection.exec(
      `INSERT INTO connector_events (
        id, event_id, connector_instance_id, event_type, payload, processed, created_at, tenant_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        data.eventId,
        data.connectorInstanceId,
        data.eventType,
        data.payload ? JSON.stringify(data.payload) : null,
        data.processed ? 1 : 0,
        createdAt,
        tenantId
      ]
    );

    return {
      ...data,
      id,
      createdAt
    };
  }

  findEventsByInstanceId(connectorInstanceId: string, tenantId: string = DEFAULT_TENANT_ID): ConnectorEvent[] {
    const rows = this.connection.query<{
      id: string;
      event_id: string;
      connector_instance_id: string;
      event_type: string;
      payload: string | null;
      processed: number;
      created_at: string;
    }>('SELECT * FROM connector_events WHERE tenant_id = ? AND connector_instance_id = ?', [tenantId, connectorInstanceId]);

    return rows.map(row => this.mapEventRow(row));
  }

  findEventsByProcessedStatus(processed: boolean, tenantId: string = DEFAULT_TENANT_ID): ConnectorEvent[] {
    const rows = this.connection.query<{
      id: string;
      event_id: string;
      connector_instance_id: string;
      event_type: string;
      payload: string | null;
      processed: number;
      created_at: string;
    }>('SELECT * FROM connector_events WHERE tenant_id = ? AND processed = ?', [tenantId, processed ? 1 : 0]);

    return rows.map(row => this.mapEventRow(row));
  }

  markEventProcessed(id: string, tenantId: string = DEFAULT_TENANT_ID): ConnectorEvent | undefined {
    this.connection.exec(
      'UPDATE connector_events SET processed = 1 WHERE tenant_id = ? AND id = ?',
      [tenantId, id]
    );

    const rows = this.connection.query<{
      id: string;
      event_id: string;
      connector_instance_id: string;
      event_type: string;
      payload: string | null;
      processed: number;
      created_at: string;
    }>('SELECT * FROM connector_events WHERE tenant_id = ? AND id = ?', [tenantId, id]);

    if (rows.length === 0) {
      return undefined;
    }

    return this.mapEventRow(rows[0]);
  }

  private mapDefinitionRow(row: {
    id: string;
    connector_id: string;
    name: string;
    connector_type: ConnectorType;
    version: string;
    description: string | null;
    capabilities: string;
    config_schema: string | null;
    status: ConnectorStatus;
    created_at: string;
    updated_at: string;
  }): ConnectorDefinition {
    return {
      id: row.id,
      connectorId: row.connector_id,
      name: row.name,
      connectorType: row.connector_type,
      version: row.version,
      description: row.description ?? undefined,
      capabilities: JSON.parse(row.capabilities),
      configSchema: row.config_schema ? JSON.parse(row.config_schema) : undefined,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  private mapInstanceRow(row: {
    id: string;
    connector_instance_id: string;
    connector_definition_id: string;
    user_id: string;
    name: string;
    auth_state_ref: string;
    config: string | null;
    status: ConnectorStatus;
    created_at: string;
    updated_at: string;
  }): ConnectorInstance {
    return {
      id: row.id,
      connectorInstanceId: row.connector_instance_id,
      connectorDefinitionId: row.connector_definition_id,
      userId: row.user_id,
      name: row.name,
      authStateRef: row.auth_state_ref,
      config: row.config ? JSON.parse(row.config) : undefined,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  private mapEventRow(row: {
    id: string;
    event_id: string;
    connector_instance_id: string;
    event_type: string;
    payload: string | null;
    processed: number;
    created_at: string;
  }): ConnectorEvent {
    return {
      id: row.id,
      eventId: row.event_id,
      connectorInstanceId: row.connector_instance_id,
      eventType: row.event_type,
      payload: row.payload ? JSON.parse(row.payload) : undefined,
      processed: row.processed === 1,
      createdAt: row.created_at
    };
  }
}

export function createConnectorStore(connection: ConnectionManager): ConnectorStore {
  return new ConnectorStoreImpl(connection);
}
