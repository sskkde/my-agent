import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createApiServer } from '../../../src/api/server.js'
import { createApiContext, isApiContextError, type ApiContext } from '../../../src/api/context.js'
import { hashPassword } from '../../../src/storage/auth-crypto.js'
import { WORKDIR_MAX_FILE_BYTES, WORKDIR_QUOTA_BYTES } from '../../../src/workdirs/workdir-paths.js'
import type { FastifyInstance } from 'fastify'
import fs from 'node:fs'
import path from 'node:path'

interface EnvelopeResponse<T = unknown> {
  ok: boolean
  data?: T
  error?: { code: string; message: string }
  requestId: string
}

interface WorkdirResponse {
  id: string
  userId: string
  name: string
  createdAt: string
  updatedAt: string
}

interface WorkdirListData {
  workdirs: WorkdirResponse[]
  total: number
}

interface WorkdirData {
  workdir: WorkdirResponse | null
}

interface TreeNode {
  name: string
  type: 'file' | 'directory'
  relativePath: string
}

interface TreeData {
  tree: TreeNode[]
  path: string
}

interface FileData {
  path: string
  content: string
  sizeBytes: number
  modifiedAt: string
}

describe('Workdirs API', () => {
  let server: FastifyInstance
  let baseUrl: string
  let apiContext: ApiContext
  let authCookie: string
  let userId: string

  beforeAll(async () => {
    const ctx = createApiContext({ dbPath: ':memory:' })
    if (isApiContextError(ctx)) {
      throw new Error(`Failed to create API context: ${ctx.message}`)
    }
    apiContext = ctx
    server = await createApiServer(apiContext)
    await server.listen({ port: 0 })
    const address = server.server.address()
    if (!address || typeof address === 'string') {
      throw new Error('Expected server to listen on a TCP port')
    }
    baseUrl = `http://localhost:${address.port}`

    const setupResponse = await fetch(`${baseUrl}/api/v1/setup/user`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'testuser', password: 'password123' }),
    })
    expect(setupResponse.status).toBe(201)
    authCookie = setupResponse.headers.get('set-cookie')!
    await setupResponse.text()

    const meResponse = await fetch(`${baseUrl}/api/v1/auth/me`, {
      headers: { Cookie: authCookie },
    })
    const meBody = (await meResponse.json()) as { data: { user: { userId: string } } }
    userId = meBody.data.user.userId
  })

  afterAll(async () => {
    await server.close()
    apiContext.connection.close()
  })

  describe('Workdir CRUD', () => {
    it('should list empty workdirs initially', async () => {
      const response = await fetch(`${baseUrl}/api/v1/workdirs`, {
        headers: { Cookie: authCookie },
      })
      expect(response.status).toBe(200)
      const body = (await response.json()) as EnvelopeResponse<WorkdirListData>
      expect(body.ok).toBe(true)
      expect(body.data!.workdirs).toEqual([])
      expect(body.data!.total).toBe(0)
    })

    it('should create a new workdir', async () => {
      const response = await fetch(`${baseUrl}/api/v1/workdirs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify({ name: 'my-project' }),
      })
      expect(response.status).toBe(201)
      const body = (await response.json()) as EnvelopeResponse<WorkdirData>
      expect(body.ok).toBe(true)
      expect(body.data!.workdir).toBeDefined()
      expect(body.data!.workdir!.name).toBe('my-project')
      expect(body.data!.workdir!.userId).toBe(userId)
    })

    it('should list workdirs after creation', async () => {
      const response = await fetch(`${baseUrl}/api/v1/workdirs`, {
        headers: { Cookie: authCookie },
      })
      expect(response.status).toBe(200)
      const body = (await response.json()) as EnvelopeResponse<WorkdirListData>
      expect(body.ok).toBe(true)
      expect(body.data!.total).toBeGreaterThanOrEqual(1)
      expect(body.data!.workdirs.some((w) => w.name === 'my-project')).toBe(true)
    })

    it('should rename a workdir', async () => {
      const listResponse = await fetch(`${baseUrl}/api/v1/workdirs`, {
        headers: { Cookie: authCookie },
      })
      const listBody = (await listResponse.json()) as EnvelopeResponse<WorkdirListData>
      const workdirId = listBody.data!.workdirs[0]!.id

      const response = await fetch(`${baseUrl}/api/v1/workdirs/${workdirId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify({ name: 'renamed-project' }),
      })
      expect(response.status).toBe(200)
      const body = (await response.json()) as EnvelopeResponse<WorkdirData>
      expect(body.ok).toBe(true)
      expect(body.data!.workdir!.name).toBe('renamed-project')
    })

    it('should reject duplicate workdir name', async () => {
      await fetch(`${baseUrl}/api/v1/workdirs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify({ name: 'unique-name' }),
      })

      const response = await fetch(`${baseUrl}/api/v1/workdirs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify({ name: 'unique-name' }),
      })
      expect(response.status).toBe(409)
      const body = (await response.json()) as EnvelopeResponse
      expect(body.ok).toBe(false)
      expect(body.error!.code).toBe('CONFLICT')
    })

    it('should reject empty workdir name', async () => {
      const response = await fetch(`${baseUrl}/api/v1/workdirs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify({ name: '' }),
      })
      expect(response.status).toBe(400)
    })

    it('should soft-delete a workdir', async () => {
      const createResponse = await fetch(`${baseUrl}/api/v1/workdirs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify({ name: 'to-delete' }),
      })
      const createBody = (await createResponse.json()) as EnvelopeResponse<WorkdirData>
      const workdirId = createBody.data!.workdir!.id

      const response = await fetch(`${baseUrl}/api/v1/workdirs/${workdirId}`, {
        method: 'DELETE',
        headers: { Cookie: authCookie },
      })
      expect(response.status).toBe(200)
      const body = (await response.json()) as EnvelopeResponse
      expect(body.ok).toBe(true)

      const listResponse = await fetch(`${baseUrl}/api/v1/workdirs`, {
        headers: { Cookie: authCookie },
      })
      const listBody = (await listResponse.json()) as EnvelopeResponse<WorkdirListData>
      expect(listBody.data!.workdirs.some((w) => w.id === workdirId)).toBe(false)
    })

    it('should return 404 for non-existent workdir', async () => {
      const response = await fetch(`${baseUrl}/api/v1/workdirs/non-existent-id`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify({ name: 'new-name' }),
      })
      expect(response.status).toBe(404)
    })

    it('should require authentication', async () => {
      const response = await fetch(`${baseUrl}/api/v1/workdirs`, {
        headers: {},
      })
      expect(response.status).toBe(401)
    })
  })

  describe('Session Active Workdir', () => {
    let sessionId: string
    let workdirId: string

    beforeEach(async () => {
      const sessionResponse = await fetch(`${baseUrl}/api/v1/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify({}),
      })
      const sessionBody = (await sessionResponse.json()) as { data: { session: { sessionId: string } } }
      sessionId = sessionBody.data.session.sessionId

      const workdirResponse = await fetch(`${baseUrl}/api/v1/workdirs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify({ name: `test-wd-${Date.now()}` }),
      })
      const workdirBody = (await workdirResponse.json()) as EnvelopeResponse<WorkdirData>
      workdirId = workdirBody.data!.workdir!.id
    })

    it('should return null when no active workdir set', async () => {
      const response = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/workdir`, {
        headers: { Cookie: authCookie },
      })
      expect(response.status).toBe(200)
      const body = (await response.json()) as EnvelopeResponse<WorkdirData>
      expect(body.ok).toBe(true)
      expect(body.data!.workdir).toBeNull()
    })

    it('should set active workdir for session', async () => {
      const response = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/workdir`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify({ workdirId }),
      })
      expect(response.status).toBe(200)
      const body = (await response.json()) as EnvelopeResponse<WorkdirData>
      expect(body.ok).toBe(true)
      expect(body.data!.workdir).toBeDefined()
      expect(body.data!.workdir!.id).toBe(workdirId)
    })

    it('should get active workdir after setting', async () => {
      await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/workdir`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify({ workdirId }),
      })

      const response = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/workdir`, {
        headers: { Cookie: authCookie },
      })
      expect(response.status).toBe(200)
      const body = (await response.json()) as EnvelopeResponse<WorkdirData>
      expect(body.data!.workdir!.id).toBe(workdirId)
    })

    it('should clear active workdir', async () => {
      await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/workdir`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify({ workdirId }),
      })

      const response = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/workdir`, {
        method: 'DELETE',
        headers: { Cookie: authCookie },
      })
      expect(response.status).toBe(200)
      const body = (await response.json()) as EnvelopeResponse
      expect(body.ok).toBe(true)

      const getResponse = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/workdir`, {
        headers: { Cookie: authCookie },
      })
      const getBody = (await getResponse.json()) as EnvelopeResponse<WorkdirData>
      expect(getBody.data!.workdir).toBeNull()
    })

    it('should return 404 for non-existent session', async () => {
      const response = await fetch(`${baseUrl}/api/v1/sessions/non-existent/workdir`, {
        headers: { Cookie: authCookie },
      })
      expect(response.status).toBe(404)
    })
  })

  describe('File Operations', () => {
    let workdirId: string
    let workdirPath: string

    beforeAll(async () => {
      const response = await fetch(`${baseUrl}/api/v1/workdirs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify({ name: 'file-test-wd' }),
      })
      const body = (await response.json()) as EnvelopeResponse<WorkdirData>
      workdirId = body.data!.workdir!.id

      const wd = apiContext.stores.workdirStore.getById(workdirId, userId)
      workdirPath = wd!.path
    })

    it('should create a directory', async () => {
      const response = await fetch(`${baseUrl}/api/v1/workdirs/${workdirId}/dirs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify({ path: 'src/components' }),
      })
      expect(response.status).toBe(201)
      const body = (await response.json()) as EnvelopeResponse
      expect(body.ok).toBe(true)
      expect(fs.existsSync(path.join(workdirPath, 'src', 'components'))).toBe(true)
    })

    it('should write a file', async () => {
      const response = await fetch(`${baseUrl}/api/v1/workdirs/${workdirId}/files`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify({ path: 'src/index.ts', content: 'export const hello = "world"' }),
      })
      expect(response.status).toBe(200)
      const body = (await response.json()) as EnvelopeResponse<FileData>
      expect(body.ok).toBe(true)
      expect(body.data!.sizeBytes).toBeGreaterThan(0)
    })

    it('should read a file', async () => {
      const response = await fetch(`${baseUrl}/api/v1/workdirs/${workdirId}/files?path=src/index.ts`, {
        headers: { Cookie: authCookie },
      })
      expect(response.status).toBe(200)
      const body = (await response.json()) as EnvelopeResponse<FileData>
      expect(body.ok).toBe(true)
      expect(body.data!.content).toBe('export const hello = "world"')
      expect(body.data!.path).toBe('src/index.ts')
    })

    it('should list directory tree', async () => {
      const response = await fetch(`${baseUrl}/api/v1/workdirs/${workdirId}/tree`, {
        headers: { Cookie: authCookie },
      })
      expect(response.status).toBe(200)
      const body = (await response.json()) as EnvelopeResponse<TreeData>
      expect(body.ok).toBe(true)
      expect(body.data!.tree.some((e) => e.name === 'src' && e.type === 'directory')).toBe(true)
    })

    it('should list subdirectory tree', async () => {
      const response = await fetch(`${baseUrl}/api/v1/workdirs/${workdirId}/tree?path=src`, {
        headers: { Cookie: authCookie },
      })
      expect(response.status).toBe(200)
      const body = (await response.json()) as EnvelopeResponse<TreeData>
      expect(body.ok).toBe(true)
      expect(body.data!.tree.some((e) => e.name === 'index.ts' && e.type === 'file')).toBe(true)
    })

    it('should return 404 for non-existent file', async () => {
      const response = await fetch(`${baseUrl}/api/v1/workdirs/${workdirId}/files?path=non-existent.txt`, {
        headers: { Cookie: authCookie },
      })
      expect(response.status).toBe(404)
    })

    it('should return 400 when reading a directory as file', async () => {
      const response = await fetch(`${baseUrl}/api/v1/workdirs/${workdirId}/files?path=src`, {
        headers: { Cookie: authCookie },
      })
      expect(response.status).toBe(400)
    })

    it('should reject path traversal in tree', async () => {
      const response = await fetch(`${baseUrl}/api/v1/workdirs/${workdirId}/tree?path=../../../etc`, {
        headers: { Cookie: authCookie },
      })
      expect(response.status).toBe(400)
      const body = (await response.json()) as EnvelopeResponse
      expect(body.ok).toBe(false)
      expect(body.error!.code).toBe('PATH_VALIDATION_ERROR')
    })

    it('should reject path traversal in file read', async () => {
      const response = await fetch(
        `${baseUrl}/api/v1/workdirs/${workdirId}/files?path=../../../etc/passwd`,
        { headers: { Cookie: authCookie } },
      )
      expect(response.status).toBe(400)
    })

    it('should reject path traversal in file write', async () => {
      const response = await fetch(`${baseUrl}/api/v1/workdirs/${workdirId}/files`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify({ path: '../../../tmp/hacked.txt', content: 'malicious' }),
      })
      expect(response.status).toBe(400)
    })

    it('should reject path traversal in mkdir', async () => {
      const response = await fetch(`${baseUrl}/api/v1/workdirs/${workdirId}/dirs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify({ path: '../../../tmp/hacked-dir' }),
      })
      expect(response.status).toBe(400)
    })

    it('should return 404 for non-existent workdir in file operations', async () => {
      const response = await fetch(`${baseUrl}/api/v1/workdirs/non-existent-id/tree`, {
        headers: { Cookie: authCookie },
      })
      expect(response.status).toBe(404)
    })

    it('should require path parameter for file read', async () => {
      const response = await fetch(`${baseUrl}/api/v1/workdirs/${workdirId}/files`, {
        headers: { Cookie: authCookie },
      })
      expect(response.status).toBe(400)
    })

    it('should upload and download a file', async () => {
      const uploadResponse = await fetch(`${baseUrl}/api/v1/workdirs/${workdirId}/files/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify({ path: 'uploads/readme.txt', content: 'uploaded content' }),
      })
      expect(uploadResponse.status).toBe(201)
      const uploadBody = (await uploadResponse.json()) as EnvelopeResponse<FileData>
      expect(uploadBody.ok).toBe(true)
      expect(uploadBody.data!.path).toBe('uploads/readme.txt')
      expect(uploadBody.data!.sizeBytes).toBe('uploaded content'.length)

      const downloadResponse = await fetch(
        `${baseUrl}/api/v1/workdirs/${workdirId}/files/download?path=uploads/readme.txt`,
        { headers: { Cookie: authCookie } },
      )
      expect(downloadResponse.status).toBe(200)
      expect(downloadResponse.headers.get('content-disposition')).toContain('readme.txt')
      expect(await downloadResponse.text()).toBe('uploaded content')
    })

    it('should reject upload to an existing target without overwriting it', async () => {
      fs.writeFileSync(path.join(workdirPath, 'upload-existing.txt'), 'original content', 'utf-8')

      const response = await fetch(`${baseUrl}/api/v1/workdirs/${workdirId}/files/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify({ path: 'upload-existing.txt', content: 'new content' }),
      })

      expect(response.status).toBe(409)
      const body = (await response.json()) as EnvelopeResponse
      expect(body.error!.code).toBe('CONFLICT')
      expect(fs.readFileSync(path.join(workdirPath, 'upload-existing.txt'), 'utf-8')).toBe('original content')
    })

    it('should rename a file', async () => {
      const writeResponse = await fetch(`${baseUrl}/api/v1/workdirs/${workdirId}/files`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify({ path: 'rename-source.txt', content: 'rename me' }),
      })
      expect(writeResponse.status).toBe(200)

      const renameResponse = await fetch(`${baseUrl}/api/v1/workdirs/${workdirId}/files`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify({ fromPath: 'rename-source.txt', toPath: 'renamed/target.txt' }),
      })
      expect(renameResponse.status).toBe(200)
      expect(fs.existsSync(path.join(workdirPath, 'rename-source.txt'))).toBe(false)
      expect(fs.readFileSync(path.join(workdirPath, 'renamed', 'target.txt'), 'utf-8')).toBe('rename me')
    })

    it('should move a directory', async () => {
      fs.mkdirSync(path.join(workdirPath, 'move-source'), { recursive: true })
      fs.writeFileSync(path.join(workdirPath, 'move-source', 'child.txt'), 'child content', 'utf-8')

      const moveResponse = await fetch(`${baseUrl}/api/v1/workdirs/${workdirId}/files`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify({ fromPath: 'move-source', toPath: 'moved/dir' }),
      })
      expect(moveResponse.status).toBe(200)
      expect(fs.existsSync(path.join(workdirPath, 'move-source'))).toBe(false)
      expect(fs.readFileSync(path.join(workdirPath, 'moved', 'dir', 'child.txt'), 'utf-8')).toBe('child content')
    })

    it('should reject moving onto an existing target without overwriting it', async () => {
      fs.writeFileSync(path.join(workdirPath, 'move-conflict-source.txt'), 'source content', 'utf-8')
      fs.writeFileSync(path.join(workdirPath, 'move-conflict-target.txt'), 'target content', 'utf-8')

      const response = await fetch(`${baseUrl}/api/v1/workdirs/${workdirId}/files`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify({ fromPath: 'move-conflict-source.txt', toPath: 'move-conflict-target.txt' }),
      })

      expect(response.status).toBe(409)
      const body = (await response.json()) as EnvelopeResponse
      expect(body.error!.code).toBe('CONFLICT')
      expect(fs.readFileSync(path.join(workdirPath, 'move-conflict-source.txt'), 'utf-8')).toBe('source content')
      expect(fs.readFileSync(path.join(workdirPath, 'move-conflict-target.txt'), 'utf-8')).toBe('target content')
    })

    it('should delete a file', async () => {
      fs.writeFileSync(path.join(workdirPath, 'delete-me.txt'), 'delete content', 'utf-8')

      const response = await fetch(`${baseUrl}/api/v1/workdirs/${workdirId}/files?path=delete-me.txt`, {
        method: 'DELETE',
        headers: { Cookie: authCookie },
      })
      expect(response.status).toBe(200)
      expect(fs.existsSync(path.join(workdirPath, 'delete-me.txt'))).toBe(false)
    })

    it('should reject deleting a non-empty directory without recursive flag', async () => {
      fs.mkdirSync(path.join(workdirPath, 'non-empty'), { recursive: true })
      fs.writeFileSync(path.join(workdirPath, 'non-empty', 'child.txt'), 'child content', 'utf-8')

      const response = await fetch(`${baseUrl}/api/v1/workdirs/${workdirId}/files?path=non-empty`, {
        method: 'DELETE',
        headers: { Cookie: authCookie },
      })
      expect(response.status).toBe(409)
      expect(fs.existsSync(path.join(workdirPath, 'non-empty', 'child.txt'))).toBe(true)
    })

    it('should recursively delete a directory when requested', async () => {
      fs.mkdirSync(path.join(workdirPath, 'recursive-delete'), { recursive: true })
      fs.writeFileSync(path.join(workdirPath, 'recursive-delete', 'child.txt'), 'child content', 'utf-8')

      const response = await fetch(
        `${baseUrl}/api/v1/workdirs/${workdirId}/files?path=recursive-delete&recursive=true`,
        { method: 'DELETE', headers: { Cookie: authCookie } },
      )
      expect(response.status).toBe(200)
      expect(fs.existsSync(path.join(workdirPath, 'recursive-delete'))).toBe(false)
    })

    it('should reject reading files larger than the API read limit', async () => {
      const largeFilePath = path.join(workdirPath, 'oversized-read.txt')
      const handle = fs.openSync(largeFilePath, 'w')
      fs.writeSync(handle, Buffer.from('x'), 0, 1, WORKDIR_MAX_FILE_BYTES)
      fs.closeSync(handle)

      const response = await fetch(`${baseUrl}/api/v1/workdirs/${workdirId}/files?path=oversized-read.txt`, {
        headers: { Cookie: authCookie },
      })
      expect(response.status).toBe(413)
    })

    it('should reject downloading files larger than the API download limit', async () => {
      const largeFilePath = path.join(workdirPath, 'oversized-download.txt')
      const handle = fs.openSync(largeFilePath, 'w')
      fs.writeSync(handle, Buffer.from('x'), 0, 1, WORKDIR_MAX_FILE_BYTES)
      fs.closeSync(handle)

      const response = await fetch(
        `${baseUrl}/api/v1/workdirs/${workdirId}/files/download?path=oversized-download.txt`,
        { headers: { Cookie: authCookie } },
      )
      expect(response.status).toBe(413)
    })

    it('should reject writes that exceed total workdir storage quota', async () => {
      const quotaFilePath = path.join(workdirPath, 'quota-anchor.bin')
      const handle = fs.openSync(quotaFilePath, 'w')
      fs.writeSync(handle, Buffer.from('x'), 0, 1, WORKDIR_QUOTA_BYTES - 1)
      fs.closeSync(handle)

      const response = await fetch(`${baseUrl}/api/v1/workdirs/${workdirId}/files`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify({ path: 'quota-overflow.txt', content: 'xx' }),
      })
      expect(response.status).toBe(413)
    })

    it('should reject writes over quota before creating parent directories', async () => {
      const quotaWorkdirResponse = await fetch(`${baseUrl}/api/v1/workdirs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify({ name: 'write-quota-side-effects-wd' }),
      })
      const quotaWorkdirBody = (await quotaWorkdirResponse.json()) as EnvelopeResponse<WorkdirData>
      const quotaWorkdirId = quotaWorkdirBody.data!.workdir!.id
      const quotaWorkdirPath = apiContext.stores.workdirStore.getById(quotaWorkdirId, userId)!.path
      const handle = fs.openSync(path.join(quotaWorkdirPath, 'quota-anchor.bin'), 'w')
      fs.writeSync(handle, Buffer.from('x'), 0, 1, WORKDIR_QUOTA_BYTES - 1)
      fs.closeSync(handle)

      const response = await fetch(`${baseUrl}/api/v1/workdirs/${quotaWorkdirId}/files`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify({ path: 'new-parent/quota-overflow.txt', content: 'xx' }),
      })

      expect(response.status).toBe(413)
      expect(fs.existsSync(path.join(quotaWorkdirPath, 'new-parent'))).toBe(false)
    })

    it('should reject uploads that exceed total workdir storage quota', async () => {
      const uploadWorkdirResponse = await fetch(`${baseUrl}/api/v1/workdirs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify({ name: 'upload-quota-wd' }),
      })
      const uploadWorkdirBody = (await uploadWorkdirResponse.json()) as EnvelopeResponse<WorkdirData>
      const uploadWorkdirId = uploadWorkdirBody.data!.workdir!.id
      const uploadWorkdirPath = apiContext.stores.workdirStore.getById(uploadWorkdirId, userId)!.path
      const quotaFilePath = path.join(uploadWorkdirPath, 'quota-anchor.bin')
      const handle = fs.openSync(quotaFilePath, 'w')
      fs.writeSync(handle, Buffer.from('x'), 0, 1, WORKDIR_QUOTA_BYTES - 1)
      fs.closeSync(handle)

      const response = await fetch(`${baseUrl}/api/v1/workdirs/${uploadWorkdirId}/files/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify({ path: 'quota-upload.txt', content: 'xx' }),
      })
      expect(response.status).toBe(413)
      expect(fs.existsSync(path.join(uploadWorkdirPath, 'quota-upload.txt'))).toBe(false)
    })

    it('should not expose absolute filesystem paths when workdir file operations fail', async () => {
      const failureWorkdirResponse = await fetch(`${baseUrl}/api/v1/workdirs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify({ name: 'filesystem-failure-wd' }),
      })
      const failureWorkdirBody = (await failureWorkdirResponse.json()) as EnvelopeResponse<WorkdirData>
      const failureWorkdirId = failureWorkdirBody.data!.workdir!.id
      const failureWorkdirPath = apiContext.stores.workdirStore.getById(failureWorkdirId, userId)!.path
      fs.writeFileSync(path.join(failureWorkdirPath, 'file-parent'), 'not a directory', 'utf-8')

      const response = await fetch(`${baseUrl}/api/v1/workdirs/${failureWorkdirId}/files/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify({ path: 'file-parent/child.txt', content: 'child' }),
      })

      expect(response.status).toBe(500)
      const body = (await response.json()) as EnvelopeResponse
      expect(body.error!.message).toBe('Workdir filesystem operation failed')
      expect(body.error!.message).not.toContain(failureWorkdirPath)
    })
  })

  describe('Cross-User Isolation', () => {
    let userAWorkdirId: string
    let userASessionId: string
    let userBCookie: string

    beforeAll(async () => {
      const workdirResponse = await fetch(`${baseUrl}/api/v1/workdirs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify({ name: 'user-a-workdir' }),
      })
      const workdirBody = (await workdirResponse.json()) as EnvelopeResponse<WorkdirData>
      userAWorkdirId = workdirBody.data!.workdir!.id

      const sessionResponse = await fetch(`${baseUrl}/api/v1/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify({}),
      })
      const sessionBody = (await sessionResponse.json()) as { data: { session: { sessionId: string } } }
      userASessionId = sessionBody.data.session.sessionId

      const passwordHash = await hashPassword('password456')
      apiContext.stores.userStore.create({
        userId: 'user-b-test',
        username: 'userb',
        passwordHash,
      })

      const loginResponse = await fetch(`${baseUrl}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'userb', password: 'password456' }),
      })
      await loginResponse.text()
      userBCookie = loginResponse.headers.get('set-cookie') ?? ''
      expect(userBCookie).toBeTruthy()
    })

    it('should not list user A workdirs for user B', async () => {
      const response = await fetch(`${baseUrl}/api/v1/workdirs`, {
        headers: { Cookie: userBCookie },
      })
      expect(response.status).toBe(200)
      const body = (await response.json()) as EnvelopeResponse<WorkdirListData>
      expect(body.data!.workdirs.some((w) => w.id === userAWorkdirId)).toBe(false)
    })

    it('should return 404 when user B tries to rename user A workdir', async () => {
      const response = await fetch(`${baseUrl}/api/v1/workdirs/${userAWorkdirId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: userBCookie },
        body: JSON.stringify({ name: 'hacked-name' }),
      })
      expect(response.status).toBe(404)
    })

    it('should return 404 when user B tries to delete user A workdir', async () => {
      const response = await fetch(`${baseUrl}/api/v1/workdirs/${userAWorkdirId}`, {
        method: 'DELETE',
        headers: { Cookie: userBCookie },
      })
      expect(response.status).toBe(404)
    })

    it('should return 404 when user B tries to read user A workdir tree', async () => {
      const response = await fetch(`${baseUrl}/api/v1/workdirs/${userAWorkdirId}/tree`, {
        headers: { Cookie: userBCookie },
      })
      expect(response.status).toBe(404)
    })

    it('should return 403 when user B tries to access user A session workdir', async () => {
      const response = await fetch(`${baseUrl}/api/v1/sessions/${userASessionId}/workdir`, {
        headers: { Cookie: userBCookie },
      })
      expect(response.status).toBe(403)
    })
  })

  describe('Response Envelope Format', () => {
    it('should use envelope format for success responses', async () => {
      const response = await fetch(`${baseUrl}/api/v1/workdirs`, {
        headers: { Cookie: authCookie },
      })
      const body = (await response.json()) as EnvelopeResponse
      expect(body).toHaveProperty('ok')
      expect(body).toHaveProperty('requestId')
      expect(body).toHaveProperty('data')
    })

    it('should use envelope format for error responses', async () => {
      const response = await fetch(`${baseUrl}/api/v1/workdirs/non-existent`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify({ name: 'test' }),
      })
      const body = (await response.json()) as EnvelopeResponse
      expect(body.ok).toBe(false)
      expect(body).toHaveProperty('error')
      expect(body.error).toHaveProperty('code')
      expect(body.error).toHaveProperty('message')
      expect(body).toHaveProperty('requestId')
    })

    it('should not expose raw filesystem paths in workdir responses', async () => {
      const response = await fetch(`${baseUrl}/api/v1/workdirs`, {
        headers: { Cookie: authCookie },
      })
      const body = (await response.json()) as EnvelopeResponse<WorkdirListData>
      for (const workdir of body.data!.workdirs) {
        const json = JSON.stringify(workdir)
        expect(json).not.toContain('/data/workdirs')
        expect(json).not.toMatch(/^\/[a-z]/)
      }
    })
  })
})
