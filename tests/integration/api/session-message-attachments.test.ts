/**
 * Session Message Attachments Integration Tests
 *
 * Tests for attaching file uploads to session messages via the API.
 *
 * Routes tested:
 * - POST /api/v1/sessions/:sessionId/files   - Upload a file
 * - POST /api/v1/sessions/:sessionId/messages - Send a message with attachmentIds
 *
 * Security requirements:
 * - attachmentIds are optional and correctly propagated through the pipeline
 * - Cross-session attachment references are handled (envelope carries the IDs)
 * - Invalid attachmentIds do not crash the server
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  createAuthenticatedTestContext,
  closeAuthenticatedTestContext,
  type AuthenticatedTestContext,
} from '../../helpers/auth.js'
import { resetUploadConfigCache } from '../../../src/config/upload-config.js'

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

describe('Session Message Attachments', () => {
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
  // Message with attachmentIds
  // ===========================================================================

  describe('POST /api/v1/sessions/:sessionId/messages with attachmentIds', () => {
    it('should accept a message with attachmentIds referencing uploaded files', async () => {
      // Upload a file first
      const formData = createMultipartBody('attach-test.txt', 'attachment content')
      const uploadResponse = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/files`, {
        method: 'POST',
        headers: { Cookie: authCookie },
        body: formData,
      })
      expect(uploadResponse.status).toBe(201)
      const uploadBody = (await uploadResponse.json()) as ApiEnvelope<{ file: FileMetadata }>
      const fileId = uploadBody.data!.file.fileId

      // Send a message referencing the uploaded file
      const messageResponse = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify({ text: 'Here is the file', attachmentIds: [fileId] }),
      })

      expect(messageResponse.status).toBe(202)
      const messageBody = (await messageResponse.json()) as ApiEnvelope<{ accepted: boolean; envelopeId: string }>
      expect(messageBody.ok).toBe(true)
      expect(messageBody.data?.accepted).toBe(true)
      expect(messageBody.data?.envelopeId).toBeDefined()
    })

    it('should accept a message with multiple attachmentIds', async () => {
      // Upload two files
      const formData1 = createMultipartBody('multi-1.txt', 'content 1')
      const formData2 = createMultipartBody('multi-2.txt', 'content 2')

      const upload1 = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/files`, {
        method: 'POST',
        headers: { Cookie: authCookie },
        body: formData1,
      })
      const upload2 = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/files`, {
        method: 'POST',
        headers: { Cookie: authCookie },
        body: formData2,
      })

      const body1 = (await upload1.json()) as ApiEnvelope<{ file: FileMetadata }>
      const body2 = (await upload2.json()) as ApiEnvelope<{ file: FileMetadata }>

      const messageResponse = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify({
          text: 'Multiple files attached',
          attachmentIds: [body1.data!.file.fileId, body2.data!.file.fileId],
        }),
      })

      expect(messageResponse.status).toBe(202)
      const messageBody = (await messageResponse.json()) as ApiEnvelope<{ accepted: boolean }>
      expect(messageBody.ok).toBe(true)
      expect(messageBody.data?.accepted).toBe(true)
    })

    it('should accept a message without attachmentIds (backward compat)', async () => {
      const messageResponse = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify({ text: 'No attachments here' }),
      })

      expect(messageResponse.status).toBe(202)
      const messageBody = (await messageResponse.json()) as ApiEnvelope<{ accepted: boolean }>
      expect(messageBody.ok).toBe(true)
      expect(messageBody.data?.accepted).toBe(true)
    })

    it('should accept a message with empty attachmentIds array', async () => {
      const messageResponse = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify({ text: 'Empty array', attachmentIds: [] }),
      })

      expect(messageResponse.status).toBe(202)
    })

    it('should accept an attachment-only message with empty text and valid attachments', async () => {
      const formData = createMultipartBody('attach-only.txt', 'attachment only content')
      const uploadResponse = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/files`, {
        method: 'POST',
        headers: { Cookie: authCookie },
        body: formData,
      })
      const uploadBody = (await uploadResponse.json()) as ApiEnvelope<{ file: FileMetadata }>
      const fileId = uploadBody.data!.file.fileId

      const messageResponse = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify({ text: '', attachmentIds: [fileId] }),
      })

      expect(messageResponse.status).toBe(202)
      const messageBody = (await messageResponse.json()) as ApiEnvelope<{ accepted: boolean }>
      expect(messageBody.ok).toBe(true)
      expect(messageBody.data?.accepted).toBe(true)
    })

    it('should return 400 for empty text without attachments', async () => {
      const messageResponse = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify({ text: '' }),
      })

      expect(messageResponse.status).toBe(400)
      const messageBody = (await messageResponse.json()) as ApiEnvelope<never>
      expect(messageBody.ok).toBe(false)
      expect(messageBody.error?.code).toBe('INVALID_MESSAGE_TEXT')
    })

    it('should return 404 for non-existent attachmentIds', async () => {
      const messageResponse = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify({
          text: 'Ghost attachment',
          attachmentIds: ['non-existent-id-12345'],
        }),
      })

      expect(messageResponse.status).toBe(404)
      const messageBody = (await messageResponse.json()) as ApiEnvelope<{ accepted: boolean }>
      expect(messageBody.ok).toBe(false)
      expect(messageBody.error?.code).toBe('ATTACHMENT_NOT_FOUND')
    })

    it('should return 404 for empty text with ghost attachmentIds', async () => {
      const messageResponse = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify({ text: '', attachmentIds: ['some-id'] }),
      })

      expect(messageResponse.status).toBe(404)
      const messageBody = (await messageResponse.json()) as ApiEnvelope<never>
      expect(messageBody.ok).toBe(false)
      expect(messageBody.error?.code).toBe('ATTACHMENT_NOT_FOUND')
    })

    it('should return 404 for non-existent session', async () => {
      const messageResponse = await fetch(`${baseUrl}/api/v1/sessions/non-existent/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify({ text: 'test', attachmentIds: ['some-id'] }),
      })

      expect(messageResponse.status).toBe(404)
    })

    it('should return 401 without authentication', async () => {
      const messageResponse = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'test', attachmentIds: ['some-id'] }),
      })

      expect(messageResponse.status).toBe(401)
    })
  })

  // ===========================================================================
  // Cross-session attachment reference
  // ===========================================================================

  describe('Cross-session attachment references', () => {
    let otherSessionId: string

    beforeAll(async () => {
      // Create a second session
      const sessionResponse = await fetch(`${baseUrl}/api/v1/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify({}),
      })
      const sessionBody = (await sessionResponse.json()) as { data: { session: { sessionId: string } } }
      otherSessionId = sessionBody.data.session.sessionId
    })

    it('should reject referencing files from session A in a message to session B', async () => {
      const formData = createMultipartBody('cross-sess.txt', 'cross session content')
      const uploadResponse = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/files`, {
        method: 'POST',
        headers: { Cookie: authCookie },
        body: formData,
      })
      const uploadBody = (await uploadResponse.json()) as ApiEnvelope<{ file: FileMetadata }>
      const fileId = uploadBody.data!.file.fileId

      const messageResponse = await fetch(`${baseUrl}/api/v1/sessions/${otherSessionId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify({ text: 'Cross-session reference', attachmentIds: [fileId] }),
      })

      expect(messageResponse.status).toBe(404)
      const messageBody = (await messageResponse.json()) as ApiEnvelope<never>
      expect(messageBody.ok).toBe(false)
      expect(messageBody.error?.code).toBe('ATTACHMENT_NOT_FOUND')
    })
  })

  // ===========================================================================
  // Deleted attachment reference
  // ===========================================================================

  describe('Deleted attachment reference', () => {
    it('should return 400 ATTACHMENT_DELETED when referencing a deleted file', async () => {
      const formData = createMultipartBody('deleted-ref.txt', 'will be deleted')
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

      const messageResponse = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify({ text: 'Referencing deleted file', attachmentIds: [fileId] }),
      })

      expect(messageResponse.status).toBe(400)
      const messageBody = (await messageResponse.json()) as ApiEnvelope<never>
      expect(messageBody.ok).toBe(false)
      expect(messageBody.error?.code).toBe('ATTACHMENT_DELETED')
    })
  })

  // ===========================================================================
  // Over-count attachment limit
  // ===========================================================================

  describe('Over-count attachment limit', () => {
    it('should return 400 TOO_MANY_ATTACHMENTS when exceeding maxAttachmentsPerMessage', async () => {
      const uploadIds: string[] = []
      for (let i = 0; i < 6; i++) {
        const formData = createMultipartBody(`overcount-${i}.txt`, `content ${i}`)
        const response = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/files`, {
          method: 'POST',
          headers: { Cookie: authCookie },
          body: formData,
        })
        if (response.status === 201) {
          const body = (await response.json()) as ApiEnvelope<{ file: FileMetadata }>
          uploadIds.push(body.data!.file.fileId)
        }
      }

      if (uploadIds.length > 5) {
        const messageResponse = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: authCookie },
          body: JSON.stringify({ text: 'Too many files', attachmentIds: uploadIds }),
        })

        expect(messageResponse.status).toBe(400)
        const messageBody = (await messageResponse.json()) as ApiEnvelope<never>
        expect(messageBody.ok).toBe(false)
        expect(messageBody.error?.code).toBe('TOO_MANY_ATTACHMENTS')
      }
    })
  })

  // ===========================================================================
  // Over-quota upload rejection
  // ===========================================================================

  describe('Over-quota upload rejection', () => {
    let quotaCtx: AuthenticatedTestContext
    let quotaBaseUrl: string
    let quotaAuthCookie: string
    let quotaSessionId: string
    let originalQuota: string | undefined

    beforeAll(async () => {
      originalQuota = process.env.UPLOAD_PER_SESSION_QUOTA_BYTES
      process.env.UPLOAD_PER_SESSION_QUOTA_BYTES = '512'
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

    it('should reject upload when session quota is exceeded', async () => {
      const formData1 = createMultipartBody('quota-a.txt', 'a'.repeat(300))
      const response1 = await fetch(`${quotaBaseUrl}/api/v1/sessions/${quotaSessionId}/files`, {
        method: 'POST',
        headers: { Cookie: quotaAuthCookie },
        body: formData1,
      })
      expect(response1.status).toBe(201)

      const formData2 = createMultipartBody('quota-b.txt', 'b'.repeat(300))
      const response2 = await fetch(`${quotaBaseUrl}/api/v1/sessions/${quotaSessionId}/files`, {
        method: 'POST',
        headers: { Cookie: quotaAuthCookie },
        body: formData2,
      })

      expect(response2.status).toBe(413)
      const body = (await response2.json()) as ApiEnvelope<never>
      expect(body.ok).toBe(false)
      expect(body.error?.code).toBe('SESSION_QUOTA_EXCEEDED')
    })

    it('should not allow referencing quota-exceeded files in a message', async () => {
      const messageResponse = await fetch(`${quotaBaseUrl}/api/v1/sessions/${quotaSessionId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: quotaAuthCookie },
        body: JSON.stringify({ text: 'Should not crash', attachmentIds: ['non-existent-quota-id'] }),
      })

      expect(messageResponse.status).toBe(404)
      const body = (await messageResponse.json()) as ApiEnvelope<never>
      expect(body.error?.code).toBe('ATTACHMENT_NOT_FOUND')
    })
  })

  // ===========================================================================
  // Binary attachment context: metadata-only, not visual understanding
  // ===========================================================================

  describe('Binary attachment context behavior', () => {
    it('should accept image attachment in message and store contentRef in transcript', async () => {
      const pngBase64 =
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg=='
      const pngBytes = Uint8Array.from(atob(pngBase64), (c) => c.charCodeAt(0))
      const pngBlob = new Blob([pngBytes], { type: 'image/png' })
      const formData = new FormData()
      formData.append('file', pngBlob, 'binary-test.png')

      const uploadResponse = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/files`, {
        method: 'POST',
        headers: { Cookie: authCookie },
        body: formData,
      })
      expect(uploadResponse.status).toBe(201)
      const uploadBody = (await uploadResponse.json()) as ApiEnvelope<{ file: FileMetadata }>
      const imageFileId = uploadBody.data!.file.fileId
      expect(uploadBody.data!.file.mimeType).toBe('image/png')

      const messageResponse = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify({ text: 'Image attached', attachmentIds: [imageFileId] }),
      })
      expect(messageResponse.status).toBe(202)

      let transcripts: Array<{ input: { contentRefs?: string[] } }> = []
      for (let attempt = 0; attempt < 30; attempt++) {
        const tResponse = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/transcripts`, {
          headers: { Cookie: authCookie },
        })
        const tBody = (await tResponse.json()) as ApiEnvelope<{ transcripts: typeof transcripts }>
        transcripts = tBody.data?.transcripts ?? []
        if (transcripts.some((t) => t.input.contentRefs?.includes(`attachment:${imageFileId}`))) break
        await new Promise((r) => setTimeout(r, 200))
      }

      const turn = transcripts.find((t) => t.input.contentRefs?.includes(`attachment:${imageFileId}`))
      expect(turn, 'transcript should reference image attachment').toBeDefined()
      expect(turn!.input.contentRefs).toContain(`attachment:${imageFileId}`)
    }, 60000)
  })
})
