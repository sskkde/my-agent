import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import WorkflowsTab from './WorkflowsTab';
import * as client from '../../api/client';
import type { WorkflowDefinitionResponse, WorkflowDraftResponse, WorkflowRunResponse } from '../../api/types';

vi.mock('../../api/client');

function makeDraft(overrides: Partial<WorkflowDraftResponse> = {}): WorkflowDraftResponse {
  return {
    draftId: 'draft-1',
    name: 'Test WF',
    description: '',
    steps: [
      { stepId: 's1', stepType: 'tool_call' as const, name: 'Step 1', config: { toolName: 'status.query' } },
    ],
    ownerUserId: 'user-1',
    status: 'draft',
    validationIssues: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeDefinition(overrides: Partial<WorkflowDefinitionResponse> = {}): WorkflowDefinitionResponse {
  return {
    workflowId: 'def-1',
    name: 'Test WF',
    version: 1,
    steps: [
      { stepId: 's1', stepType: 'tool_call' as const, name: 'Step 1', config: { toolName: 'status.query' } },
    ],
    ownerUserId: 'user-1',
    status: 'published',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeRun(overrides: Partial<WorkflowRunResponse> = {}): WorkflowRunResponse {
  return {
    workflowRunId: 'run-1',
    definitionId: 'def-1',
    version: 1,
    status: 'pending',
    currentStepIds: ['s1'],
    stepRuns: [
      { stepRunId: 'sr-1', stepId: 's1', stepType: 'tool_call', status: 'pending' },
    ],
    ...overrides,
  };
}

describe('WorkflowsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(client.listWorkflowDrafts).mockResolvedValue([]);
    vi.mocked(client.listWorkflowDefinitions).mockResolvedValue([]);
  });

  it('renders the workflows panel', async () => {
    render(<WorkflowsTab />);
    await waitFor(() => {
      expect(screen.getByTestId('workflows-panel')).toBeInTheDocument();
    });
  });

  it('shows empty state when no drafts exist', async () => {
    render(<WorkflowsTab />);
    await waitFor(() => {
      expect(screen.getByText('暂无草稿')).toBeInTheDocument();
    });
  });

  it('blocks publish for empty workflow with validation errors', async () => {
    render(<WorkflowsTab />);
    await waitFor(() => {
      expect(screen.getByTestId('workflows-panel')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByTestId('workflow-validate'));

    await waitFor(() => {
      expect(screen.getByTestId('workflow-validation-errors')).toBeInTheDocument();
    });

    expect(screen.getByText(/工作流名称不能为空/)).toBeInTheDocument();
    expect(screen.getByTestId('workflow-publish')).toBeDisabled();
  });

  it('validates missing step name', async () => {
    render(<WorkflowsTab />);
    await waitFor(() => {
      expect(screen.getByTestId('workflows-panel')).toBeInTheDocument();
    });

    await userEvent.type(screen.getByTestId('workflow-name-input'), 'Test Workflow');
    await userEvent.click(screen.getByTestId('workflow-validate'));

    await waitFor(() => {
      expect(screen.getByTestId('workflow-validation-errors')).toBeInTheDocument();
    });

    expect(screen.getByText(/步骤 1 名称不能为空/)).toBeInTheDocument();
  });

  it('validates missing tool name for tool_call step', async () => {
    render(<WorkflowsTab />);
    await waitFor(() => {
      expect(screen.getByTestId('workflows-panel')).toBeInTheDocument();
    });

    await userEvent.type(screen.getByTestId('workflow-name-input'), 'Test Workflow');
    await userEvent.type(screen.getByTestId('workflow-step-title-0'), 'My Step');
    await userEvent.click(screen.getByTestId('workflow-validate'));

    await waitFor(() => {
      expect(screen.getByTestId('workflow-validation-errors')).toBeInTheDocument();
    });

    expect(screen.getByText(/步骤 1 .*工具调用.*缺少工具名称/)).toBeInTheDocument();
  });

  it('blocks publish on saved draft that has not been validated', async () => {
    const draft = makeDraft();
    vi.mocked(client.createWorkflowDraft).mockResolvedValue(draft);
    vi.mocked(client.updateWorkflowDraft).mockResolvedValue(draft);

    render(<WorkflowsTab />);
    await waitFor(() => {
      expect(screen.getByTestId('workflows-panel')).toBeInTheDocument();
    });

    await userEvent.type(screen.getByTestId('workflow-name-input'), 'Test WF');
    await userEvent.type(screen.getByTestId('workflow-step-title-0'), 'Step 1');
    await userEvent.type(screen.getByTestId('workflow-step-toolName-0'), 'status.query');

    await userEvent.click(screen.getByTestId('workflow-save'));
    await waitFor(() => {
      expect(client.createWorkflowDraft).toHaveBeenCalled();
    });

    expect(screen.getByTestId('workflow-publish')).toBeDisabled();

    await userEvent.click(screen.getByTestId('workflow-publish'));
    expect(client.publishWorkflowDraft).not.toHaveBeenCalled();
  });

  it('blocks publish on saved draft after edits invalidate prior validation', async () => {
    const draft = makeDraft();
    vi.mocked(client.createWorkflowDraft).mockResolvedValue(draft);
    vi.mocked(client.updateWorkflowDraft).mockResolvedValue(draft);
    vi.mocked(client.getWorkflowDraft).mockResolvedValue(draft);
    vi.mocked(client.validateWorkflowDraft).mockResolvedValue({ valid: true, issues: [] });

    render(<WorkflowsTab />);
    await waitFor(() => {
      expect(screen.getByTestId('workflows-panel')).toBeInTheDocument();
    });

    await userEvent.type(screen.getByTestId('workflow-name-input'), 'Test WF');
    await userEvent.type(screen.getByTestId('workflow-step-title-0'), 'Step 1');
    await userEvent.type(screen.getByTestId('workflow-step-toolName-0'), 'status.query');

    await userEvent.click(screen.getByTestId('workflow-save'));
    await waitFor(() => {
      expect(client.createWorkflowDraft).toHaveBeenCalled();
    });

    await userEvent.click(screen.getByTestId('workflow-validate'));
    await waitFor(() => {
      expect(client.validateWorkflowDraft).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(screen.getByTestId('workflow-publish')).not.toBeDisabled();
    });

    await userEvent.type(screen.getByTestId('workflow-name-input'), 'X');
    await waitFor(() => {
      expect(screen.getByTestId('workflow-publish')).toBeDisabled();
    });

    await userEvent.click(screen.getByTestId('workflow-publish'));
    expect(client.publishWorkflowDraft).not.toHaveBeenCalled();
  });

  it('blocks publish when validation returns errors on saved draft', async () => {
    const draft = makeDraft({ steps: [{ stepId: 's1', stepType: 'tool_call' as const, name: '', config: {} }] });
    vi.mocked(client.createWorkflowDraft).mockResolvedValue(draft);
    vi.mocked(client.updateWorkflowDraft).mockResolvedValue(draft);
    vi.mocked(client.getWorkflowDraft).mockResolvedValue(draft);
    vi.mocked(client.validateWorkflowDraft).mockResolvedValue({
      valid: false,
      issues: [{ code: 'MISSING_TOOL_NAME', message: '缺少工具名称', severity: 'error' }],
    });

    render(<WorkflowsTab />);
    await waitFor(() => {
      expect(screen.getByTestId('workflows-panel')).toBeInTheDocument();
    });

    await userEvent.type(screen.getByTestId('workflow-name-input'), 'Test WF');
    await userEvent.type(screen.getByTestId('workflow-step-title-0'), 'Step 1');

    await userEvent.click(screen.getByTestId('workflow-save'));
    await waitFor(() => {
      expect(client.createWorkflowDraft).toHaveBeenCalled();
    });

    await userEvent.click(screen.getByTestId('workflow-validate'));
    await waitFor(() => {
      expect(screen.getByTestId('workflow-validation-errors')).toBeInTheDocument();
    });

    expect(screen.getByTestId('workflow-publish')).toBeDisabled();
    await userEvent.click(screen.getByTestId('workflow-publish'));
    expect(client.publishWorkflowDraft).not.toHaveBeenCalled();
  });

  it('creates, reorders, validates, publishes, and runs a workflow', async () => {
    const draft = makeDraft({
      steps: [
        { stepId: 'step-1', stepType: 'tool_call' as const, name: 'Check status', config: { toolName: 'status.query' } },
        { stepId: 'step-2', stepType: 'tool_call' as const, name: 'Ask approval', config: {} },
      ],
    });
    const definition = makeDefinition();
    const run = makeRun();

    vi.mocked(client.createWorkflowDraft).mockResolvedValue(draft);
    vi.mocked(client.updateWorkflowDraft).mockResolvedValue(draft);
    vi.mocked(client.getWorkflowDraft).mockResolvedValue(draft);
    vi.mocked(client.validateWorkflowDraft).mockResolvedValue({ valid: true, issues: [] });
    vi.mocked(client.publishWorkflowDraft).mockResolvedValue(definition);
    vi.mocked(client.startWorkflowRun).mockResolvedValue(run);
    vi.mocked(client.listWorkflowDrafts).mockResolvedValue([draft]);
    vi.mocked(client.listWorkflowDefinitions).mockResolvedValue([definition]);

    render(<WorkflowsTab />);
    await waitFor(() => {
      expect(screen.getByTestId('workflows-panel')).toBeInTheDocument();
    });

    await userEvent.type(screen.getByTestId('workflow-name-input'), 'P0 Builder Smoke');
    await userEvent.type(screen.getByTestId('workflow-step-title-0'), 'Check status');
    await userEvent.type(screen.getByTestId('workflow-step-toolName-0'), 'status.query');

    await userEvent.click(screen.getByTestId('workflow-add-step'));
    await waitFor(() => {
      expect(screen.getByTestId('workflow-step-title-1')).toBeInTheDocument();
    });

    await userEvent.type(screen.getByTestId('workflow-step-title-1'), 'Ask approval');
    await userEvent.click(screen.getByTestId('workflow-step-up-1'));

    await userEvent.click(screen.getByTestId('workflow-save'));
    await waitFor(() => {
      expect(client.createWorkflowDraft).toHaveBeenCalled();
    });

    await userEvent.click(screen.getByTestId('workflow-validate'));
    await waitFor(() => {
      expect(client.validateWorkflowDraft).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(screen.getByTestId('workflow-publish')).not.toBeDisabled();
    });

    await userEvent.click(screen.getByTestId('workflow-publish'));
    await waitFor(() => {
      expect(client.publishWorkflowDraft).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(screen.getByTestId('workflow-run')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByTestId('workflow-run'));
    await waitFor(() => {
      expect(screen.getByTestId('workflow-run-result')).toBeInTheDocument();
    });

    expect(screen.getByTestId('workflow-run-id')).toHaveTextContent('run-1');
    expect(screen.getByTestId('workflow-run-status')).toHaveTextContent('pending');
  });

  it('adds and removes steps', async () => {
    render(<WorkflowsTab />);
    await waitFor(() => {
      expect(screen.getByTestId('workflows-panel')).toBeInTheDocument();
    });

    expect(screen.getByTestId('workflow-step-0')).toBeInTheDocument();

    await userEvent.click(screen.getByTestId('workflow-add-step'));
    await waitFor(() => {
      expect(screen.getByTestId('workflow-step-1')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByTestId('workflow-step-remove-0'));
    await waitFor(() => {
      expect(screen.queryByTestId('workflow-step-1')).not.toBeInTheDocument();
    });

    expect(screen.getByTestId('workflow-step-0')).toBeInTheDocument();
  });

  it('displays existing drafts in sidebar', async () => {
    vi.mocked(client.listWorkflowDrafts).mockResolvedValue([
      makeDraft({ draftId: 'draft-existing', name: 'Existing Draft' }),
    ]);

    render(<WorkflowsTab />);
    await waitFor(() => {
      expect(screen.getByText('Existing Draft')).toBeInTheDocument();
    });
  });

  it('shows error when save fails', async () => {
    vi.mocked(client.createWorkflowDraft).mockRejectedValue(new Error('Server error'));

    render(<WorkflowsTab />);
    await waitFor(() => {
      expect(screen.getByTestId('workflows-panel')).toBeInTheDocument();
    });

    await userEvent.type(screen.getByTestId('workflow-name-input'), 'Test');
    await userEvent.click(screen.getByTestId('workflow-save'));

    await waitFor(() => {
      expect(screen.getByTestId('workflow-error')).toBeInTheDocument();
    });

    expect(screen.getByText('Server error')).toBeInTheDocument();
  });
});
