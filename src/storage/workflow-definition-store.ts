import type { ConnectionManager } from './connection.js';
import type { WorkflowDefinition, WorkflowStep, WorkflowDefinitionStatus } from '../workflows/types.js';

export interface WorkflowDefinitionStore {
  createDefinition(definition: Omit<WorkflowDefinition, 'createdAt' | 'updatedAt'>): WorkflowDefinition;
  getDefinitionById(workflowId: string): WorkflowDefinition | null;
  getDefinitionByNameAndVersion(name: string, version: number): WorkflowDefinition | null;
  getLatestDefinitionByName(name: string): WorkflowDefinition | null;
  getDefinitionsByOwner(ownerUserId: string): WorkflowDefinition[];
  getDefinitionsByStatus(status: WorkflowDefinitionStatus): WorkflowDefinition[];
  getNextVersionNumber(name: string): number;
  deprecateDefinition(workflowId: string): void;
  updateDefinition(workflowId: string, updates: Partial<Omit<WorkflowDefinition, 'workflowId' | 'createdAt' | 'updatedAt'>>): WorkflowDefinition | null;
}

class WorkflowDefinitionStoreImpl implements WorkflowDefinitionStore {
  private connection: ConnectionManager;

  constructor(connection: ConnectionManager) {
    this.connection = connection;
  }

  createDefinition(definition: Omit<WorkflowDefinition, 'createdAt' | 'updatedAt'>): WorkflowDefinition {
    const now = new Date().toISOString();

    this.connection.exec(
      `INSERT INTO workflow_definitions (
        workflow_id, name, description, version, steps,
        owner_user_id, status, published_from_draft_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        definition.workflowId,
        definition.name,
        definition.description ?? null,
        definition.version,
        JSON.stringify(definition.steps),
        definition.ownerUserId,
        definition.status,
        definition.publishedFromDraftId ?? null,
        now,
        now,
      ]
    );

    return {
      ...definition,
      createdAt: now,
      updatedAt: now,
    };
  }

  getDefinitionById(workflowId: string): WorkflowDefinition | null {
    const results = this.connection.query<{
      workflow_id: string;
      name: string;
      description: string | null;
      version: number;
      steps: string;
      owner_user_id: string;
      status: string;
      published_from_draft_id: string | null;
      created_at: string;
      updated_at: string;
    }>(
      `SELECT * FROM workflow_definitions WHERE workflow_id = ?`,
      [workflowId]
    );

    if (results.length === 0) {
      return null;
    }

    return this.mapRowToDefinition(results[0]);
  }

  getDefinitionByNameAndVersion(name: string, version: number): WorkflowDefinition | null {
    const results = this.connection.query<{
      workflow_id: string;
      name: string;
      description: string | null;
      version: number;
      steps: string;
      owner_user_id: string;
      status: string;
      published_from_draft_id: string | null;
      created_at: string;
      updated_at: string;
    }>(
      `SELECT * FROM workflow_definitions WHERE name = ? AND version = ?`,
      [name, version]
    );

    if (results.length === 0) {
      return null;
    }

    return this.mapRowToDefinition(results[0]);
  }

  getLatestDefinitionByName(name: string): WorkflowDefinition | null {
    const results = this.connection.query<{
      workflow_id: string;
      name: string;
      description: string | null;
      version: number;
      steps: string;
      owner_user_id: string;
      status: string;
      published_from_draft_id: string | null;
      created_at: string;
      updated_at: string;
    }>(
      `SELECT * FROM workflow_definitions WHERE name = ? ORDER BY version DESC LIMIT 1`,
      [name]
    );

    if (results.length === 0) {
      return null;
    }

    return this.mapRowToDefinition(results[0]);
  }

  getDefinitionsByOwner(ownerUserId: string): WorkflowDefinition[] {
    const results = this.connection.query<{
      workflow_id: string;
      name: string;
      description: string | null;
      version: number;
      steps: string;
      owner_user_id: string;
      status: string;
      published_from_draft_id: string | null;
      created_at: string;
      updated_at: string;
    }>(
      `SELECT * FROM workflow_definitions WHERE owner_user_id = ? ORDER BY updated_at DESC`,
      [ownerUserId]
    );

    return results.map(row => this.mapRowToDefinition(row));
  }

  getDefinitionsByStatus(status: WorkflowDefinitionStatus): WorkflowDefinition[] {
    const results = this.connection.query<{
      workflow_id: string;
      name: string;
      description: string | null;
      version: number;
      steps: string;
      owner_user_id: string;
      status: string;
      published_from_draft_id: string | null;
      created_at: string;
      updated_at: string;
    }>(
      `SELECT * FROM workflow_definitions WHERE status = ? ORDER BY updated_at DESC`,
      [status]
    );

    return results.map(row => this.mapRowToDefinition(row));
  }

  getNextVersionNumber(name: string): number {
    const results = this.connection.query<{ max_version: number | null }>(
      `SELECT MAX(version) as max_version FROM workflow_definitions WHERE name = ?`,
      [name]
    );

    const maxVersion = results[0]?.max_version ?? 0;
    return maxVersion + 1;
  }

  deprecateDefinition(workflowId: string): void {
    const now = new Date().toISOString();

    this.connection.exec(
      `UPDATE workflow_definitions SET status = ?, updated_at = ? WHERE workflow_id = ?`,
      ['deprecated', now, workflowId]
    );
  }

  updateDefinition(
    workflowId: string,
    updates: Partial<Omit<WorkflowDefinition, 'workflowId' | 'createdAt' | 'updatedAt'>>
  ): WorkflowDefinition | null {
    const existing = this.getDefinitionById(workflowId);
    if (!existing) {
      return null;
    }

    const updateFields: string[] = [];
    const values: unknown[] = [];

    if (updates.name !== undefined) {
      updateFields.push('name = ?');
      values.push(updates.name);
    }
    if (updates.description !== undefined) {
      updateFields.push('description = ?');
      values.push(updates.description);
    }
    if (updates.steps !== undefined) {
      updateFields.push('steps = ?');
      values.push(JSON.stringify(updates.steps));
    }
    if (updates.ownerUserId !== undefined) {
      updateFields.push('owner_user_id = ?');
      values.push(updates.ownerUserId);
    }
    if (updates.status !== undefined) {
      updateFields.push('status = ?');
      values.push(updates.status);
    }
    if (updates.publishedFromDraftId !== undefined) {
      updateFields.push('published_from_draft_id = ?');
      values.push(updates.publishedFromDraftId);
    }

    if (updateFields.length === 0) {
      return existing;
    }

    const now = new Date().toISOString();
    updateFields.push('updated_at = ?');
    values.push(now);
    values.push(workflowId);

    this.connection.exec(
      `UPDATE workflow_definitions SET ${updateFields.join(', ')} WHERE workflow_id = ?`,
      values
    );

    return this.getDefinitionById(workflowId);
  }

  private mapRowToDefinition(row: {
    workflow_id: string;
    name: string;
    description: string | null;
    version: number;
    steps: string;
    owner_user_id: string;
    status: string;
    published_from_draft_id: string | null;
    created_at: string;
    updated_at: string;
  }): WorkflowDefinition {
    return {
      workflowId: row.workflow_id,
      name: row.name,
      description: row.description ?? undefined,
      version: row.version,
      steps: JSON.parse(row.steps) as WorkflowStep[],
      ownerUserId: row.owner_user_id,
      status: row.status as WorkflowDefinitionStatus,
      publishedFromDraftId: row.published_from_draft_id ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

export function createWorkflowDefinitionStore(connection: ConnectionManager): WorkflowDefinitionStore {
  return new WorkflowDefinitionStoreImpl(connection);
}
