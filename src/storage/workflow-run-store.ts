import type { ConnectionManager } from './connection.js';
import type { WorkflowRunState } from '../shared/states.js';
import { DEFAULT_TENANT_ID } from '../tenancy/tenant-context.js';

export type WorkflowStepType = 'agent_run' | 'subagent_run' | 'tool_call' | 'approval' | 'wait' | 'condition' | 'branch' | 'parallel_group' | 'polling_wait';

export interface WorkflowRun {
  workflowRunId: string;
  workflowId: string;
  workflowVersion: string;
  ownerUserId: string;
  triggerEventId?: string;
  status: WorkflowRunState;
  currentStepIds?: string[];
  inputData?: unknown;
  outputData?: unknown;
  contextData?: unknown;
  startedAt?: string;
  completedAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface WorkflowStepRun {
  stepRunId: string;
  workflowRunId: string;
  stepId: string;
  stepType: WorkflowStepType;
  status: WorkflowRunState;
  kernelRunId?: string;
  subagentRunId?: string;
  toolCallId?: string;
  approvalId?: string;
  inputData?: unknown;
  outputData?: unknown;
  errorMessage?: string;
  startedAt?: string;
  completedAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface WorkflowRunStore {
  createWorkflowRun(run: Omit<WorkflowRun, 'createdAt' | 'updatedAt'>, tenantId?: string): void;
  getWorkflowRunById(workflowRunId: string, tenantId?: string): WorkflowRun | null;
  updateWorkflowStatus(workflowRunId: string, status: WorkflowRunState, tenantId?: string): void;
  updateCurrentSteps(workflowRunId: string, stepIds: string[], tenantId?: string): void;
  saveWorkflowOutput(workflowRunId: string, output: unknown, tenantId?: string): void;
  getWorkflowRunsByWorkflow(workflowId: string, tenantId?: string): WorkflowRun[];
  getWorkflowRunsByOwnerAndStatus(ownerUserId: string, status: WorkflowRunState, tenantId?: string): WorkflowRun[];
  getWorkflowRunsByTrigger(triggerEventId: string, tenantId?: string): WorkflowRun[];
  createStepRun(step: Omit<WorkflowStepRun, 'createdAt' | 'updatedAt'>, tenantId?: string): void;
  getStepRunById(stepRunId: string, tenantId?: string): WorkflowStepRun | null;
  updateStepStatus(stepRunId: string, status: WorkflowRunState, tenantId?: string): void;
  saveStepOutput(stepRunId: string, output: unknown, tenantId?: string): void;
  linkStepToKernelRun(stepRunId: string, kernelRunId: string, tenantId?: string): void;
  linkStepToSubagentRun(stepRunId: string, subagentRunId: string, tenantId?: string): void;
  linkStepToToolCall(stepRunId: string, toolCallId: string, tenantId?: string): void;
  linkStepToApproval(stepRunId: string, approvalId: string, tenantId?: string): void;
  getStepsByWorkflowAndStatus(workflowRunId: string, status: WorkflowRunState, tenantId?: string): WorkflowStepRun[];
  getStepsByStepId(stepId: string, tenantId?: string): WorkflowStepRun[];
  getStepsByWorkflowRunId(workflowRunId: string, tenantId?: string): WorkflowStepRun[];
}

class WorkflowRunStoreImpl implements WorkflowRunStore {
  private connection: ConnectionManager;

  constructor(connection: ConnectionManager) {
    this.connection = connection;
  }

  createWorkflowRun(run: Omit<WorkflowRun, 'createdAt' | 'updatedAt'>, tenantId: string = DEFAULT_TENANT_ID): void {
    const now = new Date().toISOString();
    const startedAt = run.startedAt ?? now;
    this.connection.exec(
      `INSERT INTO workflow_runs (
        workflow_run_id, workflow_id, workflow_version, owner_user_id,
        trigger_event_id, status, current_step_ids, input_data, output_data,
        context_data, started_at, completed_at, created_at, updated_at, tenant_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        run.workflowRunId,
        run.workflowId,
        run.workflowVersion,
        run.ownerUserId,
        run.triggerEventId ?? null,
        run.status,
        run.currentStepIds ? JSON.stringify(run.currentStepIds) : null,
        run.inputData ? JSON.stringify(run.inputData) : null,
        run.outputData ? JSON.stringify(run.outputData) : null,
        run.contextData ? JSON.stringify(run.contextData) : null,
        startedAt,
        run.completedAt ?? null,
        now,
        now,
        tenantId,
      ]
    );
  }

  getWorkflowRunById(workflowRunId: string, tenantId: string = DEFAULT_TENANT_ID): WorkflowRun | null {
    const results = this.connection.query<{
      workflow_run_id: string;
      workflow_id: string;
      workflow_version: string;
      owner_user_id: string;
      trigger_event_id: string | null;
      status: string;
      current_step_ids: string | null;
      input_data: string | null;
      output_data: string | null;
      context_data: string | null;
      started_at: string;
      completed_at: string | null;
      created_at: string;
      updated_at: string;
    }>(
      `SELECT * FROM workflow_runs WHERE tenant_id = ? AND workflow_run_id = ?`,
      [tenantId, workflowRunId]
    );

    if (results.length === 0) {
      return null;
    }

    return this.mapRowToWorkflowRun(results[0]);
  }

  updateWorkflowStatus(workflowRunId: string, status: WorkflowRunState, tenantId: string = DEFAULT_TENANT_ID): void {
    const now = new Date().toISOString();
    const completedAt = ['completed', 'failed', 'cancelled', 'timeout'].includes(status) ? now : null;

    this.connection.exec(
      `UPDATE workflow_runs 
       SET status = ?, completed_at = COALESCE(?, completed_at), updated_at = ? 
       WHERE tenant_id = ? AND workflow_run_id = ?`,
      [status, completedAt, now, tenantId, workflowRunId]
    );
  }

  updateCurrentSteps(workflowRunId: string, stepIds: string[], tenantId: string = DEFAULT_TENANT_ID): void {
    const now = new Date().toISOString();
    this.connection.exec(
      `UPDATE workflow_runs SET current_step_ids = ?, updated_at = ? WHERE tenant_id = ? AND workflow_run_id = ?`,
      [JSON.stringify(stepIds), now, tenantId, workflowRunId]
    );
  }

  saveWorkflowOutput(workflowRunId: string, output: unknown, tenantId: string = DEFAULT_TENANT_ID): void {
    const now = new Date().toISOString();
    const completedAt = new Date().toISOString();
    this.connection.exec(
      `UPDATE workflow_runs 
       SET output_data = ?, completed_at = ?, updated_at = ? 
       WHERE tenant_id = ? AND workflow_run_id = ?`,
      [JSON.stringify(output), completedAt, now, tenantId, workflowRunId]
    );
  }

  getWorkflowRunsByWorkflow(workflowId: string, tenantId: string = DEFAULT_TENANT_ID): WorkflowRun[] {
    const results = this.connection.query<{
      workflow_run_id: string;
      workflow_id: string;
      workflow_version: string;
      owner_user_id: string;
      trigger_event_id: string | null;
      status: string;
      current_step_ids: string | null;
      input_data: string | null;
      output_data: string | null;
      context_data: string | null;
      started_at: string;
      completed_at: string | null;
      created_at: string;
      updated_at: string;
    }>(
      `SELECT * FROM workflow_runs WHERE tenant_id = ? AND workflow_id = ? ORDER BY started_at DESC`,
      [tenantId, workflowId]
    );

    return results.map(r => this.mapRowToWorkflowRun(r));
  }

  getWorkflowRunsByOwnerAndStatus(ownerUserId: string, status: WorkflowRunState, tenantId: string = DEFAULT_TENANT_ID): WorkflowRun[] {
    const results = this.connection.query<{
      workflow_run_id: string;
      workflow_id: string;
      workflow_version: string;
      owner_user_id: string;
      trigger_event_id: string | null;
      status: string;
      current_step_ids: string | null;
      input_data: string | null;
      output_data: string | null;
      context_data: string | null;
      started_at: string;
      completed_at: string | null;
      created_at: string;
      updated_at: string;
    }>(
      `SELECT * FROM workflow_runs WHERE tenant_id = ? AND owner_user_id = ? AND status = ? ORDER BY started_at DESC`,
      [tenantId, ownerUserId, status]
    );

    return results.map(r => this.mapRowToWorkflowRun(r));
  }

  getWorkflowRunsByTrigger(triggerEventId: string, tenantId: string = DEFAULT_TENANT_ID): WorkflowRun[] {
    const results = this.connection.query<{
      workflow_run_id: string;
      workflow_id: string;
      workflow_version: string;
      owner_user_id: string;
      trigger_event_id: string | null;
      status: string;
      current_step_ids: string | null;
      input_data: string | null;
      output_data: string | null;
      context_data: string | null;
      started_at: string;
      completed_at: string | null;
      created_at: string;
      updated_at: string;
    }>(
      `SELECT * FROM workflow_runs WHERE tenant_id = ? AND trigger_event_id = ? ORDER BY started_at DESC`,
      [tenantId, triggerEventId]
    );

    return results.map(r => this.mapRowToWorkflowRun(r));
  }

  createStepRun(step: Omit<WorkflowStepRun, 'createdAt' | 'updatedAt'>, tenantId: string = DEFAULT_TENANT_ID): void {
    const now = new Date().toISOString();
    this.connection.exec(
      `INSERT INTO workflow_step_runs (
        step_run_id, workflow_run_id, step_id, step_type, status,
        kernel_run_id, subagent_run_id, tool_call_id, approval_id,
        input_data, output_data, error_message, started_at, completed_at,
        created_at, updated_at, tenant_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        step.stepRunId,
        step.workflowRunId,
        step.stepId,
        step.stepType,
        step.status,
        step.kernelRunId ?? null,
        step.subagentRunId ?? null,
        step.toolCallId ?? null,
        step.approvalId ?? null,
        step.inputData ? JSON.stringify(step.inputData) : null,
        step.outputData ? JSON.stringify(step.outputData) : null,
        step.errorMessage ?? null,
        step.startedAt ?? null,
        step.completedAt ?? null,
        now,
        now,
        tenantId,
      ]
    );
  }

  getStepRunById(stepRunId: string, tenantId: string = DEFAULT_TENANT_ID): WorkflowStepRun | null {
    const results = this.connection.query<{
      step_run_id: string;
      workflow_run_id: string;
      step_id: string;
      step_type: string;
      status: string;
      kernel_run_id: string | null;
      subagent_run_id: string | null;
      tool_call_id: string | null;
      approval_id: string | null;
      input_data: string | null;
      output_data: string | null;
      error_message: string | null;
      started_at: string | null;
      completed_at: string | null;
      created_at: string;
      updated_at: string;
    }>(
      `SELECT * FROM workflow_step_runs WHERE tenant_id = ? AND step_run_id = ?`,
      [tenantId, stepRunId]
    );

    if (results.length === 0) {
      return null;
    }

    return this.mapRowToWorkflowStepRun(results[0]);
  }

  updateStepStatus(stepRunId: string, status: WorkflowRunState, tenantId: string = DEFAULT_TENANT_ID): void {
    const now = new Date().toISOString();
    const completedAt = ['completed', 'failed', 'cancelled', 'skipped', 'timeout'].includes(status) ? now : null;

    this.connection.exec(
      `UPDATE workflow_step_runs 
       SET status = ?, completed_at = COALESCE(?, completed_at), updated_at = ? 
       WHERE tenant_id = ? AND step_run_id = ?`,
      [status, completedAt, now, tenantId, stepRunId]
    );
  }

  saveStepOutput(stepRunId: string, output: unknown, tenantId: string = DEFAULT_TENANT_ID): void {
    const now = new Date().toISOString();
    this.connection.exec(
      `UPDATE workflow_step_runs SET output_data = ?, updated_at = ? WHERE tenant_id = ? AND step_run_id = ?`,
      [JSON.stringify(output), now, tenantId, stepRunId]
    );
  }

  linkStepToKernelRun(stepRunId: string, kernelRunId: string, tenantId: string = DEFAULT_TENANT_ID): void {
    const now = new Date().toISOString();
    this.connection.exec(
      `UPDATE workflow_step_runs SET kernel_run_id = ?, updated_at = ? WHERE tenant_id = ? AND step_run_id = ?`,
      [kernelRunId, now, tenantId, stepRunId]
    );
  }

  linkStepToSubagentRun(stepRunId: string, subagentRunId: string, tenantId: string = DEFAULT_TENANT_ID): void {
    const now = new Date().toISOString();
    this.connection.exec(
      `UPDATE workflow_step_runs SET subagent_run_id = ?, updated_at = ? WHERE tenant_id = ? AND step_run_id = ?`,
      [subagentRunId, now, tenantId, stepRunId]
    );
  }

  linkStepToToolCall(stepRunId: string, toolCallId: string, tenantId: string = DEFAULT_TENANT_ID): void {
    const now = new Date().toISOString();
    this.connection.exec(
      `UPDATE workflow_step_runs SET tool_call_id = ?, updated_at = ? WHERE tenant_id = ? AND step_run_id = ?`,
      [toolCallId, now, tenantId, stepRunId]
    );
  }

  linkStepToApproval(stepRunId: string, approvalId: string, tenantId: string = DEFAULT_TENANT_ID): void {
    const now = new Date().toISOString();
    this.connection.exec(
      `UPDATE workflow_step_runs SET approval_id = ?, updated_at = ? WHERE tenant_id = ? AND step_run_id = ?`,
      [approvalId, now, tenantId, stepRunId]
    );
  }

  getStepsByWorkflowAndStatus(workflowRunId: string, status: WorkflowRunState, tenantId: string = DEFAULT_TENANT_ID): WorkflowStepRun[] {
    const results = this.connection.query<{
      step_run_id: string;
      workflow_run_id: string;
      step_id: string;
      step_type: string;
      status: string;
      kernel_run_id: string | null;
      subagent_run_id: string | null;
      tool_call_id: string | null;
      approval_id: string | null;
      input_data: string | null;
      output_data: string | null;
      error_message: string | null;
      started_at: string | null;
      completed_at: string | null;
      created_at: string;
      updated_at: string;
    }>(
      `SELECT * FROM workflow_step_runs WHERE tenant_id = ? AND workflow_run_id = ? AND status = ? ORDER BY created_at ASC`,
      [tenantId, workflowRunId, status]
    );

    return results.map(r => this.mapRowToWorkflowStepRun(r));
  }

  getStepsByStepId(stepId: string, tenantId: string = DEFAULT_TENANT_ID): WorkflowStepRun[] {
    const results = this.connection.query<{
      step_run_id: string;
      workflow_run_id: string;
      step_id: string;
      step_type: string;
      status: string;
      kernel_run_id: string | null;
      subagent_run_id: string | null;
      tool_call_id: string | null;
      approval_id: string | null;
      input_data: string | null;
      output_data: string | null;
      error_message: string | null;
      started_at: string | null;
      completed_at: string | null;
      created_at: string;
      updated_at: string;
    }>(
      `SELECT * FROM workflow_step_runs WHERE tenant_id = ? AND step_id = ? ORDER BY created_at DESC`,
      [tenantId, stepId]
    );

    return results.map(r => this.mapRowToWorkflowStepRun(r));
  }

  getStepsByWorkflowRunId(workflowRunId: string, tenantId: string = DEFAULT_TENANT_ID): WorkflowStepRun[] {
    const results = this.connection.query<{
      step_run_id: string;
      workflow_run_id: string;
      step_id: string;
      step_type: string;
      status: string;
      kernel_run_id: string | null;
      subagent_run_id: string | null;
      tool_call_id: string | null;
      approval_id: string | null;
      input_data: string | null;
      output_data: string | null;
      error_message: string | null;
      started_at: string | null;
      completed_at: string | null;
      created_at: string;
      updated_at: string;
    }>(
      `SELECT * FROM workflow_step_runs WHERE tenant_id = ? AND workflow_run_id = ? ORDER BY created_at ASC`,
      [tenantId, workflowRunId]
    );

    return results.map(r => this.mapRowToWorkflowStepRun(r));
  }

  private mapRowToWorkflowRun(row: {
    workflow_run_id: string;
    workflow_id: string;
    workflow_version: string;
    owner_user_id: string;
    trigger_event_id: string | null;
    status: string;
    current_step_ids: string | null;
    input_data: string | null;
    output_data: string | null;
    context_data: string | null;
    started_at: string;
    completed_at: string | null;
    created_at: string;
    updated_at: string;
  }): WorkflowRun {
    return {
      workflowRunId: row.workflow_run_id,
      workflowId: row.workflow_id,
      workflowVersion: row.workflow_version,
      ownerUserId: row.owner_user_id,
      triggerEventId: row.trigger_event_id ?? undefined,
      status: row.status as WorkflowRunState,
      currentStepIds: row.current_step_ids ? JSON.parse(row.current_step_ids) : undefined,
      inputData: row.input_data ? JSON.parse(row.input_data) : undefined,
      outputData: row.output_data ? JSON.parse(row.output_data) : undefined,
      contextData: row.context_data ? JSON.parse(row.context_data) : undefined,
      startedAt: row.started_at,
      completedAt: row.completed_at ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapRowToWorkflowStepRun(row: {
    step_run_id: string;
    workflow_run_id: string;
    step_id: string;
    step_type: string;
    status: string;
    kernel_run_id: string | null;
    subagent_run_id: string | null;
    tool_call_id: string | null;
    approval_id: string | null;
    input_data: string | null;
    output_data: string | null;
    error_message: string | null;
    started_at: string | null;
    completed_at: string | null;
    created_at: string;
    updated_at: string;
  }): WorkflowStepRun {
    return {
      stepRunId: row.step_run_id,
      workflowRunId: row.workflow_run_id,
      stepId: row.step_id,
      stepType: row.step_type as WorkflowStepType,
      status: row.status as WorkflowRunState,
      kernelRunId: row.kernel_run_id ?? undefined,
      subagentRunId: row.subagent_run_id ?? undefined,
      toolCallId: row.tool_call_id ?? undefined,
      approvalId: row.approval_id ?? undefined,
      inputData: row.input_data ? JSON.parse(row.input_data) : undefined,
      outputData: row.output_data ? JSON.parse(row.output_data) : undefined,
      errorMessage: row.error_message ?? undefined,
      startedAt: row.started_at ?? undefined,
      completedAt: row.completed_at ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

export function createWorkflowRunStore(connection: ConnectionManager): WorkflowRunStore {
  return new WorkflowRunStoreImpl(connection);
}
