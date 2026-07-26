/**
 * Normalize an OpenAI-compatible base URL so the chat path can be appended as
 * `${base}/chat/completions` without producing `/v1/v1/chat/completions` or
 * double slashes.
 *
 * Rules:
 *   - strip trailing slashes
 *   - if the path already ends with `/v1` (or `/vN`), keep it as-is
 *   - otherwise append `/v1`
 *
 * @example
 *   normalizeOpenAICompatibleBaseUrl('http://localhost:11434')      // → 'http://localhost:11434/v1'
 *   normalizeOpenAICompatibleBaseUrl('http://localhost:11434/')    // → 'http://localhost:11434/v1'
 *   normalizeOpenAICompatibleBaseUrl('http://localhost:11434/v1')   // → 'http://localhost:11434/v1'
 *   normalizeOpenAICompatibleBaseUrl('http://localhost:11434/v1/') // → 'http://localhost:11434/v1'
 *   normalizeOpenAICompatibleBaseUrl('https://api.example.com')    // → 'https://api.example.com/v1'
 */
export function normalizeOpenAICompatibleBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '')
  if (/\/v\d+$/.test(trimmed)) {
    return trimmed
  }
  return `${trimmed}/v1`
}

/**
 * Strip a trailing `/vN` (version) segment from a base URL so that endpoints
 * which live on the origin root (e.g. Ollama `/api/tags`) can be built without
 * the `/v1` prefix.
 *
 * @example
 *   stripVersionSegment('http://localhost:11434/v1') // → 'http://localhost:11434'
 *   stripVersionSegment('http://localhost:11434')     // → 'http://localhost:11434'
 */
export function stripVersionSegment(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '').replace(/\/v\d+$/, '')
}
