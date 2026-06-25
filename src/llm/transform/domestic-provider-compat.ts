/**
 * Domestic Provider Compatibility Layer
 *
 * Handles provider-specific request quirks for domestic (China-based) LLM providers.
 * This is a lightweight transformation applied AFTER the standard OpenAI request body is built.
 *
 * Quirks handled:
 *   1. All providers: Strip empty `tools` array (some reject empty arrays)
 *   2. Moonshot/Kimi: Normalize `tool_choice='required'` → `'auto'` (not supported)
 *   3. MiMo: Map `max_tokens` → `max_completion_tokens` (different API parameter name)
 *
 * Usage:
 *   import { normalizeDomesticProviderRequest } from './domestic-provider-compat'
 *   const body = buildOpenAIChatRequestBody(request)
 *   const normalized = normalizeDomesticProviderRequest(providerType, body)
 */

/**
 * Normalize an OpenAI-compatible request body for a specific domestic provider.
 *
 * @param providerType - The provider type identifier (e.g., 'moonshot', 'mimo')
 * @param body - The already-built OpenAI Chat API request body
 * @returns A new body object with provider-specific quirks applied
 */
export function normalizeDomesticProviderRequest(
  providerType: string,
  body: Record<string, unknown>,
): Record<string, unknown> {
  const normalized = { ...body }

  // Quirk 1: Strip empty tools array for all domestic providers
  // Some domestic providers reject requests with an empty tools array
  if (Array.isArray(normalized.tools) && normalized.tools.length === 0) {
    delete normalized.tools
  }

  // Provider-specific quirks
  switch (providerType) {
    case 'moonshot':
      return applyMoonshotQuirks(normalized)

    case 'mimo':
      return applyMimoQuirks(normalized)

    default:
      return normalized
  }
}

/**
 * Moonshot/Kimi-specific quirks:
 * - `tool_choice='required'` is not supported; normalize to `'auto'`
 */
function applyMoonshotQuirks(body: Record<string, unknown>): Record<string, unknown> {
  if (body.tool_choice === 'required') {
    body.tool_choice = 'auto'
  }
  return body
}

/**
 * MiMo-specific quirks:
 * - Uses `max_completion_tokens` instead of `max_tokens`
 */
function applyMimoQuirks(body: Record<string, unknown>): Record<string, unknown> {
  if ('max_tokens' in body) {
    const maxTokens = body.max_tokens
    delete body.max_tokens
    body.max_completion_tokens = maxTokens
  }
  return body
}

/**
 * Check if a provider type is a known domestic provider that has quirks.
 * Useful for early-exit optimization in the request pipeline.
 *
 * @param providerType - The provider type to check
 * @returns True if the provider has specific quirks beyond the default set
 */
export function hasProviderQuirks(providerType: string): boolean {
  return providerType === 'moonshot' || providerType === 'mimo'
}
