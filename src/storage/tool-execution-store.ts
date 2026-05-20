import type { ConnectionManager } from './connection.js';
import type { ToolExecutionState } from '../shared/states.js';
import { TOOL_EXECUTION_STATES } from '../shared/states.js';
import { DEFAULT_TENANT_ID } from '../tenancy/tenant-context.js';

export type SensitivityLevel = 'low' | 'medium' | 'high' | 'restricted';

export interface ToolExecution {
  toolCallId: string;
  toolName: string;
  userId: string;
  sessionId?: string;
  kernelRunId?: string;
  status: ToolExecutionState;
  params?: unknown;
  resultPreview?: string;
  resultRef?: string;
  structuredContent?: Record<string, unknown>;
  sensitivity: SensitivityLevel;
  errorMessage?: string;
  startedAt?: string;
  completedAt?: string;
  terminalStateReached: boolean;
}

export interface ToolExecutionStore {
  create(exec: Omit<ToolExecution, 'startedAt' | 'completedAt' | 'terminalStateReached'>, tenantId?: string): void;
  getById(toolCallId: string, tenantId?: string): ToolExecution | null;
  updateStatus(toolCallId: string, status: ToolExecutionState, tenantId?: string): void;
  saveResult(toolCallId: string, result: {
    preview?: string;
    resultRef?: string;
    structuredContent?: Record<string, unknown>;
  }, tenantId?: string): void;
  getByToolName(toolName: string, tenantId?: string): ToolExecution[];
  getBySession(sessionId: string, tenantId?: string): ToolExecution[];
  getBySensitivity(sensitivity: SensitivityLevel, tenantId?: string): ToolExecution[];
  getPendingByKernelRunId(kernelRunId: string, tenantId?: string): ToolExecution[];
  getByStatus(status: ToolExecutionState, tenantId?: string): ToolExecution[];
}

const TERMINAL_TOOL_STATES: ToolExecutionState[] = [
  TOOL_EXECUTION_STATES.COMPLETED,
  TOOL_EXECUTION_STATES.FAILED,
  TOOL_EXECUTION_STATES.DENIED,
  TOOL_EXECUTION_STATES.ABORTED,
  TOOL_EXECUTION_STATES.CANCELLED,
  TOOL_EXECUTION_STATES.DISCARDED,
  TOOL_EXECUTION_STATES.TIMEOUT,
];

function isTerminalState(status: ToolExecutionState): boolean {
  return TERMINAL_TOOL_STATES.includes(status);
}

class ToolExecutionStoreImpl implements ToolExecutionStore {
  private connection: ConnectionManager;

  constructor(connection: ConnectionManager) {
    this.connection = connection;
  }

  create(exec: Omit<ToolExecution, 'startedAt' | 'completedAt' | 'terminalStateReached'>, tenantId: string = DEFAULT_TENANT_ID): void {
    const now = new Date().toISOString();
    const terminalReached = isTerminalState(exec.status) ? 1 : 0;

    this.connection.exec(
      `INSERT INTO tool_executions (
        tool_call_id, tool_name, user_id, session_id, kernel_run_id,
        status, params, result_preview, result_ref, structured_content,
        sensitivity, error_message, started_at, completed_at, terminal_state_reached, tenant_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        exec.toolCallId,
        exec.toolName,
        exec.userId,
        exec.sessionId ?? null,
        exec.kernelRunId ?? null,
        exec.status,
        exec.params ? JSON.stringify(exec.params) : null,
        exec.resultPreview ?? null,
        exec.resultRef ?? null,
        exec.structuredContent ? JSON.stringify(exec.structuredContent) : null,
        exec.sensitivity,
        exec.errorMessage ?? null,
        now,
        terminalReached === 1 ? now : null,
        terminalReached,
        tenantId,
      ]
    );
  }

  getById(toolCallId: string, tenantId: string = DEFAULT_TENANT_ID): ToolExecution | null {
    const results = this.connection.query<{
      tool_call_id: string;
      tool_name: string;
      user_id: string;
      session_id: string | null;
      kernel_run_id: string | null;
      status: string;
      params: string | null;
      result_preview: string | null;
      result_ref: string | null;
      structured_content: string | null;
      sensitivity: string;
      error_message: string | null;
      started_at: string;
      completed_at: string | null;
      terminal_state_reached: number;
    }>(
      `SELECT * FROM tool_executions WHERE tool_call_id = ? AND tenant_id = ?`,
      [toolCallId, tenantId]
    );

    if (results.length === 0) {
      return null;
    }

    return this.mapRowToToolExecution(results[0]);
  }

  updateStatus(toolCallId: string, status: ToolExecutionState, tenantId: string = DEFAULT_TENANT_ID): void {
    const terminalReached = isTerminalState(status) ? 1 : 0;
    const completedAt = terminalReached === 1 ? new Date().toISOString() : null;

    this.connection.exec(
      `UPDATE tool_executions 
       SET status = ?, terminal_state_reached = ?, completed_at = COALESCE(?, completed_at)
       WHERE tool_call_id = ? AND tenant_id = ?`,
      [status, terminalReached, completedAt, toolCallId, tenantId]
    );
  }

  saveResult(toolCallId: string, result: {
    preview?: string;
    resultRef?: string;
    structuredContent?: Record<string, unknown>;
  }, tenantId: string = DEFAULT_TENANT_ID): void {
    this.connection.exec(
      `UPDATE tool_executions 
       SET result_preview = ?, result_ref = ?, structured_content = ?
       WHERE tool_call_id = ? AND tenant_id = ?`,
      [
        result.preview ?? null,
        result.resultRef ?? null,
        result.structuredContent ? JSON.stringify(result.structuredContent) : null,
        toolCallId,
        tenantId,
      ]
    );
  }

  getByToolName(toolName: string, tenantId: string = DEFAULT_TENANT_ID): ToolExecution[] {
    const results = this.connection.query<{
      tool_call_id: string;
      tool_name: string;
      user_id: string;
      session_id: string | null;
      kernel_run_id: string | null;
      status: string;
      params: string | null;
      result_preview: string | null;
      result_ref: string | null;
      structured_content: string | null;
      sensitivity: string;
      error_message: string | null;
      started_at: string;
      completed_at: string | null;
      terminal_state_reached: number;
    }>(
      `SELECT * FROM tool_executions WHERE tool_name = ? AND tenant_id = ? ORDER BY started_at DESC`,
      [toolName, tenantId]
    );

    return results.map(r => this.mapRowToToolExecution(r));
  }

  getBySession(sessionId: string, tenantId: string = DEFAULT_TENANT_ID): ToolExecution[] {
    const results = this.connection.query<{
      tool_call_id: string;
      tool_name: string;
      user_id: string;
      session_id: string | null;
      kernel_run_id: string | null;
      status: string;
      params: string | null;
      result_preview: string | null;
      result_ref: string | null;
      structured_content: string | null;
      sensitivity: string;
      error_message: string | null;
      started_at: string;
      completed_at: string | null;
      terminal_state_reached: number;
    }>(
      `SELECT * FROM tool_executions WHERE session_id = ? AND tenant_id = ? ORDER BY started_at DESC`,
      [sessionId, tenantId]
    );

    return results.map(r => this.mapRowToToolExecution(r));
  }

  getBySensitivity(sensitivity: SensitivityLevel, tenantId: string = DEFAULT_TENANT_ID): ToolExecution[] {
    const results = this.connection.query<{
      tool_call_id: string;
      tool_name: string;
      user_id: string;
      session_id: string | null;
      kernel_run_id: string | null;
      status: string;
      params: string | null;
      result_preview: string | null;
      result_ref: string | null;
      structured_content: string | null;
      sensitivity: string;
      error_message: string | null;
      started_at: string;
      completed_at: string | null;
      terminal_state_reached: number;
    }>(
      `SELECT * FROM tool_executions WHERE sensitivity = ? AND tenant_id = ? ORDER BY started_at DESC`,
      [sensitivity, tenantId]
    );

    return results.map(r => this.mapRowToToolExecution(r));
  }

  getPendingByKernelRunId(kernelRunId: string, tenantId: string = DEFAULT_TENANT_ID): ToolExecution[] {
    const results = this.connection.query<{
      tool_call_id: string;
      tool_name: string;
      user_id: string;
      session_id: string | null;
      kernel_run_id: string | null;
      status: string;
      params: string | null;
      result_preview: string | null;
      result_ref: string | null;
      structured_content: string | null;
      sensitivity: string;
      error_message: string | null;
      started_at: string;
      completed_at: string | null;
      terminal_state_reached: number;
    }>(
      `SELECT * FROM tool_executions 
       WHERE kernel_run_id = ? AND terminal_state_reached = 0 AND tenant_id = ?
       ORDER BY started_at DESC`,
      [kernelRunId, tenantId]
    );

    return results.map(r => this.mapRowToToolExecution(r));
  }

  getByStatus(status: ToolExecutionState, tenantId: string = DEFAULT_TENANT_ID): ToolExecution[] {
    const results = this.connection.query<{
      tool_call_id: string;
      tool_name: string;
      user_id: string;
      session_id: string | null;
      kernel_run_id: string | null;
      status: string;
      params: string | null;
      result_preview: string | null;
      result_ref: string | null;
      structured_content: string | null;
      sensitivity: string;
      error_message: string | null;
      started_at: string;
      completed_at: string | null;
      terminal_state_reached: number;
    }>(
      `SELECT * FROM tool_executions WHERE status = ? AND tenant_id = ? ORDER BY started_at DESC`,
      [status, tenantId]
    );

    return results.map(r => this.mapRowToToolExecution(r));
  }

  private mapRowToToolExecution(row: {
    tool_call_id: string;
    tool_name: string;
    user_id: string;
    session_id: string | null;
    kernel_run_id: string | null;
    status: string;
    params: string | null;
    result_preview: string | null;
    result_ref: string | null;
    structured_content: string | null;
    sensitivity: string;
    error_message: string | null;
    started_at: string;
    completed_at: string | null;
    terminal_state_reached: number;
  }): ToolExecution {
    return {
      toolCallId: row.tool_call_id,
      toolName: row.tool_name,
      userId: row.user_id,
      sessionId: row.session_id ?? undefined,
      kernelRunId: row.kernel_run_id ?? undefined,
      status: row.status as ToolExecutionState,
      params: row.params ? JSON.parse(row.params) : undefined,
      resultPreview: row.result_preview ?? undefined,
      resultRef: row.result_ref ?? undefined,
      structuredContent: row.structured_content ? JSON.parse(row.structured_content) : undefined,
      sensitivity: row.sensitivity as SensitivityLevel,
      errorMessage: row.error_message ?? undefined,
      startedAt: row.started_at,
      completedAt: row.completed_at ?? undefined,
      terminalStateReached: row.terminal_state_reached === 1,
    };
  }
}

export function createToolExecutionStore(connection: ConnectionManager): ToolExecutionStore {
  return new ToolExecutionStoreImpl(connection);
}
