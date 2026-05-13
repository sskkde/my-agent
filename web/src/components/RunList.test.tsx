import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import RunList, { type RunListItem } from './RunList';

const mockRuns: RunListItem[] = [
  {
    id: 'run-1',
    type: 'planner_run',
    status: 'running',
    summary: 'Processing task',
    createdAt: '2024-01-15T10:30:00Z',
  },
  {
    id: 'run-2',
    type: 'workflow_run',
    status: 'completed',
    summary: 'Workflow completed successfully',
    createdAt: '2024-01-15T09:00:00Z',
  },
  {
    id: 'run-3',
    type: 'background_run',
    status: 'failed',
    summary: 'Background task failed',
    createdAt: '2024-01-14T15:00:00Z',
  },
  {
    id: 'run-4',
    type: 'planner_run',
    status: 'cancelled',
    summary: 'Cancelled by user',
    createdAt: '2024-01-14T10:00:00Z',
  },
  {
    id: 'run-5',
    type: 'workflow_run',
    status: 'pending',
    summary: 'Waiting to start',
    createdAt: '2024-01-16T08:00:00Z',
  },
];

describe('RunList', () => {
  it('renders loading state', () => {
    render(<RunList runs={[]} onRunClick={() => {}} loading />);

    expect(screen.getByTestId('loading-spinner')).toBeInTheDocument();
  });

  it('renders empty state when no runs', () => {
    render(<RunList runs={[]} onRunClick={() => {}} />);

    expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    expect(screen.getByText('暂无运行记录')).toBeInTheDocument();
  });

  it('renders all runs by default', () => {
    render(<RunList runs={mockRuns} onRunClick={() => {}} />);

    expect(screen.getByTestId('run-row-run-1')).toBeInTheDocument();
    expect(screen.getByTestId('run-row-run-2')).toBeInTheDocument();
    expect(screen.getByTestId('run-row-run-3')).toBeInTheDocument();
    expect(screen.getByTestId('run-row-run-4')).toBeInTheDocument();
    expect(screen.getByTestId('run-row-run-5')).toBeInTheDocument();
  });

  it('filters by active status', () => {
    render(<RunList runs={mockRuns} onRunClick={() => {}} />);

    fireEvent.click(screen.getByTestId('filter-active'));

    expect(screen.getByTestId('run-row-run-1')).toBeInTheDocument();
    expect(screen.getByTestId('run-row-run-5')).toBeInTheDocument();
    expect(screen.queryByTestId('run-row-run-2')).not.toBeInTheDocument();
    expect(screen.queryByTestId('run-row-run-3')).not.toBeInTheDocument();
    expect(screen.queryByTestId('run-row-run-4')).not.toBeInTheDocument();
  });

  it('filters by completed status', () => {
    render(<RunList runs={mockRuns} onRunClick={() => {}} />);

    fireEvent.click(screen.getByTestId('filter-completed'));

    expect(screen.getByTestId('run-row-run-2')).toBeInTheDocument();
    expect(screen.queryByTestId('run-row-run-1')).not.toBeInTheDocument();
  });

  it('filters by failed status', () => {
    render(<RunList runs={mockRuns} onRunClick={() => {}} />);

    fireEvent.click(screen.getByTestId('filter-failed'));

    expect(screen.getByTestId('run-row-run-3')).toBeInTheDocument();
    expect(screen.queryByTestId('run-row-run-1')).not.toBeInTheDocument();
  });

  it('filters by cancelled status', () => {
    render(<RunList runs={mockRuns} onRunClick={() => {}} />);

    fireEvent.click(screen.getByTestId('filter-cancelled'));

    expect(screen.getByTestId('run-row-run-4')).toBeInTheDocument();
    expect(screen.queryByTestId('run-row-run-1')).not.toBeInTheDocument();
  });

  it('shows all runs when clicking all filter', () => {
    render(<RunList runs={mockRuns} onRunClick={() => {}} />);

    fireEvent.click(screen.getByTestId('filter-failed'));
    fireEvent.click(screen.getByTestId('filter-all'));

    expect(screen.getByTestId('run-row-run-1')).toBeInTheDocument();
    expect(screen.getByTestId('run-row-run-2')).toBeInTheDocument();
    expect(screen.getByTestId('run-row-run-3')).toBeInTheDocument();
  });

  it('calls onRunClick when row is clicked', () => {
    const handleClick = vi.fn();
    render(<RunList runs={mockRuns} onRunClick={handleClick} />);

    fireEvent.click(screen.getByTestId('run-row-run-1'));

    expect(handleClick).toHaveBeenCalledWith('run-1');
  });

  it('shows cancel button for running runs', () => {
    render(<RunList runs={mockRuns} onRunClick={() => {}} onCancel={() => {}} />);

    expect(screen.getByTestId('cancel-btn-run-1')).toBeInTheDocument();
    expect(screen.queryByTestId('cancel-btn-run-2')).not.toBeInTheDocument();
  });

  it('shows cancel button for pending runs', () => {
    render(<RunList runs={mockRuns} onRunClick={() => {}} onCancel={() => {}} />);

    expect(screen.getByTestId('cancel-btn-run-5')).toBeInTheDocument();
  });

  it('shows retry button for failed runs', () => {
    render(<RunList runs={mockRuns} onRunClick={() => {}} onRetry={() => {}} />);

    expect(screen.getByTestId('retry-btn-run-3')).toBeInTheDocument();
    expect(screen.queryByTestId('retry-btn-run-1')).not.toBeInTheDocument();
  });

  it('calls onCancel when cancel button is clicked', () => {
    const handleCancel = vi.fn();
    render(<RunList runs={mockRuns} onRunClick={() => {}} onCancel={handleCancel} />);

    fireEvent.click(screen.getByTestId('cancel-btn-run-1'));

    expect(handleCancel).toHaveBeenCalledWith('run-1');
  });

  it('calls onRetry when retry button is clicked', () => {
    const handleRetry = vi.fn();
    render(<RunList runs={mockRuns} onRunClick={() => {}} onRetry={handleRetry} />);

    fireEvent.click(screen.getByTestId('retry-btn-run-3'));

    expect(handleRetry).toHaveBeenCalledWith('run-3');
  });

  it('does not call onRunClick when action button is clicked', () => {
    const handleClick = vi.fn();
    const handleCancel = vi.fn();
    render(<RunList runs={mockRuns} onRunClick={handleClick} onCancel={handleCancel} />);

    fireEvent.click(screen.getByTestId('cancel-btn-run-1'));

    expect(handleClick).not.toHaveBeenCalled();
    expect(handleCancel).toHaveBeenCalled();
  });

  it('displays correct status badges', () => {
    render(<RunList runs={mockRuns} onRunClick={() => {}} />);

    expect(screen.getByTestId('status-badge-run-1')).toHaveTextContent('运行中');
    expect(screen.getByTestId('status-badge-run-2')).toHaveTextContent('已完成');
    expect(screen.getByTestId('status-badge-run-3')).toHaveTextContent('失败');
    expect(screen.getByTestId('status-badge-run-4')).toHaveTextContent('已取消');
    expect(screen.getByTestId('status-badge-run-5')).toHaveTextContent('等待中');
  });

  it('displays correct type labels', () => {
    render(<RunList runs={mockRuns} onRunClick={() => {}} />);

    const typeLabels = screen.getAllByText('计划运行');
    expect(typeLabels.length).toBe(2);

    const workflowLabels = screen.getAllByText('工作流');
    expect(workflowLabels.length).toBe(2);

    expect(screen.getByText('后台任务')).toBeInTheDocument();
  });

  it('renders filter chips with correct active state', () => {
    render(<RunList runs={mockRuns} onRunClick={() => {}} />);

    const allFilter = screen.getByTestId('filter-all');
    expect(allFilter).toHaveClass('run-list__filter-chip--active');

    fireEvent.click(screen.getByTestId('filter-failed'));
    expect(allFilter).not.toHaveClass('run-list__filter-chip--active');
    expect(screen.getByTestId('filter-failed')).toHaveClass('run-list__filter-chip--active');
  });

  it('shows empty state message for filtered results', () => {
    const singleRun: RunListItem[] = [
      { id: 'run-1', type: 'planner_run', status: 'running', summary: 'Test', createdAt: '2024-01-01T00:00:00Z' },
    ];
    render(<RunList runs={singleRun} onRunClick={() => {}} />);

    fireEvent.click(screen.getByTestId('filter-failed'));

    expect(screen.getByText('当前筛选条件下没有运行记录')).toBeInTheDocument();
  });
});
