import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { respondApproval } from './client';

describe('respondApproval', () => {
  const originalFetch = global.fetch;
  const mockFetch = vi.fn();

  beforeEach(() => {
    global.fetch = mockFetch;
    mockFetch.mockReset();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('normalizes legacy "approved" to approve_once', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        approvalId: 'test-id',
        status: 'approved'
      })
    });

    await respondApproval('test-id', 'approved', 'test reason');

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/approvals/test-id'),
      expect.objectContaining({
        method: 'PATCH',
        body: expect.any(String)
      })
    );

    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(callBody).toEqual({
      decision: 'approved',
      responseType: 'approve_once',
      reason: 'test reason'
    });
  });

  it('normalizes legacy "rejected" to reject', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        approvalId: 'test-id',
        status: 'rejected'
      })
    });

    await respondApproval('test-id', 'rejected');

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/approvals/test-id'),
      expect.objectContaining({
        method: 'PATCH',
        body: expect.any(String)
      })
    );

    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(callBody).toEqual({
      decision: 'rejected',
      responseType: 'reject',
      reason: undefined
    });
  });

  it('passes "approve_once" directly', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        approvalId: 'test-id',
        status: 'approved'
      })
    });

    await respondApproval('test-id', 'approve_once');

    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(callBody).toEqual({
      responseType: 'approve_once',
      reason: undefined
    });
  });

  it('passes "approve_always" directly', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        approvalId: 'test-id',
        status: 'approved'
      })
    });

    await respondApproval('test-id', 'approve_always', 'always approve');

    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(callBody).toEqual({
      responseType: 'approve_always',
      reason: 'always approve'
    });
  });

  it('passes "reject" directly', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        approvalId: 'test-id',
        status: 'rejected'
      })
    });

    await respondApproval('test-id', 'reject');

    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(callBody).toEqual({
      responseType: 'reject',
      reason: undefined
    });
  });
});
