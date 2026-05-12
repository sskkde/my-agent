/**
 * Dead Letter Queue (DLQ) Types
 *
 * Common types for the dead letter queue module, providing a reliable
 * holding area for events that fail processing after all retries.
 */

export type DeadLetterStatus = 'pending' | 'retrying' | 'discarded' | 'resolved';

export interface DeadLetterRecord {
  eventId: string;
  sourceModule: string;
  sourceId: string;
  reason: string;
  payload?: Record<string, unknown>;
  status: DeadLetterStatus;
  failureCount: number;
  lastError?: string;
  enqueuedAt: string;
  updatedAt: string;
  discardedAt?: string;
  resolvedAt?: string;
}

/**
 * Filters for listing DLQ records.
 */
export interface DeadLetterListFilters {
  module?: string;
  status?: DeadLetterStatus;
}

/**
 * Result of a retry operation.
 */
export interface RetryResult {
  success: boolean;
  error?: string;
}
