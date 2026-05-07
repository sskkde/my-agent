// GitHub Connector Types
// Type definitions for GitHub API responses and connector operations

// GitHub Issue
export interface GitHubIssue {
  id: number;
  number: number;
  title: string;
  body: string | null;
  state: 'open' | 'closed';
  user: GitHubUser;
  labels: GitHubLabel[];
  assignees: GitHubUser[];
  milestone: GitHubMilestone | null;
  comments: number;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  htmlUrl: string;
}

// GitHub Pull Request
export interface GitHubPullRequest {
  id: number;
  number: number;
  title: string;
  body: string | null;
  state: 'open' | 'closed';
  user: GitHubUser;
  labels: GitHubLabel[];
  assignees: GitHubUser[];
  draft: boolean;
  merged: boolean;
  mergeable: boolean | null;
  mergedAt: string | null;
  head: {
    ref: string;
    sha: string;
  };
  base: {
    ref: string;
    sha: string;
  };
  comments: number;
  reviewComments: number;
  commits: number;
  additions: number;
  deletions: number;
  changedFiles: number;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  htmlUrl: string;
}

// GitHub User
export interface GitHubUser {
  id: number;
  login: string;
  avatarUrl: string;
  htmlUrl: string;
  type: 'User' | 'Bot' | 'Organization';
}

// GitHub Label
export interface GitHubLabel {
  id: number;
  name: string;
  color: string;
  description: string | null;
}

// GitHub Milestone
export interface GitHubMilestone {
  id: number;
  number: number;
  title: string;
  description: string | null;
  state: 'open' | 'closed';
  dueOn: string | null;
}

// GitHub Comment
export interface GitHubComment {
  id: number;
  body: string;
  user: GitHubUser;
  createdAt: string;
  updatedAt: string;
  htmlUrl: string;
}

// GitHub Issue Comment (response from create)
export interface GitHubIssueComment {
  id: number;
  nodeId: string;
  body: string;
  user: GitHubUser;
  createdAt: string;
  updatedAt: string;
  htmlUrl: string;
  issueUrl: string;
}

// Operation Parameters
export interface ListIssuesParams {
  owner: string;
  repo: string;
  state?: 'open' | 'closed' | 'all';
  labels?: string[];
  sort?: 'created' | 'updated' | 'comments';
  direction?: 'asc' | 'desc';
  since?: string;
  page?: number;
  perPage?: number;
}

export interface GetIssueParams {
  owner: string;
  repo: string;
  issueNumber: number;
}

export interface ListPullRequestsParams {
  owner: string;
  repo: string;
  state?: 'open' | 'closed' | 'all';
  head?: string;
  base?: string;
  sort?: 'created' | 'updated' | 'popularity' | 'long-running';
  direction?: 'asc' | 'desc';
  page?: number;
  perPage?: number;
}

export interface GetPullRequestParams {
  owner: string;
  repo: string;
  prNumber: number;
}

export interface CreateIssueCommentParams {
  owner: string;
  repo: string;
  issueNumber: number;
  body: string;
}

// Authentication
export interface GitHubAuthConfig {
  pat: string; // Personal Access Token (encrypted at rest)
}

// Error Types
export type GitHubErrorCode =
  | 'AUTH_INVALID'
  | 'AUTH_EXPIRED'
  | 'RATE_LIMITED'
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'VALIDATION_ERROR'
  | 'NETWORK_ERROR'
  | 'UNKNOWN_ERROR';

export interface GitHubError {
  code: GitHubErrorCode;
  message: string;
  recoverable: boolean;
  details?: {
    statusCode?: number;
    rateLimitRemaining?: number;
    rateLimitResetAt?: string;
  };
}

// Transport Interface (for mocking/real implementation)
export interface GitHubTransport {
  listIssues(params: ListIssuesParams): Promise<{ issues: GitHubIssue[]; total: number }>;
  getIssue(params: GetIssueParams): Promise<GitHubIssue | null>;
  listPullRequests(params: ListPullRequestsParams): Promise<{ pullRequests: GitHubPullRequest[]; total: number }>;
  getPullRequest(params: GetPullRequestParams): Promise<GitHubPullRequest | null>;
  createIssueComment(params: CreateIssueCommentParams): Promise<GitHubIssueComment>;
  validateAuth(): Promise<boolean>;
}

// Approval Request Metadata for Issue Comment
export interface IssueCommentApprovalMetadata {
  operation: 'create_issue_comment';
  owner: string;
  repo: string;
  issueNumber: number;
  body: string;
  idempotencyKey: string;
}
