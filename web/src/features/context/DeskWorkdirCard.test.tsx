import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import DeskWorkdirCard from './DeskWorkdirCard'
import * as client from '../../api/client'

vi.mock('../../api/client')

// Polyfill File.text() for jsdom (not available in jsdom <25)
if (!File.prototype.text) {
  File.prototype.text = function () {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = () => reject(reader.error)
      reader.readAsText(this)
    })
  }
}

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

  it('clears stale error state when sessionId becomes null', async () => {
    vi.mocked(client.getSessionWorkdir).mockRejectedValue(new Error('Session not found'))

    const { rerender } = render(<DeskWorkdirCard sessionId={TEST_SESSION_ID} />)

    await waitFor(() => {
      expect(screen.getByText('加载失败')).toBeInTheDocument()
    })

    rerender(<DeskWorkdirCard sessionId={null} />)

    await waitFor(() => {
      expect(screen.getByText('暂无书桌内容')).toBeInTheDocument()
    })
    expect(screen.queryByText('加载失败')).not.toBeInTheDocument()
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

    render(<DeskWorkdirCard sessionId={TEST_SESSION_ID} />)

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

  it('uploads file and refreshes tree when 放到书桌 is clicked', async () => {
    vi.mocked(client.getSessionWorkdir).mockResolvedValue({
      workdir: { id: 'wd-1', userId: 'u-1', name: 'project', createdAt: '', updatedAt: '' },
    })
    vi.mocked(client.listWorkdirTree)
      .mockResolvedValueOnce({ tree: [], path: '/' })
      .mockResolvedValueOnce({
        tree: [{ name: 'notes.txt', type: 'file', relativePath: 'notes.txt' }],
        path: '/',
      })
    vi.mocked(client.uploadWorkdirFile).mockResolvedValue({
      path: 'notes.txt',
      sizeBytes: 5,
      modifiedAt: '2024-01-01T00:00:00Z',
    })

    const file = new File(['hello'], 'notes.txt', { type: 'text/plain' })

    render(<DeskWorkdirCard sessionId={TEST_SESSION_ID} />)

    await waitFor(() => {
      expect(screen.getByText('放到书桌')).toBeInTheDocument()
    })

    const input = screen.getByTestId('desk-file-input') as HTMLInputElement
    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => {
      expect(client.uploadWorkdirFile).toHaveBeenCalledWith('wd-1', 'notes.txt', 'hello')
    })
    await waitFor(() => {
      expect(screen.getByText('notes.txt')).toBeInTheDocument()
    })
  })

  it('shows error when upload returns 409 conflict', async () => {
    vi.mocked(client.getSessionWorkdir).mockResolvedValue({
      workdir: { id: 'wd-1', userId: 'u-1', name: 'project', createdAt: '', updatedAt: '' },
    })
    vi.mocked(client.listWorkdirTree).mockResolvedValue({ tree: [], path: '/' })
    const conflictError = new Error('File already exists')
    ;(conflictError as unknown as { status: number }).status = 409
    vi.mocked(client.uploadWorkdirFile).mockRejectedValue(conflictError)

    const file = new File(['hello'], 'dup.txt', { type: 'text/plain' })

    render(<DeskWorkdirCard sessionId={TEST_SESSION_ID} />)

    await waitFor(() => {
      expect(screen.getByText('放到书桌')).toBeInTheDocument()
    })
    const input = screen.getByTestId('desk-file-input') as HTMLInputElement
    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => {
      expect(screen.getByText('同名文件已存在')).toBeInTheDocument()
    })
  })

  it('shows 文件过大 error when upload returns 413', async () => {
    vi.mocked(client.getSessionWorkdir).mockResolvedValue({
      workdir: { id: 'wd-1', userId: 'u-1', name: 'project', createdAt: '', updatedAt: '' },
    })
    vi.mocked(client.listWorkdirTree).mockResolvedValue({ tree: [], path: '/' })
    const tooLargeError = new Error('File content exceeds maximum size')
    ;(tooLargeError as unknown as { status: number }).status = 413
    vi.mocked(client.uploadWorkdirFile).mockRejectedValue(tooLargeError)

    const file = new File(['x'.repeat(100)], 'big.txt', { type: 'text/plain' })

    render(<DeskWorkdirCard sessionId={TEST_SESSION_ID} />)

    await waitFor(() => {
      expect(screen.getByText('放到书桌')).toBeInTheDocument()
    })
    const input = screen.getByTestId('desk-file-input') as HTMLInputElement
    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => {
      expect(screen.getByText('文件过大')).toBeInTheDocument()
    })
  })

  it('disables 放到书桌 button when no active workdir', async () => {
    vi.mocked(client.getSessionWorkdir).mockResolvedValue({ workdir: null })

    render(<DeskWorkdirCard sessionId={TEST_SESSION_ID} />)

    await waitFor(() => {
      expect(screen.getByText('暂无书桌内容')).toBeInTheDocument()
    })
    // Button should not be present in empty state (no workdir to upload to)
    expect(screen.queryByText('放到书桌')).not.toBeInTheDocument()
  })
})
