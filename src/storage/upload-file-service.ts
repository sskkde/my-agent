/**
 * Local disk storage service for uploaded file bytes.
 *
 * Derives storage paths from file IDs (never user-supplied filenames),
 * writes atomically via temp-file-then-rename, computes SHA-256 checksums,
 * enforces size limits, and cleans up partial writes on failure.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import * as crypto from 'node:crypto'
import { Readable } from 'node:stream'
import type { ReadableStream as WebReadableStream } from 'node:stream/web'

import { getUploadConfig } from '../config/upload-config.js'

/**
 * Result of a successful file write.
 */
export interface WriteResult {
  /** Relative storage path (e.g. "ab/cd/abcd-1234-..."). */
  storageRef: string
  /** SHA-256 hex digest of the written bytes. */
  checksum: string
  /** Total bytes written. */
  sizeBytes: number
}

/**
 * File stats returned by stat().
 */
export interface FileStat {
  sizeBytes: number
  modifiedAt: string
}

/**
 * Interface for local disk file storage operations.
 */
export interface UploadFileService {
  /** Write a file stream to storage. Returns { storageRef, checksum, sizeBytes }. */
  write(fileId: string, stream: WebReadableStream<Uint8Array>, expectedSize?: number): Promise<WriteResult>
  /** Read a file from storage. Returns a ReadableStream or throws if not found. */
  read(storageRef: string): Readable
  /** Get file stats (size, mtime). Throws if not found. */
  stat(storageRef: string): FileStat
  /** Delete a file from storage. Returns true if deleted, false if not found. */
  delete(storageRef: string): boolean
}

// ── Implementation ──────────────────────────────────────────────────────────

class UploadFileServiceImpl implements UploadFileService {
  private readonly uploadDir: string
  private readonly maxFileSizeBytes: number

  constructor(uploadDir: string, maxFileSizeBytes: number) {
    this.uploadDir = path.resolve(uploadDir)
    this.maxFileSizeBytes = maxFileSizeBytes
  }

  async write(
    fileId: string,
    stream: WebReadableStream<Uint8Array>,
    expectedSize?: number,
  ): Promise<WriteResult> {
    // Derive storage path from fileId — never from user filenames
    const storageRef = this.deriveStorageRef(fileId)
    const fullPath = this.resolvePath(storageRef)
    const dir = path.dirname(fullPath)

    // Ensure parent directories exist
    fs.mkdirSync(dir, { recursive: true })

    // Write to temp file first (atomic pattern)
    const tmpPath = `${fullPath}.tmp.${crypto.randomUUID()}`
    let bytesWritten = 0
    const hash = crypto.createHash('sha256')

    let writeStream: fs.WriteStream | undefined
    try {
      writeStream = fs.createWriteStream(tmpPath)
      const nodeReadable = Readable.fromWeb(stream)

      // Consume stream, enforce size, compute checksum
      for await (const chunk of nodeReadable) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        bytesWritten += buf.length

        // Enforce max file size from config
        if (bytesWritten > this.maxFileSizeBytes) {
          throw new StorageSizeExceededError(bytesWritten, this.maxFileSizeBytes)
        }

        // Enforce caller-provided expected size
        if (expectedSize !== undefined && bytesWritten > expectedSize) {
          throw new StorageSizeExceededError(bytesWritten, expectedSize)
        }

        hash.update(buf)
        writeStream.write(buf)
      }

      // Wait for write stream to flush
      await new Promise<void>((resolve, reject) => {
        writeStream!.end(() => resolve())
        writeStream!.on('error', reject)
      })

      // Atomic rename: temp → final
      fs.renameSync(tmpPath, fullPath)

      const checksum = hash.digest('hex')
      return { storageRef, checksum, sizeBytes: bytesWritten }
    } catch (err) {
      // Destroy write stream before cleanup to release file handle
      if (writeStream) {
        writeStream.destroy()
        // Wait briefly for the stream to close
        await new Promise<void>((resolve) => {
          writeStream!.on('close', resolve)
          // Resolve immediately if already closed
          if (writeStream!.destroyed) resolve()
        })
      }
      // Clean up partial write
      this.tryUnlink(tmpPath)
      throw err
    }
  }

  read(storageRef: string): Readable {
    const fullPath = this.resolvePath(storageRef)

    if (!fs.existsSync(fullPath)) {
      throw new StorageNotFoundError(storageRef)
    }

    return fs.createReadStream(fullPath)
  }

  stat(storageRef: string): FileStat {
    const fullPath = this.resolvePath(storageRef)

    let stats: fs.Stats
    try {
      stats = fs.statSync(fullPath)
    } catch (err: unknown) {
      if (isNodeError(err) && err.code === 'ENOENT') {
        throw new StorageNotFoundError(storageRef)
      }
      throw err
    }

    return {
      sizeBytes: stats.size,
      modifiedAt: stats.mtime.toISOString(),
    }
  }

  delete(storageRef: string): boolean {
    const fullPath = this.resolvePath(storageRef)

    if (!fs.existsSync(fullPath)) {
      return false
    }

    fs.unlinkSync(fullPath)
    return true
  }

  // ── Private helpers ────────────────────────────────────────────────────

  /**
   * Derive a sharded storage reference from a fileId.
   * Produces "ab/cd/abcd-1234-..." to spread files across subdirectories.
   */
  private deriveStorageRef(fileId: string): string {
    const shard1 = fileId.slice(0, 2)
    const shard2 = fileId.slice(2, 4)
    return path.join(shard1, shard2, fileId)
  }

  /**
   * Resolve a storageRef to an absolute path and verify it stays within uploadDir.
   * Prevents path traversal attacks.
   */
  private resolvePath(storageRef: string): string {
    const resolved = path.resolve(this.uploadDir, storageRef)
    if (!resolved.startsWith(this.uploadDir + path.sep) && resolved !== this.uploadDir) {
      throw new StoragePathTraversalError(storageRef)
    }
    return resolved
  }

  /**
   * Best-effort file deletion (for cleanup on failure).
   */
  private tryUnlink(filePath: string): void {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath)
      }
    } catch {
      // Best-effort; caller already has the real error
    }
  }
}

// ── Errors ──────────────────────────────────────────────────────────────────

export class StorageNotFoundError extends Error {
  constructor(storageRef: string) {
    super(`File not found: ${storageRef}`)
    this.name = 'StorageNotFoundError'
  }
}

export class StorageSizeExceededError extends Error {
  constructor(bytesWritten: number, limit: number) {
    super(`File size ${bytesWritten} bytes exceeds limit of ${limit} bytes`)
    this.name = 'StorageSizeExceededError'
  }
}

export class StoragePathTraversalError extends Error {
  constructor(storageRef: string) {
    super(`Path traversal detected in storageRef: ${storageRef}`)
    this.name = 'StoragePathTraversalError'
  }
}

// ── Factory ─────────────────────────────────────────────────────────────────

/**
 * Create an UploadFileService backed by the local filesystem.
 * Reads upload directory and max file size from the upload config.
 */
export function createUploadFileService(
  uploadDir?: string,
  maxFileSizeBytes?: number,
): UploadFileService {
  const config = getUploadConfig()
  return new UploadFileServiceImpl(
    uploadDir ?? config.uploadDir,
    maxFileSizeBytes ?? config.maxFileSizeBytes,
  )
}

// ── Type guard ──────────────────────────────────────────────────────────────

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err
}
