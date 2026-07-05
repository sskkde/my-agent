import { render, screen, waitFor, fireEvent } from '@testing-library/react'
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

  it('renders root tree nodes when active workdir exists', async () => {
    vi.mocked(client.getSessionWorkdir).mockResolvedValue({
      workdir: { id: 'wd-1', userId: 'u-1', name: 'project', createdAt: '', updatedAt: '' },
    })
    vi.mocked(client.listWorkdirTree).mockResolvedValue({
      tree: [
        { name: 'README.md', type: 'file', relativePath: 'README.md' },
        { name: 'src', type: 'directory', relativePath: 'src' },
      ],
      path: '/',
    })

    render(<DeskWorkdirCard sessionId={TEST_SESSION_ID} />)

    await waitFor(() => {
      expect(screen.getByText('README.md')).toBeInTheDocument()
    })
    expect(screen.getByText('src')).toBeInTheDocument()
    expect(screen.getByText('project')).toBeInTheDocument()
  })

  it('expands directory and loads children on click', async () => {
    vi.mocked(client.getSessionWorkdir).mockResolvedValue({
      workdir: { id: 'wd-1', userId: 'u-1', name: 'project', createdAt: '', updatedAt: '' },
    })
    vi.mocked(client.listWorkdirTree)
      .mockResolvedValueOnce({
        tree: [{ name: 'src', type: 'directory', relativePath: 'src' }],
        path: '/',
      })
      .mockResolvedValueOnce({
        tree: [{ name: 'index.ts', type: 'file', relativePath: 'src/index.ts' }],
        path: 'src',
      })

    const { container } = render(<DeskWorkdirCard sessionId={TEST_SESSION_ID} />)

    await waitFor(() => {
      expect(screen.getByText('src')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('src'))

    await waitFor(() => {
      expect(screen.getByText('index.ts')).toBeInTheDocument()
    })
    expect(client.listWorkdirTree).toHaveBeenCalledWith('wd-1', 'src')
  })

  it('shows read-only preview when file is clicked', async () => {
    vi.mocked(client.getSessionWorkdir).mockResolvedValue({
      workdir: { id: 'wd-1', userId: 'u-1', name: 'project', createdAt: '', updatedAt: '' },
    })
    vi.mocked(client.listWorkdirTree).mockResolvedValue({
      tree: [{ name: 'README.md', type: 'file', relativePath: 'README.md' }],
      path: '/',
    })
    vi.mocked(client.readWorkdirFile).mockResolvedValue({
      path: 'README.md',
      content: '# Hello World',
      sizeBytes: 13,
      modifiedAt: '2024-01-01T00:00:00Z',
    })

    render(<DeskWorkdirCard sessionId={TEST_SESSION_ID} />)

    await waitFor(() => {
      expect(screen.getByText('README.md')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('desk-tree-node-README.md'))

    await waitFor(() => {
      expect(screen.getByText('# Hello World')).toBeInTheDocument()
    })
    expect(client.readWorkdirFile).toHaveBeenCalledWith('wd-1', 'README.md')
    expect(screen.getByText('关闭')).toBeInTheDocument()
  })

  it('closes preview when close button is clicked', async () => {
    vi.mocked(client.getSessionWorkdir).mockResolvedValue({
      workdir: { id: 'wd-1', userId: 'u-1', name: 'project', createdAt: '', updatedAt: '' },
    })
    vi.mocked(client.listWorkdirTree).mockResolvedValue({
      tree: [{ name: 'README.md', type: 'file', relativePath: 'README.md' }],
      path: '/',
    })
    vi.mocked(client.readWorkdirFile).mockResolvedValue({
      path: 'README.md',
      content: '# Hello World',
      sizeBytes: 13,
      modifiedAt: '2024-01-01T00:00:00Z',
    })

    render(<DeskWorkdirCard sessionId={TEST_SESSION_ID} />)

    await waitFor(() => {
      expect(screen.getByText('README.md')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByTestId('desk-tree-node-README.md'))
    await waitFor(() => {
      expect(screen.getByText('# Hello World')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('关闭'))
    expect(screen.queryByText('# Hello World')).not.toBeInTheDocument()
  })
})
