import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import RunDetailView from './RunDetailView';
import type { RunInfo, PlannerRunEvent, PlannerRunSummary } from '../../api/types';

vi.mock('../../api/client', () => ({
  getPlannerRunEvents: vi.fn(),
  getPlannerRunSummary: vi.fn(),
}));

import { getPlannerRunEvents, getPlannerRunSummary } from '../../api/client';

const mockRun: RunInfo & { plannerRunId?: string } = {
  runId: 'run-123',
  status: 'running',
  objective: 'Test objective',
  progress: 50,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T01:00:00Z',
  plannerRunId: 'planner-run-456',
};

const mockEvents: PlannerRunEvent[] = [
  {
    eventId: 'event-1',
    eventType: 'planner_run_started',
    timestamp: '2024-01-01T00:00:00Z',
    payload: { goal: 'Test goal' },
  },
  {
    eventId: 'event-2',
    eventType: 'step_started',
    timestamp: '2024-01-01T00:01:00Z',
    payload: { stepId: 'step-1', stepName: 'Read file' },
  },
  {
    eventId: 'event-3',
    eventType: 'step_completed',
    timestamp: '2024-01-01T00:02:00Z',
    payload: { stepId: 'step-1' },
  },
];

const mockSummary: PlannerRunSummary = {
  plannerRunId: 'planner-run-456',
  status: 'running',
  goal: 'Test goal',
  stepCount: 3,
  currentStep: 'step-1',
  planVersion: 1,
};

describe('RunDetailView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getPlannerRunEvents as ReturnType<typeof vi.fn>).mockResolvedValue({ events: [], total: 0 });
    (getPlannerRunSummary as ReturnType<typeof vi.fn>).mockResolvedValue({ summary: null });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows loading state initially', async () => {
    (getPlannerRunEvents as ReturnType<typeof vi.fn>).mockImplementation(() => new Promise(() => {}));
    (getPlannerRunSummary as ReturnType<typeof vi.fn>).mockImplementation(() => new Promise(() => {}));

    render(<RunDetailView run={mockRun} />);

    expect(screen.getByTestId('run-detail-loading')).toBeInTheDocument();
    expect(screen.getByText('加载中...')).toBeInTheDocument();
  });

  it('renders run metadata when loaded', async () => {
    (getPlannerRunEvents as ReturnType<typeof vi.fn>).mockResolvedValue({ events: mockEvents, total: 3 });
    (getPlannerRunSummary as ReturnType<typeof vi.fn>).mockResolvedValue({ summary: mockSummary });

    render(<RunDetailView run={mockRun} />);

    await waitFor(() => {
      expect(screen.getByTestId('run-detail-view')).toBeInTheDocument();
    });

    expect(screen.getByText('run-123')).toBeInTheDocument();
    expect(screen.getByText('运行中')).toBeInTheDocument();
    expect(screen.getByText('Test goal')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('step-1')).toBeInTheDocument();
    expect(screen.getByText('v1')).toBeInTheDocument();
  });

  it('renders timeline events in chronological order', async () => {
    (getPlannerRunEvents as ReturnType<typeof vi.fn>).mockResolvedValue({ events: mockEvents, total: 3 });
    (getPlannerRunSummary as ReturnType<typeof vi.fn>).mockResolvedValue({ summary: mockSummary });

    render(<RunDetailView run={mockRun} />);

    await waitFor(() => {
      expect(screen.getByText('计划运行开始')).toBeInTheDocument();
    });

    expect(screen.getByText('步骤开始')).toBeInTheDocument();
    expect(screen.getByText('步骤完成')).toBeInTheDocument();
  });

  it('shows empty state when no timeline events', async () => {
    (getPlannerRunEvents as ReturnType<typeof vi.fn>).mockResolvedValue({ events: [], total: 0 });
    (getPlannerRunSummary as ReturnType<typeof vi.fn>).mockResolvedValue({ summary: mockSummary });

    render(<RunDetailView run={mockRun} />);

    await waitFor(() => {
      expect(screen.getByText('暂无时间线事件')).toBeInTheDocument();
    });
  });

  it('shows error state on API failure', async () => {
    (getPlannerRunEvents as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('API error'));
    (getPlannerRunSummary as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('API error'));

    render(<RunDetailView run={mockRun} />);

    await waitFor(() => {
      expect(screen.getByTestId('run-detail-error')).toBeInTheDocument();
    });

    expect(screen.getByText('API error')).toBeInTheDocument();
  });

  it('handles run without plannerRunId', async () => {
    const runWithoutPlanner: RunInfo = {
      runId: 'run-789',
      status: 'completed',
      objective: 'Simple run',
      createdAt: '2024-01-01T00:00:00Z',
    };

    render(<RunDetailView run={runWithoutPlanner} />);

    await waitFor(() => {
      expect(screen.getByTestId('run-detail-no-planner')).toBeInTheDocument();
    });

    expect(screen.getByText('此运行无计划运行详情')).toBeInTheDocument();
    expect(getPlannerRunEvents).not.toHaveBeenCalled();
    expect(getPlannerRunSummary).not.toHaveBeenCalled();
  });

  it('renders close button when onClose provided', async () => {
    const onClose = vi.fn();

    render(<RunDetailView run={mockRun} onClose={onClose} />);

    await waitFor(() => {
      expect(screen.getByTestId('run-detail-close')).toBeInTheDocument();
    });
  });

  it('calls onClose when close button clicked', async () => {
    const onClose = vi.fn();

    render(<RunDetailView run={mockRun} onClose={onClose} />);

    await waitFor(() => {
      expect(screen.getByTestId('run-detail-close')).toBeInTheDocument();
    });

    screen.getByTestId('run-detail-close').click();

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not render close button when onClose not provided', async () => {
    render(<RunDetailView run={mockRun} />);

    await waitFor(() => {
      expect(screen.getByTestId('run-detail-view')).toBeInTheDocument();
    });

    expect(screen.queryByTestId('run-detail-close')).not.toBeInTheDocument();
  });

  it('displays correct status badges for different states', async () => {
    const completedRun: RunInfo & { plannerRunId?: string } = {
      ...mockRun,
      status: 'completed',
    };

    (getPlannerRunSummary as ReturnType<typeof vi.fn>).mockResolvedValue({ summary: { ...mockSummary, status: 'completed' } });

    render(<RunDetailView run={completedRun} />);

    await waitFor(() => {
      expect(screen.getByText('已完成')).toBeInTheDocument();
    });

    const badge = screen.getByText('已完成');
    expect(badge.className).toContain('status-completed');
  });

  it('shows progress percentage when available', async () => {
    (getPlannerRunSummary as ReturnType<typeof vi.fn>).mockResolvedValue({ summary: mockSummary });

    render(<RunDetailView run={mockRun} />);

    await waitFor(() => {
      expect(screen.getByText('50%')).toBeInTheDocument();
    });
  });

  it('does not show progress when not available', async () => {
    const runWithoutProgress: RunInfo & { plannerRunId?: string } = {
      ...mockRun,
      progress: undefined,
    };

    (getPlannerRunSummary as ReturnType<typeof vi.fn>).mockResolvedValue({ summary: mockSummary });

    render(<RunDetailView run={runWithoutProgress} />);

    await waitFor(() => {
      expect(screen.getByTestId('run-detail-view')).toBeInTheDocument();
    });

    expect(screen.queryByText('进度:')).not.toBeInTheDocument();
  });
});
