/**
 * File Upload Security Tests
 *
 * Integration-level security tests for the file upload system.
 * Covers the full attack surface: oversized files, MIME/extension spoofing,
 * path traversal, cross-user/cross-session denial, deleted-file denial,
 * and raw-byte non-exposure in API responses.
 *
 * Routes:
 * - POST   /api/v1/sessions/:sessionId/files   - Upload
 * - GET    /api/v1/sessions/:sessionId/files   - List
 * - GET    /api/v1/files/:fileId               - Metadata
 * - GET    /api/v1/files/:fileId/download       - Download
 * - DELETE /api/v1/files/:fileId               - Delete
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  createAuthenticatedTestContext,
  closeAuthenticatedTestContext,
  type AuthenticatedTestContext,
} from '../helpers/auth.js'
import { resetUploadConfigCache } from '../../src/config/upload-config.js'

interface FileMetadata {
  fileId: string
  userId: string
  sessionId: string
  originalFilename: string
  mimeType: string
  extension: string
  sizeBytes: number
  status: string
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

describe('File Upload Security', () => {
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
  // Oversized file rejection
  // ===========================================================================

  describe('Oversized file rejection', () => {
    it('should reject a file exceeding maxFileSizeBytes (10 MiB default)', async () => {
      const largeContent = 'x'.repeat(12 * 1024 * 1024)
      const formData = createMultipartBody('large.txt', largeContent)

      const response = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/files`, {
        method: 'POST',
        headers: { Cookie: authCookie },
        body: formData,
      })

      expect(response.status).toBe(413)
      const body = (await response.json()) as ApiEnvelope<never>
      expect(body.ok).toBe(false)
      expect(body.error?.code).toBe('FILE_TOO_LARGE')
    })

    it('should reject a 0-byte file gracefully', async () => {
      const formData = createMultipartBody('empty.txt', '')

      const response = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/files`, {
        method: 'POST',
        headers: { Cookie: authCookie },
        body: formData,
      })

      // 0-byte files should be accepted (valid edge case) or rejected with clear error
      expect([200, 201, 400, 413]).toContain(response.status)
    })
  })

  // ===========================================================================
  // MIME type and extension rejection
  // ===========================================================================

  describe('MIME type and extension rejection', () => {
    it('should reject disallowed MIME type (application/x-msdownload)', async () => {
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

    it('should reject disallowed extension (.exe) even with valid MIME', async () => {
      // Send with text/plain MIME but .exe extension
      const formData = createMultipartBody('malware.exe', 'not really an exe', 'text/plain')

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

    it('should reject disallowed extension (.sh)', async () => {
      const formData = createMultipartBody('script.sh', '#!/bin/bash\necho pwned', 'text/plain')

      const response = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/files`, {
        method: 'POST',
        headers: { Cookie: authCookie },
        body: formData,
      })

      expect(response.status).toBe(415)
    })

    it('should accept allowed MIME types', async () => {
      const allowedTypes = [
        { filename: 'doc.txt', mime: 'text/plain' },
        { filename: 'data.json', mime: 'application/json' },
        { filename: 'notes.md', mime: 'text/markdown' },
        { filename: 'sheet.csv', mime: 'text/csv' },
      ]

      for (const { filename, mime } of allowedTypes) {
        const formData = createMultipartBody(filename, 'test content', mime)
        const response = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/files`, {
          method: 'POST',
          headers: { Cookie: authCookie },
          body: formData,
        })

        expect(response.status).toBe(201)
        const body = (await response.json()) as ApiEnvelope<{ file: FileMetadata }>
        expect(body.ok).toBe(true)
        expect(body.data?.file.mimeType).toBe(mime)
      }
    })
  })

  // ===========================================================================
  // No path traversal
  // ===========================================================================

  describe('No path traversal', () => {
    it('should sanitize filename with path traversal characters', async () => {
      const formData = createMultipartBody('../../../etc/passwd', 'traversal attempt')

      const response = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/files`, {
        method: 'POST',
        headers: { Cookie: authCookie },
        body: formData,
      })

      // Should either succeed with sanitized name or reject
      if (response.status === 201) {
        const body = (await response.json()) as ApiEnvelope<{ file: FileMetadata }>
        expect(body.ok).toBe(true)
        // The returned filename must NOT contain path separators
        expect(body.data?.file.originalFilename).not.toContain('/')
        expect(body.data?.file.originalFilename).not.toContain('\\')
      }
    })

    it('should not expose storageRef in API responses (prevents path info leak)', async () => {
      const formData = createMultipartBody('refleak.txt', 'check ref leak')
      const uploadResponse = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/files`, {
        method: 'POST',
        headers: { Cookie: authCookie },
        body: formData,
      })
      const uploadBody = (await uploadResponse.json()) as ApiEnvelope<{ file: FileMetadata }>
      const fileId = uploadBody.data!.file.fileId

      // Check upload response
      expect((uploadBody.data?.file as unknown as Record<string, unknown>)?.storageRef).toBeUndefined()

      // Check metadata response
      const metaResponse = await fetch(`${baseUrl}/api/v1/files/${fileId}`, {
        headers: { Cookie: authCookie },
      })
      const metaBody = (await metaResponse.json()) as ApiEnvelope<{ file: FileMetadata }>
      expect((metaBody.data?.file as unknown as Record<string, unknown>)?.storageRef).toBeUndefined()

      // Check list response
      const listResponse = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/files`, {
        headers: { Cookie: authCookie },
      })
      const listBody = (await listResponse.json()) as ApiEnvelope<{ files: FileMetadata[] }>
      for (const file of listBody.data!.files) {
        expect((file as unknown as Record<string, unknown>)?.storageRef).toBeUndefined()
      }
    })
  })

  // ===========================================================================
  // Cross-user / cross-session denial
  // ===========================================================================

  describe('Cross-user and cross-session denial', () => {
    let otherCookie: string

    beforeAll(async () => {
      // Create a second user
      const { hashPassword, generateSessionToken, hashToken } = await import('../../src/storage/auth-crypto.js')
      const userStore = ctx.apiContext.stores.userStore
      const authTokenStore = ctx.apiContext.stores.authTokenStore

      const passwordHash = await hashPassword('securitypass123')
      const user = userStore.create({
        userId: `user-security-${Date.now()}`,
        username: `secuser_${Date.now()}`,
        passwordHash,
      })

      const sessionToken = generateSessionToken()
      const tokenHash = hashToken(sessionToken)
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
      authTokenStore.create({ tokenHash, userId: user.userId, expiresAt })

      otherCookie = `agent-platform-session=${sessionToken}`
    })

    it('should deny cross-user file metadata access (404)', async () => {
      // Upload a file as primary user
      const formData = createMultipartBody('cross-user.txt', 'private')
      const uploadResponse = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/files`, {
        method: 'POST',
        headers: { Cookie: authCookie },
        body: formData,
      })
      const uploadBody = (await uploadResponse.json()) as ApiEnvelope<{ file: FileMetadata }>
      const fileId = uploadBody.data!.file.fileId

      // Other user tries to access the file metadata
      const response = await fetch(`${baseUrl}/api/v1/files/${fileId}`, {
        headers: { Cookie: otherCookie },
      })

      expect(response.status).toBe(404)
    })

    it('should deny cross-user file download (404)', async () => {
      const formData = createMultipartBody('cross-dl.txt', 'download me')
      const uploadResponse = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/files`, {
        method: 'POST',
        headers: { Cookie: authCookie },
        body: formData,
      })
      const uploadBody = (await uploadResponse.json()) as ApiEnvelope<{ file: FileMetadata }>
      const fileId = uploadBody.data!.file.fileId

      const response = await fetch(`${baseUrl}/api/v1/files/${fileId}/download`, {
        headers: { Cookie: otherCookie },
      })

      // 404 because getById with wrong userId returns undefined
      expect(response.status).toBe(404)
    })

    it('should deny cross-user file deletion (404)', async () => {
      const formData = createMultipartBody('cross-del.txt', 'delete attempt')
      const uploadResponse = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/files`, {
        method: 'POST',
        headers: { Cookie: authCookie },
        body: formData,
      })
      const uploadBody = (await uploadResponse.json()) as ApiEnvelope<{ file: FileMetadata }>
      const fileId = uploadBody.data!.file.fileId

      const response = await fetch(`${baseUrl}/api/v1/files/${fileId}`, {
        method: 'DELETE',
        headers: { Cookie: otherCookie },
      })

      expect(response.status).toBe(404)

      // Verify the file still exists for the original owner
      const verifyResponse = await fetch(`${baseUrl}/api/v1/files/${fileId}`, {
        headers: { Cookie: authCookie },
      })
      expect(verifyResponse.status).toBe(200)
    })

    it('should deny cross-user session file listing (403)', async () => {
      const response = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/files`, {
        headers: { Cookie: otherCookie },
      })

      expect(response.status).toBe(403)
      const body = (await response.json()) as ApiEnvelope<never>
      expect(body.error?.code).toBe('FORBIDDEN')
    })
  })

  // ===========================================================================
  // Deleted file denial
  // ===========================================================================

  describe('Deleted file denial', () => {
    it('should return 404 for metadata on a soft-deleted file', async () => {
      // Upload then delete
      const formData = createMultipartBody('del-denial.txt', 'will be deleted')
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

      // Metadata should be 404
      const metaResponse = await fetch(`${baseUrl}/api/v1/files/${fileId}`, {
        headers: { Cookie: authCookie },
      })
      expect(metaResponse.status).toBe(404)
    })

    it('should return 404 for download on a soft-deleted file', async () => {
      const formData = createMultipartBody('del-dl.txt', 'download deleted')
      const uploadResponse = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/files`, {
        method: 'POST',
        headers: { Cookie: authCookie },
        body: formData,
      })
      const uploadBody = (await uploadResponse.json()) as ApiEnvelope<{ file: FileMetadata }>
      const fileId = uploadBody.data!.file.fileId

      await fetch(`${baseUrl}/api/v1/files/${fileId}`, {
        method: 'DELETE',
        headers: { Cookie: authCookie },
      })

      const dlResponse = await fetch(`${baseUrl}/api/v1/files/${fileId}/download`, {
        headers: { Cookie: authCookie },
      })
      expect(dlResponse.status).toBe(404)
    })

    it('should exclude deleted files from session listing', async () => {
      // Upload two files, delete one
      const formData1 = createMultipartBody('del-list-1.txt', 'keep')
      const formData2 = createMultipartBody('del-list-2.txt', 'remove')

      await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/files`, {
        method: 'POST',
        headers: { Cookie: authCookie },
        body: formData1,
      })
      const upload2 = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/files`, {
        method: 'POST',
        headers: { Cookie: authCookie },
        body: formData2,
      })

      const body2 = (await upload2.json()) as ApiEnvelope<{ file: FileMetadata }>
      const fileIdToDelete = body2.data!.file.fileId

      // Delete the second file
      await fetch(`${baseUrl}/api/v1/files/${fileIdToDelete}`, {
        method: 'DELETE',
        headers: { Cookie: authCookie },
      })

      // List should not include the deleted file
      const listResponse = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/files`, {
        headers: { Cookie: authCookie },
      })
      const listBody = (await listResponse.json()) as ApiEnvelope<{ files: FileMetadata[] }>

      for (const file of listBody.data!.files) {
        expect(file.fileId).not.toBe(fileIdToDelete)
      }
    })
  })

  // ===========================================================================
  // Raw-byte non-exposure in API responses
  // ===========================================================================

  describe('Raw-byte non-exposure in API responses', () => {
    it('should not expose storageRef in upload response', async () => {
      const formData = createMultipartBody('no-raw.txt', 'secret bytes')
      const response = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/files`, {
        method: 'POST',
        headers: { Cookie: authCookie },
        body: formData,
      })
      const body = (await response.json()) as ApiEnvelope<{ file: FileMetadata }>

      // storageRef must not be in the response
      expect((body.data?.file as unknown as Record<string, unknown>)?.storageRef).toBeUndefined()

      // checksum must not be in the response (internal detail)
      expect((body.data?.file as unknown as Record<string, unknown>)?.checksum).toBeUndefined()

      // tenantId must not be in the response
      expect((body.data?.file as unknown as Record<string, unknown>)?.tenantId).toBeUndefined()

      // previewText must not be in the response (unless explicitly requested)
      expect((body.data?.file as unknown as Record<string, unknown>)?.previewText).toBeUndefined()
    })

    it('should not expose raw file content in metadata response', async () => {
      const secretContent = 'TOP_SECRET_DATA_12345'
      const formData = createMultipartBody('secret.txt', secretContent)
      const uploadResponse = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/files`, {
        method: 'POST',
        headers: { Cookie: authCookie },
        body: formData,
      })
      const uploadBody = (await uploadResponse.json()) as ApiEnvelope<{ file: FileMetadata }>
      const fileId = uploadBody.data!.file.fileId

      const metaResponse = await fetch(`${baseUrl}/api/v1/files/${fileId}`, {
        headers: { Cookie: authCookie },
      })
      const metaBody = await metaResponse.text()

      // The raw file content must NOT appear in the metadata response body
      expect(metaBody).not.toContain(secretContent)
    })

    it('should not expose raw file content in list response', async () => {
      const secretContent = 'LIST_LEAK_TEST_67890'
      const formData = createMultipartBody('list-leak.txt', secretContent)
      await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/files`, {
        method: 'POST',
        headers: { Cookie: authCookie },
        body: formData,
      })

      const listResponse = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/files`, {
        headers: { Cookie: authCookie },
      })
      const listText = await listResponse.text()

      expect(listText).not.toContain(secretContent)
    })

    it('should stream file content in download endpoint', async () => {
      const formData = createMultipartBody('dl-stub.txt', 'download test')
      const uploadResponse = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/files`, {
        method: 'POST',
        headers: { Cookie: authCookie },
        body: formData,
      })
      const uploadBody = (await uploadResponse.json()) as ApiEnvelope<{ file: FileMetadata }>
      const fileId = uploadBody.data!.file.fileId

      const dlResponse = await fetch(`${baseUrl}/api/v1/files/${fileId}/download`, {
        headers: { Cookie: authCookie },
      })

      expect(dlResponse.status).toBe(200)
      const text = await dlResponse.text()
      expect(text).toBe('download test')
    })
  })

  // ===========================================================================
  // Authentication enforcement
  // ===========================================================================

  describe('Authentication enforcement', () => {
    it('should require auth for file upload', async () => {
      const formData = createMultipartBody('noauth.txt', 'content')
      const response = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/files`, {
        method: 'POST',
        body: formData,
      })
      expect(response.status).toBe(401)
    })

    it('should require auth for file listing', async () => {
      const response = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/files`)
      expect(response.status).toBe(401)
    })

    it('should require auth for file metadata', async () => {
      const response = await fetch(`${baseUrl}/api/v1/files/some-id`)
      expect(response.status).toBe(401)
    })

    it('should require auth for file download', async () => {
      const response = await fetch(`${baseUrl}/api/v1/files/some-id/download`)
      expect(response.status).toBe(401)
    })

    it('should require auth for file deletion', async () => {
      const response = await fetch(`${baseUrl}/api/v1/files/some-id`, { method: 'DELETE' })
      expect(response.status).toBe(401)
    })
  })

  // ===========================================================================
  // Per-session quota enforcement
  // ===========================================================================

  describe('Per-session quota enforcement', () => {
    let quotaCtx: AuthenticatedTestContext
    let quotaBaseUrl: string
    let quotaAuthCookie: string
    let quotaSessionId: string

    let originalQuota: string | undefined

    beforeAll(async () => {
      originalQuota = process.env.UPLOAD_PER_SESSION_QUOTA_BYTES
      process.env.UPLOAD_PER_SESSION_QUOTA_BYTES = '1024'
      resetUploadConfigCache()

      quotaCtx = await createAuthenticatedTestContext()
      quotaBaseUrl = quotaCtx.baseUrl
      quotaAuthCookie = quotaCtx.authCookie

      const sessionResponse = await fetch(`${quotaBaseUrl}/api/v1/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: quotaAuthCookie },
        body: JSON.stringify({}),
      })
      const sessionBody = (await sessionResponse.json()) as { data: { session: { sessionId: string } } }
      quotaSessionId = sessionBody.data.session.sessionId
    }, 30000)

    afterAll(async () => {
      await closeAuthenticatedTestContext(quotaCtx)
      if (originalQuota === undefined) {
        delete process.env.UPLOAD_PER_SESSION_QUOTA_BYTES
      } else {
        process.env.UPLOAD_PER_SESSION_QUOTA_BYTES = originalQuota
      }
      resetUploadConfigCache()
    }, 30000)

    it('should accept multiple small files within quota', async () => {
      const formData1 = createMultipartBody('quota1.txt', 'a'.repeat(400))
      const response1 = await fetch(`${quotaBaseUrl}/api/v1/sessions/${quotaSessionId}/files`, {
        method: 'POST',
        headers: { Cookie: quotaAuthCookie },
        body: formData1,
      })
      expect(response1.status).toBe(201)

      const formData2 = createMultipartBody('quota2.txt', 'b'.repeat(400))
      const response2 = await fetch(`${quotaBaseUrl}/api/v1/sessions/${quotaSessionId}/files`, {
        method: 'POST',
        headers: { Cookie: quotaAuthCookie },
        body: formData2,
      })
      expect(response2.status).toBe(201)
    })

    it('should reject upload that would exceed per-session quota', async () => {
      const formData = createMultipartBody('over-quota.txt', 'c'.repeat(400))
      const response = await fetch(`${quotaBaseUrl}/api/v1/sessions/${quotaSessionId}/files`, {
        method: 'POST',
        headers: { Cookie: quotaAuthCookie },
        body: formData,
      })

      expect(response.status).toBe(413)
      const body = (await response.json()) as ApiEnvelope<never>
      expect(body.ok).toBe(false)
      expect(body.error?.code).toBe('SESSION_QUOTA_EXCEEDED')
    })
  })
})
