import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import DeskWorkdirCard from './DeskWorkdirCard'
import * as client from '../../api/client'

vi.mock('../../api/client')

const TEST_SESSION_ID = 'ses_desk_test'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('DeskWorkdirCard', () => {
  it('does not call getSessionWorkdir when sessionId is null', () => {
    render(<DeskWorkdirCard sessionId={null} />)
    expect(client.getSessionWorkdir).not.toHaveBeenCalled()
  })

  it('calls getSessionWorkdir with sessionId', async () => {
    vi.mocked(client.getSessionWorkdir).mockResolvedValue({ workdir: null })

    render(<DeskWorkdirCard sessionId={TEST_SESSION_ID} />)

    await waitFor(() => {
      expect(client.getSessionWorkdir).toHaveBeenCalledWith(TEST_SESSION_ID)
    })
  })

  it('renders empty state when no active workdir', async () => {
    vi.mocked(client.getSessionWorkdir).mockResolvedValue({ workdir: null })

    render(<DeskWorkdirCard sessionId={TEST_SESSION_ID} />)

    await waitFor(() => {
      expect(screen.getByText('暂无书桌内容')).toBeInTheDocument()
    })
    expect(screen.getByText('选择工作目录后显示文件')).toBeInTheDocument()
  })

  it('renders error state with retry when getSessionWorkdir fails', async () => {
    vi.mocked(client.getSessionWorkdir).mockRejectedValue(new Error('Failed to load workdir'))

    render(<DeskWorkdirCard sessionId={TEST_SESSION_ID} />)

    await waitFor(() => {
      expect(screen.getByText('加载失败')).toBeInTheDocument()
    })
    expect(screen.getByText('重试')).toBeInTheDocument()
  })
})
