/**
 * Approval Request Tool
 * Handles approval requests and responses for high-risk foreground operations
 */

import type { ApprovalStore, CreateApprovalRequest } from '../../storage/approval-store.js';
import { APPROVAL_STATES } from '../../storage/approval-store.js';
import { createSuccessResult, createErrorResult, type ForegroundToolResult } from './foreground-tool-result.js';
import { createModelInputRedactor, type ModelInputRedactor } from '../../kernel/model-input/model-input-redactor.js';

export const APPROVAL_REQUEST_TOOL_ID = 'foreground_handle_approval';

/**
 * Data returned when an approval request is created
 */
export interface ApprovalRequestData {
  approvalId: string | null;
  status: 'pending' | 'auto_approved';
  operation?: string;
  operationArgs?: Record<string, unknown>;
}

/**
 * Data returned when an approval response is processed
 */
export interface ApprovalResponseData {
  approvalId: string;
  status: 'approved' | 'denied';
  operation: string;
  operationArgs: Record<string, unknown>;
}

/**
 * Dependencies for approval request tool
 */
export interface ApprovalRequestDeps {
  approvalStore: ApprovalStore;
  userId: string;
  sessionId: string;
  turnId: string;
}

/**
 * Input for approval request
 */
export interface ApprovalRequestInput {
  operation: string;
  operationArgs: Record<string, unknown>;
  requiresApproval: boolean;
  correlationId?: string;
  riskLevel?: string;
}

/**
 * Input for approval response
 */
export interface ApprovalResponseInput {
  approvalId: string;
  decision: 'approved' | 'denied';
  responseReason?: string;
}

/**
 * Safe operations that do not require approval
 * These are low-risk operations that can be auto-approved
 */
const SAFE_OPERATIONS = new Set([
  'status_query',
  'read_file',
  'list_files',
  'search',
  'get_session',
  'get_transcript',
]);

/**
 * Check if an operation is considered safe (low-risk)
 */
function isSafeOperation(operation: string): boolean {
  return SAFE_OPERATIONS.has(operation);
}

/**
 * Redact sensitive fields from operation args
 */
function redactOperationArgs(
  operationArgs: Record<string, unknown>,
  redactor: ModelInputRedactor
): Record<string, unknown> {
  return redactor.redact(operationArgs);
}

/**
 * Handle approval request - creates a pending approval if required
 * 
 * Behavior:
 * - If requiresApproval === true: create pending approval, return success with { approvalId, status: 'pending' }
 * - If requiresApproval === false and operation is safe: return success with { approvalId: null, status: 'auto_approved' }
 * - Returns failure with code APPROVAL_DENIED or APPROVAL_STORE_ERROR on error
 */
export async function handleApprovalRequest(
  deps: ApprovalRequestDeps,
  input: ApprovalRequestInput
): Promise<ForegroundToolResult<ApprovalRequestData>> {
  const { approvalStore, userId, sessionId, turnId } = deps;
  const { operation, operationArgs, requiresApproval, correlationId, riskLevel } = input;

  try {
    // If approval is not required and operation is safe, auto-approve
    if (!requiresApproval && isSafeOperation(operation)) {
      return createSuccessResult<ApprovalRequestData>(
        {
          approvalId: null,
          status: 'auto_approved',
          operation,
          operationArgs,
        },
        `Operation "${operation}" auto-approved (low-risk).`,
        {}
      );
    }

    // If approval is required, create a pending approval request
    if (requiresApproval) {
      // Redact sensitive fields before storing
      const redactor = createModelInputRedactor();
      const redactedArgs = redactOperationArgs(operationArgs, redactor);

      const now = new Date().toISOString();
      const approvalId = `approval-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const createRequest: CreateApprovalRequest = {
        id: approvalId,
        userId,
        sessionId,
        status: APPROVAL_STATES.PENDING,
        actionType: operation,
        resource: correlationId,
        requestedBy: userId,
        requestedAt: now,
        riskLevel: riskLevel ?? 'high',
        metadata: JSON.stringify({
          operationArgs: redactedArgs,
          turnId,
        }),
        sourceContext: 'foreground_approval_tool',
      };

      const approval = approvalStore.create(createRequest);

      return createSuccessResult<ApprovalRequestData>(
        {
          approvalId: approval.id,
          status: 'pending',
          operation,
          operationArgs: redactedArgs,
        },
        `Approval request created for operation "${operation}". Waiting for user approval.`,
        {}
      );
    }

    // If approval is not required but operation is not in safe list, still require approval
    // This is a defensive measure - unknown operations should be reviewed
    const redactor = createModelInputRedactor();
    const redactedArgs = redactOperationArgs(operationArgs, redactor);

    const now = new Date().toISOString();
    const approvalId = `approval-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

    const createRequest: CreateApprovalRequest = {
      id: approvalId,
      userId,
      sessionId,
      status: APPROVAL_STATES.PENDING,
      actionType: operation,
      resource: correlationId,
      requestedBy: userId,
      requestedAt: now,
      riskLevel: riskLevel ?? 'medium',
      metadata: JSON.stringify({
        operationArgs: redactedArgs,
        turnId,
      }),
      sourceContext: 'foreground_approval_tool',
    };

    const approval = approvalStore.create(createRequest);

    return createSuccessResult<ApprovalRequestData>(
      {
        approvalId: approval.id,
        status: 'pending',
        operation,
        operationArgs: redactedArgs,
      },
      `Approval request created for operation "${operation}" (unknown risk level). Waiting for user approval.`,
      {}
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return createErrorResult<ApprovalRequestData>(
      'APPROVAL_STORE_ERROR',
      errorMessage,
      true,
      `Failed to create approval request for operation "${operation}".`
    );
  }
}

/**
 * Handle approval response - processes user's approval decision
 * 
 * Behavior:
 * - On approved: look up approval, return { data: { approvalId, status: 'approved', operation, operationArgs } }
 * - On denied: return failure code APPROVAL_DENIED (recoverable: false)
 */
export async function handleApprovalResponse(
  deps: ApprovalRequestDeps,
  input: ApprovalResponseInput
): Promise<ForegroundToolResult<ApprovalResponseData>> {
  const { approvalStore } = deps;
  const { approvalId, decision, responseReason } = input;

  try {
    // Look up the approval request
    const approval = approvalStore.getById(approvalId);

    if (!approval) {
      return createErrorResult<ApprovalResponseData>(
        'APPROVAL_NOT_FOUND',
        `Approval request ${approvalId} not found`,
        false,
        'The approval request could not be found.'
      );
    }

    // Check if approval is still pending
    if (approval.status !== APPROVAL_STATES.PENDING) {
      return createErrorResult<ApprovalResponseData>(
        'APPROVAL_NOT_PENDING',
        `Approval request ${approvalId} is not pending (current status: ${approval.status})`,
        false,
        'This approval request has already been processed.'
      );
    }

    // Handle denial
    if (decision === 'denied') {
      const now = new Date().toISOString();
      approvalStore.update(approvalId, {
        status: APPROVAL_STATES.REJECTED,
        respondedAt: now,
        responseBy: deps.userId,
        responseReason: responseReason ?? 'User denied the request',
      });

      return createErrorResult<ApprovalResponseData>(
        'APPROVAL_DENIED',
        `Approval request ${approvalId} was denied`,
        false,
        'The requested operation was denied and will not be executed.'
      );
    }

    // Handle approval
    const now = new Date().toISOString();
    approvalStore.update(approvalId, {
      status: APPROVAL_STATES.APPROVED,
      respondedAt: now,
      responseBy: deps.userId,
      responseReason: responseReason ?? 'User approved the request',
    });

    // Parse operation args from metadata
    let operationArgs: Record<string, unknown> = {};
    try {
      if (approval.metadata) {
        const parsed = JSON.parse(approval.metadata);
        operationArgs = parsed.operationArgs ?? {};
      }
    } catch {
      // If parsing fails, use empty object
    }

    return createSuccessResult<ApprovalResponseData>(
      {
        approvalId,
        status: 'approved',
        operation: approval.actionType,
        operationArgs,
      },
      `Operation "${approval.actionType}" approved. Proceeding with execution.`,
      {}
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return createErrorResult<ApprovalResponseData>(
      'APPROVAL_STORE_ERROR',
      errorMessage,
      true,
      'Failed to process approval response.'
    );
  }
}
