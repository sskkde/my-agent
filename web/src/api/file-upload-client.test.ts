import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  uploadSessionFile,
  listSessionFiles,
  getFileMetadata,
  deleteFile,
  sendMessage,
  getFileDownloadUrl,
  downloadFile,
} from './client'

describe('file upload client helpers', () => {
  const originalFetch = global.fetch
  const mockFetch = vi.fn()

  beforeEach(() => {
    global.fetch = mockFetch
    mockFetch.mockReset()
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  describe('uploadSessionFile', () => {
    it('sends FormData without manual Content-Type header', async () => {
      const file = new File(['hello'], 'test.txt', { type: 'text/plain' })
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            file: {
              fileId: 'f1',
              userId: 'u1',
              sessionId: 's1',
              originalFilename: 'test.txt',
              sanitizedName: 'test.txt',
              mimeType: 'text/plain',
              extension: '.txt',
              sizeBytes: 5,
              previewStatus: 'pending',
              status: 'uploading',
              createdAt: '2026-01-01T00:00:00Z',
            },
          },
        }),
      })

      const result = await uploadSessionFile('s1', file)

      expect(result.fileId).toBe('f1')
      expect(result.originalFilename).toBe('test.txt')

      const callInit = mockFetch.mock.calls[0][1] as RequestInit
      expect(callInit.method).toBe('POST')
      expect(callInit.body).toBeInstanceOf(FormData)
      expect(callInit.headers).toBeUndefined()
    })
  })

  describe('listSessionFiles', () => {
    it('returns file list from the API', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            files: [
              {
                fileId: 'f1',
                userId: 'u1',
                sessionId: 's1',
                originalFilename: 'a.txt',
                sanitizedName: 'a.txt',
                mimeType: 'text/plain',
                extension: '.txt',
                sizeBytes: 10,
                previewStatus: 'pending',
                status: 'ready',
                createdAt: '2026-01-01T00:00:00Z',
              },
            ],
            total: 1,
          },
        }),
      })

      const files = await listSessionFiles('s1')

      expect(files).toHaveLength(1)
      expect(files[0].fileId).toBe('f1')
    })
  })

  describe('getFileMetadata', () => {
    it('returns metadata for a specific file', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            file: {
              fileId: 'f1',
              userId: 'u1',
              sessionId: 's1',
              originalFilename: 'doc.pdf',
              sanitizedName: 'doc.pdf',
              mimeType: 'application/pdf',
              extension: '.pdf',
              sizeBytes: 1024,
              previewStatus: 'generated',
              status: 'ready',
              createdAt: '2026-01-01T00:00:00Z',
            },
          },
        }),
      })

      const file = await getFileMetadata('f1')

      expect(file.fileId).toBe('f1')
      expect(file.mimeType).toBe('application/pdf')
    })
  })

  describe('deleteFile', () => {
    it('sends DELETE request and resolves on success', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      })

      await expect(deleteFile('f1')).resolves.toBeUndefined()

      const callUrl = mockFetch.mock.calls[0][0] as string
      expect(callUrl).toContain('/files/f1')
      const callInit = mockFetch.mock.calls[0][1] as RequestInit
      expect(callInit.method).toBe('DELETE')
    })

    it('throws on error response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: async () => ({
          error: { code: 'NOT_FOUND', message: 'File not found' },
        }),
      })

      await expect(deleteFile('missing')).rejects.toThrow('File not found')
    })
  })
})

describe('sendMessage with attachmentIds', () => {
  const originalFetch = global.fetch
  const mockFetch = vi.fn()

  beforeEach(() => {
    global.fetch = mockFetch
    mockFetch.mockReset()
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('includes attachmentIds in request body when provided', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: {
          accepted: true,
          status: 'accepted',
          correlationId: 'c1',
          envelopeId: 'e1',
        },
      }),
    })

    await sendMessage('s1', 'hello', ['file-a', 'file-b'])

    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body as string)
    expect(callBody).toEqual({ text: 'hello', attachmentIds: ['file-a', 'file-b'] })
  })

  it('omits attachmentIds from body when not provided', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: {
          accepted: true,
          status: 'accepted',
          correlationId: 'c1',
          envelopeId: 'e1',
        },
      }),
    })

    await sendMessage('s1', 'hello')

    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body as string)
    expect(callBody).toEqual({ text: 'hello' })
    expect(callBody.attachmentIds).toBeUndefined()
  })

  it('omits attachmentIds when empty array is provided', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: {
          accepted: true,
          status: 'accepted',
          correlationId: 'c1',
          envelopeId: 'e1',
        },
      }),
    })

    await sendMessage('s1', 'hello', [])

    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body as string)
    expect(callBody).toEqual({ text: 'hello' })
    expect(callBody.attachmentIds).toBeUndefined()
  })

  it('throws typed error on failure response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      json: async () => ({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid text' },
      }),
    })

    await expect(sendMessage('s1', '')).rejects.toThrow('Invalid text')
  })
})

describe('file download helpers', () => {
  it('getFileDownloadUrl returns the correct API path', () => {
    expect(getFileDownloadUrl('file-abc')).toBe('/api/v1/files/file-abc/download')
  })

  it('getFileDownloadUrl encodes special characters in fileId', () => {
    expect(getFileDownloadUrl('file/with/slash')).toBe('/api/v1/files/file%2Fwith%2Fslash/download')
  })

  it('downloadFile opens a new window with the download URL', () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
    try {
      downloadFile('file-123')
      expect(openSpy).toHaveBeenCalledWith('/api/v1/files/file-123/download', '_blank')
    } finally {
      openSpy.mockRestore()
    }
  })
})
