import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  respondApproval,
  listWorkdirs,
  createWorkdir,
  renameWorkdir,
  deleteWorkdir,
  getSessionWorkdir,
  setSessionWorkdir,
  clearSessionWorkdir,
  listWorkdirTree,
  readWorkdirFile,
  writeWorkdirFile,
  createWorkdirDir,
} from './client'

describe('respondApproval', () => {
  const originalFetch = global.fetch
  const mockFetch = vi.fn()

  beforeEach(() => {
    global.fetch = mockFetch
    mockFetch.mockReset()
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('normalizes legacy "approved" to approve_once', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        approvalId: 'test-id',
        status: 'approved',
      }),
    })

    await respondApproval('test-id', 'approved', 'test reason')

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/approvals/test-id'),
      expect.objectContaining({
        method: 'PATCH',
        body: expect.any(String),
      }),
    )

    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(callBody).toEqual({
      decision: 'approved',
      responseType: 'approve_once',
      reason: 'test reason',
    })
  })

  it('normalizes legacy "rejected" to reject', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        approvalId: 'test-id',
        status: 'rejected',
      }),
    })

    await respondApproval('test-id', 'rejected')

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/approvals/test-id'),
      expect.objectContaining({
        method: 'PATCH',
        body: expect.any(String),
      }),
    )

    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(callBody).toEqual({
      decision: 'rejected',
      responseType: 'reject',
      reason: undefined,
    })
  })

  it('passes "approve_once" directly', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        approvalId: 'test-id',
        status: 'approved',
      }),
    })

    await respondApproval('test-id', 'approve_once')

    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(callBody).toEqual({
      responseType: 'approve_once',
      reason: undefined,
    })
  })

  it('passes "approve_always" directly', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        approvalId: 'test-id',
        status: 'approved',
      }),
    })

    await respondApproval('test-id', 'approve_always', 'always approve')

    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(callBody).toEqual({
      responseType: 'approve_always',
      reason: 'always approve',
    })
  })

  it('passes "reject" directly', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        approvalId: 'test-id',
        status: 'rejected',
      }),
    })

    await respondApproval('test-id', 'reject')

    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(callBody).toEqual({
      responseType: 'reject',
      reason: undefined,
    })
  })
})

describe('listWorkdirs', () => {
  const originalFetch = global.fetch
  const mockFetch = vi.fn()

  beforeEach(() => {
    global.fetch = mockFetch
    mockFetch.mockReset()
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('returns workdirs from envelope', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        data: {
          workdirs: [
            { id: 'wd-1', userId: 'u1', name: 'My Project', createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-01T00:00:00Z' },
          ],
          total: 1,
        },
        requestId: 'req-1',
      }),
    })

    const result = await listWorkdirs()

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/workdirs'),
      expect.objectContaining({ credentials: 'include' }),
    )
    expect(result.workdirs).toHaveLength(1)
    expect(result.workdirs[0]!.name).toBe('My Project')
    expect(result.total).toBe(1)
  })

  it('does not expose raw absolute paths', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        data: { workdirs: [{ id: 'wd-1', userId: 'u1', name: 'Proj', createdAt: '', updatedAt: '' }], total: 1 },
        requestId: 'r',
      }),
    })

    const result = await listWorkdirs()
    const workdir = result.workdirs[0]!
    expect(workdir).not.toHaveProperty('path')
    expect(workdir).not.toHaveProperty('absolutePath')
  })
})

describe('createWorkdir', () => {
  const originalFetch = global.fetch
  const mockFetch = vi.fn()

  beforeEach(() => {
    global.fetch = mockFetch
    mockFetch.mockReset()
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('POSTs with name in body', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        data: {
          workdir: { id: 'wd-new', userId: 'u1', name: 'New Project', createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-01T00:00:00Z' },
        },
        requestId: 'req-1',
      }),
    })

    const result = await createWorkdir('New Project')

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/workdirs'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ name: 'New Project' }),
      }),
    )
    expect(result.workdir!.name).toBe('New Project')
  })
})

describe('renameWorkdir', () => {
  const originalFetch = global.fetch
  const mockFetch = vi.fn()

  beforeEach(() => {
    global.fetch = mockFetch
    mockFetch.mockReset()
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('PATCHes with new name', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        data: {
          workdir: { id: 'wd-1', userId: 'u1', name: 'Renamed', createdAt: '', updatedAt: '2025-01-02T00:00:00Z' },
        },
        requestId: 'r',
      }),
    })

    const result = await renameWorkdir('wd-1', 'Renamed')

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/workdirs/wd-1'),
      expect.objectContaining({ method: 'PATCH' }),
    )
    expect(result.workdir!.name).toBe('Renamed')
  })
})

describe('deleteWorkdir', () => {
  const originalFetch = global.fetch
  const mockFetch = vi.fn()

  beforeEach(() => {
    global.fetch = mockFetch
    mockFetch.mockReset()
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('sends DELETE and returns confirmation', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        data: { deleted: true, workdirId: 'wd-1' },
        requestId: 'r',
      }),
    })

    const result = await deleteWorkdir('wd-1')

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/workdirs/wd-1'),
      expect.objectContaining({ method: 'DELETE' }),
    )
    expect(result.deleted).toBe(true)
    expect(result.workdirId).toBe('wd-1')
  })
})

describe('getSessionWorkdir', () => {
  const originalFetch = global.fetch
  const mockFetch = vi.fn()

  beforeEach(() => {
    global.fetch = mockFetch
    mockFetch.mockReset()
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('returns active workdir for session', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        data: {
          workdir: { id: 'wd-1', userId: 'u1', name: 'Active', createdAt: '', updatedAt: '' },
        },
        requestId: 'r',
      }),
    })

    const result = await getSessionWorkdir('sess-1')

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/sessions/sess-1/workdir'),
      expect.objectContaining({ credentials: 'include' }),
    )
    expect(result.workdir!.id).toBe('wd-1')
  })

  it('returns null workdir when none set', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        data: { workdir: null },
        requestId: 'r',
      }),
    })

    const result = await getSessionWorkdir('sess-1')
    expect(result.workdir).toBeNull()
  })
})

describe('setSessionWorkdir', () => {
  const originalFetch = global.fetch
  const mockFetch = vi.fn()

  beforeEach(() => {
    global.fetch = mockFetch
    mockFetch.mockReset()
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('PUTs workdirId for session', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        data: {
          workdir: { id: 'wd-1', userId: 'u1', name: 'Set', createdAt: '', updatedAt: '' },
        },
        requestId: 'r',
      }),
    })

    const result = await setSessionWorkdir('sess-1', 'wd-1')

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/sessions/sess-1/workdir'),
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ workdirId: 'wd-1' }),
      }),
    )
    expect(result.workdir!.id).toBe('wd-1')
  })
})

describe('clearSessionWorkdir', () => {
  const originalFetch = global.fetch
  const mockFetch = vi.fn()

  beforeEach(() => {
    global.fetch = mockFetch
    mockFetch.mockReset()
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('DELETEs active workdir for session', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        data: { cleared: true },
        requestId: 'r',
      }),
    })

    const result = await clearSessionWorkdir('sess-1')

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/sessions/sess-1/workdir'),
      expect.objectContaining({ method: 'DELETE' }),
    )
    expect(result.cleared).toBe(true)
  })
})

describe('listWorkdirTree', () => {
  const originalFetch = global.fetch
  const mockFetch = vi.fn()

  beforeEach(() => {
    global.fetch = mockFetch
    mockFetch.mockReset()
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('lists root tree without path param', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        data: {
          tree: [
            { name: 'src', type: 'directory', relativePath: 'src' },
            { name: 'README.md', type: 'file', relativePath: 'README.md' },
          ],
          path: '/',
        },
        requestId: 'r',
      }),
    })

    const result = await listWorkdirTree('wd-1')

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/workdirs/wd-1/tree'),
      expect.objectContaining({ credentials: 'include' }),
    )
    expect(result.tree).toHaveLength(2)
    expect(result.path).toBe('/')
  })

  it('passes path query parameter', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        data: { tree: [{ name: 'index.ts', type: 'file', relativePath: 'src/index.ts' }], path: 'src' },
        requestId: 'r',
      }),
    })

    await listWorkdirTree('wd-1', 'src')

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('path=src'),
      expect.anything(),
    )
  })

  it('tree nodes use relativePath, not absolute', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        data: {
          tree: [{ name: 'file.txt', type: 'file', relativePath: 'dir/file.txt' }],
          path: 'dir',
        },
        requestId: 'r',
      }),
    })

    const result = await listWorkdirTree('wd-1', 'dir')
    const node = result.tree[0]!
    expect(node.relativePath).not.toMatch(/^\//)
    expect(node.relativePath).not.toContain('home')
    expect(node.relativePath).not.toContain('data')
    expect(node.relativePath).toBe('dir/file.txt')
  })
})

describe('readWorkdirFile', () => {
  const originalFetch = global.fetch
  const mockFetch = vi.fn()

  beforeEach(() => {
    global.fetch = mockFetch
    mockFetch.mockReset()
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('reads file with path query param', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        data: {
          path: 'src/index.ts',
          content: 'export const x = 1;',
          sizeBytes: 20,
          modifiedAt: '2025-01-01T00:00:00Z',
        },
        requestId: 'r',
      }),
    })

    const result = await readWorkdirFile('wd-1', 'src/index.ts')

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('path=src%2Findex.ts'),
      expect.objectContaining({ credentials: 'include' }),
    )
    expect(result.content).toBe('export const x = 1;')
    expect(result.path).toBe('src/index.ts')
    expect(result.sizeBytes).toBe(20)
  })
})

describe('writeWorkdirFile', () => {
  const originalFetch = global.fetch
  const mockFetch = vi.fn()

  beforeEach(() => {
    global.fetch = mockFetch
    mockFetch.mockReset()
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('PUTs path and content in body', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        data: { path: 'README.md', sizeBytes: 12, modifiedAt: '2025-01-01T00:00:00Z' },
        requestId: 'r',
      }),
    })

    const result = await writeWorkdirFile('wd-1', 'README.md', '# Hello')

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/workdirs/wd-1/files'),
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ path: 'README.md', content: '# Hello' }),
      }),
    )
    expect(result.path).toBe('README.md')
    expect(result.sizeBytes).toBe(12)
  })
})

describe('createWorkdirDir', () => {
  const originalFetch = global.fetch
  const mockFetch = vi.fn()

  beforeEach(() => {
    global.fetch = mockFetch
    mockFetch.mockReset()
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('POSTs path to create directory', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        data: { path: 'src/utils', created: true },
        requestId: 'r',
      }),
    })

    const result = await createWorkdirDir('wd-1', 'src/utils')

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/workdirs/wd-1/dirs'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ path: 'src/utils' }),
      }),
    )
    expect(result.path).toBe('src/utils')
    expect(result.created).toBe(true)
  })
})
