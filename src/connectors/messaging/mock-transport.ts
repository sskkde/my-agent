/**
 * Injectable mock messaging transport for testing.
 * Blocks real network by default; records all sendText calls for assertion.
 */

import type {
  MessagingTransport,
  MessagingTransportResult,
  DeliveryTarget,
  OutboundTextMessage,
} from './types.js'

/** Recorded call from MockMessagingTransport.sendText(). */
export interface RecordedSendCall {
  target: DeliveryTarget
  message: OutboundTextMessage
  timestamp: string
}

export interface MockTransportOverrides {
  sendText?: (
    target: DeliveryTarget,
    message: OutboundTextMessage,
  ) => Promise<MessagingTransportResult>
  verifyWebhook?: (
    payload: unknown,
    headers: Record<string, string>,
    config: Record<string, unknown>,
  ) => Promise<boolean>
}

/**
 * Mock transport that records calls and blocks real network by default.
 * Configure via constructor overrides or the static factory.
 */
export class MockMessagingTransport implements MessagingTransport {
  private readonly calls: RecordedSendCall[] = []
  private readonly sendTextFn: (
    target: DeliveryTarget,
    message: OutboundTextMessage,
  ) => Promise<MessagingTransportResult>
  private readonly verifyWebhookFn: (
    payload: unknown,
    headers: Record<string, string>,
    config: Record<string, unknown>,
  ) => Promise<boolean>

  constructor(overrides?: MockTransportOverrides) {
    this.sendTextFn =
      overrides?.sendText ??
      (() => {
        throw new Error(
          'MockMessagingTransport: real network blocked. Provide a sendText override.',
        )
      })
    this.verifyWebhookFn =
      overrides?.verifyWebhook ??
      (() => {
        throw new Error(
          'MockMessagingTransport: real network blocked. Provide a verifyWebhook override.',
        )
      })
  }

  async sendText(
    target: DeliveryTarget,
    message: OutboundTextMessage,
  ): Promise<MessagingTransportResult> {
    this.calls.push({
      target: structuredClone(target),
      message: structuredClone(message),
      timestamp: new Date().toISOString(),
    })
    return this.sendTextFn(target, message)
  }

  async verifyWebhook(
    payload: unknown,
    headers: Record<string, string>,
    config: Record<string, unknown>,
  ): Promise<boolean> {
    return this.verifyWebhookFn(payload, headers, config)
  }

  /** Return a shallow copy of recorded calls. */
  getRecordedCalls(): readonly RecordedSendCall[] {
    return [...this.calls]
  }

  /** Clear recorded call history. */
  clearCalls(): void {
    this.calls.length = 0
  }
}

/**
 * Factory for creating mock transports with sensible defaults.
 * By default, all methods throw to block real network.
 */
export function createMockTransport(
  overrides?: MockTransportOverrides,
): MockMessagingTransport {
  return new MockMessagingTransport(overrides)
}
