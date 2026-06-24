import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import path from 'node:path'
import type { ApiContext } from '../context.js'
import { success, envelopeError } from '../response-envelope.js'
import { ResourceType, Action } from '../../permissions/rbac-types.js'
import { getUploadConfig } from '../../config/upload-config.js'
import type {
  FileUploadRecord,
  FileUploadStore,
} from '../../storage/file-upload-store.js'
import type { SessionStore } from '../../storage/session-store.js'
import { StorageSizeExceededError, StorageNotFoundError } from '../../storage/upload-file-service.js'


// ── Response DTO (excludes storageRef and internal fields) ──────────────────

interface FileMetadataResponse {
  fileId: string
  userId: string
  sessionId: string
  originalFilename: string
  sanitizedName: string
  mimeType: string
  extension: string
  sizeBytes: number
  previewStatus: string
  status: string
  createdAt: string
  updatedAt: string
}

function toFileMetadataResponse(record: FileUploadRecord): FileMetadataResponse {
  return {
    fileId: record.fileId,
    userId: record.userId,
    sessionId: record.sessionId,
    originalFilename: record.originalFilename,
    sanitizedName: record.sanitizedName,
    mimeType: record.mimeType,
    extension: record.extension,
    sizeBytes: record.sizeBytes,
    previewStatus: record.previewStatus,
    status: record.status,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function extractExtension(filename: string): string {
  const ext = path.extname(filename).toLowerCase()
  return ext
}

function isAllowedMimeType(mimeType: string): boolean {
  return getUploadConfig().allowedMimeTypes.includes(mimeType)
}

function isAllowedExtension(extension: string): boolean {
  return getUploadConfig().allowedExtensions.includes(extension)
}

function sanitizeFilename(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 255)
}

// ── Route registration ──────────────────────────────────────────────────────

export async function registerFileRoutes(server: FastifyInstance, context: ApiContext): Promise<void> {
  const fileUploadStore: FileUploadStore = context.stores.fileUploadStore
  const sessionStore: SessionStore = context.stores.sessionStore
  const { uploadFileService, uploadPreviewExtractor } = context

  // ── POST /api/v1/sessions/:sessionId/files ──────────────────────────────

  server.post(
    '/api/v1/sessions/:sessionId/files',
    async (request: FastifyRequest<{ Params: { sessionId: string } }>, reply: FastifyReply) => {
      if (!request.requirePermission(ResourceType.files, Action.create)) {
        return reply
      }

      const { sessionId } = request.params
      const userId = request.user?.userId
      const tenantId = request.user?.tenantId ?? 'org_default'

      if (!userId) {
        return reply.code(401).send(envelopeError('UNAUTHORIZED', 'Authentication required', request.requestId))
      }

      // Validate session exists and user owns it
      const session = sessionStore.getById(sessionId)
      if (!session) {
        return reply.code(404).send(envelopeError('NOT_FOUND', 'Session not found', request.requestId))
      }
      if (session.userId !== userId) {
        return reply.code(403).send(envelopeError('FORBIDDEN', 'Access denied to this session', request.requestId))
      }

      // Parse multipart file
      const uploadConfig = getUploadConfig()

      let file: Awaited<ReturnType<typeof request.file>>
      try {
        file = await request.file()
      } catch (err) {
        const errWithStatus = err as Error & { statusCode?: number }
        if (errWithStatus.statusCode === 413) {
          return reply.code(413).send(envelopeError('FILE_TOO_LARGE', `File exceeds maximum size of ${uploadConfig.maxFileSizeBytes} bytes`, request.requestId))
        }
        const message = err instanceof Error ? err.message : 'Failed to parse multipart upload'
        return reply.code(400).send(envelopeError('BAD_REQUEST', message, request.requestId))
      }

      if (!file) {
        return reply.code(400).send(envelopeError('BAD_REQUEST', 'No file provided in request', request.requestId))
      }

      // Validate MIME type
      if (!isAllowedMimeType(file.mimetype)) {
        return reply.code(415).send(
          envelopeError(
            'UNSUPPORTED_MEDIA_TYPE',
            `MIME type '${file.mimetype}' is not allowed. Allowed types: ${uploadConfig.allowedMimeTypes.join(', ')}`,
            request.requestId,
          ),
        )
      }

      // Validate extension
      const extension = extractExtension(file.filename ?? '')
      if (!isAllowedExtension(extension)) {
        return reply.code(415).send(
          envelopeError(
            'UNSUPPORTED_MEDIA_TYPE',
            `File extension '${extension}' is not allowed. Allowed extensions: ${uploadConfig.allowedExtensions.join(', ')}`,
            request.requestId,
          ),
        )
      }

      // Read file into buffer and validate size
      let fileBuffer: Buffer
      try {
        fileBuffer = await file.toBuffer()
      } catch (err) {
        const errWithStatus = err as Error & { statusCode?: number }
        if (errWithStatus.statusCode === 413) {
          return reply.code(413).send(envelopeError('FILE_TOO_LARGE', `File exceeds maximum size of ${uploadConfig.maxFileSizeBytes} bytes`, request.requestId))
        }
        return reply.code(400).send(envelopeError('BAD_REQUEST', 'Failed to read uploaded file', request.requestId))
      }

      if (fileBuffer.length > uploadConfig.maxFileSizeBytes) {
        return reply.code(413).send(
          envelopeError(
            'FILE_TOO_LARGE',
            `File size ${fileBuffer.length} bytes exceeds maximum of ${uploadConfig.maxFileSizeBytes} bytes`,
            request.requestId,
          ),
        )
      }

      // Enforce per-session upload quota
      const existingFiles = fileUploadStore.listBySession(sessionId)
      const currentSessionBytes = existingFiles.reduce((sum, f) => sum + f.sizeBytes, 0)
      if (currentSessionBytes + fileBuffer.length > uploadConfig.perSessionQuotaBytes) {
        return reply.code(413).send(
          envelopeError(
            'SESSION_QUOTA_EXCEEDED',
            `Session upload quota of ${uploadConfig.perSessionQuotaBytes} bytes would be exceeded. Current usage: ${currentSessionBytes} bytes, upload size: ${fileBuffer.length} bytes`,
            request.requestId,
          ),
        )
      }

      const originalFilename = file.filename ?? 'unnamed'
      const sanitizedName = sanitizeFilename(originalFilename)

      const preliminaryRecord = fileUploadStore.create({
        userId,
        sessionId,
        tenantId,
        originalFilename,
        sanitizedName,
        mimeType: file.mimetype,
        extension,
        sizeBytes: 0,
        checksum: '',
        storageRef: '',
        previewText: undefined,
        previewStatus: 'pending',
        sensitivity: 'low',
        status: 'uploading',
      })

      let writeResult
      try {
        const webStream = new Blob([fileBuffer]).stream() as ReadableStream<Uint8Array>
        writeResult = await uploadFileService.write(
          preliminaryRecord.fileId,
          webStream,
          fileBuffer.length,
        )
      } catch (err) {
        fileUploadStore.delete(preliminaryRecord.fileId)
        if (err instanceof StorageSizeExceededError) {
          return reply.code(413).send(
            envelopeError('FILE_TOO_LARGE', err.message, request.requestId),
          )
        }
        throw err
      }

      const previewResult = uploadPreviewExtractor.extract(fileBuffer, file.mimetype)

      const record = fileUploadStore.update(preliminaryRecord.fileId, {
        sizeBytes: writeResult.sizeBytes,
        checksum: writeResult.checksum,
        storageRef: writeResult.storageRef,
        previewText: previewResult.previewText,
        previewStatus: previewResult.previewStatus,
        status: 'ready',
      })

      if (!record) {
        try {
          uploadFileService.delete(writeResult.storageRef)
        } catch {
          // best-effort: write already succeeded, metadata update failed
        }
        throw new Error(`Failed to update file record ${preliminaryRecord.fileId}`)
      }

      return reply.code(201).send(success({ file: toFileMetadataResponse(record) }, request.requestId))
    },
  )

  // ── GET /api/v1/sessions/:sessionId/files ───────────────────────────────

  server.get(
    '/api/v1/sessions/:sessionId/files',
    async (request: FastifyRequest<{ Params: { sessionId: string } }>, reply: FastifyReply) => {
      if (!request.requirePermission(ResourceType.files, Action.read)) {
        return reply
      }

      const { sessionId } = request.params
      const userId = request.user?.userId

      if (!userId) {
        return reply.code(401).send(envelopeError('UNAUTHORIZED', 'Authentication required', request.requestId))
      }

      // Validate session exists and user owns it
      const session = sessionStore.getById(sessionId)
      if (!session) {
        return reply.code(404).send(envelopeError('NOT_FOUND', 'Session not found', request.requestId))
      }
      if (session.userId !== userId) {
        return reply.code(403).send(envelopeError('FORBIDDEN', 'Access denied to this session', request.requestId))
      }

      const files = fileUploadStore.listBySession(sessionId)
      const items = files.map(toFileMetadataResponse)

      return reply.code(200).send(success({ files: items, total: items.length }, request.requestId))
    },
  )

  // ── GET /api/v1/files/:fileId ───────────────────────────────────────────

  server.get(
    '/api/v1/files/:fileId',
    async (request: FastifyRequest<{ Params: { fileId: string } }>, reply: FastifyReply) => {
      if (!request.requirePermission(ResourceType.files, Action.read)) {
        return reply
      }

      const { fileId } = request.params
      const userId = request.user?.userId

      if (!userId) {
        return reply.code(401).send(envelopeError('UNAUTHORIZED', 'Authentication required', request.requestId))
      }

      const record = fileUploadStore.getById(fileId, { userId })
      if (!record || record.status === 'deleted') {
        return reply.code(404).send(envelopeError('NOT_FOUND', 'File not found', request.requestId))
      }

      return reply.code(200).send(success({ file: toFileMetadataResponse(record) }, request.requestId))
    },
  )

  // ── GET /api/v1/files/:fileId/download ──────────────────────────────────

  server.get(
    '/api/v1/files/:fileId/download',
    async (request: FastifyRequest<{ Params: { fileId: string } }>, reply: FastifyReply) => {
      if (!request.requirePermission(ResourceType.files, Action.read)) {
        return reply
      }

      const { fileId } = request.params
      const userId = request.user?.userId

      if (!userId) {
        return reply.code(401).send(envelopeError('UNAUTHORIZED', 'Authentication required', request.requestId))
      }

      const record = fileUploadStore.getById(fileId, { userId })
      if (!record || record.status === 'deleted') {
        return reply.code(404).send(envelopeError('NOT_FOUND', 'File not found', request.requestId))
      }

      let fileStream
      try {
        fileStream = uploadFileService.read(record.storageRef)
      } catch (err) {
        if (err instanceof StorageNotFoundError) {
          // Stored bytes missing — file record exists but content is gone
          return reply.code(404).send(envelopeError('NOT_FOUND', 'File content not found', request.requestId))
        }
        throw err
      }

      const safeName = record.sanitizedName || sanitizeFilename(record.originalFilename)
      const escapedName = safeName.replace(/["\\]/g, '_')

      return reply
        .header('Content-Type', record.mimeType)
        .header('Content-Disposition', `attachment; filename="${escapedName}"`)
        .header('Content-Length', record.sizeBytes)
        .send(fileStream)
    },
  )

  // ── DELETE /api/v1/files/:fileId ────────────────────────────────────────

  server.delete(
    '/api/v1/files/:fileId',
    async (request: FastifyRequest<{ Params: { fileId: string } }>, reply: FastifyReply) => {
      if (!request.requirePermission(ResourceType.files, Action.delete)) {
        return reply
      }

      const { fileId } = request.params
      const userId = request.user?.userId

      if (!userId) {
        return reply.code(401).send(envelopeError('UNAUTHORIZED', 'Authentication required', request.requestId))
      }

      const record = fileUploadStore.getById(fileId, { userId })
      if (!record || record.status === 'deleted') {
        return reply.code(404).send(envelopeError('NOT_FOUND', 'File not found', request.requestId))
      }

      fileUploadStore.markDeleted(fileId)

      try {
        uploadFileService.delete(record.storageRef)
      } catch {
        // best-effort: metadata already marked deleted
      }

      return reply.code(200).send(success({ deleted: true, fileId }, request.requestId))
    },
  )
}
