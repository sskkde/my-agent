import type { ConnectionManager } from './connection.js';
import type { WorkflowDraft, WorkflowStep, ValidationIssue, WorkflowDraftStatus } from '../workflows/types.js';

export interface WorkflowDraftStore {
  createDraft(draft: Omit<WorkflowDraft, 'createdAt' | 'updatedAt'>): WorkflowDraft;
  getDraftById(draftId: string): WorkflowDraft | null;
  getDraftsByOwner(ownerUserId: string): WorkflowDraft[];
  getDraftsByStatus(status: WorkflowDraftStatus): WorkflowDraft[];
  updateDraft(draftId: string, updates: Partial<Omit<WorkflowDraft, 'draftId' | 'createdAt' | 'updatedAt'>>): WorkflowDraft | null;
  deleteDraft(draftId: string): boolean;
  addValidationIssues(draftId: string, issues: ValidationIssue[]): void;
  clearValidationIssues(draftId: string): void;
}

class WorkflowDraftStoreImpl implements WorkflowDraftStore {
  private connection: ConnectionManager;

  constructor(connection: ConnectionManager) {
    this.connection = connection;
  }

  createDraft(draft: Omit<WorkflowDraft, 'createdAt' | 'updatedAt'>): WorkflowDraft {
    const now = new Date().toISOString();

    this.connection.exec(
      `INSERT INTO workflow_drafts (
        draft_id, name, description, steps, owner_user_id,
        status, validation_issues, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        draft.draftId,
        draft.name,
        draft.description ?? null,
        JSON.stringify(draft.steps),
        draft.ownerUserId,
        draft.status,
        JSON.stringify(draft.validationIssues),
        now,
        now,
      ]
    );

    return {
      ...draft,
      createdAt: now,
      updatedAt: now,
    };
  }

  getDraftById(draftId: string): WorkflowDraft | null {
    const results = this.connection.query<{
      draft_id: string;
      name: string;
      description: string | null;
      steps: string;
      owner_user_id: string;
      status: string;
      validation_issues: string;
      created_at: string;
      updated_at: string;
    }>(
      `SELECT * FROM workflow_drafts WHERE draft_id = ?`,
      [draftId]
    );

    if (results.length === 0) {
      return null;
    }

    return this.mapRowToDraft(results[0]);
  }

  getDraftsByOwner(ownerUserId: string): WorkflowDraft[] {
    const results = this.connection.query<{
      draft_id: string;
      name: string;
      description: string | null;
      steps: string;
      owner_user_id: string;
      status: string;
      validation_issues: string;
      created_at: string;
      updated_at: string;
    }>(
      `SELECT * FROM workflow_drafts WHERE owner_user_id = ? ORDER BY updated_at DESC`,
      [ownerUserId]
    );

    return results.map(row => this.mapRowToDraft(row));
  }

  getDraftsByStatus(status: WorkflowDraftStatus): WorkflowDraft[] {
    const results = this.connection.query<{
      draft_id: string;
      name: string;
      description: string | null;
      steps: string;
      owner_user_id: string;
      status: string;
      validation_issues: string;
      created_at: string;
      updated_at: string;
    }>(
      `SELECT * FROM workflow_drafts WHERE status = ? ORDER BY updated_at DESC`,
      [status]
    );

    return results.map(row => this.mapRowToDraft(row));
  }

  updateDraft(
    draftId: string,
    updates: Partial<Omit<WorkflowDraft, 'draftId' | 'createdAt' | 'updatedAt'>>
  ): WorkflowDraft | null {
    const existing = this.getDraftById(draftId);
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
    if (updates.validationIssues !== undefined) {
      updateFields.push('validation_issues = ?');
      values.push(JSON.stringify(updates.validationIssues));
    }

    if (updateFields.length === 0) {
      return existing;
    }

    const now = new Date().toISOString();
    updateFields.push('updated_at = ?');
    values.push(now);
    values.push(draftId);

    this.connection.exec(
      `UPDATE workflow_drafts SET ${updateFields.join(', ')} WHERE draft_id = ?`,
      values
    );

    return this.getDraftById(draftId);
  }

  deleteDraft(draftId: string): boolean {
    const existing = this.getDraftById(draftId);
    if (!existing) {
      return false;
    }

    this.connection.exec(
      `DELETE FROM workflow_drafts WHERE draft_id = ?`,
      [draftId]
    );

    return this.getDraftById(draftId) === null;
  }

  addValidationIssues(draftId: string, issues: ValidationIssue[]): void {
    const draft = this.getDraftById(draftId);
    if (!draft) {
      throw new Error(`Draft not found: ${draftId}`);
    }

    const updatedIssues = [...draft.validationIssues, ...issues];
    const now = new Date().toISOString();

    this.connection.exec(
      `UPDATE workflow_drafts SET validation_issues = ?, status = ?, updated_at = ? WHERE draft_id = ?`,
      [JSON.stringify(updatedIssues), 'invalid', now, draftId]
    );
  }

  clearValidationIssues(draftId: string): void {
    const draft = this.getDraftById(draftId);
    if (!draft) {
      throw new Error(`Draft not found: ${draftId}`);
    }

    const now = new Date().toISOString();

    this.connection.exec(
      `UPDATE workflow_drafts SET validation_issues = ?, status = ?, updated_at = ? WHERE draft_id = ?`,
      [JSON.stringify([]), 'draft', now, draftId]
    );
  }

  private mapRowToDraft(row: {
    draft_id: string;
    name: string;
    description: string | null;
    steps: string;
    owner_user_id: string;
    status: string;
    validation_issues: string;
    created_at: string;
    updated_at: string;
  }): WorkflowDraft {
    return {
      draftId: row.draft_id,
      name: row.name,
      description: row.description ?? undefined,
      steps: JSON.parse(row.steps) as WorkflowStep[],
      ownerUserId: row.owner_user_id,
      status: row.status as WorkflowDraftStatus,
      validationIssues: JSON.parse(row.validation_issues) as ValidationIssue[],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

export function createWorkflowDraftStore(connection: ConnectionManager): WorkflowDraftStore {
  return new WorkflowDraftStoreImpl(connection);
}
