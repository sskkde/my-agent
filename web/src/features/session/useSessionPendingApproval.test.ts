/**
 * useSessionPendingApproval Tests
 *
 * NOTE: This is a STUB test file for Task 4 (boundary definition).
 * Full hook tests will be added in Task 12.
 *
 * This test verifies:
 * - Hook returns correct interface
 * - Selection rule: earliest requestedAt for pending approvals in session
 */

import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useSessionPendingApproval } from './useSessionPendingApproval';
import * as client from '../../api/client';

// Mock the API client
vi.mock('../../api/client', () => ({
  getApprovals: vi.fn(),
}));

describe('useSessionPendingApproval', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Stub test: verify hook returns correct interface
  it('returns correct interface', async () => {
    (client.getApprovals as ReturnType<typeof vi.fn>).mockResolvedValue({
      approvals: [],
    });

    const { result } = renderHook(() => useSessionPendingApproval('session-1'));

    // Wait for initial fetch to complete to avoid act warnings
    await waitFor(() => expect(result.current.loading).toBe(false));

    // Verify return type has expected properties
    expect(result.current).toHaveProperty('pendingApproval');
    expect(result.current).toHaveProperty('loading');
    expect(result.current).toHaveProperty('error');
    expect(result.current).toHaveProperty('refresh');
    expect(typeof result.current.refresh).toBe('function');
  });

  // Stub test: verify selection rule (earliest requestedAt)
  it('selects earliest pending approval by requestedAt', async () => {
    const mockApprovals = [
      {
        id: 'approval-2',
        sessionId: 'session-1',
        status: 'pending',
        requestedAt: '2024-01-01T12:00:00Z',
        requestedBy: 'user-1',
        actionType: 'exec',
      },
      {
        id: 'approval-1',
        sessionId: 'session-1',
        status: 'pending',
        requestedAt: '2024-01-01T10:00:00Z', // Earlier
        requestedBy: 'user-1',
        actionType: 'exec',
      },
      {
        id: 'approval-3',
        sessionId: 'session-1',
        status: 'approved', // Not pending
        requestedAt: '2024-01-01T08:00:00Z',
        requestedBy: 'user-1',
        actionType: 'exec',
      },
      {
        id: 'approval-4',
        sessionId: 'session-2', // Different session
        status: 'pending',
        requestedAt: '2024-01-01T09:00:00Z',
        requestedBy: 'user-1',
        actionType: 'exec',
      },
    ];

    (client.getApprovals as ReturnType<typeof vi.fn>).mockResolvedValue({
      approvals: mockApprovals,
    });

    const { result } = renderHook(() =>
      useSessionPendingApproval('session-1')
    );

    await waitFor(() => expect(result.current.pendingApproval).not.toBeNull());

    // Should select approval-1 (earliest pending for session-1)
    expect(result.current.pendingApproval?.id).toBe('approval-1');
  });

  // Stub test: verify null sessionId returns null approval
  it('returns null approval when sessionId is null', () => {
    const { result } = renderHook(() => useSessionPendingApproval(null));

    expect(result.current.pendingApproval).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  // Task 12 will add:
  // - Test: handles API errors gracefully
  // - Test: refresh function refetches approvals
  // - Test: returns expired approvals (UI handles expiration)
  // - Test: loading state during fetch
  // - Test: re-fetches when sessionId changes
});
