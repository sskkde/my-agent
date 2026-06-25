import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import path from 'node:path'
import fs from 'node:fs'
import type { ApiContext } from '../context.js'
import { success, envelopeError } from '../response-envelope.js'
import { ResourceType, Action } from '../../permissions/rbac-types.js'
import type { WorkdirService } from '../../workdirs/workdir-service.js'
import { WorkdirServiceError } from '../../workdirs/workdir-service.js'
import type { WorkdirStore, Workdir } from '../../storage/workdir-store.js'
import type { SessionStore } from '../../storage/session-store.js'
import { validateWorkdirPath, validateWorkdirWritePath } from '../../workdirs/workdir-paths.js'
import { WORKDIR_MAX_FILE_BYTES, WORKDIR_MAX_FILES, WORKDIR_QUOTA_BYTES } from '../../workdirs/workdir-paths.js'

interface WorkdirResponse {
  id: string
  userId: string
  name: string
  createdAt: string
  updatedAt: string
}

function toWorkdirResponse(workdir: Workdir): WorkdirResponse {
  return {
    id: workdir.id,
    userId: workdir.userId,
    name: workdir.name,
    createdAt: workdir.createdAt,
    updatedAt: workdir.updatedAt,
  }
}

interface TreeNode {
  name: string
  type: 'file' | 'directory'
  relativePath: string
}

interface WorkdirUsage {
  bytes: number
  files: number
}

function calculateWorkdirUsage(rootPath: string): WorkdirUsage {
  let bytes = 0
  let files = 0
  const pending = [rootPath]

  while (pending.length > 0) {
    const current = pending.pop()
    if (!current) continue
    const stats = fs.lstatSync(current)
    if (current !== rootPath) files += 1
    if (stats.isDirectory()) {
      for (const entry of fs.readdirSync(current)) {
        pending.push(path.join(current, entry))
      }
    } else {
      bytes += stats.size
    }
  }

  return { bytes, files }
}

function existingFileSize(filePath: string): number {
  if (!fs.existsSync(filePath)) return 0
  const stats = fs.statSync(filePath)
  return stats.isFile() ? stats.size : 0
}

function enforceWorkdirWriteQuota(workdirPath: string, targetPath: string, nextBytes: number): { ok: true } | { ok: false; message: string } {
  const usage = calculateWorkdirUsage(workdirPath)
  const currentBytes = existingFileSize(targetPath)
  if (!fs.existsSync(targetPath) && usage.files >= WORKDIR_MAX_FILES) {
    return { ok: false, message: `Workdir file count exceeds maximum of ${WORKDIR_MAX_FILES}` }
  }
  if (usage.bytes - currentBytes + nextBytes > WORKDIR_QUOTA_BYTES) {
    return { ok: false, message: `Workdir storage exceeds maximum of ${WORKDIR_QUOTA_BYTES} bytes` }
  }
  return { ok: true }
}

function resolveUserId(request: FastifyRequest): string | null {
  return request.user?.userId ?? null
}

function resolveTenantId(request: FastifyRequest): string {
  return request.user?.tenantId ?? 'org_default'
}

function validateSessionOwnership(
  sessionStore: SessionStore,
  sessionId: string,
  userId: string,
): { ok: true } | { ok: false; status: number; code: string; message: string } {
  const session = sessionStore.getById(sessionId)
  if (!session) {
    return { ok: false, status: 404, code: 'NOT_FOUND', message: 'Session not found' }
  }
  if (session.userId !== userId) {
    return { ok: false, status: 403, code: 'FORBIDDEN', message: 'Access denied to this session' }
  }
  return { ok: true }
}

function mapServiceError(error: WorkdirServiceError): { status: number; code: string } {
  switch (error.code) {
    case 'WORKDIR_NOT_FOUND':
      return { status: 404, code: 'NOT_FOUND' }
    case 'WORKDIR_SOFT_DELETED':
      return { status: 410, code: 'GONE' }
    case 'WORKDIR_NAME_CONFLICT':
      return { status: 409, code: 'CONFLICT' }
    case 'WORKDIR_QUOTA_EXCEEDED':
      return { status: 413, code: 'QUOTA_EXCEEDED' }
    case 'WORKDIR_MKDIR_FAILED':
      return { status: 500, code: 'INTERNAL_ERROR' }
    case 'WORKDIR_INVALID_NAME':
      return { status: 400, code: 'BAD_REQUEST' }
    case 'WORKDIR_OWNERSHIP_VIOLATION':
      return { status: 403, code: 'FORBIDDEN' }
    case 'WORKDIR_NOT_ACTIVE':
      return { status: 404, code: 'NOT_FOUND' }
    default:
      return { status: 500, code: 'INTERNAL_ERROR' }
  }
}

function safeServiceErrorMessage(error: WorkdirServiceError): string {
  const { code } = mapServiceError(error)
  if (code === 'INTERNAL_ERROR') return 'Workdir operation failed'
  return error.message
}

function getNodeErrorCode(error: unknown): string | undefined {
  if (!(error instanceof Error) || !('code' in error)) return undefined
  const code = error.code
  return typeof code === 'string' ? code : undefined
}

function filesystemErrorResponse(error: unknown): { status: number; code: string; message: string } | null {
  const code = getNodeErrorCode(error)
  if (!code) return null
  if (code === 'EACCES' || code === 'EPERM') return { status: 403, code: 'FORBIDDEN', message: 'Permission denied' }
  if (code === 'EEXIST') return { status: 409, code: 'CONFLICT', message: 'File already exists' }
  return { status: 500, code: 'INTERNAL_ERROR', message: 'Workdir filesystem operation failed' }
}

export async function registerWorkdirRoutes(server: FastifyInstance, context: ApiContext): Promise<void> {
  const workdirService: WorkdirService = context.workdirService
  const workdirStore: WorkdirStore = context.stores.workdirStore
  const sessionStore: SessionStore = context.stores.sessionStore

  // GET /api/v1/workdirs - List user's workdirs
  server.get(
    '/api/v1/workdirs',
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!request.requirePermission(ResourceType.workdirs, Action.read)) {
        return reply
      }

      const userId = resolveUserId(request)
      if (!userId) {
        return reply.code(401).send(envelopeError('UNAUTHORIZED', 'Authentication required', request.requestId))
      }

      const tenantId = resolveTenantId(request)
      const workdirs = workdirStore.listByUser(userId, tenantId)
      const items = workdirs.map(toWorkdirResponse)

      return reply.code(200).send(success({ workdirs: items, total: items.length }, request.requestId))
    },
  )

  // POST /api/v1/workdirs - Create new workdir
  server.post<{ Body: { name: string } }>(
    '/api/v1/workdirs',
    async (request: FastifyRequest<{ Body: { name: string } }>, reply: FastifyReply) => {
      if (!request.requirePermission(ResourceType.workdirs, Action.create)) {
        return reply
      }

      const userId = resolveUserId(request)
      if (!userId) {
        return reply.code(401).send(envelopeError('UNAUTHORIZED', 'Authentication required', request.requestId))
      }

      const { name } = request.body
      if (!name || typeof name !== 'string' || name.trim().length === 0) {
        return reply.code(400).send(envelopeError('BAD_REQUEST', 'Workdir name is required', request.requestId))
      }

      const tenantId = resolveTenantId(request)

      try {
        const workdir = workdirService.createWorkdir(userId, name.trim(), tenantId)
        return reply.code(201).send(success({ workdir: toWorkdirResponse(workdir) }, request.requestId))
      } catch (error) {
        if (error instanceof WorkdirServiceError) {
          const { status, code } = mapServiceError(error)
          return reply.code(status).send(envelopeError(code, safeServiceErrorMessage(error), request.requestId))
        }
        throw error
      }
    },
  )

  // PATCH /api/v1/workdirs/:workdirId - Rename workdir
  server.patch<{ Params: { workdirId: string }; Body: { name: string } }>(
    '/api/v1/workdirs/:workdirId',
    async (request: FastifyRequest<{ Params: { workdirId: string }; Body: { name: string } }>, reply: FastifyReply) => {
      if (!request.requirePermission(ResourceType.workdirs, Action.update)) {
        return reply
      }

      const userId = resolveUserId(request)
      if (!userId) {
        return reply.code(401).send(envelopeError('UNAUTHORIZED', 'Authentication required', request.requestId))
      }

      const { workdirId } = request.params
      const { name } = request.body
      if (!name || typeof name !== 'string' || name.trim().length === 0) {
        return reply.code(400).send(envelopeError('BAD_REQUEST', 'Workdir name is required', request.requestId))
      }

      const tenantId = resolveTenantId(request)

      try {
        const workdir = workdirService.renameWorkdir(workdirId, userId, name.trim(), tenantId)
        return reply.code(200).send(success({ workdir: toWorkdirResponse(workdir) }, request.requestId))
      } catch (error) {
        if (error instanceof WorkdirServiceError) {
          const { status, code } = mapServiceError(error)
          return reply.code(status).send(envelopeError(code, safeServiceErrorMessage(error), request.requestId))
        }
        throw error
      }
    },
  )

  // DELETE /api/v1/workdirs/:workdirId - Soft-delete workdir
  server.delete<{ Params: { workdirId: string } }>(
    '/api/v1/workdirs/:workdirId',
    async (request: FastifyRequest<{ Params: { workdirId: string } }>, reply: FastifyReply) => {
      if (!request.requirePermission(ResourceType.workdirs, Action.delete)) {
        return reply
      }

      const userId = resolveUserId(request)
      if (!userId) {
        return reply.code(401).send(envelopeError('UNAUTHORIZED', 'Authentication required', request.requestId))
      }

      const { workdirId } = request.params
      const tenantId = resolveTenantId(request)

      const workdir = workdirStore.getById(workdirId, userId, tenantId)
      if (!workdir) {
        return reply.code(404).send(envelopeError('NOT_FOUND', 'Workdir not found', request.requestId))
      }

      try {
        workdirService.softDeleteWorkdir(workdirId, userId, tenantId)
        return reply.code(200).send(success({ deleted: true, workdirId }, request.requestId))
      } catch (error) {
        if (error instanceof WorkdirServiceError) {
          const { status, code } = mapServiceError(error)
          return reply.code(status).send(envelopeError(code, safeServiceErrorMessage(error), request.requestId))
        }
        throw error
      }
    },
  )

  // GET /api/v1/sessions/:sessionId/workdir - Get active workdir for session
  server.get<{ Params: { sessionId: string } }>(
    '/api/v1/sessions/:sessionId/workdir',
    async (request: FastifyRequest<{ Params: { sessionId: string } }>, reply: FastifyReply) => {
      if (!request.requirePermission(ResourceType.workdirs, Action.read)) {
        return reply
      }

      const userId = resolveUserId(request)
      if (!userId) {
        return reply.code(401).send(envelopeError('UNAUTHORIZED', 'Authentication required', request.requestId))
      }

      const { sessionId } = request.params
      const ownership = validateSessionOwnership(sessionStore, sessionId, userId)
      if (!ownership.ok) {
        return reply.code(ownership.status).send(envelopeError(ownership.code, ownership.message, request.requestId))
      }

      const tenantId = resolveTenantId(request)
      const activeWorkdir = workdirService.getActiveWorkdir(sessionId, userId, tenantId)

      if (!activeWorkdir) {
        return reply.code(200).send(success({ workdir: null }, request.requestId))
      }

      return reply.code(200).send(success({ workdir: toWorkdirResponse(activeWorkdir) }, request.requestId))
    },
  )

  // PUT /api/v1/sessions/:sessionId/workdir - Set active workdir for session
  server.put<{ Params: { sessionId: string }; Body: { workdirId: string } }>(
    '/api/v1/sessions/:sessionId/workdir',
    async (
      request: FastifyRequest<{ Params: { sessionId: string }; Body: { workdirId: string } }>,
      reply: FastifyReply,
    ) => {
      if (!request.requirePermission(ResourceType.workdirs, Action.update)) {
        return reply
      }

      const userId = resolveUserId(request)
      if (!userId) {
        return reply.code(401).send(envelopeError('UNAUTHORIZED', 'Authentication required', request.requestId))
      }

      const { sessionId } = request.params
      const ownership = validateSessionOwnership(sessionStore, sessionId, userId)
      if (!ownership.ok) {
        return reply.code(ownership.status).send(envelopeError(ownership.code, ownership.message, request.requestId))
      }

      const { workdirId } = request.body
      if (!workdirId || typeof workdirId !== 'string') {
        return reply.code(400).send(envelopeError('BAD_REQUEST', 'workdirId is required', request.requestId))
      }

      const tenantId = resolveTenantId(request)

      try {
        workdirService.setActiveWorkdir(sessionId, workdirId, userId, tenantId)
        const workdir = workdirService.getActiveWorkdir(sessionId, userId, tenantId)
        return reply.code(200).send(success({ workdir: workdir ? toWorkdirResponse(workdir) : null }, request.requestId))
      } catch (error) {
        if (error instanceof WorkdirServiceError) {
          const { status, code } = mapServiceError(error)
          return reply.code(status).send(envelopeError(code, safeServiceErrorMessage(error), request.requestId))
        }
        throw error
      }
    },
  )

  // DELETE /api/v1/sessions/:sessionId/workdir - Clear active workdir for session
  server.delete<{ Params: { sessionId: string } }>(
    '/api/v1/sessions/:sessionId/workdir',
    async (request: FastifyRequest<{ Params: { sessionId: string } }>, reply: FastifyReply) => {
      if (!request.requirePermission(ResourceType.workdirs, Action.delete)) {
        return reply
      }

      const userId = resolveUserId(request)
      if (!userId) {
        return reply.code(401).send(envelopeError('UNAUTHORIZED', 'Authentication required', request.requestId))
      }

      const { sessionId } = request.params
      const ownership = validateSessionOwnership(sessionStore, sessionId, userId)
      if (!ownership.ok) {
        return reply.code(ownership.status).send(envelopeError(ownership.code, ownership.message, request.requestId))
      }

      const tenantId = resolveTenantId(request)
      workdirService.clearActiveWorkdir(sessionId, userId, tenantId)

      return reply.code(200).send(success({ cleared: true }, request.requestId))
    },
  )

  // GET /api/v1/workdirs/:workdirId/tree - List directory tree
  server.get<{ Params: { workdirId: string }; Querystring: { path?: string } }>(
    '/api/v1/workdirs/:workdirId/tree',
    async (
      request: FastifyRequest<{ Params: { workdirId: string }; Querystring: { path?: string } }>,
      reply: FastifyReply,
    ) => {
      if (!request.requirePermission(ResourceType.workdirs, Action.read)) {
        return reply
      }

      const userId = resolveUserId(request)
      if (!userId) {
        return reply.code(401).send(envelopeError('UNAUTHORIZED', 'Authentication required', request.requestId))
      }

      const { workdirId } = request.params
      const tenantId = resolveTenantId(request)

      const workdir = workdirStore.getById(workdirId, userId, tenantId)
      if (!workdir) {
        return reply.code(404).send(envelopeError('NOT_FOUND', 'Workdir not found', request.requestId))
      }

      const subPath = request.query.path || ''
      const targetPath = subPath ? path.join(workdir.path, subPath) : workdir.path

      const validation = validateWorkdirPath(targetPath, workdir.path)
      if (!validation.ok) {
        return reply.code(400).send(envelopeError('PATH_VALIDATION_ERROR', validation.error.message, request.requestId))
      }

      try {
        const entries = fs.readdirSync(validation.canonicalPath, { withFileTypes: true })
        const tree: TreeNode[] = entries.map((entry) => ({
          name: entry.name,
          type: entry.isDirectory() ? 'directory' : 'file',
          relativePath: subPath ? `${subPath}/${entry.name}` : entry.name,
        }))

        return reply.code(200).send(success({ tree, path: subPath || '/' }, request.requestId))
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          return reply.code(404).send(envelopeError('NOT_FOUND', 'Directory not found', request.requestId))
        }
        throw error
      }
    },
  )

  // GET /api/v1/workdirs/:workdirId/files - Read file content
  server.get<{ Params: { workdirId: string }; Querystring: { path: string } }>(
    '/api/v1/workdirs/:workdirId/files',
    async (
      request: FastifyRequest<{ Params: { workdirId: string }; Querystring: { path: string } }>,
      reply: FastifyReply,
    ) => {
      if (!request.requirePermission(ResourceType.workdirs, Action.read)) {
        return reply
      }

      const userId = resolveUserId(request)
      if (!userId) {
        return reply.code(401).send(envelopeError('UNAUTHORIZED', 'Authentication required', request.requestId))
      }

      const { workdirId } = request.params
      const filePath = request.query.path
      if (!filePath) {
        return reply.code(400).send(envelopeError('BAD_REQUEST', 'path query parameter is required', request.requestId))
      }

      const tenantId = resolveTenantId(request)
      const workdir = workdirStore.getById(workdirId, userId, tenantId)
      if (!workdir) {
        return reply.code(404).send(envelopeError('NOT_FOUND', 'Workdir not found', request.requestId))
      }

      const targetPath = path.join(workdir.path, filePath)
      const validation = validateWorkdirPath(targetPath, workdir.path)
      if (!validation.ok) {
        return reply.code(400).send(envelopeError('PATH_VALIDATION_ERROR', validation.error.message, request.requestId))
      }

      try {
        const stat = fs.statSync(validation.canonicalPath)
        if (stat.isDirectory()) {
          return reply.code(400).send(envelopeError('BAD_REQUEST', 'Path is a directory, not a file', request.requestId))
        }
        if (stat.size > WORKDIR_MAX_FILE_BYTES) {
          return reply.code(413).send(envelopeError('QUOTA_EXCEEDED', `File exceeds maximum read size of ${WORKDIR_MAX_FILE_BYTES} bytes`, request.requestId))
        }

        const content = fs.readFileSync(validation.canonicalPath, 'utf-8')
        return reply.code(200).send(
          success(
            {
              path: filePath,
              content,
              sizeBytes: stat.size,
              modifiedAt: stat.mtime.toISOString(),
            },
            request.requestId,
          ),
        )
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          return reply.code(404).send(envelopeError('NOT_FOUND', 'File not found', request.requestId))
        }
        throw error
      }
    },
  )

  // PUT /api/v1/workdirs/:workdirId/files - Write file content
  server.put<{ Params: { workdirId: string }; Body: { path: string; content: string } }>(
    '/api/v1/workdirs/:workdirId/files',
    async (
      request: FastifyRequest<{ Params: { workdirId: string }; Body: { path: string; content: string } }>,
      reply: FastifyReply,
    ) => {
      if (!request.requirePermission(ResourceType.workdirs, Action.update)) {
        return reply
      }

      const userId = resolveUserId(request)
      if (!userId) {
        return reply.code(401).send(envelopeError('UNAUTHORIZED', 'Authentication required', request.requestId))
      }

      const { workdirId } = request.params
      const { path: filePath, content } = request.body
      if (!filePath || typeof filePath !== 'string') {
        return reply.code(400).send(envelopeError('BAD_REQUEST', 'path is required', request.requestId))
      }
      if (content === undefined || content === null) {
        return reply.code(400).send(envelopeError('BAD_REQUEST', 'content is required', request.requestId))
      }

      if (Buffer.byteLength(content, 'utf-8') > WORKDIR_MAX_FILE_BYTES) {
        return reply.code(413).send(
          envelopeError(
            'QUOTA_EXCEEDED',
            `File content exceeds maximum size of ${WORKDIR_MAX_FILE_BYTES} bytes`,
            request.requestId,
          ),
        )
      }

      const tenantId = resolveTenantId(request)
      const workdir = workdirStore.getById(workdirId, userId, tenantId)
      if (!workdir) {
        return reply.code(404).send(envelopeError('NOT_FOUND', 'Workdir not found', request.requestId))
      }

      const targetPath = path.join(workdir.path, filePath)
      const validation = validateWorkdirWritePath(targetPath, workdir.path)
      if (!validation.ok) {
        return reply.code(400).send(envelopeError('PATH_VALIDATION_ERROR', validation.error.message, request.requestId))
      }

      try {
        const contentBytes = Buffer.byteLength(content, 'utf-8')
        const quota = enforceWorkdirWriteQuota(workdir.path, validation.canonicalPath, contentBytes)
        if (!quota.ok) {
          return reply.code(413).send(envelopeError('QUOTA_EXCEEDED', quota.message, request.requestId))
        }
        const dir = path.dirname(validation.canonicalPath)
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true })
        }
        fs.writeFileSync(validation.canonicalPath, content, 'utf-8')
        const stat = fs.statSync(validation.canonicalPath)
        return reply.code(200).send(
          success(
            {
              path: filePath,
              sizeBytes: stat.size,
              modifiedAt: stat.mtime.toISOString(),
            },
            request.requestId,
          ),
        )
      } catch (error) {
        const mapped = filesystemErrorResponse(error)
        if (mapped) return reply.code(mapped.status).send(envelopeError(mapped.code, mapped.message, request.requestId))
        throw error
      }
    },
  )

  // POST /api/v1/workdirs/:workdirId/dirs - Create directory
  server.post<{ Params: { workdirId: string }; Body: { path: string } }>(
    '/api/v1/workdirs/:workdirId/dirs',
    async (
      request: FastifyRequest<{ Params: { workdirId: string }; Body: { path: string } }>,
      reply: FastifyReply,
    ) => {
      if (!request.requirePermission(ResourceType.workdirs, Action.create)) {
        return reply
      }

      const userId = resolveUserId(request)
      if (!userId) {
        return reply.code(401).send(envelopeError('UNAUTHORIZED', 'Authentication required', request.requestId))
      }

      const { workdirId } = request.params
      const { path: dirPath } = request.body
      if (!dirPath || typeof dirPath !== 'string') {
        return reply.code(400).send(envelopeError('BAD_REQUEST', 'path is required', request.requestId))
      }

      const tenantId = resolveTenantId(request)
      const workdir = workdirStore.getById(workdirId, userId, tenantId)
      if (!workdir) {
        return reply.code(404).send(envelopeError('NOT_FOUND', 'Workdir not found', request.requestId))
      }

      const targetPath = path.join(workdir.path, dirPath)
      const validation = validateWorkdirWritePath(targetPath, workdir.path)
      if (!validation.ok) {
        return reply.code(400).send(envelopeError('PATH_VALIDATION_ERROR', validation.error.message, request.requestId))
      }

      try {
        if (!fs.existsSync(validation.canonicalPath)) {
          const quota = enforceWorkdirWriteQuota(workdir.path, validation.canonicalPath, 0)
          if (!quota.ok) {
            return reply.code(413).send(envelopeError('QUOTA_EXCEEDED', quota.message, request.requestId))
          }
        }
        fs.mkdirSync(validation.canonicalPath, { recursive: true })
        return reply.code(201).send(
          success(
            {
              path: dirPath,
              created: true,
            },
            request.requestId,
          ),
        )
      } catch (error) {
        const mapped = filesystemErrorResponse(error)
        if (mapped) return reply.code(mapped.status).send(envelopeError(mapped.code, mapped.message, request.requestId))
        throw error
      }
    },
  )

  server.delete<{ Params: { workdirId: string }; Querystring: { path: string; recursive?: string } }>(
    '/api/v1/workdirs/:workdirId/files',
    async (
      request: FastifyRequest<{ Params: { workdirId: string }; Querystring: { path: string; recursive?: string } }>,
      reply: FastifyReply,
    ) => {
      if (!request.requirePermission(ResourceType.workdirs, Action.delete)) return reply
      const userId = resolveUserId(request)
      if (!userId) return reply.code(401).send(envelopeError('UNAUTHORIZED', 'Authentication required', request.requestId))
      const { path: filePath, recursive } = request.query
      if (!filePath) return reply.code(400).send(envelopeError('BAD_REQUEST', 'path query parameter is required', request.requestId))
      const workdir = workdirStore.getById(request.params.workdirId, userId, resolveTenantId(request))
      if (!workdir) return reply.code(404).send(envelopeError('NOT_FOUND', 'Workdir not found', request.requestId))
      const validation = validateWorkdirPath(path.join(workdir.path, filePath), workdir.path)
      if (!validation.ok) return reply.code(400).send(envelopeError('PATH_VALIDATION_ERROR', validation.error.message, request.requestId))
      try {
        const stat = fs.statSync(validation.canonicalPath)
        if (stat.isDirectory()) {
          if (recursive !== 'true' && fs.readdirSync(validation.canonicalPath).length > 0) {
            return reply.code(409).send(envelopeError('CONFLICT', 'Directory is not empty', request.requestId))
          }
          fs.rmSync(validation.canonicalPath, { recursive: recursive === 'true', force: false })
        } else {
          fs.unlinkSync(validation.canonicalPath)
        }
        return reply.code(200).send(success({ path: filePath, deleted: true }, request.requestId))
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          return reply.code(404).send(envelopeError('NOT_FOUND', 'Path not found', request.requestId))
        }
        if ((error as NodeJS.ErrnoException).code === 'ENOTEMPTY') {
          return reply.code(409).send(envelopeError('CONFLICT', 'Directory is not empty', request.requestId))
        }
        throw error
      }
    },
  )

  server.patch<{ Params: { workdirId: string }; Body: { fromPath: string; toPath: string } }>(
    '/api/v1/workdirs/:workdirId/files',
    async (
      request: FastifyRequest<{ Params: { workdirId: string }; Body: { fromPath: string; toPath: string } }>,
      reply: FastifyReply,
    ) => {
      if (!request.requirePermission(ResourceType.workdirs, Action.update)) return reply
      const userId = resolveUserId(request)
      if (!userId) return reply.code(401).send(envelopeError('UNAUTHORIZED', 'Authentication required', request.requestId))
      const { fromPath, toPath } = request.body
      if (!fromPath || !toPath) return reply.code(400).send(envelopeError('BAD_REQUEST', 'fromPath and toPath are required', request.requestId))
      const workdir = workdirStore.getById(request.params.workdirId, userId, resolveTenantId(request))
      if (!workdir) return reply.code(404).send(envelopeError('NOT_FOUND', 'Workdir not found', request.requestId))
      const source = validateWorkdirPath(path.join(workdir.path, fromPath), workdir.path)
      if (!source.ok) return reply.code(400).send(envelopeError('PATH_VALIDATION_ERROR', source.error.message, request.requestId))
      const target = validateWorkdirWritePath(path.join(workdir.path, toPath), workdir.path)
      if (!target.ok) return reply.code(400).send(envelopeError('PATH_VALIDATION_ERROR', target.error.message, request.requestId))
      try {
        if (fs.existsSync(target.canonicalPath)) {
          return reply.code(409).send(envelopeError('CONFLICT', 'Target path already exists', request.requestId))
        }
        const targetParent = path.dirname(target.canonicalPath)
        if (!fs.existsSync(targetParent)) fs.mkdirSync(targetParent, { recursive: true })
        fs.renameSync(source.canonicalPath, target.canonicalPath)
        const stat = fs.statSync(target.canonicalPath)
        return reply.code(200).send(success({ fromPath, path: toPath, type: stat.isDirectory() ? 'directory' : 'file' }, request.requestId))
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          return reply.code(404).send(envelopeError('NOT_FOUND', 'Source path not found', request.requestId))
        }
        const mapped = filesystemErrorResponse(error)
        if (mapped) return reply.code(mapped.status).send(envelopeError(mapped.code, mapped.message, request.requestId))
        throw error
      }
    },
  )

  server.get<{ Params: { workdirId: string }; Querystring: { path: string } }>(
    '/api/v1/workdirs/:workdirId/files/download',
    async (
      request: FastifyRequest<{ Params: { workdirId: string }; Querystring: { path: string } }>,
      reply: FastifyReply,
    ) => {
      if (!request.requirePermission(ResourceType.workdirs, Action.read)) return reply
      const userId = resolveUserId(request)
      if (!userId) return reply.code(401).send(envelopeError('UNAUTHORIZED', 'Authentication required', request.requestId))
      const filePath = request.query.path
      if (!filePath) return reply.code(400).send(envelopeError('BAD_REQUEST', 'path query parameter is required', request.requestId))
      const workdir = workdirStore.getById(request.params.workdirId, userId, resolveTenantId(request))
      if (!workdir) return reply.code(404).send(envelopeError('NOT_FOUND', 'Workdir not found', request.requestId))
      const validation = validateWorkdirPath(path.join(workdir.path, filePath), workdir.path)
      if (!validation.ok) return reply.code(400).send(envelopeError('PATH_VALIDATION_ERROR', validation.error.message, request.requestId))
      try {
        const stat = fs.statSync(validation.canonicalPath)
        if (!stat.isFile()) return reply.code(400).send(envelopeError('BAD_REQUEST', 'Path is not a file', request.requestId))
        if (stat.size > WORKDIR_MAX_FILE_BYTES) {
          return reply.code(413).send(envelopeError('QUOTA_EXCEEDED', `File exceeds maximum download size of ${WORKDIR_MAX_FILE_BYTES} bytes`, request.requestId))
        }
        return reply
          .header('Content-Type', 'application/octet-stream')
          .header('Content-Disposition', `attachment; filename="${path.basename(filePath).replace(/"/g, '')}"`)
          .send(fs.readFileSync(validation.canonicalPath))
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          return reply.code(404).send(envelopeError('NOT_FOUND', 'File not found', request.requestId))
        }
        throw error
      }
    },
  )

  server.post<{ Params: { workdirId: string }; Body: { path: string; content: string } }>(
    '/api/v1/workdirs/:workdirId/files/upload',
    async (
      request: FastifyRequest<{ Params: { workdirId: string }; Body: { path: string; content: string } }>,
      reply: FastifyReply,
    ) => {
      if (!request.requirePermission(ResourceType.workdirs, Action.create)) return reply
      const userId = resolveUserId(request)
      if (!userId) return reply.code(401).send(envelopeError('UNAUTHORIZED', 'Authentication required', request.requestId))
      const { path: uploadPath, content } = request.body
      if (!uploadPath || content === undefined || content === null) {
        return reply.code(400).send(envelopeError('BAD_REQUEST', 'path and content are required', request.requestId))
      }
      if (Buffer.byteLength(content, 'utf-8') > WORKDIR_MAX_FILE_BYTES) {
        return reply.code(413).send(envelopeError('QUOTA_EXCEEDED', `File content exceeds maximum size of ${WORKDIR_MAX_FILE_BYTES} bytes`, request.requestId))
      }
      const workdir = workdirStore.getById(request.params.workdirId, userId, resolveTenantId(request))
      if (!workdir) return reply.code(404).send(envelopeError('NOT_FOUND', 'Workdir not found', request.requestId))
      const validation = validateWorkdirWritePath(path.join(workdir.path, uploadPath), workdir.path)
      if (!validation.ok) return reply.code(400).send(envelopeError('PATH_VALIDATION_ERROR', validation.error.message, request.requestId))
      try {
        if (fs.existsSync(validation.canonicalPath)) {
          return reply.code(409).send(envelopeError('CONFLICT', 'File already exists', request.requestId))
        }
        const contentBytes = Buffer.byteLength(content, 'utf-8')
        const quota = enforceWorkdirWriteQuota(workdir.path, validation.canonicalPath, contentBytes)
        if (!quota.ok) {
          return reply.code(413).send(envelopeError('QUOTA_EXCEEDED', quota.message, request.requestId))
        }
        const dir = path.dirname(validation.canonicalPath)
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
        fs.writeFileSync(validation.canonicalPath, content, { encoding: 'utf-8', flag: 'wx' })
        const stat = fs.statSync(validation.canonicalPath)
        return reply.code(201).send(success({ path: uploadPath, sizeBytes: stat.size, modifiedAt: stat.mtime.toISOString() }, request.requestId))
      } catch (error) {
        const mapped = filesystemErrorResponse(error)
        if (mapped) return reply.code(mapped.status).send(envelopeError(mapped.code, mapped.message, request.requestId))
        throw error
      }
    },
  )
}
