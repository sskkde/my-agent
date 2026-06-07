/**
 * Message Processor Types
 * Channel-neutral contract for processing inbound messages.
 *
 * The MessageProcessor contract converts channel-specific InboundEnvelope
 * into a channel-neutral MessageProcessorInput, ensuring no routing,
 * delivery, or channel-specific concerns leak into processing logic.
 */

/**
 * Error result shape for MessageProcessorOutput
 */
export interface MessageProcessorError {
  /** Error code for programmatic handling */
  code: string
  /** Human-readable error message */
  message: string
  /** Optional additional error details */
  details?: Record<string, unknown>
}

/**
 * Channel-neutral input for message processing.
 * Contains only correlation/session metadata and message content.
 * NO channel routing, delivery, or registry references.
 */
export interface MessageProcessorInput {
  /** Correlation ID for tracing (maps from envelopeId) */
  correlationId: string
  /** User identifier */
  userId: string
  /** Session identifier */
  sessionId: string
  /** Message text content */
  text: string
  /** ISO timestamp of the message */
  timestamp: string
  /** Optional metadata for correlation/linkage (channel-specific keys are filtered out) */
  metadata?: Record<string, unknown>
}

/**
 * Result content for successful processing
 */
export interface MessageProcessorResult {
  /** Response text (if any) */
  text?: string
  /** Decision route taken */
  route?: string
  /** Additional result data */
  data?: Record<string, unknown>
}

/**
 * Channel-neutral output from message processing.
 * Contains processing result or error with correlation tracking.
 */
export interface MessageProcessorOutput {
  /** Correlation ID matching the input */
  correlationId: string
  /** Whether processing succeeded */
  success: boolean
  /** Result data (if success is true) */
  result?: MessageProcessorResult
  /** Error details (if success is false) */
  error?: MessageProcessorError
  /** ISO timestamp of the output */
  timestamp: string
}

/**
 * MessageProcessor interface
 * Contract for processing messages with timeout support.
 */
export interface MessageProcessor {
  /**
   * Process a message and return a channel-neutral result.
   * Must respect the configured timeout.
   *
   * @param input - Channel-neutral message input
   * @returns Promise resolving to processing output with matching correlationId
   */
  process(input: MessageProcessorInput): Promise<MessageProcessorOutput>
}

/**
 * Configuration for creating a MessageProcessor
 */
export interface MessageProcessorConfig {
  /** Timeout in milliseconds (default: 30000) */
  timeoutMs: number
  /** Core processing function to wrap with timeout/error handling */
  processorFn: (input: MessageProcessorInput) => Promise<MessageProcessorOutput>
}

/**
 * Factory function type for creating MessageProcessor instances
 */
export type MessageProcessorFactory = (config: MessageProcessorConfig) => MessageProcessor
