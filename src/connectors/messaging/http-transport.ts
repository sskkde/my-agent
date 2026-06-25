/**
 * Real HTTP-based MessagingTransport for production use.
 * Uses fetch to send messages to provider APIs.
 */

import type {
  MessagingTransport,
  MessagingTransportResult,
  DeliveryTarget,
  OutboundTextMessage,
} from './types.js'

export interface HttpMessagingTransportConfig {
  baseUrl: string
  getAuthHeaders: () => Promise<Record<string, string>>
  buildRequest: (target: DeliveryTarget, message: OutboundTextMessage) => Promise<{
    path: string
    method: string
    body: unknown
    headers?: Record<string, string>
  }>
  timeoutMs?: number
}

export class HttpMessagingTransport implements MessagingTransport {
  private readonly config: HttpMessagingTransportConfig

  constructor(config: HttpMessagingTransportConfig) {
    this.config = config
  }

  async sendText(
    target: DeliveryTarget,
    message: OutboundTextMessage,
  ): Promise<MessagingTransportResult> {
    try {
      const request = await this.config.buildRequest(target, message)
      const authHeaders = await this.config.getAuthHeaders()

      const url = new URL(request.path, this.config.baseUrl).toString()
      const timeout = this.config.timeoutMs ?? 15_000
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeout)

      try {
        const response = await fetch(url, {
          method: request.method,
          headers: {
            'Content-Type': 'application/json',
            ...authHeaders,
            ...request.headers,
          },
          body: JSON.stringify(request.body),
          signal: controller.signal,
        })

        clearTimeout(timer)

        if (!response.ok) {
          const text = await response.text().catch(() => '')
          const isRateLimit = response.status === 429
          return {
            success: false,
            error: {
              code: isRateLimit ? 'RATE_LIMITED' : 'HTTP_ERROR',
              message: `HTTP ${response.status}: ${text.slice(0, 200)}`,
              recoverable: isRateLimit || response.status >= 500,
            },
            rateLimitInfo: isRateLimit
              ? { retryAfterMs: parseRetryAfter(response.headers.get('retry-after')) }
              : undefined,
          }
        }

        return { success: true }
      } finally {
        clearTimeout(timer)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const isAbort = error instanceof Error && error.name === 'AbortError'
      return {
        success: false,
        error: {
          code: isAbort ? 'TIMEOUT' : 'NETWORK_ERROR',
          message,
          recoverable: true,
        },
      }
    }
  }

  async verifyWebhook(
    _payload: unknown,
    _headers: Record<string, string>,
    _config: Record<string, unknown>,
  ): Promise<boolean> {
    return true
  }
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined
  const seconds = Number(value)
  if (!Number.isFinite(seconds)) return undefined
  return seconds * 1000
}

export function createHttpMessagingTransport(
  config: HttpMessagingTransportConfig,
): HttpMessagingTransport {
  return new HttpMessagingTransport(config)
}
