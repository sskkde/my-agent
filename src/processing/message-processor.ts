import type {
  MessageProcessor,
  MessageProcessorConfig,
  MessageProcessorInput,
  MessageProcessorOutput,
} from './types.js'
import type { InboundEnvelope } from '../gateway/types.js'

class MessageProcessorImpl implements MessageProcessor {
  private config: MessageProcessorConfig

  constructor(config: MessageProcessorConfig) {
    this.config = config
  }

  async process(input: MessageProcessorInput): Promise<MessageProcessorOutput> {
    const timeoutMs = this.config.timeoutMs
    const processorFn = this.config.processorFn

    return Promise.race([
      this.executeProcessor(processorFn, input),
      this.createTimeoutPromise(input.correlationId, timeoutMs),
    ])
  }

  private async executeProcessor(
    processorFn: (input: MessageProcessorInput) => Promise<MessageProcessorOutput>,
    input: MessageProcessorInput,
  ): Promise<MessageProcessorOutput> {
    try {
      const result = await processorFn(input)
      return result
    } catch (error) {
      return this.createErrorOutput(
        input.correlationId,
        'PROCESSING_ERROR',
        error instanceof Error ? error.message : 'Unknown processing error',
      )
    }
  }

  private createTimeoutPromise(correlationId: string, timeoutMs: number): Promise<MessageProcessorOutput> {
    return new Promise((resolve) => {
      setTimeout(() => {
        const timeoutSeconds = Math.floor(timeoutMs / 1000)
        resolve(
          this.createErrorOutput(correlationId, 'TIMEOUT', `Processing timed out after ${timeoutSeconds} seconds`),
        )
      }, timeoutMs)
    })
  }

  private createErrorOutput(correlationId: string, code: string, message: string): MessageProcessorOutput {
    return {
      correlationId,
      success: false,
      error: {
        code,
        message,
      },
      timestamp: new Date().toISOString(),
    }
  }
}

/**
 * Factory function to create a MessageProcessor instance.
 *
 * @param config - Processor configuration including timeout and processing function
 * @returns MessageProcessor instance
 */
export function createMessageProcessor(config: MessageProcessorConfig): MessageProcessor {
  return new MessageProcessorImpl(config)
}

/**
 * Converts an InboundEnvelope to a channel-neutral MessageProcessorInput.
 *
 * This function strips all channel-specific routing information while preserving
 * correlation metadata needed for transcript linkage. Channel-specific keys
 * (sourceChannel, channel, etc.) are filtered out from metadata.
 *
 * @param envelope - The inbound envelope from the gateway
 * @returns Channel-neutral MessageProcessorInput
 */
export function convertInboundEnvelopeToProcessorInput(envelope: InboundEnvelope): MessageProcessorInput {
  // Filter out channel-specific keys from metadata
  const filteredMetadata: Record<string, unknown> = {}
  if (envelope.metadata) {
    for (const [key, value] of Object.entries(envelope.metadata)) {
      if (key !== 'sourceChannel' && key !== 'channel' && key !== 'channelRegistry') {
        filteredMetadata[key] = value
      }
    }
  }

  return {
    correlationId: envelope.envelopeId,
    userId: envelope.userId,
    sessionId: envelope.sessionId,
    text: envelope.payload.text ?? '',
    timestamp: envelope.timestamp,
    metadata: {
      ...filteredMetadata,
      envelopeEventType: envelope.eventType,
    },
  }
}
