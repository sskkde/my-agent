import type {
  GitHubTransport,
  GitHubIssue,
  GitHubPullRequest,
  GitHubIssueComment,
  GitHubUser,
  GitHubLabel,
  ListIssuesParams,
  GetIssueParams,
  ListPullRequestsParams,
  GetPullRequestParams,
  CreateIssueCommentParams,
} from './github-types.js';

const mockUser: GitHubUser = {
  id: 1,
  login: 'octocat',
  avatarUrl: 'https://github.com/images/error/octocat_happy.gif',
  htmlUrl: 'https://github.com/octocat',
  type: 'User',
};

const mockLabels: GitHubLabel[] = [
  { id: 1, name: 'bug', color: 'ff0000', description: 'Something is not working' },
  { id: 2, name: 'enhancement', color: '00ff00', description: 'New feature or request' },
  { id: 3, name: 'documentation', color: '0000ff', description: 'Improvements or additions to documentation' },
];

const mockIssues: GitHubIssue[] = [
  {
    id: 1,
    number: 1,
    title: 'First issue',
    body: 'This is the first issue in the repository.',
    state: 'open',
    user: mockUser,
    labels: [mockLabels[0]],
    assignees: [],
    milestone: null,
    comments: 2,
    createdAt: '2024-01-01T10:00:00Z',
    updatedAt: '2024-01-02T15:30:00Z',
    closedAt: null,
    htmlUrl: 'https://github.com/octocat/Hello-World/issues/1',
  },
  {
    id: 2,
    number: 2,
    title: 'Second issue with enhancement label',
    body: 'This issue has an enhancement label.',
    state: 'open',
    user: mockUser,
    labels: [mockLabels[1]],
    assignees: [mockUser],
    milestone: null,
    comments: 0,
    createdAt: '2024-01-03T09:00:00Z',
    updatedAt: '2024-01-03T09:00:00Z',
    closedAt: null,
    htmlUrl: 'https://github.com/octocat/Hello-World/issues/2',
  },
  {
    id: 3,
    number: 3,
    title: 'Closed issue',
    body: 'This issue has been closed.',
    state: 'closed',
    user: mockUser,
    labels: [mockLabels[0], mockLabels[2]],
    assignees: [],
    milestone: null,
    comments: 5,
    createdAt: '2024-01-04T11:00:00Z',
    updatedAt: '2024-01-05T16:00:00Z',
    closedAt: '2024-01-05T16:00:00Z',
    htmlUrl: 'https://github.com/octocat/Hello-World/issues/3',
  },
];

const mockPullRequests: GitHubPullRequest[] = [
  {
    id: 101,
    number: 10,
    title: 'Add new feature',
    body: 'This PR adds a new feature to the project.',
    state: 'open',
    user: mockUser,
    labels: [mockLabels[1]],
    assignees: [],
    draft: false,
    merged: false,
    mergeable: true,
    mergedAt: null,
    head: { ref: 'feature-branch', sha: 'abc123' },
    base: { ref: 'main', sha: 'def456' },
    comments: 3,
    reviewComments: 2,
    commits: 5,
    additions: 100,
    deletions: 20,
    changedFiles: 8,
    createdAt: '2024-01-10T10:00:00Z',
    updatedAt: '2024-01-12T14:00:00Z',
    closedAt: null,
    htmlUrl: 'https://github.com/octocat/Hello-World/pull/10',
  },
  {
    id: 102,
    number: 11,
    title: 'Fix bug in authentication',
    body: 'This PR fixes a critical bug in the authentication module.',
    state: 'open',
    user: mockUser,
    labels: [mockLabels[0]],
    assignees: [mockUser],
    draft: false,
    merged: false,
    mergeable: true,
    mergedAt: null,
    head: { ref: 'bugfix/auth', sha: 'ghi789' },
    base: { ref: 'main', sha: 'def456' },
    comments: 1,
    reviewComments: 0,
    commits: 2,
    additions: 15,
    deletions: 5,
    changedFiles: 3,
    createdAt: '2024-01-15T09:00:00Z',
    updatedAt: '2024-01-15T09:00:00Z',
    closedAt: null,
    htmlUrl: 'https://github.com/octocat/Hello-World/pull/11',
  },
  {
    id: 103,
    number: 12,
    title: 'Update documentation',
    body: 'Updated the README with new instructions.',
    state: 'closed',
    user: mockUser,
    labels: [mockLabels[2]],
    assignees: [],
    draft: false,
    merged: true,
    mergeable: null,
    mergedAt: '2024-01-18T12:00:00Z',
    head: { ref: 'docs/update', sha: 'jkl012' },
    base: { ref: 'main', sha: 'def456' },
    comments: 2,
    reviewComments: 1,
    commits: 1,
    additions: 50,
    deletions: 10,
    changedFiles: 2,
    createdAt: '2024-01-17T08:00:00Z',
    updatedAt: '2024-01-18T12:00:00Z',
    closedAt: '2024-01-18T12:00:00Z',
    htmlUrl: 'https://github.com/octocat/Hello-World/pull/12',
  },
];

const createdComments: Map<string, GitHubIssueComment> = new Map();
let commentIdCounter = 1000;

export class GitHubMockTransport implements GitHubTransport {
  private validPat: string | null = null;

  setValidPat(pat: string | null): void {
    this.validPat = pat;
  }

  async validateAuth(): Promise<boolean> {
    return this.validPat !== null;
  }

  async listIssues(params: ListIssuesParams): Promise<{ issues: GitHubIssue[]; total: number }> {
    this.checkAuth();

    let filtered = [...mockIssues];

    if (params.state && params.state !== 'all') {
      filtered = filtered.filter(issue => issue.state === params.state);
    }

    if (params.labels && params.labels.length > 0) {
      filtered = filtered.filter(issue =>
        params.labels!.some(label =>
          issue.labels.some(l => l.name === label)
        )
      );
    }

    if (params.sort === 'updated') {
      filtered.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    } else if (params.sort === 'comments') {
      filtered.sort((a, b) => b.comments - a.comments);
    } else {
      filtered.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }

    if (params.direction === 'asc') {
      filtered.reverse();
    }

    const perPage = params.perPage ?? 30;
    const page = params.page ?? 1;
    const start = (page - 1) * perPage;
    const paginated = filtered.slice(start, start + perPage);

    return { issues: paginated, total: filtered.length };
  }

  async getIssue(params: GetIssueParams): Promise<GitHubIssue | null> {
    this.checkAuth();

    const issue = mockIssues.find(i => i.number === params.issueNumber);
    return issue ?? null;
  }

  async listPullRequests(params: ListPullRequestsParams): Promise<{ pullRequests: GitHubPullRequest[]; total: number }> {
    this.checkAuth();

    let filtered = [...mockPullRequests];

    if (params.state && params.state !== 'all') {
      filtered = filtered.filter(pr => pr.state === params.state);
    }

    if (params.head) {
      filtered = filtered.filter(pr => pr.head.ref === params.head);
    }

    if (params.base) {
      filtered = filtered.filter(pr => pr.base.ref === params.base);
    }

    if (params.sort === 'updated') {
      filtered.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    } else if (params.sort === 'popularity') {
      filtered.sort((a, b) => b.comments - a.comments);
    } else {
      filtered.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }

    if (params.direction === 'asc') {
      filtered.reverse();
    }

    const perPage = params.perPage ?? 30;
    const page = params.page ?? 1;
    const start = (page - 1) * perPage;
    const paginated = filtered.slice(start, start + perPage);

    return { pullRequests: paginated, total: filtered.length };
  }

  async getPullRequest(params: GetPullRequestParams): Promise<GitHubPullRequest | null> {
    this.checkAuth();

    const pr = mockPullRequests.find(p => p.number === params.prNumber);
    return pr ?? null;
  }

  async createIssueComment(params: CreateIssueCommentParams): Promise<GitHubIssueComment> {
    this.checkAuth();

    const issue = mockIssues.find(i => i.number === params.issueNumber);
    if (!issue) {
      throw new Error(`Issue not found: ${params.issueNumber}`);
    }

    const id = commentIdCounter++;
    const comment: GitHubIssueComment = {
      id,
      nodeId: `IC_${id}`,
      body: params.body,
      user: mockUser,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      htmlUrl: `https://github.com/${params.owner}/${params.repo}/issues/${params.issueNumber}#issuecomment-${id}`,
      issueUrl: `https://github.com/${params.owner}/${params.repo}/issues/${params.issueNumber}`,
    };

    const key = `${params.owner}/${params.repo}/${params.issueNumber}/${id}`;
    createdComments.set(key, comment);

    return comment;
  }

  private checkAuth(): void {
    if (this.validPat === null) {
      const error = new Error('Authentication required');
      (error as unknown as Record<string, unknown>).code = 'AUTH_INVALID';
      throw error;
    }
  }

  getCreatedComments(): Map<string, GitHubIssueComment> {
    return createdComments;
  }

  clearCreatedComments(): void {
    createdComments.clear();
  }
}

export function createGitHubMockTransport(): GitHubMockTransport {
  return new GitHubMockTransport();
}
