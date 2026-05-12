import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import ObservabilityTab from './ObservabilityTab';
import type { RunEntry, ConsoleResponse, ReplayPreviewResponse } from '../../api/observability';

vi.mock('../../api/observability', () => ({
  getRuns: vi.fn(),
  getRunConsole: vi.fn(),
  getReplayPreview: vi.fn(),
}));

import { getRuns, getRunConsole, getReplayPreview } from '../../api/observability';

const mockRuns: RunEntry[] = [
  {
    id: 'run-1',
    type: 'planner_run',
    status: 'running',
    createdAt: '2024-01-01T00:00:00Z',
    summary: 'Test run 1',
  },
  {
    id: 'run-2',
    type: 'workflow_run',
    status: 'completed',
    createdAt: '2024-01-01T01:00:00Z',
    summary: 'Test run 2',
  },
  {
    id: 'run-3',
    type: 'planner_run',
    status: 'failed',
    createdAt: '2024-01-01T02:00:00Z',
    summary: 'Test run 3',
  },
];

const mockConsoleResponse: ConsoleResponse = {
  runId: 'run-2',
  status: 'completed',
  timeline: [
    {
      eventId: 'event-1',
      eventType: 'run_started',
      timestamp: '2024-01-01T01:00:00Z',
      summary: 'Run started',
    },
    {
      eventId: 'event-2',
      eventType: 'step_completed',
      timestamp: '2024-01-01T01:05:00Z',
      summary: 'Step completed',
    },
    {
      eventId: 'event-3',
      eventType: 'run_completed',
      timestamp: '2024-01-01T01:10:00Z',
      summary: 'Run completed',
    },
  ],
};

const mockReplayResponse: ReplayPreviewResponse = {
  runId: 'run-2',
  mode: 'safe',
  timeline: [
    {
      eventId: 'event-1',
      eventType: 'run_started',
      timestamp: '2024-01-01T01:00:00Z',
      summary: 'Run started',
    },
  ],
  blockedActions: [],
};

const mockReplayWithBlockedActions: ReplayPreviewResponse = {
  runId: 'run-3',
  mode: 'safe',
  timeline: [
    {
      eventId: 'event-1',
      eventType: 'run_started',
      timestamp: '2024-01-01T02:00:00Z',
      summary: 'Run started',
    },
  ],
  blockedActions: [
    {
      eventId: 'event-2',
      action: 'file_delete',
      reason: 'Dangerous operation blocked',
    },
  ],
};

describe('ObservabilityTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getRuns as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders run list with status filter dropdown', async () => {
    (getRuns as ReturnType<typeof vi.fn>).mockResolvedValue(mockRuns);

    render(<ObservabilityTab />);

    await waitFor(() => {
      expect(screen.getByTestId('observability-runs-list')).toBeInTheDocument();
    });

    expect(screen.getByTestId('status-filter')).toBeInTheDocument();
    expect(screen.getByText('run-1')).toBeInTheDocument();
    expect(screen.getByText('run-2')).toBeInTheDocument();
    expect(screen.getByText('run-3')).toBeInTheDocument();
  });

  it('click run expands timeline view with events sorted chronologically', async () => {
    (getRuns as ReturnType<typeof vi.fn>).mockResolvedValue(mockRuns);
    (getRunConsole as ReturnType<typeof vi.fn>).mockResolvedValue(mockConsoleResponse);

    render(<ObservabilityTab />);

    await waitFor(() => {
      expect(screen.getByTestId('observability-runs-list')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('run-header-run-2'));

    await waitFor(() => {
      expect(getRunConsole).toHaveBeenCalledWith('run-2');
    });

    await waitFor(() => {
      expect(screen.getByText('时间线')).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(screen.getByText('Run started')).toBeInTheDocument();
    });
  });

  it('completed runs show "回放预览" button', async () => {
    (getRuns as ReturnType<typeof vi.fn>).mockResolvedValue(mockRuns);
    (getRunConsole as ReturnType<typeof vi.fn>).mockResolvedValue(mockConsoleResponse);

    render(<ObservabilityTab />);

    await waitFor(() => {
      expect(screen.getByTestId('observability-runs-list')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('run-header-run-2'));

    await waitFor(() => {
      expect(screen.getByTestId('replay-preview-button-run-2')).toBeInTheDocument();
    });

    expect(screen.getByText('回放预览')).toBeInTheDocument();
  });

  it('failed runs show "回放预览" button', async () => {
    (getRuns as ReturnType<typeof vi.fn>).mockResolvedValue(mockRuns);
    (getRunConsole as ReturnType<typeof vi.fn>).mockResolvedValue(mockConsoleResponse);

    render(<ObservabilityTab />);

    await waitFor(() => {
      expect(screen.getByTestId('observability-runs-list')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('run-header-run-3'));

    await waitFor(() => {
      expect(screen.getByTestId('replay-preview-button-run-3')).toBeInTheDocument();
    });
  });

  it('running runs do NOT show "回放预览" button', async () => {
    (getRuns as ReturnType<typeof vi.fn>).mockResolvedValue(mockRuns);
    (getRunConsole as ReturnType<typeof vi.fn>).mockResolvedValue(mockConsoleResponse);

    render(<ObservabilityTab />);

    await waitFor(() => {
      expect(screen.getByTestId('observability-runs-list')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('run-header-run-1'));

    await waitFor(() => {
      expect(getRunConsole).toHaveBeenCalledWith('run-1');
    });

    expect(screen.queryByTestId('replay-preview-button-run-1')).not.toBeInTheDocument();
  });

  it('Replay Preview button opens modal with timeline events, no actions', async () => {
    (getRuns as ReturnType<typeof vi.fn>).mockResolvedValue(mockRuns);
    (getRunConsole as ReturnType<typeof vi.fn>).mockResolvedValue(mockConsoleResponse);
    (getReplayPreview as ReturnType<typeof vi.fn>).mockResolvedValue(mockReplayResponse);

    render(<ObservabilityTab />);

    await waitFor(() => {
      expect(screen.getByTestId('observability-runs-list')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('run-header-run-2'));

    await waitFor(() => {
      expect(screen.getByTestId('replay-preview-button-run-2')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('replay-preview-button-run-2'));

    await waitFor(() => {
      expect(screen.getByTestId('replay-preview-modal')).toBeInTheDocument();
    });

    expect(screen.getByTestId('no-blocked-actions')).toBeInTheDocument();
    expect(screen.getByText('无阻塞操作')).toBeInTheDocument();
  });

  it('shows blocked actions when replay has blocked actions', async () => {
    (getRuns as ReturnType<typeof vi.fn>).mockResolvedValue(mockRuns);
    (getRunConsole as ReturnType<typeof vi.fn>).mockResolvedValue(mockConsoleResponse);
    (getReplayPreview as ReturnType<typeof vi.fn>).mockResolvedValue(mockReplayWithBlockedActions);

    render(<ObservabilityTab />);

    await waitFor(() => {
      expect(screen.getByTestId('observability-runs-list')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('run-header-run-3'));

    await waitFor(() => {
      expect(screen.getByTestId('replay-preview-button-run-3')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('replay-preview-button-run-3'));

    await waitFor(() => {
      expect(screen.getByTestId('replay-preview-modal')).toBeInTheDocument();
    });

    expect(screen.getByText('Dangerous operation blocked')).toBeInTheDocument();
  });

  it('shows loading state', async () => {
    (getRuns as ReturnType<typeof vi.fn>).mockImplementation(() => 
      new Promise(() => {})
    );

    render(<ObservabilityTab />);

    expect(screen.getByTestId('observability-loading')).toBeInTheDocument();
    expect(screen.getByText('加载中...')).toBeInTheDocument();
  });

  it('shows empty state when no runs', async () => {
    (getRuns as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    render(<ObservabilityTab />);

    await waitFor(() => {
      expect(screen.getByTestId('observability-empty')).toBeInTheDocument();
    });

    expect(screen.getByText('暂无运行记录')).toBeInTheDocument();
  });

  it('shows error state on fetch failure', async () => {
    (getRuns as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Network error'));

    render(<ObservabilityTab />);

    await waitFor(() => {
      expect(screen.getByTestId('observability-error')).toBeInTheDocument();
    });

    expect(screen.getByText('Network error')).toBeInTheDocument();
  });

  it('filter changes call API with correct status', async () => {
    (getRuns as ReturnType<typeof vi.fn>).mockResolvedValue(mockRuns);

    render(<ObservabilityTab />);

    await waitFor(() => {
      expect(screen.getByTestId('observability-runs-list')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId('status-filter'), { target: { value: 'completed' } });

    await waitFor(() => {
      expect(getRuns).toHaveBeenCalledWith('completed');
    });
  });

  it('closes modal when close button clicked', async () => {
    (getRuns as ReturnType<typeof vi.fn>).mockResolvedValue(mockRuns);
    (getRunConsole as ReturnType<typeof vi.fn>).mockResolvedValue(mockConsoleResponse);
    (getReplayPreview as ReturnType<typeof vi.fn>).mockResolvedValue(mockReplayResponse);

    render(<ObservabilityTab />);

    await waitFor(() => {
      expect(screen.getByTestId('observability-runs-list')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('run-header-run-2'));

    await waitFor(() => {
      expect(screen.getByTestId('replay-preview-button-run-2')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('replay-preview-button-run-2'));

    await waitFor(() => {
      expect(screen.getByTestId('replay-preview-modal')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('replay-preview-close'));

    await waitFor(() => {
      expect(screen.queryByTestId('replay-preview-modal')).not.toBeInTheDocument();
    });
  });
});
