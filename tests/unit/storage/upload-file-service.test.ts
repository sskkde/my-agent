import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as crypto from 'node:crypto'
import { Readable } from 'node:stream'

import {
  createUploadFileService,
  type UploadFileService,
  StorageNotFoundError,
  StorageSizeExceededError,
  StoragePathTraversalError,
} from '../../../src/storage/upload-file-service.js'

/**
 * Helper: create a Web ReadableStream from a Uint8Array.
 */
function toWebStream(data: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(data)
      controller.close()
    },
  })
}

/**
 * Helper: create a Web ReadableStream that emits chunks then errors.
 */
function toErrorStream(chunks: Uint8Array[], err: Error): ReadableStream<Uint8Array> {
  let i = 0
  return new ReadableStream({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(chunks[i]!)
        i++
      } else {
        controller.error(err)
      }
    },
  })
}

/**
 * Helper: collect a Node Readable into a Buffer.
 */
async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

/**
 * Helper: compute SHA-256 hex digest of data.
 */
function sha256(data: Uint8Array): string {
  return crypto.createHash('sha256').update(data).digest('hex')
}

describe('UploadFileService', () => {
  let tmpDir: string
  let service: UploadFileService

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'upload-service-test-'))
    service = createUploadFileService(tmpDir, 1024 * 1024) // 1 MiB for tests
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  // ── write + read round-trip ────────────────────────────────────────────

  describe('write', () => {
    it('writes a file and returns storageRef, checksum, and sizeBytes', async () => {
      const fileId = '550e8400-e29b-41d4-a716-446655440000'
      const content = new TextEncoder().encode('Hello, world!')
      const stream = toWebStream(content)

      const result = await service.write(fileId, stream)

      expect(result.storageRef).toBe(path.join('55', '0e', fileId))
      expect(result.checksum).toBe(sha256(content))
      expect(result.sizeBytes).toBe(content.length)
    })

    it('creates sharded directories on disk', async () => {
      const fileId = 'abcdef12-3456-7890-abcd-ef1234567890'
      const content = new TextEncoder().encode('shard test')
      await service.write(fileId, toWebStream(content))

      const expectedDir = path.join(tmpDir, 'ab', 'cd')
      expect(fs.existsSync(expectedDir)).toBe(true)
      expect(fs.existsSync(path.join(expectedDir, fileId))).toBe(true)
    })
  })

  // ── read ───────────────────────────────────────────────────────────────

  describe('read', () => {
    it('reads back the exact bytes that were written', async () => {
      const fileId = '550e8400-e29b-41d4-a716-446655440000'
      const content = new TextEncoder().encode('round-trip content ⚡')
      const result = await service.write(fileId, toWebStream(content))

      const readStream = service.read(result.storageRef)
      const readBack = await streamToBuffer(readStream)

      expect(Buffer.compare(readBack, Buffer.from(content))).toBe(0)
    })

    it('throws StorageNotFoundError for non-existent file', () => {
      expect(() => service.read('non/existent/file-id')).toThrow(StorageNotFoundError)
    })
  })

  // ── stat ───────────────────────────────────────────────────────────────

  describe('stat', () => {
    it('returns correct sizeBytes and modifiedAt', async () => {
      const fileId = '550e8400-e29b-41d4-a716-446655440000'
      const content = new TextEncoder().encode('stat test')
      const result = await service.write(fileId, toWebStream(content))

      const fileStat = service.stat(result.storageRef)

      expect(fileStat.sizeBytes).toBe(content.length)
      expect(fileStat.modifiedAt).toBeTruthy()
      // Verify it's a valid ISO date
      expect(new Date(fileStat.modifiedAt).toISOString()).toBe(fileStat.modifiedAt)
    })

    it('throws StorageNotFoundError for non-existent file', () => {
      expect(() => service.stat('non/existent/file-id')).toThrow(StorageNotFoundError)
    })
  })

  // ── checksum ───────────────────────────────────────────────────────────

  describe('checksum', () => {
    it('computes SHA-256 matching independently computed hash', async () => {
      const fileId = '550e8400-e29b-41d4-a716-446655440000'
      const content = crypto.randomBytes(4096)
      const expectedHash = sha256(content)

      const result = await service.write(fileId, toWebStream(content))

      expect(result.checksum).toBe(expectedHash)
    })

    it('produces different checksums for different content', async () => {
      const fileIdA = '11111111-1111-1111-1111-111111111111'
      const fileIdB = '22222222-2222-2222-2222-222222222222'
      const contentA = new TextEncoder().encode('content A')
      const contentB = new TextEncoder().encode('content B')

      const resultA = await service.write(fileIdA, toWebStream(contentA))
      const resultB = await service.write(fileIdB, toWebStream(contentB))

      expect(resultA.checksum).not.toBe(resultB.checksum)
    })
  })

  // ── size enforcement ──────────────────────────────────────────────────

  describe('size enforcement', () => {
    it('rejects writes exceeding the configured max file size', async () => {
      // Create service with tiny 10-byte limit
      const tinyService = createUploadFileService(tmpDir, 10)
      const fileId = '550e8400-e29b-41d4-a716-446655440000'
      const content = new TextEncoder().encode('this is more than ten bytes')

      await expect(tinyService.write(fileId, toWebStream(content))).rejects.toThrow(
        StorageSizeExceededError,
      )
    })

    it('rejects writes exceeding caller-provided expectedSize', async () => {
      const fileId = '550e8400-e29b-41d4-a716-446655440000'
      const content = new TextEncoder().encode('exceeds expected')

      await expect(service.write(fileId, toWebStream(content), 5)).rejects.toThrow(
        StorageSizeExceededError,
      )
    })

    it('accepts writes at exactly the expected size', async () => {
      const fileId = '550e8400-e29b-41d4-a716-446655440000'
      const content = new TextEncoder().encode('exact') // 5 bytes

      const result = await service.write(fileId, toWebStream(content), 5)
      expect(result.sizeBytes).toBe(5)
    })
  })

  // ── path traversal prevention ─────────────────────────────────────────

  describe('path traversal prevention', () => {
    it('handles fileId containing ../ without escaping uploadDir', async () => {
      // Even with traversal-like characters in the first 4 chars, the sharding
      // uses slice(0,2) and slice(2,4) which will be ".." and "/." — the resolve
      // method catches this.
      const maliciousId = '../escape-attempt'
      const content = new TextEncoder().encode('traversal test')

      // The derived path would try to go up from uploadDir, but resolvePath
      // validates that the result stays within uploadDir
      await expect(service.write(maliciousId, toWebStream(content))).rejects.toThrow(
        StoragePathTraversalError,
      )
    })

    it('normal paths stay within uploadDir', async () => {
      const fileId = '550e8400-e29b-41d4-a716-446655440000'
      const content = new TextEncoder().encode('safe path')
      const result = await service.write(fileId, toWebStream(content))

      // storageRef is relative — never exposes absolute path
      expect(path.isAbsolute(result.storageRef)).toBe(false)
    })

    it('read with path traversal ref throws StoragePathTraversalError', () => {
      expect(() => service.read('../../etc/passwd')).toThrow(StoragePathTraversalError)
    })

    it('stat with path traversal ref throws StoragePathTraversalError', () => {
      expect(() => service.stat('../../etc/passwd')).toThrow(StoragePathTraversalError)
    })
  })

  // ── delete ─────────────────────────────────────────────────────────────

  describe('delete', () => {
    it('deletes a file and returns true', async () => {
      const fileId = '550e8400-e29b-41d4-a716-446655440000'
      const content = new TextEncoder().encode('delete me')
      const result = await service.write(fileId, toWebStream(content))

      const deleted = service.delete(result.storageRef)

      expect(deleted).toBe(true)
      // File no longer exists
      expect(() => service.stat(result.storageRef)).toThrow(StorageNotFoundError)
    })

    it('returns false when deleting a non-existent file (idempotent)', () => {
      const deleted = service.delete('non/existent/file-id')
      expect(deleted).toBe(false)
    })

    it('returns false on repeated delete of same file', async () => {
      const fileId = '550e8400-e29b-41d4-a716-446655440000'
      const content = new TextEncoder().encode('double delete')
      const result = await service.write(fileId, toWebStream(content))

      expect(service.delete(result.storageRef)).toBe(true)
      expect(service.delete(result.storageRef)).toBe(false)
    })
  })

  // ── partial write cleanup ──────────────────────────────────────────────

  describe('partial write cleanup', () => {
    it('cleans up temp file when stream errors mid-write', async () => {
      const fileId = '550e8400-e29b-41d4-a716-446655440000'
      const chunk1 = new TextEncoder().encode('partial ')
      const err = new Error('stream interrupted')
      const stream = toErrorStream([chunk1], err)

      await expect(service.write(fileId, stream)).rejects.toThrow('stream interrupted')

      // The final file should NOT exist
      const storageRef = path.join('55', '0e', fileId)
      const fullPath = path.join(tmpDir, storageRef)
      expect(fs.existsSync(fullPath)).toBe(false)

      // No temp files should remain
      const shardDir = path.join(tmpDir, '55', '0e')
      if (fs.existsSync(shardDir)) {
        const files = fs.readdirSync(shardDir)
        const tmpFiles = files.filter((f) => f.includes('.tmp.'))
        expect(tmpFiles).toHaveLength(0)
      }
    })

    it('cleans up temp file when size limit is exceeded mid-write', async () => {
      const tinyService = createUploadFileService(tmpDir, 5)
      const fileId = '550e8400-e29b-41d4-a716-446655440000'
      // Stream two chunks: first is 4 bytes, second pushes over 5
      const chunk1 = new TextEncoder().encode('1234')
      const chunk2 = new TextEncoder().encode('6789')
      let pulled = false
      const stream = new ReadableStream({
        pull(controller) {
          if (!pulled) {
            controller.enqueue(chunk1)
            pulled = true
          } else {
            controller.enqueue(chunk2)
            controller.close()
          }
        },
      })

      await expect(tinyService.write(fileId, stream)).rejects.toThrow(StorageSizeExceededError)

      // No temp files should remain
      const shardDir = path.join(tmpDir, '55', '0e')
      if (fs.existsSync(shardDir)) {
        const files = fs.readdirSync(shardDir)
        const tmpFiles = files.filter((f) => f.includes('.tmp.'))
        expect(tmpFiles).toHaveLength(0)
      }
    })
  })
})
