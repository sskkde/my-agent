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
import { createHash } from 'node:crypto'
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
  sanitizedName: string
  mimeType: string
  extension: string
  sizeBytes: number
  previewStatus: 'pending' | 'generated' | 'skipped' | 'failed'
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
    it('should stream file bytes with correct Content-Type and Content-Disposition headers', async () => {
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

      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toBe('text/plain')
      expect(response.headers.get('content-disposition')).toContain('attachment')
      expect(response.headers.get('content-disposition')).toContain('download-test.txt')

      const text = await response.text()
      expect(text).toBe('download content')
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

  // ===========================================================================
  // DTO contract: safe fields present, internal fields omitted
  // ===========================================================================
  describe('DTO contract — safe fields present, internal fields omitted', () => {
    const FORBIDDEN_FIELDS = ['storageRef', 'checksum', 'tenantId', 'previewText', 'sensitivity', 'deletedAt'] as const
    const ALLOWED_FIELDS: Array<keyof FileMetadata> = [
      'fileId',
      'userId',
      'sessionId',
      'originalFilename',
      'sanitizedName',
      'mimeType',
      'extension',
      'sizeBytes',
      'previewStatus',
      'status',
      'createdAt',
      'updatedAt',
    ]

    it('upload response includes sanitizedName and previewStatus', async () => {
      const formData = createMultipartBody('dto-upload.txt', 'dto contract check')
      const response = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/files`, {
        method: 'POST',
        headers: { Cookie: authCookie },
        body: formData,
      })

      expect(response.status).toBe(201)
      const body = (await response.json()) as ApiEnvelope<{ file: FileMetadata }>
      const file = body.data!.file

      // Safe public fields MUST be present
      expect(file.sanitizedName).toBeDefined()
      expect(typeof file.sanitizedName).toBe('string')
      expect(file.sanitizedName.length).toBeGreaterThan(0)
      expect(file.previewStatus).toBeDefined()
      expect(['pending', 'generated', 'skipped', 'failed']).toContain(file.previewStatus)
    })

    it('upload response omits storageRef, checksum, tenantId, previewText, sensitivity, deletedAt', async () => {
      const formData = createMultipartBody('dto-omit-upload.txt', 'omit check')
      const response = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/files`, {
        method: 'POST',
        headers: { Cookie: authCookie },
        body: formData,
      })

      expect(response.status).toBe(201)
      const body = (await response.json()) as ApiEnvelope<{ file: FileMetadata }>
      const file = body.data!.file as unknown as Record<string, unknown>

      for (const field of FORBIDDEN_FIELDS) {
        expect(file[field], `upload response must not expose "${field}"`).toBeUndefined()
      }
    })

    it('list response includes sanitizedName and previewStatus on each item', async () => {
      // Upload a file first
      const formData = createMultipartBody('dto-list.txt', 'list contract check')
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
      expect(body.data!.files.length).toBeGreaterThan(0)

      for (const file of body.data!.files) {
        expect(file.sanitizedName, 'list item must include sanitizedName').toBeDefined()
        expect(typeof file.sanitizedName).toBe('string')
        expect(file.previewStatus, 'list item must include previewStatus').toBeDefined()
        expect(['pending', 'generated', 'skipped', 'failed']).toContain(file.previewStatus)
      }
    })

    it('list response omits storageRef, checksum, tenantId, previewText, sensitivity, deletedAt on each item', async () => {
      const response = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/files`, {
        headers: { Cookie: authCookie },
      })

      const body = (await response.json()) as ApiEnvelope<{ files: FileMetadata[] }>
      for (const file of body.data!.files) {
        const rec = file as unknown as Record<string, unknown>
        for (const field of FORBIDDEN_FIELDS) {
          expect(rec[field], `list item must not expose "${field}"`).toBeUndefined()
        }
      }
    })

    it('metadata response includes sanitizedName and previewStatus', async () => {
      const formData = createMultipartBody('dto-meta.txt', 'metadata contract')
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
      const file = body.data!.file

      expect(file.sanitizedName).toBeDefined()
      expect(typeof file.sanitizedName).toBe('string')
      expect(file.previewStatus).toBeDefined()
      expect(['pending', 'generated', 'skipped', 'failed']).toContain(file.previewStatus)
    })

    it('metadata response omits storageRef, checksum, tenantId, previewText, sensitivity, deletedAt', async () => {
      const formData = createMultipartBody('dto-meta-omit.txt', 'metadata omit check')
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

      const body = (await response.json()) as ApiEnvelope<{ file: FileMetadata }>
      const file = body.data!.file as unknown as Record<string, unknown>

      for (const field of FORBIDDEN_FIELDS) {
        expect(file[field], `metadata response must not expose "${field}"`).toBeUndefined()
      }
    })

    it('upload response JSON shape matches expected allowed-field set', async () => {
      const formData = createMultipartBody('dto-shape.txt', 'shape check')
      const response = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/files`, {
        method: 'POST',
        headers: { Cookie: authCookie },
        body: formData,
      })

      const body = (await response.json()) as ApiEnvelope<{ file: FileMetadata }>
      const file = body.data!.file as unknown as Record<string, unknown>
      const actualKeys = Object.keys(file).sort()
      const expectedKeys = ALLOWED_FIELDS.slice().sort()

      expect(actualKeys).toEqual(expectedKeys)
    })
  })

  // ===========================================================================
  // Cross-layer attachment lifecycle
  // Upload → send message → transcript → timeline → download → delete
  // ===========================================================================
  describe('Cross-layer attachment lifecycle', () => {
    let lifecycleSessionId: string

    // Deterministic content for reproducible tests
    const DETERMINISTIC_CONTENT = 'The quick brown fox jumps over the lazy dog. 0123456789.'
    const DETERMINISTIC_FILENAME = 'lifecycle-test.txt'
    const EXPECTED_BYTES = new TextEncoder().encode(DETERMINISTIC_CONTENT)
    const EXPECTED_SHA256 = createHash('sha256').update(DETERMINISTIC_CONTENT).digest('hex')

    beforeAll(async () => {
      const sessionResponse = await fetch(`${baseUrl}/api/v1/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify({}),
      })
      const sessionBody = (await sessionResponse.json()) as { data: { session: { sessionId: string } } }
      lifecycleSessionId = sessionBody.data.session.sessionId
    }, 30000)

    it('should complete full lifecycle: upload → message → transcript → timeline → download → delete', async () => {
      // ── Step 1: Upload ──────────────────────────────────────────────
      const formData = createMultipartBody(DETERMINISTIC_FILENAME, DETERMINISTIC_CONTENT)
      const uploadResponse = await fetch(`${baseUrl}/api/v1/sessions/${lifecycleSessionId}/files`, {
        method: 'POST',
        headers: { Cookie: authCookie },
        body: formData,
      })

      expect(uploadResponse.status).toBe(201)
      const uploadBody = (await uploadResponse.json()) as ApiEnvelope<{ file: FileMetadata }>
      expect(uploadBody.ok).toBe(true)
      const fileId = uploadBody.data!.file.fileId
      expect(uploadBody.data!.file.originalFilename).toBe(DETERMINISTIC_FILENAME)
      expect(uploadBody.data!.file.mimeType).toBe('text/plain')
      expect(uploadBody.data!.file.sizeBytes).toBe(EXPECTED_BYTES.length)
      expect(uploadBody.data!.file.status).toBe('ready')

      // ── Step 2: Send message with attachment ────────────────────────
      const messageResponse = await fetch(`${baseUrl}/api/v1/sessions/${lifecycleSessionId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify({
          text: 'Please analyze this file',
          attachmentIds: [fileId],
        }),
      })

      expect(messageResponse.status).toBe(202)
      const messageBody = (await messageResponse.json()) as ApiEnvelope<{ accepted: boolean; envelopeId: string }>
      expect(messageBody.ok).toBe(true)
      expect(messageBody.data?.accepted).toBe(true)

      // ── Step 3: Wait for processing and verify transcript ───────────
      // Poll transcript until the turn appears (processing is async)
      let transcripts: Array<{
        turnId: string
        input: { contentRefs?: string[]; userMessageSummary?: string }
        output: { visibleMessages?: Array<{ role: string; content: string }> }
      }> = []

      for (let attempt = 0; attempt < 30; attempt++) {
        const transcriptResponse = await fetch(
          `${baseUrl}/api/v1/sessions/${lifecycleSessionId}/transcripts`,
          { headers: { Cookie: authCookie } },
        )
        const transcriptBody = (await transcriptResponse.json()) as ApiEnvelope<{
          transcripts: typeof transcripts
          total: number
        }>
        transcripts = transcriptBody.data?.transcripts ?? []

        // Look for a transcript turn that has our attachment contentRef
        const found = transcripts.some(
          (t) => t.input.contentRefs?.includes(`attachment:${fileId}`),
        )
        if (found) break

        // Wait 200ms before retry
        await new Promise((resolve) => setTimeout(resolve, 200))
      }

      // Verify transcript contains contentRef for our attachment
      const matchingTurn = transcripts.find((t) =>
        t.input.contentRefs?.includes(`attachment:${fileId}`),
      )
      expect(matchingTurn, 'transcript should contain a turn referencing our attachment').toBeDefined()
      expect(matchingTurn!.input.userMessageSummary).toBe('Please analyze this file')
      expect(matchingTurn!.input.contentRefs).toContain(`attachment:${fileId}`)

      // ── Step 4: Verify timeline includes attachment metadata ────────
      const timelineResponse = await fetch(
        `${baseUrl}/api/v1/sessions/${lifecycleSessionId}/timeline`,
        { headers: { Cookie: authCookie } },
      )
      expect(timelineResponse.status).toBe(200)

      const timelineBody = (await timelineResponse.json()) as ApiEnvelope<{
        items: Array<{
          eventId: string
          eventType: string
          content: string
          metadata?: {
            attachments?: Array<{
              fileId: string
              originalFilename: string
              sizeBytes: number
              mimeType: string
            }>
          }
        }>
        total: number
      }>
      expect(timelineBody.ok).toBe(true)

      // Find the user_message event that references our attachment
      const userMessageEvent = timelineBody.data!.items.find(
        (e) =>
          e.eventType === 'user_message' &&
          e.metadata?.attachments?.some((a) => a.fileId === fileId),
      )
      expect(
        userMessageEvent,
        'timeline should contain a user_message event with attachment metadata',
      ).toBeDefined()

      const attachmentMeta = userMessageEvent!.metadata!.attachments!.find(
        (a) => a.fileId === fileId,
      )
      expect(attachmentMeta).toBeDefined()
      expect(attachmentMeta!.originalFilename).toBe(DETERMINISTIC_FILENAME)
      expect(attachmentMeta!.sizeBytes).toBe(EXPECTED_BYTES.length)
      expect(attachmentMeta!.mimeType).toBe('text/plain')

      // ── Step 5: Download and verify bytes match ─────────────────────
      const downloadResponse = await fetch(`${baseUrl}/api/v1/files/${fileId}/download`, {
        headers: { Cookie: authCookie },
      })
      expect(downloadResponse.status).toBe(200)
      expect(downloadResponse.headers.get('content-type')).toBe('text/plain')
      expect(downloadResponse.headers.get('content-disposition')).toContain(DETERMINISTIC_FILENAME)

      const downloadedText = await downloadResponse.text()
      expect(downloadedText).toBe(DETERMINISTIC_CONTENT)

      // Verify checksum of downloaded bytes
      const downloadedSha256 = createHash('sha256').update(downloadedText).digest('hex')
      expect(downloadedSha256).toBe(EXPECTED_SHA256)

      // ── Step 6: Delete and verify access blocked ────────────────────
      const deleteResponse = await fetch(`${baseUrl}/api/v1/files/${fileId}`, {
        method: 'DELETE',
        headers: { Cookie: authCookie },
      })
      expect(deleteResponse.status).toBe(200)
      const deleteBody = (await deleteResponse.json()) as ApiEnvelope<{ deleted: boolean; fileId: string }>
      expect(deleteBody.ok).toBe(true)
      expect(deleteBody.data?.deleted).toBe(true)

      // Metadata should be 404 after deletion
      const metaAfterDelete = await fetch(`${baseUrl}/api/v1/files/${fileId}`, {
        headers: { Cookie: authCookie },
      })
      expect(metaAfterDelete.status).toBe(404)

      // Download should be 404 after deletion
      const dlAfterDelete = await fetch(`${baseUrl}/api/v1/files/${fileId}/download`, {
        headers: { Cookie: authCookie },
      })
      expect(dlAfterDelete.status).toBe(404)
    }, 60000)

    it('should verify image attachment shows metadata-only in context (not visual understanding)', async () => {
      // Upload a small valid PNG (1x1 pixel red dot)
      const pngBase64 =
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg=='
      const pngBytes = Uint8Array.from(atob(pngBase64), (c) => c.charCodeAt(0))
      const pngBlob = new Blob([pngBytes], { type: 'image/png' })
      const formData = new FormData()
      formData.append('file', pngBlob, 'test-image.png')

      const uploadResponse = await fetch(`${baseUrl}/api/v1/sessions/${lifecycleSessionId}/files`, {
        method: 'POST',
        headers: { Cookie: authCookie },
        body: formData,
      })

      expect(uploadResponse.status).toBe(201)
      const uploadBody = (await uploadResponse.json()) as ApiEnvelope<{ file: FileMetadata }>
      const imageFileId = uploadBody.data!.file.fileId
      expect(uploadBody.data!.file.mimeType).toBe('image/png')

      // Send message with image attachment
      const messageResponse = await fetch(`${baseUrl}/api/v1/sessions/${lifecycleSessionId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify({
          text: 'Check this image',
          attachmentIds: [imageFileId],
        }),
      })
      expect(messageResponse.status).toBe(202)

      // Wait for processing
      let transcripts: Array<{
        input: { contentRefs?: string[] }
      }> = []

      for (let attempt = 0; attempt < 30; attempt++) {
        const transcriptResponse = await fetch(
          `${baseUrl}/api/v1/sessions/${lifecycleSessionId}/transcripts`,
          { headers: { Cookie: authCookie } },
        )
        const transcriptBody = (await transcriptResponse.json()) as ApiEnvelope<{
          transcripts: typeof transcripts
        }>
        transcripts = transcriptBody.data?.transcripts ?? []

        const found = transcripts.some((t) =>
          t.input.contentRefs?.includes(`attachment:${imageFileId}`),
        )
        if (found) break
        await new Promise((resolve) => setTimeout(resolve, 200))
      }

      // Verify transcript references the image attachment
      const imageTurn = transcripts.find((t) =>
        t.input.contentRefs?.includes(`attachment:${imageFileId}`),
      )
      expect(imageTurn).toBeDefined()

      // Verify the timeline includes the image attachment metadata
      const timelineResponse = await fetch(
        `${baseUrl}/api/v1/sessions/${lifecycleSessionId}/timeline`,
        { headers: { Cookie: authCookie } },
      )
      const timelineBody = (await timelineResponse.json()) as ApiEnvelope<{
        items: Array<{
          eventType: string
          metadata?: {
            attachments?: Array<{
              fileId: string
              mimeType: string
            }>
          }
        }>
      }>

      const imageEvent = timelineBody.data!.items.find(
        (e) =>
          e.eventType === 'user_message' &&
          e.metadata?.attachments?.some((a) => a.fileId === imageFileId),
      )
      expect(imageEvent, 'timeline should include image attachment metadata').toBeDefined()
      expect(
        imageEvent!.metadata!.attachments!.find((a) => a.fileId === imageFileId)?.mimeType,
      ).toBe('image/png')

      // Download the image and verify bytes match (binary round-trip)
      const dlResponse = await fetch(`${baseUrl}/api/v1/files/${imageFileId}/download`, {
        headers: { Cookie: authCookie },
      })
      expect(dlResponse.status).toBe(200)
      expect(dlResponse.headers.get('content-type')).toBe('image/png')

      const downloadedBuffer = await dlResponse.arrayBuffer()
      const downloadedBytes = new Uint8Array(downloadedBuffer)
      expect(downloadedBytes.length).toBe(pngBytes.length)

      // Verify SHA-256 of downloaded image matches uploaded
      const expectedPngSha256 = createHash('sha256').update(Buffer.from(pngBytes)).digest('hex')
      const actualPngSha256 = createHash('sha256').update(Buffer.from(downloadedBytes)).digest('hex')
      expect(actualPngSha256).toBe(expectedPngSha256)
    }, 60000)
  })
})
