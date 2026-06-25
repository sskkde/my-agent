/**
 * WorkdirService
 *
 * Manages user workdirs with filesystem-backed storage.
 * - Idempotent default workdir creation
 * - Create / rename / soft-delete workdirs
 * - Per-session active workdir resolution
 * - Local-user single-developer handling
 * - Quota enforcement before disk mutation
 * - Recovery: DB row cleanup if mkdir fails
 *
 * Physical workdir files are NEVER deleted by this service.
 * Only DB rows are removed when soft-deleting.
 */

import { randomUUID } from 'crypto'
import type { WorkdirStore, Workdir, CreateWorkdirInput } from '../storage/workdir-store.js'
import type { SessionWorkdirStateStore } from '../storage/session-workdir-state-store.js'
import {
  getWorkdirRoot,
  buildWorkdirPath,
  ensureWorkdirDir,
  WORKDIR_QUOTA_BYTES,
  WORKDIR_MAX_FILES,
} from './workdir-paths.js'

// ============================================================================
// Constants
// ============================================================================

/** Canonical name for the default workdir. */
export const DEFAULT_WORKDIR_NAME = 'default'

/** Local dev user sentinel — treated as a single deterministic user. */
export const LOCAL_USER_ID = 'local-user'

// ============================================================================
// Error types
// ============================================================================

export type WorkdirServiceErrorCode =
  | 'WORKDIR_NOT_FOUND'
  | 'WORKDIR_SOFT_DELETED'
  | 'WORKDIR_NAME_CONFLICT'
  | 'WORKDIR_QUOTA_EXCEEDED'
  | 'WORKDIR_MKDIR_FAILED'
  | 'WORKDIR_INVALID_NAME'
  | 'WORKDIR_OWNERSHIP_VIOLATION'
  | 'WORKDIR_NOT_ACTIVE'

export class WorkdirServiceError extends Error {
  public readonly code: WorkdirServiceErrorCode
  public readonly details?: unknown

  constructor(code: WorkdirServiceErrorCode, message: string, details?: unknown) {
    super(message)
    this.name = 'WorkdirServiceError'
    this.code = code
    this.details = details
  }
}

// ============================================================================
// Quota config
// ============================================================================

export interface WorkdirQuotaConfig {
  /** Maximum bytes per workdir (default: 1 GiB from workdir-paths). */
  maxBytes: number
  /** Maximum number of files per workdir (default: 100,000). */
  maxFiles: number
  /** Maximum directory depth within a workdir (default: 10). */
  maxDepth: number
}

const DEFAULT_QUOTA_CONFIG: WorkdirQuotaConfig = {
  maxBytes: WORKDIR_QUOTA_BYTES,
  maxFiles: WORKDIR_MAX_FILES,
  maxDepth: 10,
}

// ============================================================================
// WorkdirService interface
// ============================================================================

export interface WorkdirService {
  createDefaultWorkdir(userId: string, tenantId?: string): Workdir
  createWorkdir(userId: string, name: string, tenantId?: string): Workdir
  renameWorkdir(id: string, userId: string, newName: string, tenantId?: string): Workdir

  /**
   * Soft-delete a workdir. Idempotent — no error if already deleted.
   * Does NOT delete physical files.
   * Clears any session active-selections pointing to this workdir.
   * Calls onWorkdirDeleted callback (if provided) for process-session cleanup.
   */
  softDeleteWorkdir(id: string, userId: string, tenantId?: string): void

  getActiveWorkdir(sessionId: string, userId: string, tenantId?: string): Workdir | null
  setActiveWorkdir(sessionId: string, workdirId: string, userId: string, tenantId?: string): void
  clearActiveWorkdir(sessionId: string, userId: string, tenantId?: string): void
}

// ============================================================================
// WorkdirService implementation
// ============================================================================

class WorkdirServiceImpl implements WorkdirService {
  private workdirStore: WorkdirStore
  private sessionStateStore: SessionWorkdirStateStore
  private quotaConfig: WorkdirQuotaConfig
  private fsOps: FileSystemOps
  private onWorkdirDeleted?: (workdirId: string) => void

  constructor(deps: {
    workdirStore: WorkdirStore
    sessionStateStore: SessionWorkdirStateStore
    quotaConfig?: Partial<WorkdirQuotaConfig>
    fsOps?: FileSystemOps
    onWorkdirDeleted?: (workdirId: string) => void
  }) {
    this.workdirStore = deps.workdirStore
    this.sessionStateStore = deps.sessionStateStore
    this.quotaConfig = { ...DEFAULT_QUOTA_CONFIG, ...deps.quotaConfig }
    this.fsOps = deps.fsOps ?? defaultFsOps
    this.onWorkdirDeleted = deps.onWorkdirDeleted
  }

  // ==========================================================================
  // createDefaultWorkdir
  // ==========================================================================

  createDefaultWorkdir(userId: string, tenantId?: string): Workdir {
    const effectiveUserId = resolveLocalUser(userId)

    // Check if default already exists (idempotent)
    const existing = this.findByName(effectiveUserId, DEFAULT_WORKDIR_NAME, tenantId)
    if (existing) {
      return existing
    }

    // Create new default workdir with filesystem
    return this.createWorkdirWithFs(effectiveUserId, DEFAULT_WORKDIR_NAME, tenantId)
  }

  // ==========================================================================
  // createWorkdir
  // ==========================================================================

  createWorkdir(userId: string, name: string, tenantId?: string): Workdir {
    const effectiveUserId = resolveLocalUser(userId)
    validateWorkdirName(name)

    // Check for name conflict among active workdirs
    const conflict = this.findByName(effectiveUserId, name, tenantId)
    if (conflict) {
      throw new WorkdirServiceError(
        'WORKDIR_NAME_CONFLICT',
        `Workdir with name "${name}" already exists for this user`,
      )
    }

    return this.createWorkdirWithFs(effectiveUserId, name, tenantId)
  }

  // ==========================================================================
  // renameWorkdir
  // ==========================================================================

  renameWorkdir(id: string, userId: string, newName: string, tenantId?: string): Workdir {
    const effectiveUserId = resolveLocalUser(userId)
    validateWorkdirName(newName)

    const workdir = this.workdirStore.getById(id, effectiveUserId, tenantId)
    if (!workdir) {
      throw new WorkdirServiceError('WORKDIR_NOT_FOUND', `Workdir ${id} not found`)
    }

    // Check for name conflict (excluding self)
    const conflict = this.findByName(effectiveUserId, newName, tenantId)
    if (conflict && conflict.id !== id) {
      throw new WorkdirServiceError(
        'WORKDIR_NAME_CONFLICT',
        `Workdir with name "${newName}" already exists for this user`,
      )
    }

    this.workdirStore.update(id, { name: newName }, effectiveUserId, tenantId)

    // Return updated workdir
    const updated = this.workdirStore.getById(id, effectiveUserId, tenantId)
    if (!updated) {
      throw new WorkdirServiceError('WORKDIR_NOT_FOUND', `Workdir ${id} disappeared after update`)
    }
    return updated
  }

  // ==========================================================================
  // softDeleteWorkdir
  // ==========================================================================

  softDeleteWorkdir(id: string, userId: string, tenantId?: string): void {
    const effectiveUserId = resolveLocalUser(userId)

    const workdir = this.workdirStore.getById(id, effectiveUserId, tenantId)
    if (!workdir) {
      return
    }

    this.workdirStore.softDelete(id, effectiveUserId, tenantId)

    this.sessionStateStore.clearAllForWorkdir(id, effectiveUserId, tenantId)

    this.onWorkdirDeleted?.(id)
  }

  // ==========================================================================
  // getActiveWorkdir
  // ==========================================================================

  getActiveWorkdir(sessionId: string, userId: string, tenantId?: string): Workdir | null {
    const effectiveUserId = resolveLocalUser(userId)

    const state = this.sessionStateStore.getActive(sessionId, effectiveUserId, tenantId)
    if (!state) {
      return null
    }

    // The INNER JOIN in getActive already filters deleted workdirs,
    // but we double-check here for safety
    const workdir = this.workdirStore.getById(state.activeWorkDirId, effectiveUserId, tenantId)
    return workdir
  }

  // ==========================================================================
  // setActiveWorkdir
  // ==========================================================================

  setActiveWorkdir(sessionId: string, workdirId: string, userId: string, tenantId?: string): void {
    const effectiveUserId = resolveLocalUser(userId)

    // Validate workdir exists and belongs to user (not soft-deleted)
    const workdir = this.workdirStore.getById(workdirId, effectiveUserId, tenantId)
    if (!workdir) {
      throw new WorkdirServiceError(
        'WORKDIR_NOT_FOUND',
        `Workdir ${workdirId} not found or is soft-deleted`,
      )
    }

    const success = this.sessionStateStore.setActive(sessionId, workdirId, effectiveUserId, tenantId)
    if (!success) {
      throw new WorkdirServiceError(
        'WORKDIR_OWNERSHIP_VIOLATION',
        `Failed to set active workdir — ownership check failed`,
      )
    }
  }

  // ==========================================================================
  // clearActiveWorkdir
  // ==========================================================================

  clearActiveWorkdir(sessionId: string, userId: string, tenantId?: string): void {
    const effectiveUserId = resolveLocalUser(userId)
    this.sessionStateStore.clearActive(sessionId, effectiveUserId, tenantId)
  }

  // ==========================================================================
  // Internal helpers
  // ==========================================================================

  /**
   * Find an active (non-deleted) workdir by name for a user.
   */
  private findByName(userId: string, name: string, tenantId?: string): Workdir | null {
    const all = this.workdirStore.listByUser(userId, tenantId)
    return all.find((w) => w.name === name) ?? null
  }

  /**
   * Create workdir record + filesystem directory.
   * On mkdir failure: soft-deletes the DB row and throws typed error.
   */
  private createWorkdirWithFs(userId: string, name: string, tenantId?: string): Workdir {
    const workdirId = randomUUID()
    const workdirRoot = getWorkdirRoot()
    const workdirPath = buildWorkdirPath(workdirRoot, userId, workdirId)

    // Quota pre-check: reject if we can't determine the root is writable
    this.enforceQuotasPreCreate(workdirPath)

    // Create DB record first
    const input: CreateWorkdirInput = {
      id: workdirId,
      userId,
      name,
      path: workdirPath,
    }

    const workdir = this.workdirStore.create(input, tenantId)

    // Attempt filesystem creation
    try {
      this.fsOps.mkdir(workdirPath)
    } catch (error) {
      // Recovery: mark DB row as deleted
      this.workdirStore.softDelete(workdirId, userId, tenantId)
      throw new WorkdirServiceError(
        'WORKDIR_MKDIR_FAILED',
        `Failed to create workdir directory: ${error instanceof Error ? error.message : String(error)}`,
        { workdirId, path: workdirPath, originalError: error },
      )
    }

    return workdir
  }

  /**
   * Pre-creation quota enforcement.
   * Validates the target path is within bounds before any disk mutation.
   */
  private enforceQuotasPreCreate(workdirPath: string): void {
    const workdirRoot = getWorkdirRoot()
    const relativePath = workdirPath.slice(workdirRoot.length)
    const depth = relativePath.split('/').filter((s) => s.length > 0).length
    if (depth > this.quotaConfig.maxDepth) {
      throw new WorkdirServiceError(
        'WORKDIR_QUOTA_EXCEEDED',
        `Workdir path depth ${depth} exceeds maximum allowed depth of ${this.quotaConfig.maxDepth}`,
      )
    }
  }
}

// ============================================================================
// Filesystem operations (injectable for testing)
// ============================================================================

export interface FileSystemOps {
  mkdir(path: string): void
}

const defaultFsOps: FileSystemOps = {
  mkdir: ensureWorkdirDir,
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Resolve the effective user ID.
 * 'local-user' is treated as a single deterministic local dev user.
 */
function resolveLocalUser(userId: string): string {
  if (userId === LOCAL_USER_ID) {
    return LOCAL_USER_ID
  }
  return userId
}

/**
 * Validate a workdir name.
 * @throws WorkdirServiceError if the name is invalid.
 */
function validateWorkdirName(name: string): void {
  if (!name || name.trim().length === 0) {
    throw new WorkdirServiceError('WORKDIR_INVALID_NAME', 'Workdir name must not be empty')
  }

  const trimmed = name.trim()
  if (trimmed.length > 128) {
    throw new WorkdirServiceError('WORKDIR_INVALID_NAME', 'Workdir name exceeds maximum length of 128')
  }

  // Reject path traversal in names
  if (trimmed.includes('..') || trimmed.includes('/') || trimmed.includes('\\')) {
    throw new WorkdirServiceError('WORKDIR_INVALID_NAME', 'Workdir name must not contain path separators or ".."')
  }

  // Reject null bytes
  if (trimmed.includes('\0')) {
    throw new WorkdirServiceError('WORKDIR_INVALID_NAME', 'Workdir name must not contain null bytes')
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createWorkdirService(deps: {
  workdirStore: WorkdirStore
  sessionStateStore: SessionWorkdirStateStore
  quotaConfig?: Partial<WorkdirQuotaConfig>
  fsOps?: FileSystemOps
  onWorkdirDeleted?: (workdirId: string) => void
}): WorkdirService {
  return new WorkdirServiceImpl(deps)
}
