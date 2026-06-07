import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useApprovalActions } from './ApprovalActionHandler'

vi.mock('../../api/client', () => ({
  respondApproval: vi.fn(),
}))

import * as api from '../../api/client'

const mockRespondApproval = api.respondApproval as ReturnType<typeof vi.fn>

describe('useApprovalActions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('approve calls API correctly', async () => {
    mockRespondApproval.mockResolvedValue({ success: true })

    const { result } = renderHook(() => useApprovalActions())

    await act(async () => {
      await result.current.approve('approval-123')
    })

    expect(mockRespondApproval).toHaveBeenCalledWith('approval-123', 'approved')
  })

  it('reject calls API correctly', async () => {
    mockRespondApproval.mockResolvedValue({ success: true })

    const { result } = renderHook(() => useApprovalActions())

    await act(async () => {
      await result.current.reject('approval-456', 'Not valid')
    })

    expect(mockRespondApproval).toHaveBeenCalledWith('approval-456', 'rejected', 'Not valid')
  })

  it('reject works without reason', async () => {
    mockRespondApproval.mockResolvedValue({ success: true })

    const { result } = renderHook(() => useApprovalActions())

    await act(async () => {
      await result.current.reject('approval-789')
    })

    expect(mockRespondApproval).toHaveBeenCalledWith('approval-789', 'rejected', undefined)
  })

  it('loading state is managed correctly', async () => {
    mockRespondApproval.mockResolvedValue({ success: true })

    const { result } = renderHook(() => useApprovalActions())

    expect(result.current.isSubmitting).toBe(false)

    await act(async () => {
      await result.current.approve('approval-loading')
    })

    expect(result.current.isSubmitting).toBe(false)
  })

  it('loading state is true while approve is in flight', async () => {
    let resolveApprove: (value: { success: boolean }) => void = () => {}
    const pendingPromise = new Promise<{ success: boolean }>((resolve) => {
      resolveApprove = resolve
    })
    mockRespondApproval.mockReturnValue(pendingPromise)

    const { result } = renderHook(() => useApprovalActions())

    expect(result.current.isSubmitting).toBe(false)

    let approvePromise: Promise<void>
    act(() => {
      approvePromise = result.current.approve('approval-pending')
    })

    expect(result.current.isSubmitting).toBe(true)

    await act(async () => {
      resolveApprove({ success: true })
      await approvePromise!
    })

    expect(result.current.isSubmitting).toBe(false)
  })

  it('error state on API failure', async () => {
    mockRespondApproval.mockRejectedValue(new Error('Network error'))

    const { result } = renderHook(() => useApprovalActions())

    expect(result.current.error).toBeNull()

    await act(async () => {
      try {
        await result.current.approve('approval-error')
      } catch {}
    })

    expect(result.current.error).toBe('Network error')
  })

  it('error state on reject API failure', async () => {
    mockRespondApproval.mockRejectedValue(new Error('Reject failed'))

    const { result } = renderHook(() => useApprovalActions())

    expect(result.current.error).toBeNull()

    await act(async () => {
      try {
        await result.current.reject('approval-reject-error', 'Bad request')
      } catch {}
    })

    expect(result.current.error).toBe('Reject failed')
  })

  it('clears error on successful approve after failure', async () => {
    mockRespondApproval.mockRejectedValueOnce(new Error('First error')).mockResolvedValueOnce({ success: true })

    const { result } = renderHook(() => useApprovalActions())

    await act(async () => {
      try {
        await result.current.approve('approval-1')
      } catch {}
    })

    expect(result.current.error).toBe('First error')

    await act(async () => {
      await result.current.approve('approval-2')
    })

    expect(result.current.error).toBeNull()
  })

  it('clears error on successful reject after failure', async () => {
    mockRespondApproval.mockRejectedValueOnce(new Error('First error')).mockResolvedValueOnce({ success: true })

    const { result } = renderHook(() => useApprovalActions())

    await act(async () => {
      try {
        await result.current.approve('approval-1')
      } catch {}
    })

    expect(result.current.error).toBe('First error')

    await act(async () => {
      await result.current.reject('approval-2', 'Reason')
    })

    expect(result.current.error).toBeNull()
  })

  it('handles non-Error thrown values', async () => {
    mockRespondApproval.mockRejectedValue('String error')

    const { result } = renderHook(() => useApprovalActions())

    await act(async () => {
      try {
        await result.current.approve('approval-string-error')
      } catch {}
    })

    expect(result.current.error).toBe('Failed to approve')
  })
})
