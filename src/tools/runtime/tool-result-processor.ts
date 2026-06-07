import type { ToolExecutionResult, ToolSensitivity } from '../types.js'
import type { ToolResultBlobStore, BlobSensitivity } from '../../storage/tool-result-blob-store.js'

export interface ProcessedResult {
  /** True if result was stored as a blob reference */
  isLargeResult: boolean
  /** The original result (for small results) or a reference wrapper */
  result: ToolExecutionResult
  /** Reference metadata if stored as blob */
  rawBlobRef?: {
    blobId: string
    sizeBytes: number
    contentType: string
  }
  /** Preview string (first N chars of the result) */
  preview?: string
  /** Human-readable summary of the result */
  summary?: string
  /** Reference to the persisted result record */
  persistedResultRef?: string
  /** Sensitivity metadata from tool definition */
  sensitivity: BlobSensitivity
}

export interface ToolResultProcessorOptions {
  /** Size threshold in bytes for storing as blob (default: 8KB) */
  thresholdBytes?: number
  /** Maximum preview length in characters (default: 2000) */
  maxPreviewLength?: number
  /** Tool name for metadata */
  toolName: string
  /** User ID for ownership */
  userId: string
  /** Session ID for ownership */
  sessionId?: string
  /** Sensitivity from tool definition */
  sensitivity?: ToolSensitivity
  /** Tool call ID */
  toolCallId: string
}

const DEFAULT_THRESHOLD_BYTES = 8 * 1024 // 8KB
const DEFAULT_MAX_PREVIEW_LENGTH = 2000

function toBlobSensitivity(sensitivity: ToolSensitivity | undefined): BlobSensitivity {
  if (!sensitivity) return 'low'
  return sensitivity
}

function getOutputSize(output: unknown): number {
  try {
    const serialized = JSON.stringify(output)
    return Buffer.byteLength(serialized, 'utf-8')
  } catch {
    return 0
  }
}

function generatePreview(output: unknown, maxLength: number): string {
  try {
    const serialized = JSON.stringify(output)
    if (serialized.length <= maxLength) {
      return serialized
    }
    return serialized.substring(0, maxLength) + '...'
  } catch {
    return '[Unable to serialize output]'
  }
}

function generateSummary(output: unknown, toolName: string): string {
  if (output === null || output === undefined) {
    return `Tool ${toolName} returned empty result`
  }

  if (typeof output === 'string') {
    const len = output.length
    return `Tool ${toolName} returned string (${len} chars)`
  }

  if (Array.isArray(output)) {
    return `Tool ${toolName} returned array (${output.length} items)`
  }

  if (typeof output === 'object') {
    const keys = Object.keys(output as Record<string, unknown>)
    return `Tool ${toolName} returned object with keys: ${keys.slice(0, 5).join(', ')}${keys.length > 5 ? '...' : ''}`
  }

  return `Tool ${toolName} returned ${typeof output}`
}

function determineContentType(output: unknown): string {
  if (output === null) return 'application/json; type=null'
  if (Array.isArray(output)) return 'application/json; type=array'
  if (typeof output === 'object') return 'application/json; type=object'
  if (typeof output === 'string') {
    try {
      JSON.parse(output)
      return 'application/json; type=string'
    } catch {
      return 'text/plain'
    }
  }
  if (typeof output === 'number') return 'application/json; type=number'
  if (typeof output === 'boolean') return 'application/json; type=boolean'
  return 'application/octet-stream'
}

export class ToolResultProcessor {
  private blobStore: ToolResultBlobStore
  private thresholdBytes: number
  private maxPreviewLength: number

  constructor(blobStore: ToolResultBlobStore, options?: { thresholdBytes?: number; maxPreviewLength?: number }) {
    this.blobStore = blobStore
    this.thresholdBytes = options?.thresholdBytes ?? DEFAULT_THRESHOLD_BYTES
    this.maxPreviewLength = options?.maxPreviewLength ?? DEFAULT_MAX_PREVIEW_LENGTH
  }

  processResult(toolExecutionResult: ToolExecutionResult, options: ToolResultProcessorOptions): ProcessedResult {
    const sensitivity = toBlobSensitivity(options.sensitivity)

    // Handle error/failed results - don't store as blob
    if (!toolExecutionResult.success || toolExecutionResult.error) {
      return {
        isLargeResult: false,
        result: toolExecutionResult,
        sensitivity,
      }
    }

    // Handle synthetic results (cancelled, timeout, skipped)
    if (toolExecutionResult.synthetic) {
      return {
        isLargeResult: false,
        result: toolExecutionResult,
        sensitivity,
      }
    }

    const output = toolExecutionResult.data ?? toolExecutionResult.structuredContent
    if (output === undefined) {
      return {
        isLargeResult: false,
        result: toolExecutionResult,
        sensitivity,
      }
    }

    const sizeBytes = getOutputSize(output)
    const threshold = options.thresholdBytes ?? this.thresholdBytes
    const previewLength = options.maxPreviewLength ?? this.maxPreviewLength

    // Small result: return directly
    if (sizeBytes < threshold) {
      return {
        isLargeResult: false,
        result: toolExecutionResult,
        sensitivity,
      }
    }

    // Large result: store as blob
    const preview = generatePreview(output, previewLength)
    const summary = generateSummary(output, options.toolName)
    const contentType = determineContentType(output)

    // Generate storage reference (in-memory for now, could be file/blob storage)
    const storageRef = `blob:${options.toolCallId}:${Date.now()}`

    const blobRecord = this.blobStore.createBlob({
      toolCallId: options.toolCallId,
      userId: options.userId,
      sessionId: options.sessionId,
      contentType,
      preview,
      storageRef,
      sensitivity,
      sizeBytes,
    })

    // Create result with reference instead of raw data
    const refResult: ToolExecutionResult = {
      success: true,
      resultRef: blobRecord.blobId,
      resultPreview: preview,
      structuredContent: {
        _type: 'blob_ref',
        blobId: blobRecord.blobId,
        summary,
        sizeBytes,
        contentType,
      },
    }

    return {
      isLargeResult: true,
      result: refResult,
      rawBlobRef: {
        blobId: blobRecord.blobId,
        sizeBytes,
        contentType,
      },
      preview,
      summary,
      persistedResultRef: blobRecord.blobId,
      sensitivity,
    }
  }
}

export function createToolResultProcessor(
  blobStore: ToolResultBlobStore,
  options?: { thresholdBytes?: number; maxPreviewLength?: number },
): ToolResultProcessor {
  return new ToolResultProcessor(blobStore, options)
}
