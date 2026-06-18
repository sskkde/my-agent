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

    it('should accept a message with non-existent attachmentIds (no server crash)', async () => {
      const messageResponse = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify({
          text: 'Ghost attachment',
          attachmentIds: ['non-existent-id-12345'],
        }),
      })

      // Server should accept the message (IDs are passed through for downstream resolution)
      expect(messageResponse.status).toBe(202)
      const messageBody = (await messageResponse.json()) as ApiEnvelope<{ accepted: boolean }>
      expect(messageBody.ok).toBe(true)
    })

    it('should return 400 for empty text with attachmentIds', async () => {
      const messageResponse = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify({ text: '', attachmentIds: ['some-id'] }),
      })

      expect(messageResponse.status).toBe(400)
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

    it('should allow referencing files from session A in a message to session B (IDs are opaque)', async () => {
      // Upload a file to session A
      const formData = createMultipartBody('cross-sess.txt', 'cross session content')
      const uploadResponse = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/files`, {
        method: 'POST',
        headers: { Cookie: authCookie },
        body: formData,
      })
      const uploadBody = (await uploadResponse.json()) as ApiEnvelope<{ file: FileMetadata }>
      const fileId = uploadBody.data!.file.fileId

      // Send a message to session B referencing the file from session A
      // The message API accepts opaque string IDs; resolution happens downstream
      const messageResponse = await fetch(`${baseUrl}/api/v1/sessions/${otherSessionId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify({ text: 'Cross-session reference', attachmentIds: [fileId] }),
      })

      expect(messageResponse.status).toBe(202)
      const messageBody = (await messageResponse.json()) as ApiEnvelope<{ accepted: boolean }>
      expect(messageBody.ok).toBe(true)
    })
  })
})
