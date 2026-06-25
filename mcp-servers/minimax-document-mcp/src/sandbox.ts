/**
 * MCP Server Sandbox Utilities (Barrel Re-Export)
 *
 * Re-exports all sandbox functionality from sub-modules:
 * - sandbox-errors.ts: Error types and factory
 * - sandbox-workspace.ts: Workspace management
 * - sandbox-guards.ts: Size enforcement, timeouts, type guards
 * - sandbox-path.ts: Path safety
 * - sandbox-artifact.ts: Artifact reference resolution
 */

// Error types and factory
export {
  createSandboxError,
  type SandboxErrorCode,
  type SandboxError,
  type SandboxErrorResponse,
  type ArtifactReference,
} from './sandbox-errors.js'

// Workspace management
export {
  createWorkspace,
  cleanupWorkspace,
  withWorkspace,
  type Workspace,
} from './sandbox-workspace.js'

// Size enforcement, timeouts, type guards
export {
  MAX_FILE_SIZE_BYTES,
  SESSION_QUOTA_BYTES,
  TIMEOUT_MS,
  enforceSizeLimit,
  enforceQuota,
  withTimeout,
  getTimeoutMs,
  isSandboxError,
  isNodeError,
  formatBytes,
  type TimeoutClass,
} from './sandbox-guards.js'

// Path safety
export { normalizePath } from './sandbox-path.js'

// Artifact reference resolution
export { resolveArtifactRef } from './sandbox-artifact.js'
