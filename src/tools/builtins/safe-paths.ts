/**
 * Safe Path Helpers for File Tool Boundaries
 * 
 * Enforces workspace root restriction, symlink escape rejection,
 * sensitive file denylist, and binary detection for safe-read tools.
 */

import { realpathSync, lstatSync, existsSync } from 'fs';
import { resolve, basename, extname, relative, isAbsolute } from 'path';

// ============================================================================
// Constants
// ============================================================================

/**
 * Maximum bytes to read from a file (256 KiB)
 */
export const MAX_FILE_READ_BYTES = 256 * 1024;

/**
 * Maximum lines to return from a file read
 */
export const MAX_FILE_READ_LINES = 2000;

/**
 * Maximum number of glob results to return
 */
export const GLOB_RESULT_CAP = 500;

/**
 * Maximum number of grep results to return before truncation
 */
export const GREP_HEAD_LIMIT = 1000;

/**
 * Default limit for session list queries
 */
export const SESSION_LIST_DEFAULT_LIMIT = 20;

/**
 * Maximum limit for session list queries
 */
export const SESSION_LIST_MAX_LIMIT = 100;

/**
 * Default limit for session history queries
 */
export const SESSION_HISTORY_DEFAULT_LIMIT = 50;

/**
 * Maximum limit for session history queries
 */
export const SESSION_HISTORY_MAX_LIMIT = 200;

/**
 * Large result threshold for storage (same as existing tools)
 */
export const LARGE_RESULT_THRESHOLD = 10000;

// ============================================================================
// File Denylist Patterns
// ============================================================================

/**
 * Patterns for sensitive files that should never be read
 */
export const SENSITIVE_FILE_PATTERNS = [
  // Environment files
  /^\.env$/,
  /^\.env\..+$/,
  
  // Private keys and certificates
  /\.pem$/,
  /\.key$/,
  /\.p12$/,
  /\.pfx$/,
  /^id_rsa$/,
  /^id_ed25519$/,
  /^id_dsa$/,
  /^id_ecdsa$/,
  
  // Database files
  /\.sqlite$/,
  /\.sqlite3$/,
  /\.db$/,
  /^data\/.*\.db$/,
];

/**
 * Binary file extensions (non-text files)
 */
export const BINARY_EXTENSIONS = [
  // Executables
  '.exe', '.dll', '.so', '.dylib', '.bin', '.dat',
  
  // Images
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.svg', '.webp',
  
  // Audio/Video
  '.mp3', '.mp4', '.avi', '.mov', '.wmv', '.flv', '.wav', '.ogg',
  
  // Archives
  '.zip', '.tar', '.gz', '.7z', '.rar', '.bz2', '.xz',
  
  // Documents (binary)
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  
  // Other binary
  '.iso', '.dmg', '.apk', '.aab', '.jar', '.war',
];

// ============================================================================
// Workspace Root Management
// ============================================================================

/**
 * Get the canonical workspace root path
 */
export function getWorkspaceRoot(): string {
  return realpathSync(process.cwd());
}

/**
 * Resolve a path to its canonical absolute form
 */
export function resolveCanonicalPath(path: string, workspaceRoot?: string): string {
  const root = workspaceRoot ?? getWorkspaceRoot();
  const absolutePath = isAbsolute(path) ? path : resolve(root, path);
  
  // Get canonical path (resolves symlinks)
  if (!existsSync(absolutePath)) {
    // For non-existent paths, resolve without realpath
    return absolutePath;
  }
  
  return realpathSync(absolutePath);
}

/**
 * Check if a path is within the workspace root
 */
export function isWithinWorkspace(path: string, workspaceRoot?: string): boolean {
  const root = workspaceRoot ?? getWorkspaceRoot();
  const canonicalPath = resolveCanonicalPath(path, root);
  
  // Check if canonical path starts with workspace root
  const relativePath = relative(root, canonicalPath);
  
  // If relative path starts with '..', it's outside workspace
  return !relativePath.startsWith('..') && !isAbsolute(relativePath);
}

// ============================================================================
// Path Safety Checks
// ============================================================================

/**
 * Result of path safety validation
 */
export interface PathSafetyResult {
  safe: boolean;
  error?: {
    code: string;
    message: string;
  };
  canonicalPath?: string;
  relativePath?: string;
}

/**
 * Validate a path for safe reading
 * 
 * Checks:
 * 1. Path is within workspace root
 * 2. No symlink escape
 * 3. Not in sensitive file denylist
 * 4. Not a binary file
 */
export function validatePathSafety(
  path: string,
  workspaceRoot?: string,
  options?: {
    allowBinary?: boolean;
    customDenylist?: RegExp[];
  }
): PathSafetyResult {
  const root = workspaceRoot ?? getWorkspaceRoot();
  
  // Check for .. escape in the original path
  if (path.includes('..')) {
    return {
      safe: false,
      error: {
        code: 'PATH_ESCAPE',
        message: 'Path contains ".." which may escape workspace',
      },
    };
  }
  
  // Resolve to canonical path
  const canonicalPath = resolveCanonicalPath(path, root);
  
  // Check workspace boundary
  if (!isWithinWorkspace(canonicalPath, root)) {
    return {
      safe: false,
      error: {
        code: 'OUTSIDE_WORKSPACE',
        message: 'Path resolves outside workspace root',
      },
    };
  }
  
  // Get relative path for denylist checks
  const relativePath = relative(root, canonicalPath);
  
  // Check sensitive file denylist
  const denylist = options?.customDenylist ?? SENSITIVE_FILE_PATTERNS;
  for (const pattern of denylist) {
    if (pattern.test(relativePath) || pattern.test(basename(relativePath))) {
      return {
        safe: false,
        error: {
          code: 'SENSITIVE_FILE',
          message: `File matches sensitive pattern: ${pattern.source}`,
        },
      };
    }
  }
  
  // Check binary file extension (if not allowed)
  if (!options?.allowBinary) {
    const ext = extname(canonicalPath).toLowerCase();
    if (BINARY_EXTENSIONS.includes(ext)) {
      return {
        safe: false,
        error: {
          code: 'BINARY_FILE',
          message: `File has binary extension: ${ext}`,
        },
      };
    }
  }
  
  return {
    safe: true,
    canonicalPath,
    relativePath,
  };
}

// ============================================================================
// Binary Detection
// ============================================================================

/**
 * Check if a file is binary by sniffing its content
 * 
 * Strategy: Check first 8192 bytes for null bytes (0x00)
 * Null bytes are a strong indicator of binary content
 */
export function isBinaryByContent(buffer: Buffer): boolean {
  const sniffSize = Math.min(buffer.length, 8192);
  
  for (let i = 0; i < sniffSize; i++) {
    if (buffer[i] === 0x00) {
      return true;
    }
  }
  
  return false;
}

/**
 * Check if a file is binary by extension
 */
export function isBinaryByExtension(path: string): boolean {
  const ext = extname(path).toLowerCase();
  return BINARY_EXTENSIONS.includes(ext);
}

/**
 * Combined binary check (extension + content sniffing)
 */
export function isBinaryFile(path: string, buffer?: Buffer): boolean {
  // Fast check by extension
  if (isBinaryByExtension(path)) {
    return true;
  }
  
  // Content sniffing if buffer provided
  if (buffer && isBinaryByContent(buffer)) {
    return true;
  }
  
  return false;
}

// ============================================================================
// Symlink Safety
// ============================================================================

/**
 * Check if a path is a symlink
 */
export function isSymlink(path: string): boolean {
  if (!existsSync(path)) {
    return false;
  }
  
  try {
    const stats = lstatSync(path, { throwIfNoEntry: false });
    return stats?.isSymbolicLink() ?? false;
  } catch {
    return false;
  }
}

/**
 * Validate that symlink target is within workspace
 */
export function validateSymlinkSafety(
  path: string,
  workspaceRoot?: string
): PathSafetyResult {
  const root = workspaceRoot ?? getWorkspaceRoot();
  
  if (!isSymlink(path)) {
    // Not a symlink, use regular validation
    return validatePathSafety(path, root);
  }
  
  // Resolve symlink target
  const targetPath = realpathSync(path);
  
  // Check if target is within workspace
  if (!isWithinWorkspace(targetPath, root)) {
    return {
      safe: false,
      error: {
        code: 'SYMLINK_ESCAPE',
        message: 'Symlink target points outside workspace',
      },
    };
  }
  
  return validatePathSafety(targetPath, root);
}

// ============================================================================
// Path Normalization Helpers
// ============================================================================

/**
 * Normalize a path for display (relative to workspace root)
 */
export function normalizePathForDisplay(
  path: string,
  workspaceRoot?: string
): string {
  const root = workspaceRoot ?? getWorkspaceRoot();
  const canonicalPath = resolveCanonicalPath(path, root);
  
  if (isWithinWorkspace(canonicalPath, root)) {
    return relative(root, canonicalPath);
  }
  
  return canonicalPath;
}

/**
 * Check if multiple paths are all within workspace
 */
export function validateMultiplePaths(
  paths: string[],
  workspaceRoot?: string
): { safe: boolean; errors: Array<{ path: string; error: string }> } {
  const errors: Array<{ path: string; error: string }> = [];
  
  for (const path of paths) {
    const result = validatePathSafety(path, workspaceRoot);
    if (!result.safe && result.error) {
      errors.push({
        path,
        error: result.error.message,
      });
    }
  }
  
  return {
    safe: errors.length === 0,
    errors,
  };
}