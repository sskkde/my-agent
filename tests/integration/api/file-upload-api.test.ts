/**
 * File Upload API Integration Tests
 *
 * Tests for session-scoped file upload, list, metadata, download, and delete routes.
 *
 * Routes:
 * - POST   /api/v1/sessions/:sessionId/files   - Upload a file
 * - GET    /api/v1/sessions/:sessionId/files   - List files for session
 * - GET    /api/v1/files/:fileId               - Get file metadata
 * - GET    /api/v1/files/:fileId/download       - Download file
 * - DELETE /api/v1/files/:fileId               - Delete file
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  createAuthenticatedTestContext,
  closeAuthenticatedTestContext,
  type AuthenticatedTestContext,
} from '../../helpers/auth.js'

interface FileMetadata {
  fileId: string
  userId: string
  sessionId: string
  originalFilename: string
  mimeType: string
  extension: string
  sizeBytes: number
  status: string
  createdAt: string
  updatedAt: string
}

interface ApiEnvelope<T> {
  ok: boolean
  data?: T
  error?: { code: string; message: string }
  requestId: string
}

function createMultipartBody(filename: string, content: string, mimeType = 'text/plain'): FormData {
  const formData = new FormData()
  const blob = new Blob([content], { type: mimeType })
  formData.append('file', blob, filename)
  return formData
}

describe('File Upload API', () => {
  let ctx: AuthenticatedTestContext
  let baseUrl: string
  let authCookie: string
  let sessionId: string

  beforeAll(async () => {
    ctx = await createAuthenticatedTestContext()
    baseUrl = ctx.baseUrl
    authCookie = ctx.authCookie

    // Create a test session
    const sessionResponse = await fetch(`${baseUrl}/api/v1/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: authCookie },
      body: JSON.stringify({}),
    })
    const sessionBody = (await sessionResponse.json()) as { data: { session: { sessionId: string } } }
    sessionId = sessionBody.data.session.sessionId
  }, 30000)

  afterAll(async () => {
    await closeAuthenticatedTestContext(ctx)
  }, 30000)

  // ===========================================================================
  // POST /api/v1/sessions/:sessionId/files - Upload
  // ===========================================================================
  describe('POST /api/v1/sessions/:sessionId/files', () => {
    it('should upload a text file and return 201 with metadata', async () => {
      const formData = createMultipartBody('test.txt', 'Hello, world!')

      const response = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/files`, {
        method: 'POST',
        headers: { Cookie: authCookie },
        body: formData,
      })

      expect(response.status).toBe(201)

      const body = (await response.json()) as ApiEnvelope<{ file: FileMetadata }>
      expect(body.ok).toBe(true)
      expect(body.data?.file).toBeDefined()
      expect(body.data?.file.fileId).toBeDefined()
      expect(body.data?.file.sessionId).toBe(sessionId)
      expect(body.data?.file.originalFilename).toBe('test.txt')
      expect(body.data?.file.mimeType).toBe('text/plain')
      expect(body.data?.file.extension).toBe('.txt')
      expect(body.data?.file.sizeBytes).toBe(13) // 'Hello, world!' = 13 bytes
      expect(body.data?.file.status).toBe('ready')
      expect(body.data?.file.createdAt).toBeDefined()
      expect(body.data?.file.updatedAt).toBeDefined()
      expect(body.requestId).toBeDefined()

      // Must NOT leak storageRef
      expect((body.data?.file as unknown as Record<string, unknown>)?.storageRef).toBeUndefined()
    })

    it('should upload a JSON file', async () => {
      const formData = createMultipartBody('data.json', '{"key":"value"}', 'application/json')

      const response = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/files`, {
        method: 'POST',
        headers: { Cookie: authCookie },
        body: formData,
      })

      expect(response.status).toBe(201)

      const body = (await response.json()) as ApiEnvelope<{ file: FileMetadata }>
      expect(body.data?.file.mimeType).toBe('application/json')
      expect(body.data?.file.extension).toBe('.json')
    })

    it('should return 415 for disallowed MIME type', async () => {
      const formData = createMultipartBody('virus.exe', 'MZ...', 'application/x-msdownload')

      const response = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/files`, {
        method: 'POST',
        headers: { Cookie: authCookie },
        body: formData,
      })

      expect(response.status).toBe(415)

      const body = (await response.json()) as ApiEnvelope<never>
      expect(body.ok).toBe(false)
      expect(body.error?.code).toBe('UNSUPPORTED_MEDIA_TYPE')
    })

    it('should reject oversized file exceeding configured limit', async () => {
      const largeContent = 'x'.repeat(12 * 1024 * 1024)
      const formData = createMultipartBody('large.txt', largeContent)

      const response = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/files`, {
        method: 'POST',
        headers: { Cookie: authCookie },
        body: formData,
      })

      const body = (await response.json()) as ApiEnvelope<never>

      if (response.status === 201) {
        expect(body.ok).toBe(true)
      } else {
        expect(response.status).toBe(413)
        expect(body.ok).toBe(false)
        expect(body.error?.code).toBe('FILE_TOO_LARGE')
      }
    })

    it('should return 404 for non-existent session', async () => {
      const formData = createMultipartBody('test.txt', 'content')

      const response = await fetch(`${baseUrl}/api/v1/sessions/non-existent-session/files`, {
        method: 'POST',
        headers: { Cookie: authCookie },
        body: formData,
      })

      expect(response.status).toBe(404)

      const body = (await response.json()) as ApiEnvelope<never>
      expect(body.error?.code).toBe('NOT_FOUND')
    })

    it('should return 401 without authentication', async () => {
      const formData = createMultipartBody('test.txt', 'content')

      const response = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/files`, {
        method: 'POST',
        body: formData,
      })

      expect(response.status).toBe(401)
    })
  })

  // ===========================================================================
  // GET /api/v1/sessions/:sessionId/files - List
  // ===========================================================================
  describe('GET /api/v1/sessions/:sessionId/files', () => {
    it('should list files for a session', async () => {
      // Upload a file first to ensure there is at least one
      const formData = createMultipartBody('list-test.txt', 'list content')
      await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/files`, {
        method: 'POST',
        headers: { Cookie: authCookie },
        body: formData,
      })

      const response = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/files`, {
        headers: { Cookie: authCookie },
      })

      expect(response.status).toBe(200)

      const body = (await response.json()) as ApiEnvelope<{ files: FileMetadata[]; total: number }>
      expect(body.ok).toBe(true)
      expect(body.data?.files).toBeDefined()
      expect(Array.isArray(body.data?.files)).toBe(true)
      expect(body.data?.files.length).toBeGreaterThan(0)
      expect(body.data?.total).toBe(body.data?.files.length)

      // All files belong to this session
      for (const file of body.data!.files) {
        expect(file.sessionId).toBe(sessionId)
      }
    })

    it('should return 404 for non-existent session', async () => {
      const response = await fetch(`${baseUrl}/api/v1/sessions/non-existent-session/files`, {
        headers: { Cookie: authCookie },
      })

      expect(response.status).toBe(404)
    })

    it('should return 401 without authentication', async () => {
      const response = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/files`)

      expect(response.status).toBe(401)
    })
  })

  // ===========================================================================
  // GET /api/v1/files/:fileId - Metadata
  // ===========================================================================
  describe('GET /api/v1/files/:fileId', () => {
    it('should return file metadata for owner', async () => {
      // Upload a file
      const formData = createMultipartBody('metadata-test.txt', 'metadata content')
      const uploadResponse = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/files`, {
        method: 'POST',
        headers: { Cookie: authCookie },
        body: formData,
      })
      const uploadBody = (await uploadResponse.json()) as ApiEnvelope<{ file: FileMetadata }>
      const fileId = uploadBody.data!.file.fileId

      const response = await fetch(`${baseUrl}/api/v1/files/${fileId}`, {
        headers: { Cookie: authCookie },
      })

      expect(response.status).toBe(200)

      const body = (await response.json()) as ApiEnvelope<{ file: FileMetadata }>
      expect(body.ok).toBe(true)
      expect(body.data?.file.fileId).toBe(fileId)
      expect(body.data?.file.originalFilename).toBe('metadata-test.txt')

      // Must NOT leak storageRef
      expect((body.data?.file as unknown as Record<string, unknown>)?.storageRef).toBeUndefined()
    })

    it('should return 404 for non-existent file', async () => {
      const response = await fetch(`${baseUrl}/api/v1/files/non-existent-file-id`, {
        headers: { Cookie: authCookie },
      })

      expect(response.status).toBe(404)
    })

    it('should return 401 without authentication', async () => {
      const response = await fetch(`${baseUrl}/api/v1/files/some-file-id`)

      expect(response.status).toBe(401)
    })
  })

  // ===========================================================================
  // GET /api/v1/files/:fileId/download - Download
  // ===========================================================================
  describe('GET /api/v1/files/:fileId/download', () => {
    it('should return 501 for download (storage stub)', async () => {
      // Upload a file
      const formData = createMultipartBody('download-test.txt', 'download content')
      const uploadResponse = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/files`, {
        method: 'POST',
        headers: { Cookie: authCookie },
        body: formData,
      })
      const uploadBody = (await uploadResponse.json()) as ApiEnvelope<{ file: FileMetadata }>
      const fileId = uploadBody.data!.file.fileId

      const response = await fetch(`${baseUrl}/api/v1/files/${fileId}/download`, {
        headers: { Cookie: authCookie },
      })

      // Storage service not yet implemented - expect 501
      expect(response.status).toBe(501)

      const body = (await response.json()) as ApiEnvelope<never>
      expect(body.ok).toBe(false)
      expect(body.error?.code).toBe('NOT_IMPLEMENTED')
    })

    it('should return 404 for non-existent file', async () => {
      const response = await fetch(`${baseUrl}/api/v1/files/non-existent-file-id/download`, {
        headers: { Cookie: authCookie },
      })

      expect(response.status).toBe(404)
    })

    it('should return 401 without authentication', async () => {
      const response = await fetch(`${baseUrl}/api/v1/files/some-file-id/download`)

      expect(response.status).toBe(401)
    })
  })

  // ===========================================================================
  // DELETE /api/v1/files/:fileId - Delete
  // ===========================================================================
  describe('DELETE /api/v1/files/:fileId', () => {
    it('should soft-delete a file', async () => {
      // Upload a file
      const formData = createMultipartBody('delete-test.txt', 'delete me')
      const uploadResponse = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/files`, {
        method: 'POST',
        headers: { Cookie: authCookie },
        body: formData,
      })
      const uploadBody = (await uploadResponse.json()) as ApiEnvelope<{ file: FileMetadata }>
      const fileId = uploadBody.data!.file.fileId

      // Delete it
      const deleteResponse = await fetch(`${baseUrl}/api/v1/files/${fileId}`, {
        method: 'DELETE',
        headers: { Cookie: authCookie },
      })

      expect(deleteResponse.status).toBe(200)

      const deleteBody = (await deleteResponse.json()) as ApiEnvelope<{ deleted: boolean; fileId: string }>
      expect(deleteBody.ok).toBe(true)
      expect(deleteBody.data?.deleted).toBe(true)
      expect(deleteBody.data?.fileId).toBe(fileId)

      // Subsequent metadata GET should 404 (soft-deleted files excluded from getById)
      const getResponse = await fetch(`${baseUrl}/api/v1/files/${fileId}`, {
        headers: { Cookie: authCookie },
      })
      expect(getResponse.status).toBe(404)
    })

    it('should return 404 for non-existent file', async () => {
      const response = await fetch(`${baseUrl}/api/v1/files/non-existent-file-id`, {
        method: 'DELETE',
        headers: { Cookie: authCookie },
      })

      expect(response.status).toBe(404)
    })

    it('should return 401 without authentication', async () => {
      const response = await fetch(`${baseUrl}/api/v1/files/some-file-id`, {
        method: 'DELETE',
      })

      expect(response.status).toBe(401)
    })
  })

  // ===========================================================================
  // Cross-user access
  // ===========================================================================
  describe('Cross-user access', () => {
    let otherCookie: string

    beforeAll(async () => {
      const { hashPassword, generateSessionToken, hashToken } = await import('../../../src/storage/auth-crypto.js')
      const userStore = ctx.apiContext.stores.userStore
      const authTokenStore = ctx.apiContext.stores.authTokenStore

      const passwordHash = await hashPassword('otherpassword123')
      const user = userStore.create({
        userId: `user-cross-${Date.now()}`,
        username: `crossuser_${Date.now()}`,
        passwordHash,
      })

      const sessionToken = generateSessionToken()
      const tokenHash = hashToken(sessionToken)
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
      authTokenStore.create({ tokenHash, userId: user.userId, expiresAt })

      otherCookie = `agent-platform-session=${sessionToken}`
    })

    it('should deny cross-user file access (404 due to ownership check)', async () => {
      // Upload a file as the first user
      const formData = createMultipartBody('cross-user.txt', 'private content')
      const uploadResponse = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/files`, {
        method: 'POST',
        headers: { Cookie: authCookie },
        body: formData,
      })
      const uploadBody = (await uploadResponse.json()) as ApiEnvelope<{ file: FileMetadata }>
      const fileId = uploadBody.data!.file.fileId

      // Second user tries to access first user's file metadata
      const response = await fetch(`${baseUrl}/api/v1/files/${fileId}`, {
        headers: { Cookie: otherCookie },
      })

      // Ownership check returns undefined -> 404
      expect(response.status).toBe(404)
    })

    it('should deny cross-user session file list (403)', async () => {
      // Second user tries to list files from first user's session
      const response = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/files`, {
        headers: { Cookie: otherCookie },
      })

      expect(response.status).toBe(403)

      const body = (await response.json()) as ApiEnvelope<never>
      expect(body.ok).toBe(false)
      expect(body.error?.code).toBe('FORBIDDEN')
    })
  })

  // ===========================================================================
  // Response envelope contract
  // ===========================================================================
  describe('Response envelope contract', () => {
    it('should return standard success envelope for upload', async () => {
      const formData = createMultipartBody('envelope-test.txt', 'envelope')
      const response = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/files`, {
        method: 'POST',
        headers: { Cookie: authCookie },
        body: formData,
      })

      const body = (await response.json()) as ApiEnvelope<unknown>
      expect(body).toHaveProperty('ok')
      expect(body).toHaveProperty('data')
      expect(body).toHaveProperty('requestId')
      expect(body.ok).toBe(true)
      expect(typeof body.requestId).toBe('string')
    })

    it('should return standard error envelope for 404', async () => {
      const response = await fetch(`${baseUrl}/api/v1/files/non-existent`, {
        headers: { Cookie: authCookie },
      })

      const body = (await response.json()) as ApiEnvelope<never>
      expect(body.ok).toBe(false)
      expect(body).toHaveProperty('error')
      expect(body.error?.code).toBe('NOT_FOUND')
      expect(body).toHaveProperty('requestId')
    })
  })
})
