import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChildTaskActions } from './ChildTaskActions'
import * as api from '../../../api/client'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ChildTaskActions', () => {
  it('calls the parent-scoped cancel endpoint once while a background task is running', async () => {
    const onOpen = vi.fn()
    let resolveCancel: (() => void) | undefined
    const cancel = vi.spyOn(api, 'cancelChildSession').mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCancel = () => resolve({ status: 'cancelled', runId: 'run-1', coordinatorStatus: 'cancelled' })
        }),
    )

    render(
      <ChildTaskActions
        parentSessionId="parent-1"
        taskId="child-1"
        childSessionId="child-1"
        status="running"
        launchMode="background"
        onOpen={onOpen}
      />,
    )

    const cancelButton = screen.getByRole('button', { name: '取消任务' })
    await act(async () => {
      fireEvent.click(cancelButton)
      fireEvent.click(cancelButton)
    })

    expect(cancel).toHaveBeenCalledTimes(1)
    expect(cancel).toHaveBeenCalledWith('parent-1', 'child-1')
    expect(cancelButton).toBeDisabled()
    expect(screen.getByRole('button', { name: '查看子会话' })).toBeEnabled()
    await act(async () => {
      resolveCancel?.()
      await Promise.resolve()
    })
    await waitFor(() => expect(cancelButton).toBeEnabled())
  })

  it('calls resume once, opens the parent-scoped drill-down, and surfaces a safe error toast', async () => {
    let rejectResume: ((error: Error) => void) | undefined
    const resume = vi.spyOn(api, 'resumeChildSession').mockImplementation(
      () =>
        new Promise<void>((_, reject) => {
          rejectResume = reject
        }),
    )
    const onOpen = vi.fn()
    const onError = vi.fn()

    render(
      <ChildTaskActions
        parentSessionId="parent-2"
        taskId="child-2"
        childSessionId="child-2"
        status="failed"
        launchMode="foreground"
        onOpen={onOpen}
        onError={onError}
      />,
    )

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '恢复任务' }))
      fireEvent.click(screen.getByRole('button', { name: '恢复任务' }))
      fireEvent.click(screen.getByRole('button', { name: '查看子会话' }))
    })
    await act(async () => {
      rejectResume?.(new Error('provider stack should not be shown'))
      await Promise.resolve()
    })

    expect(resume).toHaveBeenCalledTimes(1)
    expect(resume).toHaveBeenCalledWith('parent-2', 'child-2')
    expect(onOpen).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(onError).toHaveBeenCalledWith('任务操作失败，请稍后重试'))
    expect(screen.queryByText('provider stack should not be shown')).not.toBeInTheDocument()
  })

  it('disables cancel and resume after terminal status updates while keeping drill-down available', () => {
    const { rerender } = render(
      <ChildTaskActions
        parentSessionId="parent-3"
        taskId="child-3"
        childSessionId="child-3"
        status="running"
        launchMode="background"
        onCancel={vi.fn()}
        onResume={vi.fn()}
        onOpen={vi.fn()}
      />,
    )

    rerender(
      <ChildTaskActions
        parentSessionId="parent-3"
        taskId="child-3"
        childSessionId="child-3"
        status="cancelled"
        launchMode="background"
        onCancel={vi.fn()}
        onResume={vi.fn()}
        onOpen={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: '取消任务' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '恢复任务' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '查看子会话' })).toBeEnabled()
  })
})
