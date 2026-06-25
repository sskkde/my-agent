/**
 * Fixture-safe normalization helpers for messaging connectors.
 * Pure functions — no side effects, no network, no provider SDKs.
 */

/**
 * Normalize text for outbound delivery.
 * Trims whitespace and truncates to maxLength if provided.
 *
 * @param text - Raw text to normalize.
 * @param maxLength - Optional maximum length. Text is truncated with `…` suffix.
 * @returns Cleaned text string.
 */
export function normalizeTextForOutbound(text: string, maxLength?: number): string {
  let result = text.trim()

  if (maxLength !== undefined && maxLength > 0 && result.length > maxLength) {
    // Leave room for the ellipsis character
    result = result.slice(0, maxLength - 1) + '…'
  }

  return result
}

/**
 * Build a deterministic external ID from provider and parts.
 * Joins with `:` separator. Useful for deduplication keys.
 *
 * @param provider - Provider identifier string.
 * @param parts - Additional ID parts (conversation id, message id, etc.).
 * @returns Deterministic composite ID.
 */
export function buildExternalId(provider: string, ...parts: string[]): string {
  return [provider, ...parts].join(':')
}
