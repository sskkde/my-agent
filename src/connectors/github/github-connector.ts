import type {
  ConnectorAdapter,
  ConnectorCapability,
  ConnectorCallRequest,
} from '../types.js';
import type { ConnectorInstance } from '../../storage/connector-store.js';
import type { ApprovalStore, CreateApprovalRequest } from '../../storage/approval-store.js';
import {
  encryptSecret,
  decryptSecret,
  deserializeEncryptedSecret,
  serializeEncryptedSecret,
} from '../../storage/provider-crypto.js';
import type {
  GitHubTransport,
  GitHubIssue,
  GitHubPullRequest,
  GitHubIssueComment,
  ListIssuesParams,
  GetIssueParams,
  ListPullRequestsParams,
  GetPullRequestParams,
  CreateIssueCommentParams,
  GitHubError,
  IssueCommentApprovalMetadata,
} from './github-types.js';
import { GitHubMockTransport } from './github-mock-transport.js';

const GITHUB_CAPABILITIES: ConnectorCapability[] = [
  {
    capabilityId: 'github.list_issues',
    name: 'List Issues',
    description: 'List issues in a GitHub repository',
    category: 'read',
    riskLevel: 'low',
    inputSchema: {
      owner: { type: 'string', description: 'Repository owner' },
      repo: { type: 'string', description: 'Repository name' },
      state: { type: 'string', description: 'Issue state: open, closed, or all' },
      labels: { type: 'array', description: 'Filter by labels' },
    },
    requiresAuth: true,
    supportedOperations: ['list_issues'],
  },
  {
    capabilityId: 'github.get_issue',
    name: 'Get Issue',
    description: 'Get a specific issue by number',
    category: 'read',
    riskLevel: 'low',
    inputSchema: {
      owner: { type: 'string', description: 'Repository owner' },
      repo: { type: 'string', description: 'Repository name' },
      issueNumber: { type: 'number', description: 'Issue number' },
    },
    requiresAuth: true,
    supportedOperations: ['get_issue'],
  },
  {
    capabilityId: 'github.list_pull_requests',
    name: 'List Pull Requests',
    description: 'List pull requests in a GitHub repository',
    category: 'read',
    riskLevel: 'low',
    inputSchema: {
      owner: { type: 'string', description: 'Repository owner' },
      repo: { type: 'string', description: 'Repository name' },
      state: { type: 'string', description: 'PR state: open, closed, or all' },
    },
    requiresAuth: true,
    supportedOperations: ['list_pull_requests'],
  },
  {
    capabilityId: 'github.get_pull_request',
    name: 'Get Pull Request',
    description: 'Get a specific pull request by number',
    category: 'read',
    riskLevel: 'low',
    inputSchema: {
      owner: { type: 'string', description: 'Repository owner' },
      repo: { type: 'string', description: 'Repository name' },
      prNumber: { type: 'number', description: 'Pull request number' },
    },
    requiresAuth: true,
    supportedOperations: ['get_pull_request'],
  },
  {
    capabilityId: 'github.create_issue_comment',
    name: 'Create Issue Comment',
    description: 'Create a comment on a GitHub issue (requires approval)',
    category: 'write',
    riskLevel: 'medium',
    inputSchema: {
      owner: { type: 'string', description: 'Repository owner' },
      repo: { type: 'string', description: 'Repository name' },
      issueNumber: { type: 'number', description: 'Issue number' },
      body: { type: 'string', description: 'Comment body' },
    },
    requiresAuth: true,
    supportedOperations: ['create_issue_comment'],
  },
];

export interface GitHubConnectorConfig {
  transport?: GitHubTransport;
  approvalStore: ApprovalStore;
  useMock?: boolean;
}

export class GitHubConnectorAdapter implements ConnectorAdapter {
  private transport: GitHubTransport;
  private approvalStore: ApprovalStore;
  private pendingApprovals: Map<string, { params: CreateIssueCommentParams; approvalId: string }> = new Map();

  constructor(config: GitHubConnectorConfig) {
    this.transport = config.transport ?? new GitHubMockTransport();
    this.approvalStore = config.approvalStore;
  }

  async execute(
    instance: ConnectorInstance,
    request: ConnectorCallRequest
  ): Promise<unknown> {
    const pat = this.decryptPat(instance);

    if (this.transport instanceof GitHubMockTransport) {
      this.transport.setValidPat(pat);
    }

    const { operation, params } = request;

    switch (operation) {
      case 'list_issues':
        return this.listIssues(params as unknown as ListIssuesParams);

      case 'get_issue':
        return this.getIssue(params as unknown as GetIssueParams);

      case 'list_pull_requests':
        return this.listPullRequests(params as unknown as ListPullRequestsParams);

      case 'get_pull_request':
        return this.getPullRequest(params as unknown as GetPullRequestParams);

      case 'create_issue_comment':
        return this.createIssueComment(
          params as unknown as CreateIssueCommentParams,
          request
        );

      default:
        throw new Error(`Unknown operation: ${operation}`);
    }
  }

  discoverCapabilities(_instance: ConnectorInstance): ConnectorCapability[] {
    return GITHUB_CAPABILITIES;
  }

  checkHealth(_instance: ConnectorInstance): { healthy: boolean; message?: string } {
    return { healthy: true, message: 'GitHub connector is healthy' };
  }

  private async listIssues(params: ListIssuesParams): Promise<{ issues: GitHubIssue[]; total: number }> {
    return this.transport.listIssues(params);
  }

  private async getIssue(params: GetIssueParams): Promise<GitHubIssue | null> {
    return this.transport.getIssue(params);
  }

  private async listPullRequests(params: ListPullRequestsParams): Promise<{ pullRequests: GitHubPullRequest[]; total: number }> {
    return this.transport.listPullRequests(params);
  }

  private async getPullRequest(params: GetPullRequestParams): Promise<GitHubPullRequest | null> {
    return this.transport.getPullRequest(params);
  }

  private async createIssueComment(
    params: CreateIssueCommentParams,
    request: ConnectorCallRequest
  ): Promise<GitHubIssueComment | { requiresApproval: true; approvalId: string }> {
    const idempotencyKey = this.generateIdempotencyKey(params);

    const existingApproval = this.findExistingApproval(request.userId, idempotencyKey);
    if (existingApproval) {
      if (existingApproval.status === 'approved') {
        return this.executeIssueComment(params);
      }
      if (existingApproval.status === 'rejected') {
        throw this.createApprovalRejectedError(existingApproval.id);
      }
      return { requiresApproval: true, approvalId: existingApproval.id };
    }

    const approvalId = await this.createApprovalRequest(params, request, idempotencyKey);

    this.pendingApprovals.set(approvalId, { params, approvalId });

    return { requiresApproval: true, approvalId };
  }

  async executeApprovedComment(approvalId: string): Promise<GitHubIssueComment> {
    const pending = this.pendingApprovals.get(approvalId);
    if (!pending) {
      throw new Error(`No pending comment found for approval: ${approvalId}`);
    }

    const result = await this.executeIssueComment(pending.params);
    this.pendingApprovals.delete(approvalId);

    return result;
  }

  private async executeIssueComment(params: CreateIssueCommentParams): Promise<GitHubIssueComment> {
    return this.transport.createIssueComment(params);
  }

  private decryptPat(instance: ConnectorInstance): string {
    if (!instance.authStateRef) {
      throw this.createAuthError('No authentication configured');
    }

    try {
      const encrypted = deserializeEncryptedSecret(instance.authStateRef);
      return decryptSecret(encrypted.encrypted, encrypted.iv, encrypted.authTag);
    } catch {
      throw this.createAuthError('Failed to decrypt PAT');
    }
  }

  static encryptPat(pat: string): string {
    const encrypted = encryptSecret(pat);
    return serializeEncryptedSecret(encrypted);
  }

  private generateIdempotencyKey(params: CreateIssueCommentParams): string {
    return `github-comment-${params.owner}-${params.repo}-${params.issueNumber}-${Date.now()}`;
  }

  private findExistingApproval(userId: string, idempotencyKey: string) {
    const approvals = this.approvalStore.findByUser(userId);
    return approvals.find(a => a.idempotencyKey === idempotencyKey);
  }

  private async createApprovalRequest(
    params: CreateIssueCommentParams,
    request: ConnectorCallRequest,
    idempotencyKey: string
  ): Promise<string> {
    const approvalId = `github-approval-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    const metadata: IssueCommentApprovalMetadata = {
      operation: 'create_issue_comment',
      owner: params.owner,
      repo: params.repo,
      issueNumber: params.issueNumber,
      body: params.body,
      idempotencyKey,
    };

    const approvalRequest: CreateApprovalRequest = {
      id: approvalId,
      userId: request.userId,
      sessionId: request.sessionId ?? 'unknown',
      status: 'pending',
      riskLevel: 'medium',
      scope: 'github:write',
      actionType: 'github.create_issue_comment',
      resource: `github:${params.owner}/${params.repo}/issues/${params.issueNumber}`,
      justification: `Create comment on issue #${params.issueNumber} in ${params.owner}/${params.repo}`,
      requestedBy: 'github-connector',
      requestedAt: new Date().toISOString(),
      idempotencyKey,
      metadata: JSON.stringify(metadata),
    };

    this.approvalStore.create(approvalRequest);

    return approvalId;
  }

  private createAuthError(message: string): GitHubError {
    const error = new Error(message) as Error & GitHubError;
    error.code = 'AUTH_INVALID';
    error.message = message;
    error.recoverable = false;
    throw error;
  }

  private createApprovalRejectedError(approvalId: string): GitHubError {
    const error = new Error(`Approval was rejected: ${approvalId}`) as Error & GitHubError;
    error.code = 'FORBIDDEN';
    error.message = `Approval was rejected: ${approvalId}`;
    error.recoverable = false;
    throw error;
  }
}

export function createGitHubConnectorAdapter(config: GitHubConnectorConfig): GitHubConnectorAdapter {
  return new GitHubConnectorAdapter(config);
}
