import type { ConnectionManager } from './connection.js';

/**
 * Sensitivity levels for tool result blobs.
 * Aligned with ToolSensitivity from tools/types.ts.
 */
export type BlobSensitivity = 'low' | 'medium' | 'high' | 'restricted';

/**
 * A persisted blob representing a large tool execution result.
 * The raw content is stored via storageRef; only preview/summary
 * enters the transcript or model-facing context.
 */
export interface ToolResultBlobRecord {
  blobId: string;
  toolCallId: string;
  userId: string;
  sessionId?: string;
  contentType: string;
  preview?: string;
  storageRef: string;
  sensitivity: BlobSensitivity;
  sizeBytes: number;
  createdAt: string;
}

export interface ToolResultBlobStore {
  /** Persist a new blob record. Returns the stored record with generated id/timestamp. */
  createBlob(data: Omit<ToolResultBlobRecord, 'blobId' | 'createdAt'>): ToolResultBlobRecord;
  /** Retrieve a blob by its id. Enforces ownership: caller must match userId or sessionId. */
  getBlob(blobId: string, accessor: { userId?: string; sessionId?: string }): ToolResultBlobRecord | undefined;
  /** Find blobs by tool call id. */
  getBlobByToolCall(toolCallId: string): ToolResultBlobRecord[];
  /** Delete a blob by id. Returns true if deleted. */
  deleteBlob(blobId: string): boolean;
  /** List blobs for a given user, ordered by creation time descending. */
  listBlobsByUser(userId: string, options?: { limit?: number; offset?: number }): ToolResultBlobRecord[];
}

interface BlobRow {
  blob_id: string;
  tool_call_id: string;
  user_id: string;
  session_id: string | null;
  content_type: string;
  preview: string | null;
  storage_ref: string;
  sensitivity: BlobSensitivity;
  size_bytes: number;
  created_at: string;
}

class ToolResultBlobStoreImpl implements ToolResultBlobStore {
  private connection: ConnectionManager;

  constructor(connection: ConnectionManager) {
    this.connection = connection;
  }

  createBlob(data: Omit<ToolResultBlobRecord, 'blobId' | 'createdAt'>): ToolResultBlobRecord {
    const blobId = crypto.randomUUID();
    const createdAt = new Date().toISOString();

    this.connection.exec(
      `INSERT INTO tool_result_blobs (
        blob_id, tool_call_id, user_id, session_id,
        content_type, preview, storage_ref, sensitivity, size_bytes, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        blobId,
        data.toolCallId,
        data.userId,
        data.sessionId ?? null,
        data.contentType,
        data.preview ?? null,
        data.storageRef,
        data.sensitivity,
        data.sizeBytes,
        createdAt,
      ]
    );

    return {
      blobId,
      toolCallId: data.toolCallId,
      userId: data.userId,
      sessionId: data.sessionId,
      contentType: data.contentType,
      preview: data.preview,
      storageRef: data.storageRef,
      sensitivity: data.sensitivity,
      sizeBytes: data.sizeBytes,
      createdAt,
    };
  }

  getBlob(blobId: string, accessor: { userId?: string; sessionId?: string }): ToolResultBlobRecord | undefined {
    const rows = this.connection.query<BlobRow>(
      'SELECT * FROM tool_result_blobs WHERE blob_id = ?',
      [blobId]
    );

    if (rows.length === 0) {
      return undefined;
    }

    const record = this.mapRow(rows[0]);

    // Enforce ownership: accessor must match userId OR sessionId
    if (accessor.userId && record.userId === accessor.userId) {
      return record;
    }
    if (accessor.sessionId && record.sessionId === accessor.sessionId) {
      return record;
    }
    // If no accessor provided, deny access
    if (!accessor.userId && !accessor.sessionId) {
      return undefined;
    }

    return undefined;
  }

  getBlobByToolCall(toolCallId: string): ToolResultBlobRecord[] {
    const rows = this.connection.query<BlobRow>(
      'SELECT * FROM tool_result_blobs WHERE tool_call_id = ? ORDER BY created_at ASC',
      [toolCallId]
    );
    return rows.map(row => this.mapRow(row));
  }

  deleteBlob(blobId: string): boolean {
    this.connection.exec('DELETE FROM tool_result_blobs WHERE blob_id = ?', [blobId]);
    const rows = this.connection.query<{ count: number }>(
      'SELECT COUNT(*) as count FROM tool_result_blobs WHERE blob_id = ?',
      [blobId]
    );
    return rows[0]?.count === 0;
  }

  listBlobsByUser(userId: string, options: { limit?: number; offset?: number } = {}): ToolResultBlobRecord[] {
    const { limit = 100, offset = 0 } = options;
    const rows = this.connection.query<BlobRow>(
      'SELECT * FROM tool_result_blobs WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
      [userId, limit, offset]
    );
    return rows.map(row => this.mapRow(row));
  }

  private mapRow(row: BlobRow): ToolResultBlobRecord {
    return {
      blobId: row.blob_id,
      toolCallId: row.tool_call_id,
      userId: row.user_id,
      sessionId: row.session_id ?? undefined,
      contentType: row.content_type,
      preview: row.preview ?? undefined,
      storageRef: row.storage_ref,
      sensitivity: row.sensitivity,
      sizeBytes: row.size_bytes,
      createdAt: row.created_at,
    };
  }
}

export function createToolResultBlobStore(connection: ConnectionManager): ToolResultBlobStore {
  return new ToolResultBlobStoreImpl(connection);
}
